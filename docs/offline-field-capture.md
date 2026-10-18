# Offline field capture

Client: `public/field.js` (no framework) with service worker `public/sw.js`. Server endpoints: `GET /api/field/bootstrap`, `POST /api/sync`, recovery page `/field/recovery`.

**Status (18 Oct 2026):** offline data protection implemented and checked in desktop Chromium (headless). **Not tested on any actual field device.** Pilot gate G8 (offline data protection) and G9 (field-device testing) remain open — see `pilot-gate-register.md`. Until G8 is accepted, offline storage stays switched off for every real organisation and is used only in the demonstration organisation with synthetic data.

## Modes

The organisation's offline policy decides the mode. Only a platform operator can change it (`scripts/platform-controls.ts offline`), with an evidence reference; organisation administrators cannot (the application database role has no update right on that column).

| Mode | When | What is stored on the device |
|---|---|---|
| **Online-only** (default for every new organisation) | Offline gate not accepted for the organisation | Nothing written to IndexedDB or the Cache API by the field client. Records are sent immediately; *New sample* is disabled while offline. The service worker still caches the static page shell (no record data). |
| **Offline, encrypted** | Platform operator has enabled offline capture after gate G8 is accepted; demo organisation (synthetic data only) | Encrypted records, encrypted reference cache, and non-secret metadata (see below). |

When offline capture is switched off for an organisation that previously had it, the next unlock synchronises what is on the device and deletes the local database if nothing is left unsynchronised. Anything that cannot be synchronised stays (encrypted) with a prompt to resolve it or export a recovery file.

## Review of every local persistence location

| Location | Contents | Protection | Retention |
|---|---|---|---|
| IndexedDB `ohea-field-u-<user id>` / `records` | One entry per record: `client_uuid`, sync `state`, `updatedAt`, `syncedAt` in clear; `enc` = AES-256-GCM ciphertext of payload, server id/version, message; `env` = recovery envelope (unsynchronised records only) | Device-PIN key; recovery envelope sealed to the organisation key | Synchronised copies deleted 24 h after sync; unsynchronised kept until synchronised, recovered or the user resets the device |
| IndexedDB `…/meta` | `salt`, `verifier` (ciphertext of a fixed check value), `fails`, `lastFailAt`, `policy` (offline flag, lock/retention settings, organisation id, organisation recovery **public** key), `refEnc` (encrypted reference data) | Reference data encrypted with the device-PIN key; other items are not secret | Reference data refused after 7 days |
| Cache API `ohea-field-v2` (service worker) | `/field` page shell, CSS, JS, fonts | None needed: no record data. The cached `/field` page contains the signed-in user's name and id and the site navigation | Replaced on each online visit; old caches deleted on activation |
| Browser memory | Decrypted records and reference data, the derived key | Cleared on lock (inactivity or *Lock now*) and on page close | While unlocked |
| Downloaded recovery file | Recovery envelopes only (ciphertext), organisation id, user id, export time | Opened only by the server for that organisation | User's responsibility after download; hand to a reviewer and delete |
| Earlier unencrypted store `ohea-field` (versions before H1) | Plaintext records | Migrated into the encrypted store at the owner's first unlock, then deleted; deleted at once if it holds nothing unsynchronised | Removed on first use of this version |
| Cookies | Session cookie (HttpOnly, SameSite=Lax, Secure in production) | Server-side session; revocable | Session lifetime (10 h default) |

The field client never stores attachments or photographs. Attachments are uploaded online from the sample page.

## Minimum offline dataset

