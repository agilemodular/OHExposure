// Runs on the sign-in pages (reached after sign-out or session expiry). Removes the field client's cached page shell,
// which contains the previous user's name and form token. It never touches IndexedDB, so encrypted, unsynchronised
// field records are kept for their owner.
if ('caches' in window) caches.keys().then((ks) => ks.filter((k) => k.startsWith('ohea-field-')).forEach((k) => caches.delete(k))).catch(() => {});
