# Field device acceptance tests

**Purpose:** provide the evidence for pilot gate **G9 (actual field-device testing)** by testing field capture on the devices, operating systems and browsers the pilot site will actually use.
**Who:** a field technician and a practitioner (who also acts as recovery reviewer), with the devices in their managed configuration (passcode, encryption, MDM).
**Environment:** the pilot hosting environment with a test organisation that has offline capture enabled by a platform operator, or a staging copy. Never the demo tenant for recorded evidence.

> **Evidence rule.** Only runs on physical devices count towards G9. Desktop Chromium, browser device emulation, simulators and the automated browser check (`test/browser/field_offline_protection.py`) are useful for regression but **must not be presented as mobile-device validation**. The table at the end distinguishes the two.

## Record for every run

Device make and model · operating system and version · browser and version · managed configuration (MDM, passcode, encryption) · application build (git commit shown in `/readyz` logs or the deployment record) · environment URL · tester · date and time zone · outcome per test · defects and limitations.

## Before you start

- Sign in once online on each device and open **Field sampling**. Set a device PIN when asked.
- Have a monitoring plan in *scheduled* or *in progress* status, with at least one worker reference, instrument and method.
- Note the device's time zone and confirm its clock against a reliable source.

## Tests

| # | Area | Step | Expected result |
|---|---|---|---|
| F1 | Setup | Open Field sampling online for the first time | Asked to set a device PIN (≥ 6 characters); status "Online — all records … synchronised" |
| F2 | Offline access | Airplane mode on, reload | Page opens; PIN required; after unlock, status "Offline" with the reference-data date |
| F3 | Capture | Create a personal sample offline with start, finish, flows and tasks | Saved; "Waiting to sync" |
| F4 | Capture | Create a sample with an interruption | Saved; interruption kept |
| F5 | Attachments | Look for photo/attachment capture in the field client | Not offered offline; message says attachments are added online from the sample page. Then add a photo online from the sample page and confirm it uploads |
| F6 | Restart | Force-close the browser (and separately restart the device) while offline; reopen | PIN required; both records still waiting |
| F7 | Lock | Leave the device untouched for 16 minutes while unlocked | Screen shows "Locked after 15 minutes without activity"; records hidden until the PIN is entered |
| F8 | Wrong PIN | Enter a wrong PIN four times, then the correct one | Delays shown after the third failure; no records deleted; correct PIN unlocks after the delay |
| F9 | Sync | Airplane mode off | Within a minute both records show "Synchronised"; on the server times and time zone are correct and no clock warning appears |
| F10 | Interrupted upload | Start a sync and cut the connection mid-request (toggle airplane mode as *Sync now* is pressed) | Records stay "Waiting to sync" or show "Retrying"; on reconnection they synchronise once — no duplicates on the server |
| F11 | Duplicates | Re-send a synchronised record (repeat F10 so the acknowledgement is lost) | Server reports duplicate; one record only |
| F12 | Conflict | Edit a synchronised sample offline while a practitioner edits it online; reconnect | "Conflict — kept for review"; both versions on **Sync conflicts**; nothing overwritten |
| F13 | Clock / time zone | Set the device clock 20 minutes fast, capture and sync; then set a different time zone and capture | Sync warns that the device clock differed; a start time in the future is refused with a message; stored times reflect the time zone recorded on the record |
| F14 | Session expiry | Let the session expire (or sign out on the server) with a record waiting, then sync | "Your session has ended…"; records stay encrypted; after signing in again they synchronise |
| F15 | Revocation | Suspend the technician on the server, then sync from the device | Sync refused; records stay on the device; a reviewer recovers them from an exported recovery file (F18) |
| F16 | Storage pressure | Fill device storage to near capacity (large video files), then capture | Either saves, or shows an error without losing existing records; note behaviour (browsers may evict storage under pressure — record whether data survived) |
| F17 | Shared device | With a record waiting, sign out; sign in as a second user on the same device | Second user gets a separate, empty store and a notice that another user has unsynchronised records; second user cannot see them; can export that user's recovery file |
| F18 | Recovery | Use *Forgotten your PIN?* → *Export recovery file*; a practitioner imports it on **Recover field records** | Import reports records created (or already present); each recovered record shows it came from the original user; re-importing reports "imported before" |
| F19 | Reference expiry | Keep the device offline 8 days, then open Field sampling offline | Refuses expired reference data and asks to reconnect; unsynchronised records remain and can be exported |
| F20 | Retention | Check the device 25 hours after a successful sync | Synchronised records no longer listed on the device |
| F21 | Offline switched off | Platform operator switches offline capture off; open Field sampling and unlock | Remaining records synchronise; local store removed; page then runs online-only and disables saving while offline |
| F22 | Usability | Use in direct sunlight and with gloves | Text, buttons and inputs usable |

## Known limits to brief users on

- Records are encrypted with your PIN. Anyone who knows your PIN and has your unlocked device can read them. Encryption does not protect against malware or a compromised device.
- If you forget your PIN, records cannot be opened on the device; export a recovery file and give it to a reviewer.
- A suspended user can still open and capture records on a device that stays offline; those records are refused when it reconnects and must be recovered by a reviewer.
- Do not use private/incognito windows. Do not record names or health information in free-text fields.

## Results

### Physical devices (counts towards G9)

| Device | OS | Browser | Build | Tests passed | Defects | Limitations | Tester | Date |
|---|---|---|---|---|---|---|---|---|
| *None yet* | | | | | | | | |

### Emulated / desktop runs (regression only — not device evidence)

| Environment | Build | Coverage | Result | Date |
|---|---|---|---|---|
| Desktop Chromium 141, headless Playwright, 420 × 900 viewport, development server | Phase H1 working tree (see `test-evidence.md`) | Automated equivalents of F1–F3, F6 (reload), F8 (one wrong PIN), F11, F17, F18, F21, plus a scan of IndexedDB for plaintext | 17/17 checks passed | 18 Oct 2026 |
