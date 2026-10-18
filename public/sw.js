// Service worker: keeps the field client shell available offline. It never caches API responses
// other than through the client's own IndexedDB store, and never intercepts non-GET requests.
const CACHE = 'ohea-field-v2';
const SHELL = ['/field', '/static/app.css', '/static/field.js', '/static/fonts/atkinson-hyperlegible-latin-400-normal.woff2', '/static/fonts/atkinson-hyperlegible-latin-700-normal.woff2'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => Promise.all(SHELL.map((u) => fetch(u, { credentials: 'same-origin' }).then((r) => (r.ok && !r.redirected ? c.put(u, r) : null)).catch(() => null)))));
  self.skipWaiting();
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || !SHELL.includes(url.pathname)) return;
  // Network first so the shell stays current; fall back to the cached copy when offline.
  e.respondWith(fetch(e.request).then((r) => {
    if (r.ok && !r.redirected) { const copy = r.clone(); caches.open(CACHE).then((c) => c.put(url.pathname, copy)); }
    return r;
  }).catch(() => caches.match(url.pathname)));
});
