"""Browser check of the offline field client's data protection (desktop Chromium, headless).

EVIDENCE CLASS: emulated desktop browser. This is NOT evidence of validation on an actual mobile device; see
docs/field-device-test-script.md for the device tests that remain outstanding.

Requires the demo database (npm run seed) and a running server (npm run dev) on BASE.
Run: python3 test/browser/field_offline_protection.py
"""
import json, os, re, subprocess, sys, tempfile
from playwright.sync_api import sync_playwright

BASE = os.environ.get('BASE', 'http://localhost:3000')
CHROME = os.environ.get('CHROME', '/opt/pw-browsers/chromium-1194/chrome-linux/chrome')
PIN = 'field-pin-2468'
CODE = 'NF-H1-' + os.urandom(3).hex().upper()
SECRET_TEXT = 'Bench 7 breathing zone marker'
results = []

def check(name, ok, detail=''):
    results.append((name, bool(ok), detail))
    print(('PASS ' if ok else 'FAIL ') + name + (f' — {detail}' if detail else ''))

def login(pg, email):
    pg.goto(BASE + '/login'); pg.fill('input[name=email]', email); pg.fill('input[name=password]', 'demo-password-2026'); pg.click('button')
    pg.wait_for_load_state('networkidle')

KV_JS = """async () => {
  const names = (await indexedDB.databases()).map(d => d.name).filter(n => n.startsWith('ohea-field-u-'));
  const out = [];
  for (const n of names) {
    const db = await new Promise(r => { const q = indexedDB.open(n); q.onsuccess = () => r(q.result); });
    const rows = await new Promise(r => { const t = db.transaction('records'); const a = t.objectStore('records').getAll(); t.oncomplete = () => r(a.result); });
    db.close();
    for (const x of rows) if (x.env) out.push(x.env.kv || 1);
  }
  return out;
}"""
DUMP_IDB = """async () => {
  const names = (await indexedDB.databases()).map(d => d.name);
  const out = {};
  for (const n of names) {
    const db = await new Promise(r => { const q = indexedDB.open(n); q.onsuccess = () => r(q.result); });
    const rec = {};
    for (const s of db.objectStoreNames) {
      rec[s] = await new Promise(r => { const t = db.transaction(s); const st = t.objectStore(s); const a = st.getAll(); const k = st.getAllKeys(); t.oncomplete = () => r({ keys: k.result, values: a.result }); });
    }
    db.close(); out[n] = rec;
  }
  return out;
}"""

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=CHROME)
    ctx = b.new_context(viewport={'width': 420, 'height': 900}, accept_downloads=True)
    pg = ctx.new_page()
    errors = []
    pg.on('pageerror', lambda e: errors.append(str(e)))
    login(pg, 'technician@demo.test')
    pg.goto(BASE + '/field')
    pg.wait_for_selector('text=Protect field records on this device')
    pg.fill('input[name=pin]', PIN); pg.fill('input[name=pin2]', PIN); pg.click('text=Set PIN')
    pg.wait_for_selector('text=New sample')
    pg.wait_for_timeout(1500)  # service worker install

    boot = pg.evaluate("async () => (await (await fetch('/api/field/bootstrap')).json())")
    check('bootstrap sends worker reference codes only (no names)', all(' — ' not in w['label'] for w in boot['workers']) and len(boot['workers']) > 0, f"{len(boot['workers'])} workers")
    check('bootstrap includes organisation recovery public key', bool(boot['offline']['recoveryKey']))

    ctx.set_offline(True)
    pg.reload(); pg.wait_for_selector('text=Unlock field records', timeout=10000)
    check('reload offline requires PIN unlock', True)
    pg.fill('input[name=pin]', 'wrong-pin-000'); pg.click('button:has-text("Unlock")')
    pg.wait_for_selector('text=Incorrect PIN')
    check('wrong PIN refused without deleting records', True)
    pg.fill('input[name=pin]', PIN); pg.click('button:has-text("Unlock")')
    pg.wait_for_selector('text=New sample')
    check('correct PIN unlocks offline using encrypted reference cache', 'cached' in ' '.join(pg.locator('.flash').all_inner_texts()))
    # Change the PIN while offline; the old PIN must stop working and the new one must open the same data.
    NEW_PIN = 'changed-pin-1357'
    pg.click('text=Change PIN'); pg.fill('input[name=pin]', NEW_PIN); pg.fill('input[name=pin2]', NEW_PIN); pg.click('button:has-text("Change PIN")')
    pg.wait_for_selector('text=Device PIN changed')
    pg.click('text=Lock now'); pg.wait_for_selector('text=Unlock field records')
    pg.fill('input[name=pin]', PIN); pg.click('button:has-text("Unlock")'); pg.wait_for_selector('text=Incorrect PIN')
    pg.fill('input[name=pin]', NEW_PIN); pg.click('button:has-text("Unlock")'); pg.wait_for_selector('text=New sample')
    check('changing the PIN re-encrypts the store: old PIN refused, new PIN opens it', 'cached' in ' '.join(pg.locator('.flash').all_inner_texts()))
    PIN = NEW_PIN
    pg.click('text=New sample')
    pg.fill('input[name=sample_code]', CODE)
    pg.select_option('select[name=plan_id]', index=1)
    pg.select_option('select[name=sample_type]', 'static')
    pg.fill('input[name=location_desc]', SECRET_TEXT)
    pg.fill('input[name=start_local]', '2026-10-15T08:00'); pg.fill('input[name=end_local]', '2026-10-15T12:00')
    pg.fill('input[name=flow_pre_lpm]', '2'); pg.fill('input[name=flow_post_lpm]', '2')
    pg.click('text=Save on this device'); pg.wait_for_selector('text=Waiting to sync')

    dump = json.dumps(pg.evaluate(DUMP_IDB))
    worker_refs = [w['label'] for w in boot['workers']]
    plaintext = [s for s in [CODE, SECRET_TEXT, *worker_refs, *[x['title'] for x in boot['plans']]] if s and s in dump]
    check('IndexedDB contains no plaintext record or reference values', not plaintext, f'found: {plaintext}' if plaintext else f'{len(dump)} bytes inspected')
    check('legacy unencrypted database absent', '"ohea-field"' not in dump)

    pg.click('text=Lock now'); pg.wait_for_selector('text=Unlock field records')
    check('lock now clears the view and requires the PIN', CODE not in pg.content())

    # Forgotten-PIN path: export a recovery file from the lock screen (ciphertext only).
    pg.click('text=Forgotten your PIN?')
    with pg.expect_download() as d:
        pg.click('text=Export recovery file')
    path = os.path.join(tempfile.mkdtemp(), 'recovery.json')
    d.value.save_as(path)
    raw = open(path).read()
    rf = json.loads(raw)
    check('recovery file holds one sealed record and no plaintext', len(rf['records']) == 1 and CODE not in raw and SECRET_TEXT not in raw)

    ctx.set_offline(False)
    # A reviewer imports the recovery file server-side.
    ctx2 = b.new_context()
    pg2 = ctx2.new_page()
    login(pg2, 'practitioner@demo.test')
    pg2.goto(BASE + '/field/recovery')
    pg2.set_input_files('input[name=file]', path); pg2.click('button:has-text("Import")')
    pg2.wait_for_selector('.flash')
    msg = pg2.inner_text('.flash')
    check('recovery import creates the record', re.search(r'1 created', msg) is not None, msg)
    pg2.set_input_files('input[name=file]', path); pg2.click('button:has-text("Import")')
    pg2.wait_for_selector('.flash')
    msg2 = pg2.inner_text('.flash')
    check('re-importing the same file is idempotent', '1 already present' in msg2 and 'imported before' in msg2, msg2)

    # The original device unlocks and syncs: the server recognises the record as a duplicate.
    pg.reload(); pg.wait_for_selector('text=Unlock field records')
    pg.fill('input[name=pin]', PIN); pg.click('button:has-text("Unlock")')
    pg.wait_for_selector('.badge.b-ok', timeout=15000)
    check('device sync after recovery is a duplicate, not a second sample', 'Synchronised' in pg.inner_text('table'))

    # Key replacement: a record left unsynchronised on the device is re-sealed to the new key version at the next
    # online unlock, and still recovers if the device never syncs.
    admin_url0 = os.environ.get('DATABASE_ADMIN_URL', 'postgres://postgres:postgres_dev@localhost:5432/ohea')
    tid0 = subprocess.check_output(['psql', admin_url0, '-tAc', "select id from tenants where is_demo limit 1"]).decode().strip()
    ctx.set_offline(True)
    pg.click('text=New sample')
    REKEY = 'NF-RK-' + os.urandom(2).hex().upper()
    pg.fill('input[name=sample_code]', REKEY); pg.select_option('select[name=plan_id]', index=1); pg.select_option('select[name=sample_type]', 'static')
    pg.fill('input[name=start_local]', '2026-10-16T08:00'); pg.fill('input[name=end_local]', '2026-10-16T12:00')
    pg.click('text=Save on this device'); pg.wait_for_selector('text=Waiting to sync')
    kv_before = pg.evaluate(KV_JS)
    subprocess.run(['npx', 'tsx', 'scripts/recovery-keys.ts', 'replace', '--tenant', tid0, '--authorised-by', 'Browser check', '--reason', 'browser re-key test'],
                   env={**os.environ, 'DATABASE_ADMIN_URL': admin_url0}, check=True, capture_output=True)
    pg.route('**/api/sync', lambda route: route.fulfill(status=503, body='down'))   # keep the record unsynchronised
    ctx.set_offline(False)
    pg.reload(); pg.wait_for_selector('text=Unlock field records')
    pg.fill('input[name=pin]', PIN); pg.click('button:has-text("Unlock")'); pg.wait_for_selector('text=New sample')
    pg.wait_for_timeout(800)
    kv_after = pg.evaluate(KV_JS)
    check('after a key replacement, unsynchronised records are re-sealed to the new key version on reconnect', kv_before and kv_after and max(kv_after) > max(kv_before), f'{kv_before} -> {kv_after}')
    pg.click('text=Lock now'); pg.wait_for_selector('text=Unlock field records'); pg.click('text=Forgotten your PIN?')
    with pg.expect_download() as d2:
        pg.click('text=Export recovery file')
    path2 = os.path.join(tempfile.mkdtemp(), 'recovery2.json'); d2.value.save_as(path2)
    pg2.goto(BASE + '/field/recovery'); pg2.set_input_files('input[name=file]', path2); pg2.click('button:has-text("Import")'); pg2.wait_for_selector('.flash')
    check('a re-sealed record recovers through the server after key replacement', '1 created' in pg2.inner_text('.flash'), pg2.inner_text('.flash'))
    pg.unroute('**/api/sync')

    # Shared device: a second user on the same browser profile gets a separate store and cannot read the first.
    ctx.clear_cookies()
    had = pg.evaluate("async () => (await caches.keys()).filter(k => k.startsWith('ohea-field-')).length")
    pg.goto(BASE + '/login'); pg.wait_for_timeout(500)
    left = pg.evaluate("async () => (await caches.keys()).filter(k => k.startsWith('ohea-field-')).length")
    check('reaching the sign-in page removes the cached field page shell (keeps IndexedDB)', had > 0 and left == 0, f'caches before {had}, after {left}')
    login(pg, 'practitioner@demo.test')
    pg.goto(BASE + '/field'); pg.wait_for_selector('text=Protect field records on this device')
    check('second user on a shared device starts with a separate, empty store', CODE not in pg.content())

    # Online-only mode: a platform operator switches offline capture off for the organisation.
    admin_url = os.environ.get('DATABASE_ADMIN_URL', 'postgres://postgres:postgres_dev@localhost:5432/ohea')
    tid = subprocess.check_output(['psql', admin_url, '-tAc', "select id from tenants where is_demo limit 1"]).decode().strip()
    ctl = lambda state: subprocess.run(['npx', 'tsx', 'scripts/platform-controls.ts', 'offline', '--tenant', tid, '--offline', state, '--authorised-by', 'Browser check', '--evidence', 'test/browser'],
                                       env={**os.environ, 'DATABASE_ADMIN_URL': admin_url}, check=True, capture_output=True)
    ctl('off')
    try:
        ctx3 = b.new_context(); pg3 = ctx3.new_page()
        login(pg3, 'practitioner@demo.test')
        # A device that used an earlier version holds an unencrypted 'ohea-field' store with an unsynchronised record.
        pg3.goto(BASE + '/samples')
        legacy_code = 'NF-LEG-' + os.urandom(2).hex().upper()
        pg3.evaluate('''async (code) => {
          const b = await (await fetch('/api/field/bootstrap')).json();
          const db = await new Promise(r => { const q = indexedDB.open('ohea-field', 1); q.onupgradeneeded = () => { q.result.createObjectStore('records', { keyPath: 'client_uuid' }); q.result.createObjectStore('meta'); }; q.onsuccess = () => r(q.result); });
          await new Promise(r => { const t = db.transaction(['records', 'meta'], 'readwrite');
            t.objectStore('meta').put(b.userId, 'owner');
            t.objectStore('records').put({ client_uuid: crypto.randomUUID(), state: 'pending', server_id: null, base_version: null, payload: { plan_id: b.plans[0].id, sample_code: code, sample_type: 'static', timezone: 'Europe/London', start_local: '2026-10-14T08:00', end_local: '2026-10-14T12:00', flow_pre_lpm: 2, flow_post_lpm: 2, interruptions: [] } });
            t.oncomplete = r; });
          db.close();
        }''', legacy_code)
        pg3.goto(BASE + '/field'); pg3.wait_for_selector('text=Online-only capture')
        pg3.click('button:has-text("Send again")')  # earlier records are never sent without the user's action
        pg3.wait_for_selector('.badge.b-ok', timeout=15000)
        names = pg3.evaluate("async () => (await indexedDB.databases()).map(d => d.name)")
        check('online-only mode sends the earlier version\'s unencrypted records when the user confirms, then deletes that store', legacy_code in pg3.content() and 'ohea-field' not in names, str(names))
        check('online-only mode creates no browser database', not [n for n in names if n.startswith('ohea-field')], str(names))
        # Unsent record in online-only mode: warning shown while the page holds it.
        pg3.route('**/api/sync', lambda route: route.fulfill(status=503, body='down'))
        pg3.click('text=New sample'); pg3.fill('input[name=sample_code]', 'NF-UNSENT-' + os.urandom(2).hex())
        pg3.select_option('select[name=plan_id]', index=1); pg3.select_option('select[name=sample_type]', 'static'); pg3.fill('input[name=start_local]', '2026-10-15T08:00')
        pg3.click('text=Save and send'); pg3.wait_for_selector('text=held only in this open page')
        check('online-only mode warns that an unsent record is held only in the open page', True)
        pg3.wait_for_selector('text=Not saved — send again')
        pg3.unroute('**/api/sync'); pg3.click('button:has-text("Send again")')
        try: pg3.wait_for_selector('text=held only in this open page', state='detached', timeout=15000)
        except Exception: pass
        check('the unsent record is sent when the server is reachable again', 'held only in this open page' not in pg3.content(), pg3.inner_text('table')[:300].replace('\n', ' | '))
        ctx3.set_offline(True)
        pg3.evaluate("window.dispatchEvent(new Event('offline'))")
        pg3.wait_for_selector('text=new records cannot be saved')
        check('online-only mode disables new records while offline', pg3.locator('button:has-text("New sample")').is_disabled())
        # The technician's device, which previously held offline data, winds down when offline is switched off.
        pg.goto(BASE + '/logout'); ctx.clear_cookies(); login(pg, 'technician@demo.test')
        pg.goto(BASE + '/field'); pg.wait_for_selector('text=switched off')
        pg.fill('input[name=pin]', PIN); pg.click('button:has-text("Unlock")')
        pg.wait_for_selector('text=Online-only capture', timeout=15000)
        names = pg.evaluate("async () => (await indexedDB.databases()).map(d => d.name)")
        check('switching offline off removes a fully synchronised local store', f"ohea-field-u-{boot['userId']}" not in names, str(names))
    finally:
        ctl('on')

    check('no page errors', not errors, '; '.join(errors))
    b.close()

failed = [r for r in results if not r[1]]
print(f"\n{len(results) - len(failed)}/{len(results)} checks passed (desktop Chromium {'headless'}; not mobile-device evidence)")
sys.exit(1 if failed else 0)