`/api/field/bootstrap` sends only what capture needs: plans scheduled or in progress (title, site name), **worker reference codes only** (no names or employee numbers, whatever the user's role), exposure groups, instruments in service, method versions, substances, the CSRF token, and the offline policy. The mapping from worker reference code to person stays on the server under the identifiable-data guard (`app.pii`). Free-text fields carry a reminder not to record names or health information. Pseudonymous references are still personal data where the organisation can re-identify them, so they are encrypted at rest like everything else.

Restricted datasets that are never sent to a device: worker names and employee numbers, health or medical information (not collected by this product), laboratory results, assessments, reports, attachments, audit records.

## Encryption and key handling

- **Key derivation:** PBKDF2-SHA-256, 310,000 iterations, 16-byte random salt per device and user, from a device PIN of at least 6 characters chosen by the user. The key is created as a **non-extractable** WebCrypto AES-GCM 256-bit key and kept only in memory while unlocked. The PIN is not stored; a verifier (ciphertext of a fixed value naming the user) checks it.
- **Records and reference data:** AES-256-GCM with a fresh 96-bit IV for every write.
- **Recovery envelopes:** for every unsynchronised record, a fresh AES-256-GCM key encrypts the record (with organisation id and user id inside); that key is wrapped with the organisation's RSA-OAEP-256 (3072-bit) public key. The private key is stored in `field_recovery_keys` encrypted with AES-256-GCM under `FIELD_RECOVERY_KEK`, a 32-byte key held outside the database. The server refuses to start in production without `FIELD_RECOVERY_KEK`. Development and test use a fixed, publicly known key that protects nothing.
- **Wrong PIN:** each failure is counted; after three, a delay applies (5 s doubling to 5 min). Records are **never** deleted because of failed attempts (to avoid silent loss); the protection against guessing is the PBKDF2 cost and the delay, which a determined attacker with a copy of the database can bypass by guessing offline. A longer PIN or passphrase is the user's main defence.
- **Lock:** automatic after 15 minutes without interaction, and *Lock now*. Locking discards the key and all decrypted data from memory.

## What this protects against — and what it does not

Protects (provided the device is locked or the browser closed):

- a lost or stolen device whose browser storage is copied, against casual or moderately resourced attackers, for PINs with reasonable length;
- another user of a shared device or shared browser profile reading someone else's records (separate per-user database; different key);
- record content appearing in a recovery file that is mislaid (envelopes open only on the server for that organisation).

Does **not** protect against:

- malware, a malicious browser extension or a compromised operating system on the device;
- someone using the device while it is unlocked, or watching the PIN being entered;
- offline guessing of short or predictable PINs by an attacker who has copied the database (PBKDF2 slows guessing; it does not prevent it);
- a compromised server or a compromised `FIELD_RECOVERY_KEK` (recovery envelopes could then be opened);
- browser or OS bugs in WebCrypto or storage isolation;
- metadata visible without the PIN: the number of records, their sync state and timestamps, the user id in the database name;
- data copied off the device by the user (screenshots, notes).

Device controls therefore remain required for pilot use: managed devices with a device passcode, full-device encryption, screen lock and remote wipe, no shared browser profiles where avoidable, and no private/incognito windows (they may discard IndexedDB).

## Synchronisation, conflicts and recovery

1. Each new record gets a client UUID and is saved (encrypted) **before** any network call. Status: *Waiting to sync*.
2. On reconnect or *Sync now*, pending records are sent in one batch with the device's clock (`device_now`). Each item is processed in its own server transaction:

| Server finding | Outcome | Device state |
|---|---|---|
| UUID unknown | created | Synchronised (server id + version stored) |
| Same UUID, identical content | duplicate (lost acknowledgement or already recovered) | Synchronised; no second record |
| Edit based on current server version | updated | Synchronised |
| Edit based on an older version, or sample already dispatched/analysed | conflict — both copies stored in `sync_conflicts` | Conflict — kept for review |
| Validation failure (unknown plan, duplicate sample code, start or finish more than 15 min in the future by server time) | rejected with message | Rejected — needs correction |
| Field sync suspended for the organisation (stop condition) | rejected with the suspension reason | Kept on the device, unchanged |

3. **Device clock:** the server records the difference between its clock and the device clock on each record created by sync (`device_clock_offset_s`) and returns a warning when it exceeds 5 minutes. Future times are refused rather than stored.
4. Conflicts are resolved by a practitioner or reviewer on **Sync conflicts**, choosing the server or device copy with notes. Nothing is overwritten before that decision.
5. Network failures back off exponentially (10 s → 5 min).
6. **Recovery without the PIN or the user's session** (forgotten PIN, revoked account, damaged browser profile, user left): *Export recovery file* (on the lock screen, the main screen, and for other users' stores on a shared device) downloads the envelopes. A user with the `conflicts.resolve` permission imports it on **Recover field records** (`/field/recovery`). The server checks the organisation, opens each envelope, rejects any whose sealed organisation or user does not match the file header or whose ciphertext fails authentication, and passes the rest through the normal sync path — so already-present records become duplicates and stale edits become conflicts. Each recovered record keeps `recovered_from_user`; every import is recorded in `field_recovery_imports` (append-only), audited, and raises an alert. Re-importing the same file is harmless and is reported.

## Shared devices and revoked users

- Each user has a separate encrypted database; one user cannot open another's records, and a second user's sign-in does not delete the first user's unsynchronised work. The second user sees a notice and may export the other user's recovery file (ciphertext only) for a reviewer.
- **Revocation takes effect at the device's next connection.** A suspended or removed user, or a revoked session, gets 401/403 on sync; records stay encrypted on the device and are recoverable by a reviewer from a recovery file. **While a device stays offline, a revoked user who knows the PIN can still open their cached data and capture new records locally.** This is inherent to offline operation; the 7-day reference expiry and 24-hour synced-record purge limit the exposure, and device management must cover the rest.

## Evidence

Desktop Chromium (headless Playwright, 18 Oct 2026), `test/browser/field_offline_protection.py`, 17/17 checks: worker names absent from bootstrap; PIN required after reload offline; wrong PIN refused without deletion; offline unlock uses the encrypted cache; **no plaintext sample code, location text, worker references or plan titles anywhere in IndexedDB**; lock clears the view; recovery file contains no plaintext; reviewer import creates the record and re-import is idempotent; device sync afterwards is a duplicate; a second user on the same profile gets a separate empty store; online-only mode creates no browser database and disables saving offline; switching offline off removes a fully synchronised store. Server-side recovery tests (forged organisation, tampered ciphertext, permission, idempotency) are in `test/assurance.test.ts`.

**This is emulated desktop evidence, not validation on an actual mobile device.** Field-device tests are in `field-device-test-script.md` and are not yet run.
