// Field capture client.
//
// Two modes, chosen by the server's offline policy for the organisation (GET /api/field/bootstrap → offline.enabled):
//  • Online-only: nothing is written to browser storage. Records are sent immediately; saving is disabled while offline.
//  • Offline (enabled by a platform operator after the offline data-protection gate is accepted, or demo tenants):
//    records and cached reference data are encrypted at rest with AES-256-GCM under a key derived from a device PIN
//    (PBKDF2-SHA-256, 310,000 iterations). The key is non-extractable and held in memory only while unlocked; the
//    client locks after inactivity. Each record also carries a recovery envelope sealed to the organisation's public
//    key so that unsynchronised work can be recovered server-side without the PIN. See docs/offline-field-capture.md
//    for what this does and does not protect against.
// Every record carries a client UUID (idempotency key) and the server version it was based on, so re-sends are
// recognised as duplicates and stale edits become reviewable conflicts instead of overwrites.
(() => {
  'use strict';
  const root = document.getElementById('field-app');
  if (!root) return;
  const USER = root.dataset.user;
  const PRESET_PLAN = root.dataset.plan || '';
  const DB_NAME = `ohea-field-u-${USER}`;
  const LEGACY_DB = 'ohea-field';
  const PBKDF2_ITERATIONS = 310000;
  const MIN_PIN = 8; // and at least one non-digit: an all-digit PIN is too easy to guess offline
  const te = new TextEncoder();
  const td = new TextDecoder();
  const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
  const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

  // ── IndexedDB helpers (per-user database; never opened in online-only mode)
  const openDb = (name = DB_NAME) => new Promise((res, rej) => {
    const r = indexedDB.open(name, 1);
    r.onupgradeneeded = () => { const db = r.result; if (!db.objectStoreNames.contains('records')) db.createObjectStore('records', { keyPath: 'client_uuid' }); if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta'); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  const tx = async (store, mode, fn, name) => { const db = await openDb(name); return new Promise((res, rej) => { const t = db.transaction(store, mode); const out = fn(t.objectStore(store)); t.oncomplete = () => { db.close(); res(out instanceof IDBRequest ? out.result : out); }; t.onerror = () => { db.close(); rej(t.error); }; }); };
  const getMeta = (k, name) => tx('meta', 'readonly', (s) => s.get(k), name);
  const setMeta = (k, v) => tx('meta', 'readwrite', (s) => s.put(v, k));
  const delMeta = (k) => tx('meta', 'readwrite', (s) => s.delete(k));
  const rawRecords = (name) => tx('records', 'readonly', (s) => s.getAll(), name);
  const putRaw = (r) => tx('records', 'readwrite', (s) => s.put(r));
  const delRaw = (id) => tx('records', 'readwrite', (s) => s.delete(id));
  const dropDb = (name) => new Promise((res) => { const r = indexedDB.deleteDatabase(name); r.onsuccess = r.onerror = r.onblocked = () => res(); });
  const listDbs = async () => (indexedDB.databases ? (await indexedDB.databases()).map((d) => d.name) : []);

  // ── Crypto
  const deriveKey = async (pin, salt) => crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ITERATIONS },
    await crypto.subtle.importKey('raw', te.encode(pin), 'PBKDF2', false, ['deriveKey']), { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const encJSON = async (key, obj) => { const iv = crypto.getRandomValues(new Uint8Array(12)); return { iv: b64(iv), ct: b64(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, te.encode(JSON.stringify(obj)))) }; };
  const decJSON = async (key, e) => JSON.parse(td.decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(e.iv) }, key, unb64(e.ct))));
  async function sealEnvelope(obj) {
    const pub = await crypto.subtle.importKey('spki', unb64(policy.recoveryKey), { name: 'RSA-OAEP', hash: 'SHA-256' }, false, ['encrypt']);
    const rk = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt']);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, rk, te.encode(JSON.stringify(obj)));
    const wk = await crypto.subtle.encrypt({ name: 'RSA-OAEP' }, pub, await crypto.subtle.exportKey('raw', rk));
    const env = { v: 1, kv: policy.recoveryKeyVersion || 1, wk: b64(wk), iv: b64(iv), ct: b64(ct) };
    // Attestation: HMAC under this user's key (held only inside the PIN-encrypted cache) binds the envelope to the user.
    if (!attestKey) throw new Error('This device needs to connect once to refresh its offline keys before records can be saved on it. Reconnect and unlock again.');
    const hk = await crypto.subtle.importKey('raw', unb64(attestKey), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    env.mac = b64(await crypto.subtle.sign('HMAC', hk, te.encode(`${env.wk}.${env.iv}.${env.ct}`)));
    return env;
  }

  const el = (tag, attrs = {}, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) { if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (v !== null && v !== undefined && v !== false) e.setAttribute(k, v === true ? '' : v); }
    for (const k of kids.flat()) if (k !== null && k !== undefined && k !== false) e.append(k instanceof Node ? k : document.createTextNode(String(k)));
    return e;
  };
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = (crypto.getRandomValues(new Uint8Array(1))[0] & 15); return (c === 'x' ? r : (r & 3) | 8).toString(16); }));
  const tzDefault = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/London';
  const download = (name, obj) => { const a = el('a', { href: URL.createObjectURL(new Blob([JSON.stringify(obj, null, 1)], { type: 'application/json' })), download: name }); document.body.append(a); a.click(); a.remove(); };

  // ── State
  let policy = null;      // { enabled, cacheDays, lockMinutes, syncedRetentionHours, recoveryKey, demo, tenantId }
  let ref = null;         // decrypted reference data (in memory only while unlocked)
  let csrf = null;
  let key = null;         // non-extractable AES key, in memory only while unlocked
  let attestKey = null;   // per-user recovery attestation key, from the encrypted cache, in memory only while unlocked
  let records = [];       // decrypted records (offline mode) or in-memory queue (online-only mode)
  let syncing = false, backoff = 0, lastActivity = Date.now(), lastError = null, weakPin = false;
  const encrypted = () => policy && policy.enabled;

  async function fetchBootstrap() {
    const r = await fetch('/api/field/bootstrap', { credentials: 'same-origin' });
    if (r.status === 401 || r.status === 403) throw Object.assign(new Error('Your session has ended or your access has changed. Sign in again.'), { auth: true });
    if (!r.ok) throw new Error('bootstrap failed');
    return r.json();
  }

  // ── Encrypted record store
  const SECRET_FIELDS = ['payload', 'server_id', 'version', 'base_version', 'message', 'createdAt'];
  async function saveRecord(rec) {
    if (!encrypted()) { records = records.filter((r) => r.client_uuid !== rec.client_uuid).concat(rec); return; }
    const secret = Object.fromEntries(SECRET_FIELDS.map((k) => [k, rec[k] ?? null]));
    const raw = { client_uuid: rec.client_uuid, state: rec.state, updatedAt: rec.updatedAt, syncedAt: rec.syncedAt ?? null, enc: await encJSON(key, secret) };
    // The recovery envelope is refreshed whenever the record changes while unsynchronised.
    if (rec.state !== 'synced') raw.env = await sealEnvelope({ tenant_id: policy.tenantId, user_id: USER, client_uuid: rec.client_uuid, server_id: rec.server_id ?? null, base_version: rec.base_version ?? null, payload: rec.payload, captured_at: rec.createdAt });
    await putRaw(raw);
    records = records.filter((r) => r.client_uuid !== rec.client_uuid).concat(rec);
  }
  async function loadRecords() {
    const out = [];
    for (const raw of await rawRecords()) {
      try { out.push({ ...raw, ...(await decJSON(key, raw.enc)), enc: undefined, env: undefined, envKv: raw.env ? (raw.env.kv || 1) : null }); }
      catch { out.push({ client_uuid: raw.client_uuid, state: 'unreadable', updatedAt: raw.updatedAt, payload: {} }); }
    }
    return out;
  }
  // Synchronised copies are kept briefly for the field worker's reference, then removed from the device.
  async function purgeSynced() {
    const cutoff = Date.now() - policy.syncedRetentionHours * 3600_000;
    for (const raw of await rawRecords()) if (raw.state === 'synced' && raw.syncedAt && Date.parse(raw.syncedAt) < cutoff) await delRaw(raw.client_uuid);
  }

  async function recoveryFile(dbName, userId) {
    const raws = (await rawRecords(dbName)).filter((r) => r.state !== 'synced' && r.env);
    const pol = await getMeta('policy', dbName);
    return raws.length ? { format: 'ohea-field-recovery', version: 1, tenant_id: pol?.tenantId, user_id: userId, exported_at: new Date().toISOString(), records: raws.map((r) => r.env) } : null;
  }
  async function exportRecovery(dbName = DB_NAME, userId = USER) {
    const f = await recoveryFile(dbName, userId);
    if (!f) return alertBox('There are no unsynchronised records to export.');
    download(`field-recovery-${new Date().toISOString().slice(0, 10)}-${userId.slice(0, 8)}.json`, f);
  }

  // ── Locking
  function lock(reason) {
    key = null; ref = null; records = []; attestKey = null;
    showUnlock(reason);
  }
  ['pointerdown', 'keydown', 'touchstart'].forEach((e) => document.addEventListener(e, () => { lastActivity = Date.now(); }, { passive: true }));
  setInterval(() => { if (key && Date.now() - lastActivity > policy.lockMinutes * 60_000) lock(`Locked after ${policy.lockMinutes} minutes without activity.`); }, 15_000);

  const alertBox = (msg, kind = 'err') => root.prepend(el('div', { class: `flash ${kind}`, role: 'alert' }, msg));

  function pinForm({ title, intro, confirmPin, submitLabel, onSubmit, extra }) {
    const f = el('form', { class: 'stack panel', autocomplete: 'off' });
    const p1 = el('input', { type: 'password', name: 'pin', required: true, minlength: confirmPin ? MIN_PIN : 1, inputmode: 'text', autocomplete: confirmPin ? 'new-password' : 'current-password' });
    const p2 = confirmPin ? el('input', { type: 'password', name: 'pin2', required: true, minlength: MIN_PIN, autocomplete: 'new-password' }) : null;
    const msg = el('div', { role: 'status', class: 'small' });
    f.append(el('h2', {}, title), ...intro.map((t) => el('p', { class: 'small' }, t)),
      el('label', {}, `Device PIN`, el('span', { class: 'hint' }, `At least ${MIN_PIN} characters including a letter or symbol. Not your account password.`), p1),
      p2 ? el('label', {}, 'Repeat PIN', p2) : null, msg, el('div', { class: 'actions-row' }, el('button', {}, submitLabel)), extra || null);
    f.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      if (confirmPin && (p1.value.length < MIN_PIN || /^\d+$/.test(p1.value))) { msg.textContent = `Use at least ${MIN_PIN} characters, including at least one letter or symbol.`; return; }
      if (p2 && p1.value !== p2.value) { msg.textContent = 'The PINs do not match.'; return; }
      f.querySelector('button').disabled = true; msg.textContent = 'Working…';
      try { await onSubmit(p1.value, msg); } finally { f.querySelector('button') && (f.querySelector('button').disabled = false); p1.value = ''; if (p2) p2.value = ''; }
    });
    return f;
  }

  async function showSetup() {
    root.replaceChildren(pinForm({
      title: 'Protect field records on this device',
      intro: ['Records you capture offline are encrypted on this device with a PIN that only you know. You will need it to open them again after the screen locks.',
        'If you forget the PIN, unsynchronised records can still be recovered by a reviewer from an exported recovery file, but they cannot be opened on this device.'],
      confirmPin: true, submitLabel: 'Set PIN',
      onSubmit: async (pin) => {
        const salt = crypto.getRandomValues(new Uint8Array(16));
        key = await deriveKey(pin, salt);
        await setMeta('salt', b64(salt));
        await setMeta('verifier', await encJSON(key, { check: 'ohea-field', user: USER }));
        await setMeta('fails', 0);
        await afterUnlock();
      },
    }));
  }

  async function showUnlock(reason) {
    const fails = (await getMeta('fails')) || 0;
    const unsynced = (await rawRecords()).filter((r) => r.state !== 'synced').length;
    root.replaceChildren(
      reason ? el('div', { class: 'flash warn', role: 'status' }, reason) : '',
      pinForm({
        title: 'Unlock field records', intro: [`This device holds ${unsynced} unsynchronised record(s) for your account.`], submitLabel: 'Unlock',
        onSubmit: async (pin, msg) => {
          const n = (await getMeta('fails')) || 0;
          const wait = n >= 3 ? Math.min(300, 2 ** (n - 3) * 5) * 1000 - (Date.now() - ((await getMeta('lastFailAt')) || 0)) : 0;
          if (wait > 0) { msg.textContent = `Too many incorrect attempts. Try again in ${Math.ceil(wait / 1000)} seconds.`; return; }
          const k = await deriveKey(pin, unb64(await getMeta('salt')));
          try { const v = await decJSON(k, await getMeta('verifier')); if (v.user !== USER) throw new Error('user'); }
          catch { await setMeta('fails', n + 1); await setMeta('lastFailAt', Date.now()); msg.textContent = `Incorrect PIN (${n + 1} failed attempt${n ? 's' : ''}). Records are never deleted because of failed attempts.`; return; }
          key = k; await setMeta('fails', 0);
          weakPin = pin.length < MIN_PIN || /^\d+$/.test(pin);
          await afterUnlock();
        },
        extra: el('details', {}, el('summary', {}, 'Forgotten your PIN?'),
          el('p', { class: 'small' }, 'Export a recovery file and give it to a reviewer, who can import it on the “Recover field records” page. The file is encrypted and can only be opened by the server for your organisation. After exporting you may reset this device.'),
          el('div', { class: 'actions-row' },
            el('button', { type: 'button', class: 'secondary', onclick: () => exportRecovery() }, 'Export recovery file'),
            el('button', { type: 'button', class: 'secondary', onclick: async () => {
              if (unsynced && !confirm(`Reset this device? ${unsynced} unsynchronised record(s) will be deleted from this device. Only continue if you have exported a recovery file and it has been imported.`)) return;
              await dropDb(DB_NAME); location.reload();
            } }, 'Reset this device'))),
      }),
      fails >= 3 ? el('p', { class: 'small muted' }, `${fails} failed attempts so far; a delay applies between attempts.`) : '',
    );
  }

  async function afterUnlock() {
    lastActivity = Date.now();
    const saved = await getMeta('policy');
    const enc = await getMeta('refEnc');
    const cached = enc ? await decJSON(key, enc).catch(() => null) : null;
    attestKey = cached && cached.recoveryAttestKey;
    // Reference data: refresh from the server when online, otherwise use the encrypted cache until it expires.
    try {
      const b = await fetchBootstrap();
      // The browser session must belong to the owner of this store (shared profiles, sign-in by someone else).
      if (b.userId !== USER || (saved && saved.tenantId && saved.tenantId !== b.tenantId)) {
        lock('This browser is now signed in as a different user. Sign in as the owner of these records to synchronise them, or export a recovery file.');
        return;
      }
      csrf = b.csrf; ref = b;
      if (b.recoveryAttestKey) attestKey = b.recoveryAttestKey;
      // Keep the saved recovery key while winding down, so records that cannot be synchronised remain recoverable.
      policy = { ...b.offline, enabled: true, windingDown: !b.offline.enabled, recoveryKey: b.offline.recoveryKey || (saved && saved.recoveryKey),
        recoveryKeyVersion: b.offline.recoveryKeyVersion || (saved && saved.recoveryKeyVersion) || 1, tenantId: b.tenantId };

      if (policy.windingDown) { await disableOffline(); return; }
      await setMeta('policy', policy);
      await setMeta('refEnc', await encJSON(key, b));
    } catch (e) {
      ref = cached;
      if (ref) {
        const age = (Date.now() - Date.parse(ref.fetchedAt)) / 86400000;
        if (age > policy.cacheDays) ref = null;
        else { ref.offline = true; csrf = ref.csrf; }
      }
      if (e.auth) lastError = e.message;
    }
    await purgeSynced();
    records = await loadRecords();
    if (!policy.windingDown && attestKey) {
      // Records sealed to an older recovery key version (the organisation's key was replaced) are re-sealed to the
      // current one. Each record is re-sealed in its own write: an interruption leaves the rest on the older version,
      // which the server still accepts, so nothing becomes unrecoverable.
      for (const r of records.filter((x) => x.state !== 'synced' && x.state !== 'unreadable' && x.envKv && x.envKv !== policy.recoveryKeyVersion)) {
        try { await saveRecord(r); r.envKv = policy.recoveryKeyVersion; } catch { /* keep the older envelope */ }
      }
    }
    await migrateLegacy();
    render(); sync();
  }

  // Re-encrypts everything under a key from a new PIN. New ciphertexts are prepared first and written in one
  // transaction, so an interruption leaves either the old PIN or the new PIN working, never a mixture.
  function showChangePin() {
    root.replaceChildren(pinForm({
      title: 'Change device PIN', intro: ['Choose a new PIN for the records on this device. Your account password is not affected.'],
      confirmPin: true, submitLabel: 'Change PIN',
      extra: el('button', { type: 'button', class: 'secondary', onclick: render }, 'Cancel'),
      onSubmit: async (pin, msg) => {
        const salt = crypto.getRandomValues(new Uint8Array(16));
        const k2 = await deriveKey(pin, salt);
        const raws = await rawRecords();
        const out = [];
        for (const raw of raws) { try { out.push({ ...raw, enc: await encJSON(k2, await decJSON(key, raw.enc)) }); } catch { msg.textContent = 'A record could not be re-encrypted; PIN not changed. Export a recovery file first.'; return; } }
        const enc = await getMeta('refEnc');
        const refEnc = enc ? await encJSON(k2, await decJSON(key, enc)) : null;
        const verifier = await encJSON(k2, { check: 'ohea-field', user: USER });
        const db = await openDb();
        await new Promise((res, rej) => {
          const t = db.transaction(['records', 'meta'], 'readwrite');
          for (const r of out) t.objectStore('records').put(r);
          const m = t.objectStore('meta');
          m.put(b64(salt), 'salt'); m.put(verifier, 'verifier'); m.put(0, 'fails'); if (refEnc) m.put(refEnc, 'refEnc');
          t.oncomplete = () => { db.close(); res(); }; t.onerror = () => { db.close(); rej(t.error); };
        });
        key = k2; weakPin = false;
        await render();
        alertBox('Device PIN changed.', 'ok');
      },
    }));
  }

  // Organisation no longer permits offline storage: synchronise what is here, then remove the local database.
  async function disableOffline() {
    records = await loadRecords();
    await syncNow();
    const left = (await rawRecords()).filter((r) => r.state !== 'synced').length;
    if (!left) { await dropDb(DB_NAME); key = null; attestKey = null; policy = { ...policy, enabled: false, windingDown: false }; records = []; render(); return; }
    alertBox(`Offline capture has been switched off for your organisation. ${left} record(s) on this device could not be synchronised; resolve them or export a recovery file.`, 'warn');
    render();
  }

  // Records left in the unencrypted store used by earlier versions are moved into the encrypted store.
  async function migrateLegacy() {
    if (!(await listDbs()).includes(LEGACY_DB)) return;
    try {
      const owner = await getMeta('owner', LEGACY_DB);
      const legacy = (await rawRecords(LEGACY_DB)).filter((r) => r.state !== 'synced');
      if (owner === USER) for (const r of legacy) await saveRecord({ ...r, state: r.state === 'synced' ? 'synced' : 'pending' });
      if (owner === USER || !legacy.length) await dropDb(LEGACY_DB);
      records = await loadRecords();
    } catch { /* leave it for the other user */ }
  }

  // ── Capture form
  function fieldEl(label, input, hint) { return el('label', {}, label, hint ? el('span', { class: 'hint' }, hint) : null, input); }
  function select(name, items, value, blank = '— select —') {
    return el('select', { name }, el('option', { value: '' }, blank), ...items.map((i) => el('option', { value: i.id, selected: i.id === value }, i.label)));
  }
  function form(existing) {
    const p = existing ? existing.payload : { plan_id: PRESET_PLAN, timezone: tzDefault, sample_type: 'personal', interruptions: [] };
    const f = el('form', { class: 'stack panel' });
    const v = (k) => (p[k] ?? '');
    const saveBtn = el('button', {}, encrypted() ? 'Save on this device' : 'Save and send');
    if (!encrypted() && !navigator.onLine) saveBtn.disabled = true;
    f.append(
      el('h2', {}, existing ? `Edit ${p.sample_code}` : 'New sample'),
      !encrypted() ? el('p', { class: 'small' }, 'Online-only capture: this record is sent straight to the server and is not stored on this device. Saving is unavailable while offline.') : null,
      el('div', { class: 'row' },
        fieldEl('Plan', (() => { const s = select('plan_id', ref.plans.map((x) => ({ id: x.id, label: `${x.title} (${x.site_name})` })), v('plan_id')); s.required = true; return s; })(), ref.plans.length ? null : 'No plans are scheduled or in progress'),
        fieldEl('Sample code', el('input', { name: 'sample_code', required: true, value: v('sample_code'), autocomplete: 'off' })),
        fieldEl('Type', el('select', { name: 'sample_type' }, ...['personal', 'static', 'field_blank', 'other'].map((t) => el('option', { value: t, selected: t === v('sample_type') }, t.replace('_', ' ')))))),
      el('div', { class: 'row' },
        fieldEl('Worker reference', select('worker_id', ref.workers, v('worker_id')), 'Reference codes only; names are not held on this device'),
        fieldEl('Group (if more than one)', select('group_id', ref.groups, v('group_id'))),
        fieldEl('Location', el('input', { name: 'location_desc', value: v('location_desc') }))),
      el('div', { class: 'row' },
        fieldEl('Substance', select('substance_id', ref.substances, v('substance_id'))),
        fieldEl('Method', select('method_version_id', ref.methods, v('method_version_id'))),
        fieldEl('Instrument', select('instrument_id', ref.instruments, v('instrument_id')))),
      el('div', { class: 'row' },
        fieldEl('Time zone', el('input', { name: 'timezone', value: v('timezone') || tzDefault, required: true })),
        fieldEl('Start', el('input', { type: 'datetime-local', name: 'start_local', value: v('start_local') })),
        fieldEl('Finish', el('input', { type: 'datetime-local', name: 'end_local', value: v('end_local') }))),
      el('div', { class: 'row' },
        fieldEl('Flow before (L/min)', el('input', { type: 'number', step: 'any', min: '0', name: 'flow_pre_lpm', value: v('flow_pre_lpm') })),
        fieldEl('Flow after (L/min)', el('input', { type: 'number', step: 'any', min: '0', name: 'flow_post_lpm', value: v('flow_post_lpm') })),
        fieldEl('Media lot', el('input', { name: 'media_lot', value: v('media_lot') }))),
      fieldEl('Interruptions', el('input', { name: 'interruptions_text', value: (p.interruptions || []).map((i) => `${i.start}/${i.end}/${i.reason || ''}`).join('; '), placeholder: '2026-03-02T10:00/2026-03-02T10:30/pump paused for break' }), 'Local times as start/end/reason, separated by semicolons'),
      fieldEl('Tasks performed during sampling', el('textarea', { name: 'tasks_performed' }, v('tasks_performed'))),
      el('div', { class: 'row' },
        fieldEl('Control status', el('input', { name: 'control_status', value: v('control_status'), placeholder: 'e.g. LEV on, enclosure doors open' })),
        fieldEl('Operating conditions', el('input', { name: 'operating_conditions', value: v('operating_conditions') }))),
      fieldEl('Deviations from plan', el('textarea', { name: 'deviations' }, v('deviations')), 'Do not record names or health information here'),
      fieldEl('Notes', el('textarea', { name: 'notes' }, v('notes')), 'Do not record names or health information here'),
      el('div', { class: 'row' },
        fieldEl('Handed over to', el('input', { name: 'handover_to', value: v('handover_to') })),
        fieldEl('Handover time', el('input', { type: 'datetime-local', name: 'handover_local', value: v('handover_local') }))),
      el('p', { class: 'small muted' }, 'Photographs and other attachments are added online from the sample page; they are never stored by the offline client.'),
      el('div', { class: 'actions-row' }, saveBtn, el('button', { type: 'button', class: 'secondary', onclick: render }, 'Cancel')),
    );
    f.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      if (!encrypted() && !navigator.onLine) return;
      const fd = new FormData(f);
      const payload = {};
      for (const [k, val] of fd.entries()) if (k !== 'interruptions_text') payload[k] = typeof val === 'string' ? val.trim() : val;
      const it = String(fd.get('interruptions_text') || '').trim();
      payload.interruptions = it ? it.split(';').map((s) => { const [start, end, ...reason] = s.trim().split('/'); return { start, end, reason: reason.join('/') }; }) : [];
      for (const k of ['flow_pre_lpm', 'flow_post_lpm']) payload[k] = payload[k] === '' ? null : Number(payload[k]);
      const now = new Date().toISOString();
      const rec = existing
        ? { ...existing, payload, state: 'pending', base_version: existing.version ?? existing.base_version ?? null, message: null, updatedAt: now }
        : { client_uuid: uuid(), payload, state: 'pending', server_id: null, version: null, base_version: null, createdAt: now, updatedAt: now };
      try { await saveRecord(rec); }
      catch (e) { f.prepend(el('div', { class: 'flash err', role: 'alert' }, `Not saved: ${e.message || e}`)); return; }
      render();
      sync();
    });
    return f;
  }

  // ── Synchronisation
  async function syncNow() {
    const pending = records.filter((r) => r.state === 'pending' || r.state === 'error');
    if (!pending.length) return;
    const send = () => fetch('/api/sync', {
      method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'x-csrf-token': csrf },
      body: JSON.stringify({ device_now: Date.now(), items: pending.map((r) => ({ client_uuid: r.client_uuid, server_id: r.server_id, base_version: r.base_version, payload: r.payload })) }),
    });
    let res = await send();
    if (res.status === 401 || res.status === 403) {
      // The user may have signed in again in another tab: pick up the new form token, but only for the same user.
      try {
        const b = await fetchBootstrap();
        if (b.userId !== USER) throw new Error('This browser is now signed in as a different user. Sign in as the owner of these records to send them.');
        csrf = b.csrf;
        res = await send();
      } catch (e) { if (!e.auth) throw e; }
    }
    if (res.status === 401 || res.status === 403) throw new Error(encrypted()
      ? 'Your session has ended or your access has been withdrawn. Records stay encrypted on this device; sign in again, or ask a reviewer to recover them from an exported recovery file.'
      : 'Your session has ended. Unsent records are held only in this open page: sign in again in another tab, then press “Sync now” here. Closing or reloading this page loses them.');
    if (!res.ok) throw new Error(`Server responded ${res.status}`);
    const { results } = await res.json();
    for (const r of results) {
      const rec = pending.find((p) => p.client_uuid === r.client_uuid);
      if (!rec) continue;
      if (['created', 'updated', 'duplicate'].includes(r.outcome)) Object.assign(rec, { state: 'synced', server_id: r.server_id, version: r.version, base_version: r.version, message: (r.warnings || []).join(' ') || null });
      else if (r.outcome === 'deferred') { Object.assign(rec, { state: 'pending', message: r.message }); await saveRecord(rec); continue; }
      else if (r.outcome === 'conflict') Object.assign(rec, { state: 'conflict', server_id: r.server_id, message: r.message });
      else Object.assign(rec, { state: 'rejected', message: r.message });
      rec.syncedAt = new Date().toISOString();
      await saveRecord(rec);
    }
  }
  async function sync() {
    if (syncing || !navigator.onLine || !ref) return render();
    syncing = true;
    try { await syncNow(); lastError = null; backoff = 0; if (ref) ref.offline = false; }
    catch (e) {
      lastError = String(e.message || e);
      backoff = Math.min(300, backoff ? backoff * 2 : 10);
      setTimeout(sync, backoff * 1000);
    } finally { syncing = false; render(); }
  }

  const STATE = { pending: ['Waiting to sync', 'b-warn'], synced: ['Synchronised', 'b-ok'], conflict: ['Conflict — kept for review', 'b-bad'], rejected: ['Rejected — needs correction', 'b-bad'], error: ['Retrying', 'b-warn'], unreadable: ['Cannot be opened', 'b-bad'] };

  async function otherUsersNotice() {
    const others = (await listDbs()).filter((n) => n && n.startsWith('ohea-field-u-') && n !== DB_NAME);
    const withWork = [];
    for (const n of others) { const c = (await rawRecords(n).catch(() => [])).filter((r) => r.state !== 'synced').length; if (c) withWork.push([n, c]); }
    if (!withWork.length) return null;
    return el('div', { class: 'flash warn' }, `This device also holds encrypted, unsynchronised records for ${withWork.length} other user(s). You cannot open them. `,
      ...withWork.map(([n, c]) => el('button', { class: 'secondary tiny', onclick: () => exportRecovery(n, n.slice('ohea-field-u-'.length)) }, `Export recovery file (${c} record${c > 1 ? 's' : ''})`)));
  }

  async function render() {
    if (encrypted() && !key) return;
    if (!ref) {
      root.replaceChildren(el('div', { class: 'flash err', role: 'alert' }, lastError || 'Reference data is unavailable or has expired. Reconnect to refresh it.'),
        encrypted() ? el('div', { class: 'actions-row' }, el('button', { class: 'secondary', onclick: () => exportRecovery() }, 'Export recovery file'), el('button', { class: 'secondary', onclick: () => lock() }, 'Lock now')) : '');
      return;
    }
    const recs = records.slice().sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
    const pending = recs.filter((r) => r.state === 'pending').length;
    const unsynced = recs.filter((r) => r.state !== 'synced').length;
    root.replaceChildren(
      policy.demo ? el('div', { class: 'flash warn' }, 'Demonstration organisation: use synthetic data only.') : '',
      encrypted() && weakPin ? el('div', { class: 'flash warn' }, `Your device PIN is weaker than now required (at least ${MIN_PIN} characters including a letter or symbol). Choose “Change PIN”.`) : '',
      policy.windingDown ? el('div', { class: 'flash warn' }, 'Offline capture has been switched off for your organisation. Resolve or synchronise the records below (or export a recovery file); new records cannot be saved on this device.') : '',
      !encrypted() && unsynced ? el('div', { class: 'flash err', role: 'alert' }, `${unsynced} record(s) have not reached the server and are held only in this open page. Do not close or reload it until they are synchronised.`) : '',
      el('div', { class: `flash ${navigator.onLine ? 'ok' : 'warn'}`, role: 'status' },
        encrypted()
          ? (navigator.onLine ? (pending ? `Online — ${pending} record(s) waiting to sync.` : 'Online — all records on this device are synchronised.') : `Offline — ${pending} record(s) are encrypted on this device and will sync when you reconnect.`)
          : (navigator.onLine ? 'Online-only capture: records are sent immediately and not stored on this device.' : 'Offline — online-only capture is enabled for your organisation, so new records cannot be saved until you reconnect.'),
        ref.offline ? ` Using reference data cached ${new Date(ref.fetchedAt).toLocaleString()}.` : '',
        lastError ? el('div', { class: 'small' }, `Last sync problem: ${lastError}`) : null),
      await otherUsersNotice(),
      el('div', { class: 'actions-row' },
        el('button', { onclick: () => root.replaceChildren(form(null)), disabled: (!encrypted() && !navigator.onLine) || !!policy.windingDown }, 'New sample'),
        el('button', { class: 'secondary', onclick: sync, disabled: !navigator.onLine }, 'Sync now'),
        encrypted() ? el('button', { class: 'secondary', onclick: () => lock('Locked.') }, 'Lock now') : '',
        encrypted() ? el('button', { class: 'secondary', onclick: showChangePin }, 'Change PIN') : '',
        encrypted() && unsynced ? el('button', { class: 'secondary', onclick: () => exportRecovery() }, 'Export recovery file') : ''),
      recs.length ? el('div', { class: 'tablewrap' }, el('table', {},
        el('thead', {}, el('tr', {}, el('th', {}, 'Sample'), el('th', {}, 'Start'), el('th', {}, 'Status'), el('th', {}, ''))),
        el('tbody', {}, ...recs.map((r) => el('tr', {},
          el('td', {}, r.server_id ? el('a', { href: `/samples/${r.server_id}` }, r.payload.sample_code) : (r.payload.sample_code || '—')),
          el('td', {}, r.payload.start_local ? r.payload.start_local.replace('T', ' ') : '—'),
          el('td', {}, el('span', { class: `badge ${STATE[r.state][1]}` }, STATE[r.state][0]), r.message ? el('div', { class: 'small' }, r.message) : null),
          el('td', {}, ['conflict', 'unreadable'].includes(r.state) ? el('span', { class: 'small muted' }, r.state === 'conflict' ? 'A reviewer will resolve this' : 'Export a recovery file') : el('button', { class: 'secondary tiny', onclick: () => root.replaceChildren(form(r)) }, 'Edit')))))))
        : el('div', { class: 'empty' }, 'No samples on this device yet. Choose “New sample” to start.'),
      el('p', { class: 'small muted' }, encrypted()
        ? `Records are encrypted on this device and locked after ${policy.lockMinutes} minutes without activity. Synchronised copies are removed after ${policy.syncedRetentionHours} hours. Encryption protects records if the device is lost while locked; it does not protect against malware, a compromised browser, someone watching you enter the PIN, or an unlocked unattended device. Withdrawn access takes effect on this device only when it next connects.`
        : 'Nothing is stored on this device by the field client.'),
    );
  }

  // Online-only mode: warn before closing a page that still holds unsent records.
  window.addEventListener('beforeunload', (ev) => { if (policy && !encrypted() && records.some((r) => r.state !== 'synced')) { ev.preventDefault(); ev.returnValue = ''; } });

  // Earlier versions stored records unencrypted in 'ohea-field'. In online-only mode the owner's unsynchronised records
  // are loaded into this page and sent; the old store is deleted only once nothing in it would be lost.
  async function legacyOnlineOnly() {
    if (!(await listDbs()).includes(LEGACY_DB)) return;
    try {
      const owner = await getMeta('owner', LEGACY_DB);
      const legacy = (await rawRecords(LEGACY_DB)).filter((r) => r.state !== 'synced');
      if (!legacy.length) { await dropDb(LEGACY_DB); return; }
      if (owner !== USER) { lastError = `This device holds ${legacy.length} unsynchronised record(s) from an earlier version belonging to another user. They must sign in here to send them.`; return; }
      records = legacy.map((r) => ({ ...r, state: 'pending' }));
      if (navigator.onLine) { await syncNow(); if (records.every((r) => r.state === 'synced' || r.state === 'conflict')) await dropDb(LEGACY_DB); }
    } catch (e) { lastError = String(e.message || e); }
  }

  window.addEventListener('online', sync);
  window.addEventListener('offline', render);
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {});

  (async () => {
    // Policy comes from the server; when offline, the last policy saved for this user on this device is used.
    let b = null;
    try { b = await fetchBootstrap(); } catch (e) { lastError = e.auth ? e.message : null; }
    const known = (await listDbs()).includes(DB_NAME);
    if (b) { policy = { ...b.offline, tenantId: b.tenantId }; csrf = b.csrf; }
    else if (known) policy = await getMeta('policy');
    if (!policy) { root.replaceChildren(el('div', { class: 'flash err', role: 'alert' }, lastError || 'You are offline and this device has not been set up for offline capture. Open this page once while online.')); return; }
    if (!policy.enabled) {
      if (known) { // offline was switched off: unlock once to synchronise and remove local data (saved policy kept)
        return (await getMeta('salt')) ? showUnlock('Offline capture has been switched off for your organisation. Unlock to synchronise and remove the records held on this device.') : (await dropDb(DB_NAME), location.reload());
      }
      ref = b; records = []; await legacyOnlineOnly(); render(); sync(); return;
    }
    if (b) await setMeta('policy', policy);
    if (await getMeta('salt')) showUnlock(); else showSetup();
  })();
})();
