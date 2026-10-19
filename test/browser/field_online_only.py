"""Browser check of the online-only field configuration (desktop Chromium, headless).

EVIDENCE CLASS: emulated desktop browser on the demonstration organisation with synthetic data. This is NOT
evidence of behaviour on the pilot devices; the device tests in docs/field-device-test-script.md remain outstanding.

The check switches offline capture OFF for the demo organisation with the platform operator tool, runs, and then
restores the previous setting. Requires the demo database (npm run seed) and a running server on BASE.
Run: python3 test/browser/field_online_only.py
"""
import os, subprocess, sys
from playwright.sync_api import sync_playwright

BASE = os.environ.get('BASE', 'http://localhost:3000')
CHROME = os.environ.get('CHROME', '/opt/pw-browsers/chromium-1194/chrome-linux/chrome')
ADMIN_URL = os.environ.get('DATABASE_ADMIN_URL', 'postgres://postgres:postgres_dev@localhost:5432/ohea')
results = []

def check(ref, name, ok, detail=''):
    results.append((ref, name, bool(ok), detail))
    print(('PASS ' if ok else 'FAIL ') + f'[{ref}] {name}' + (f' — {detail}' if detail else ''))

def sql(q):
    return subprocess.check_output(['psql', ADMIN_URL, '-tAc', q]).decode().strip()

def login(pg, email):
    pg.goto(BASE + '/login'); pg.fill('input[name=email]', email); pg.fill('input[name=password]', 'demo-password-2026'); pg.click('button')
    pg.wait_for_load_state('networkidle')

tid = sql("select id from tenants where is_demo limit 1")
was_on = sql(f"select offline_capture_enabled from tenants where id='{tid}'") == 't'
def offline(state):
    subprocess.run(['npx', 'tsx', 'scripts/platform-controls.ts', 'offline', '--tenant', tid, '--offline', state,
                    '--authorised-by', 'Online-only browser check', '--evidence', 'test/browser/field_online_only.py'],
                   env={**os.environ, 'DATABASE_ADMIN_URL': ADMIN_URL}, check=True, capture_output=True)

