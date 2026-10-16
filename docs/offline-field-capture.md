# Offline field capture

Client: `public/field.js` (no framework) with service worker `public/sw.js`. Server endpoint: `POST /api/sync`.

## How it works

1. While online, `/field` loads reference lists (plans scheduled or in progress, worker references, groups, instruments in service, methods, substances) and caches them in IndexedDB with a timestamp.
2. The service worker caches the page shell, styles, script and fonts (network-first, cache fallback).
3. Each new record gets a client UUID and is saved to IndexedDB **before** any network call. Status: *Waiting to sync*.
4. On reconnect (or *Sync now*), pending records are sent in one batch. Each item is processed in its own server transaction:

| Server finding | Outcome | Device state |
|---|---|---|
| UUID unknown | created | Synchronised (server id + version stored) |
| Same UUID, identical content | duplicate (lost acknowledgement) | Synchronised; no second record |
| Edit based on current server version | updated | Synchronised |
| Edit based on an older version, or sample already dispatched/analysed | conflict — both copies stored in `sync_conflicts` | Conflict — kept for review |
| Validation failure (e.g. unknown plan, duplicate sample code) | rejected with message | Rejected — needs correction |

5. Conflicts are resolved by a practitioner or reviewer on **Sync conflicts**, choosing the server or device copy with notes. Nothing is overwritten before that decision.
6. Network failures back off exponentially (10 s → 5 min). An expired session shows "sign in again"; records stay on the device.

Warnings raised during sync (expired calibration, instrument out of service, worker not in a group on that date) are returned to the device and stored on the server's audit record; they are not hidden.

## Verified in a real browser (headless Chromium)

Shell reloads while offline; a record saved offline shows *Waiting to sync*; reconnecting synchronises it; re-sending the same record returns *duplicate*; a sync call without the CSRF header is refused (403). See `test-evidence.md`.

## Supported devices and browsers

Tested: desktop Chromium 141 (headless, via Playwright). Expected to work on current Chrome/Edge (Android, Windows, ChromeOS) and Safari 16.4+ (iOS/macOS), which support service workers and IndexedDB. **Not yet tested on physical site devices** — required before pilot (see checklist). Private/incognito modes may discard IndexedDB on close.

## Local data protection

- Records are stored **unencrypted** in the browser's IndexedDB until synchronised. Use managed devices with a passcode, full-device encryption and remote wipe.
- Worker *names* are cached only if the signed-in user's role may see them; field technicians receive pseudonymous references only.
- The device remembers which user owns the queue. A different user cannot use the device while another user's unsynchronised records remain; once synced, the store is cleared for the new user.
- *Clear this device* wipes local records (with a warning if any are unsynchronised).

## Cache expiry

Reference data older than **7 days** is refused offline; the user must reconnect. Pending records are kept until synchronised regardless of age.

## Limits of remote revocation

Suspending a user or revoking a session takes effect at the device's next connection: sync is refused and the session ends. **While a device stays offline, a revoked user can still view cached reference data and capture new records locally.** Those records will be rejected at sync and remain on the device until cleared. This is inherent to offline operation and must be covered by device management and site procedures.
