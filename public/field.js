// Offline field capture client.
// Records are written to IndexedDB first, then synchronised. Each record carries a client UUID
// (idempotency key) and the server version it was based on, so re-sends are recognised as
// duplicates and stale edits become reviewable conflicts instead of overwrites.
(() => {
  'use strict';
  const root = document.getElementById('field-app');
  if (!root) return;
  const USER = root.dataset.user;
  const PRESET_PLAN = root.dataset.plan || '';
  const DB_NAME = 'ohea-field';
  const REF_MAX_AGE_DAYS = 7;

  // ── IndexedDB helpers
  const open = () => new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => { const db = r.result; db.createObjectStore('records', { keyPath: 'client_uuid' }); db.createObjectStore('meta'); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  const tx = async (store, mode, fn) => { const db = await open(); return new Promise((res, rej) => { const t = db.transaction(store, mode); const s = t.objectStore(store); const out = fn(s); t.oncomplete = () => res(out instanceof IDBRequest ? out.result : out); t.onerror = () => rej(t.error); }); };
  const getMeta = (k) => tx('meta', 'readonly', (s) => s.get(k));
  const setMeta = (k, v) => tx('meta', 'readwrite', (s) => s.put(v, k));
  const allRecords = () => tx('records', 'readonly', (s) => s.getAll());
  const putRecord = (r) => tx('records', 'readwrite', (s) => s.put(r));
  const clearAll = async () => { await tx('records', 'readwrite', (s) => s.clear()); await tx('meta', 'readwrite', (s) => s.clear()); };

  const el = (tag, attrs = {}, ...kids) => {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) { if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v); else if (v !== null && v !== undefined && v !== false) e.setAttribute(k, v === true ? '' : v); }
    for (const k of kids.flat()) if (k !== null && k !== undefined && k !== false) e.append(k instanceof Node ? k : document.createTextNode(String(k)));
    return e;
  };
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => { const r = (crypto.getRandomValues(new Uint8Array(1))[0] & 15); return (c === 'x' ? r : (r & 3) | 8).toString(16); }));
  const tzDefault = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/London';

  let ref = null;
  let syncing = false;
  let backoff = 0;

  async function loadReference() {
    // A different user on this device must not see the previous user's queue.
    const owner = await getMeta('owner');
    if (owner && owner !== USER) {
      const pending = (await allRecords()).filter((r) => r.state !== 'synced');
      if (pending.length) return { error: `This device holds ${pending.length} unsynchronised record(s) belonging to another user. They must sign in and sync before this device can be reused.` };
      await clearAll();
    }
    await setMeta('owner', USER);
    try {
      const r = await fetch('/api/field/bootstrap', { credentials: 'same-origin' });
      if (r.status === 401) throw Object.assign(new Error('auth'), { auth: true });
      if (!r.ok) throw new Error('bootstrap failed');
      ref = await r.json();
      await setMeta('ref', ref);
    } catch (e) {
      ref = await getMeta('ref');
      if (!ref) return { error: 'You are offline and this device has no cached reference data yet. Open this page once while online.' };
      const ageDays = (Date.now() - Date.parse(ref.fetchedAt)) / 86400000;
      if (ageDays > REF_MAX_AGE_DAYS) return { error: `Cached reference data is ${Math.floor(ageDays)} days old and has expired. Reconnect to refresh it.` };
      ref.offline = true;
    }
    return {};
  }

  function field(label, input, hint) { return el('label', {}, label, hint ? el('span', { class: 'hint' }, hint) : null, input); }
  function select(name, items, value, blank = '— select —') {
    return el('select', { name }, el('option', { value: '' }, blank), ...items.map((i) => el('option', { value: i.id, selected: i.id === value }, i.label)));
  }

  function form(existing) {
    const p = existing ? existing.payload : { plan_id: PRESET_PLAN, timezone: tzDefault, sample_type: 'personal', interruptions: [] };
    const f = el('form', { class: 'stack panel' });
    const v = (k) => (p[k] ?? '');
    f.append(
      el('h2', {}, existing ? `Edit ${p.sample_code}` : 'New sample'),
      el('div', { class: 'row' },
        field('Plan', (() => { const s = select('plan_id', ref.plans.map((x) => ({ id: x.id, label: `${x.title} (${x.site_name})` })), v('plan_id')); s.required = true; return s; })(), ref.plans.length ? null : 'No plans are scheduled or in progress'),
        field('Sample code', el('input', { name: 'sample_code', required: true, value: v('sample_code'), autocomplete: 'off' })),
        field('Type', el('select', { name: 'sample_type' }, ...['personal', 'static', 'field_blank', 'other'].map((t) => el('option', { value: t, selected: t === v('sample_type') }, t.replace('_', ' ')))))),
      el('div', { class: 'row' },
        field('Worker', select('worker_id', ref.workers, v('worker_id'))),
        field('Group (if more than one)', select('group_id', ref.groups, v('group_id'))),
        field('Location', el('input', { name: 'location_desc', value: v('location_desc') }))),
      el('div', { class: 'row' },
        field('Substance', select('substance_id', ref.substances, v('substance_id'))),
        field('Method', select('method_version_id', ref.methods, v('method_version_id'))),
        field('Instrument', select('instrument_id', ref.instruments, v('instrument_id')))),
      el('div', { class: 'row' },
        field('Time zone', el('input', { name: 'timezone', value: v('timezone') || tzDefault, required: true })),
        field('Start', el('input', { type: 'datetime-local', name: 'start_local', value: v('start_local') })),
        field('Finish', el('input', { type: 'datetime-local', name: 'end_local', value: v('end_local') }))),
      el('div', { class: 'row' },
        field('Flow before (L/min)', el('input', { type: 'number', step: 'any', min: '0', name: 'flow_pre_lpm', value: v('flow_pre_lpm') })),
        field('Flow after (L/min)', el('input', { type: 'number', step: 'any', min: '0', name: 'flow_post_lpm', value: v('flow_post_lpm') })),
        field('Media lot', el('input', { name: 'media_lot', value: v('media_lot') }))),
      field('Interruptions', el('input', { name: 'interruptions_text', value: (p.interruptions || []).map((i) => `${i.start}/${i.end}/${i.reason || ''}`).join('; '), placeholder: '2026-03-02T10:00/2026-03-02T10:30/pump paused for break' }), 'Local times as start/end/reason, separated by semicolons'),
      field('Tasks performed during sampling', el('textarea', { name: 'tasks_performed' }, v('tasks_performed'))),
      el('div', { class: 'row' },
        field('Control status', el('input', { name: 'control_status', value: v('control_status'), placeholder: 'e.g. LEV on, enclosure doors open' })),
        field('Operating conditions', el('input', { name: 'operating_conditions', value: v('operating_conditions') }))),
      field('Deviations from plan', el('textarea', { name: 'deviations' }, v('deviations'))),
      field('Notes', el('textarea', { name: 'notes' }, v('notes'))),
      el('div', { class: 'row' },
        field('Handed over to', el('input', { name: 'handover_to', value: v('handover_to') })),
        field('Handover time', el('input', { type: 'datetime-local', name: 'handover_local', value: v('handover_local') }))),
      el('div', { class: 'actions-row' }, el('button', {}, existing ? 'Save on this device' : 'Save on this device'), el('button', { type: 'button', class: 'secondary', onclick: render }, 'Cancel')),
    );
    f.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const fd = new FormData(f);
      const payload = {};
      for (const [k, val] of fd.entries()) if (k !== 'interruptions_text') payload[k] = typeof val === 'string' ? val.trim() : val;
      const it = String(fd.get('interruptions_text') || '').trim();
      payload.interruptions = it ? it.split(';').map((s) => { const [start, end, ...reason] = s.trim().split('/'); return { start, end, reason: reason.join('/') }; }) : [];
      for (const k of ['flow_pre_lpm', 'flow_post_lpm']) payload[k] = payload[k] === '' ? null : Number(payload[k]);
      const rec = existing
        ? { ...existing, payload, state: 'pending', base_version: existing.version ?? existing.base_version ?? null, message: null, updatedAt: new Date().toISOString() }
        : { client_uuid: uuid(), payload, state: 'pending', server_id: null, version: null, base_version: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      await putRecord(rec);
      render();
      sync();
    });
    return f;
  }

  async function sync() {
    if (syncing || !navigator.onLine) return render();
    syncing = true;
    try {
      const pending = (await allRecords()).filter((r) => r.state === 'pending' || r.state === 'error');
      if (!pending.length) return;
      const res = await fetch('/api/sync', {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'x-csrf-token': ref.csrf },
        body: JSON.stringify({ items: pending.map((r) => ({ client_uuid: r.client_uuid, server_id: r.server_id, base_version: r.base_version, payload: r.payload })) }),
      });
      if (res.status === 401 || res.status === 403) { await setMeta('authProblem', true); throw new Error('Your session has ended. Sign in again to synchronise; records are kept on this device.'); }
      if (!res.ok) throw new Error(`Server responded ${res.status}`);
      await setMeta('authProblem', false);
      const { results } = await res.json();
      for (const r of results) {
        const rec = pending.find((p) => p.client_uuid === r.client_uuid);
        if (!rec) continue;
        if (['created', 'updated', 'duplicate'].includes(r.outcome)) Object.assign(rec, { state: 'synced', server_id: r.server_id, version: r.version, base_version: r.version, message: (r.warnings || []).join(' ') || null });
        else if (r.outcome === 'conflict') Object.assign(rec, { state: 'conflict', server_id: r.server_id, message: r.message });
        else Object.assign(rec, { state: 'rejected', message: r.message });
        rec.syncedAt = new Date().toISOString();
        await putRecord(rec);
      }
      backoff = 0;
      if (ref) ref.offline = false;
    } catch (e) {
      await setMeta('lastError', String(e.message || e));
      backoff = Math.min(300, backoff ? backoff * 2 : 10);
      setTimeout(sync, backoff * 1000);
    } finally {
      syncing = false;
      render();
    }
  }

  const STATE = { pending: ['Waiting to sync', 'b-warn'], synced: ['Synchronised', 'b-ok'], conflict: ['Conflict — kept for review', 'b-bad'], rejected: ['Rejected — needs correction', 'b-bad'], error: ['Retrying', 'b-warn'] };

  async function render() {
    const recs = (await allRecords()).sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
    const lastError = await getMeta('lastError');
    const pending = recs.filter((r) => r.state === 'pending').length;
    root.replaceChildren(
      el('div', { class: `flash ${navigator.onLine ? 'ok' : 'warn'}`, role: 'status' },
        navigator.onLine ? (pending ? `Online — ${pending} record(s) waiting to sync.` : 'Online — all records on this device are synchronised.') : `Offline — ${pending} record(s) saved on this device will sync when you reconnect.`,
        ref && ref.offline ? ` Using reference data cached ${new Date(ref.fetchedAt).toLocaleString()}.` : '',
        lastError && pending ? el('div', { class: 'small' }, `Last sync problem: ${lastError}`) : null),
      el('div', { class: 'actions-row' },
        el('button', { onclick: () => root.replaceChildren(form(null)) }, 'New sample'),
        el('button', { class: 'secondary', onclick: sync, disabled: !navigator.onLine }, 'Sync now'),
        el('button', { class: 'secondary', onclick: async () => {
          const unsynced = (await allRecords()).filter((r) => r.state !== 'synced').length;
          if (unsynced && !confirm(`${unsynced} record(s) are not synchronised and will be lost. Clear anyway?`)) return;
          await clearAll(); location.reload();
        } }, 'Clear this device')),
      recs.length ? el('div', { class: 'tablewrap' }, el('table', {},
        el('thead', {}, el('tr', {}, el('th', {}, 'Sample'), el('th', {}, 'Start'), el('th', {}, 'Status'), el('th', {}, ''))),
        el('tbody', {}, ...recs.map((r) => el('tr', {},
          el('td', {}, r.server_id ? el('a', { href: `/samples/${r.server_id}` }, r.payload.sample_code) : r.payload.sample_code),
          el('td', {}, r.payload.start_local ? r.payload.start_local.replace('T', ' ') : '—'),
          el('td', {}, el('span', { class: `badge ${STATE[r.state][1]}` }, STATE[r.state][0]), r.message ? el('div', { class: 'small' }, r.message) : null),
          el('td', {}, r.state !== 'conflict' ? el('button', { class: 'secondary tiny', onclick: () => root.replaceChildren(form(r)) }, 'Edit') : el('span', { class: 'small muted' }, 'A reviewer will resolve this')))))))
        : el('div', { class: 'empty' }, 'No samples on this device yet. Choose “New sample” to start.'),
      el('p', { class: 'small muted' }, 'Data captured here is stored unencrypted in this browser until it synchronises. Use a managed, passcode-protected device. Access revoked on the server cannot take effect on this device until it next connects.'),
    );
  }

  window.addEventListener('online', sync);
  window.addEventListener('offline', render);
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {});

  loadReference().then((r) => {
    if (r.error) { root.replaceChildren(el('div', { class: 'flash err', role: 'alert' }, r.error)); return; }
    render(); sync();
  });
})();