sql("delete from login_throttle")
offline('off')
try:
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path=CHROME)
        ctx = b.new_context(viewport={'width': 420, 'height': 900})
        pg = ctx.new_page()
        errors = []
        pg.on('pageerror', lambda e: errors.append(str(e)))
        sync_posts = []
        pg.on('request', lambda r: sync_posts.append(r.url) if r.method == 'POST' and r.url.endswith('/api/sync') else None)

        # A device that ran an earlier version holds an unencrypted store with an unsynchronised record (previously enrolled device).
        login(pg, 'practitioner@demo.test')
        pg.goto(BASE + '/samples')
        legacy_code = 'OO-LEG-' + os.urandom(2).hex().upper()
        pg.evaluate('''async (code) => {
          const b = await (await fetch('/api/field/bootstrap')).json();
          const db = await new Promise(r => { const q = indexedDB.open('ohea-field', 1); q.onupgradeneeded = () => { q.result.createObjectStore('records', { keyPath: 'client_uuid' }); q.result.createObjectStore('meta'); }; q.onsuccess = () => r(q.result); });
          await new Promise(r => { const t = db.transaction(['records', 'meta'], 'readwrite');
            t.objectStore('meta').put(b.userId, 'owner');
            t.objectStore('records').put({ client_uuid: crypto.randomUUID(), state: 'pending', server_id: null, base_version: null, payload: { plan_id: b.plans[0].id, sample_code: code, sample_type: 'static', timezone: 'Europe/London', start_local: '2026-10-14T08:00', end_local: '2026-10-14T12:00', flow_pre_lpm: 2, flow_post_lpm: 2, interruptions: [] } });
            t.oncomplete = r; });
          db.close();
        }''', legacy_code)

        boot_resp = pg.request.get(BASE + '/api/field/bootstrap')
        boot = boot_resp.json()
        check('OO-1', 'offline capture is off for the organisation and no recovery key is issued', boot['offline']['enabled'] is False and not boot['offline']['recoveryKey'])
        check('OO-2', 'field reference data is sent with Cache-Control: no-store', boot_resp.headers.get('cache-control') == 'no-store', boot_resp.headers.get('cache-control'))

        sync_posts.clear()
        pg.goto(BASE + '/field'); pg.wait_for_selector('text=Online-only capture')
        pg.wait_for_timeout(2500)
        check('OO-3', 'records left by an earlier version are shown for review and not sent automatically', legacy_code in pg.content() and not sync_posts and 'Not saved' in pg.content(), f'{len(sync_posts)} sync request(s)')
        pg.click('button:has-text("Send again")'); pg.wait_for_selector('.badge.b-ok', timeout=15000)
        names = pg.evaluate("async () => (await indexedDB.databases()).map(d => d.name)")
        check('OO-3', 'after the user sends them, the earlier store is deleted and no browser database remains', not [n for n in names if n.startswith('ohea-field')], str(names))
        sw = pg.evaluate("async () => (await navigator.serviceWorker.getRegistrations()).length")
        caches = pg.evaluate("async () => (await caches.keys()).filter(k => k.startsWith('ohea-field-'))")
        check('OO-2', 'no service worker and no cached page shell in online-only mode', sw == 0 and not caches, f'registrations {sw}, caches {caches}')

        # Lost connection during a send: the server is unreachable (request never confirmed).
        code = 'OO-NET-' + os.urandom(2).hex().upper()
        pg.route('**/api/sync', lambda route: route.abort('internetdisconnected'))
        pg.click('text=New sample'); pg.fill('input[name=sample_code]', code)
        pg.select_option('select[name=plan_id]', index=1); pg.select_option('select[name=sample_type]', 'static'); pg.fill('input[name=start_local]', '2026-10-15T08:00')
        pg.click('text=Save and send'); pg.wait_for_selector('text=Not saved — send again', timeout=10000)
        txt = pg.inner_text('#field-app')
        check('OO-4', 'a failed send shows a clear "not saved" state', 'Not saved — send again' in txt and 'have not been saved on the server' in txt)
        check('OO-5', 'no saved or synchronised indication without server acknowledgement', 'Saved on the server' not in pg.inner_text('table').split(code)[1].split('\n')[0] if code in pg.inner_text('table') else False)
        check('OO-8', 'the page tells the user what to do (send again; record on paper if the connection does not return)', 'note the details on paper' in txt)

        # Reconnection must not resend by itself.
        pg.unroute('**/api/sync'); sync_posts.clear()
        pg.evaluate("window.dispatchEvent(new Event('online'))"); pg.wait_for_timeout(3000)
        check('OO-7', 'reconnection does not replay the unsent record', not sync_posts and int(sql(f"select count(*) from sampling_events where sample_code='{code}'")) == 0, f'{len(sync_posts)} sync request(s)')

        # Response lost after the server saved the record: the user sends again; no duplicate is created.
        state = {'n': 0}
        def lose_response(route):
            state['n'] += 1
            try:
                resp = route.fetch()  # the server processes the request
                route.abort('connectionreset') if state['n'] == 1 else route.fulfill(response=resp)
            except Exception:
                pass
        pg.route('**/api/sync', lose_response)
        pg.click('button:has-text("Send again")'); pg.wait_for_selector('text=Not saved — send again', timeout=10000)
        saved_once = int(sql(f"select count(*) from sampling_events where sample_code='{code}'"))
        pg.click('button:has-text("Send again")'); pg.wait_for_selector('.badge:has-text("Saved on the server")', timeout=15000)
        n = int(sql(f"select count(*) from sampling_events where sample_code='{code}'"))
        check('OO-6', 'a repeated submission after a lost response creates exactly one record', saved_once == 1 and n == 1, f'after first send {saved_once}, after second {n}')
        pg.unroute_all(behavior='ignoreErrors')

        # Offline: new records cannot be started.
        ctx.set_offline(True); pg.evaluate("window.dispatchEvent(new Event('offline'))")
        pg.wait_for_selector('text=new records cannot be saved')
        check('OO-4', 'while offline, new records cannot be started and the banner says so', pg.locator('button:has-text("New sample")').is_disabled())
        ctx.set_offline(False)

        # Ordinary users cannot turn offline capture on.
        login(pg, 'admin@demo.test')
        r = pg.request.get(BASE + '/admin')
        check('OO-1', 'the organisation administration page offers no offline capture control', r.ok and 'System health' in r.text() and 'offline_capture' not in r.text().lower() and 'enable offline' not in r.text().lower())
        check('OO-1', 'the setting is unchanged after the check', sql(f"select offline_capture_enabled from tenants where id='{tid}'") == 'f')

        check('—', 'no page errors', not errors, '; '.join(errors))
        b.close()
finally:
    offline('on' if was_on else 'off')

failed = [r for r in results if not r[2]]
print(f"\n{len(results) - len(failed)}/{len(results)} checks passed (desktop Chromium, headless; demonstration data; not device evidence)")
sys.exit(1 if failed else 0)
