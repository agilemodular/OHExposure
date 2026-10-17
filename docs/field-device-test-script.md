# Field device test script

**Purpose:** close dependency D10 by testing offline field capture on the actual devices the pilot site will use.
**Who:** a field technician and a practitioner, with the devices in their managed configuration (passcode, encryption, MDM).
**Environment:** the pilot environment with a test organisation, or a staging copy. Never the demo tenant.

Record the device make and model, operating system version, browser and version for each run.

## Before you start

- Sign in once on each device while online and open **Field sampling** so the page and reference lists are stored on the device.
- Have a monitoring plan in *scheduled* or *in progress* status, with at least one worker, instrument and method.

## Tests

| # | Step | Expected result | Pass? | Notes |
|---|---|---|---|---|
| F1 | Open Field sampling online | Status reads "Online — all records on this device are synchronised" | | |
| F2 | Switch on airplane mode, then reload the page | Page still opens; status reads "Offline"; reference data date shown | | |
| F3 | Create a personal sample offline with start, finish, flows and tasks | Saved; shows "Waiting to sync" | | |
| F4 | Create a second sample with an interruption (start/end/reason) | Saved; interruption kept | | |
| F5 | Close the browser completely, reopen Field sampling offline | Both records still listed as waiting | | |
| F6 | Switch airplane mode off | Within a minute both show "Synchronised"; records appear under **Samples** on the server with correct times and time zone | | |
| F7 | Edit a synchronised sample offline; meanwhile a practitioner edits the same sample online; then reconnect | Device shows "Conflict — kept for review"; the practitioner sees both versions on **Sync conflicts**; nothing is overwritten | | |
| F8 | Use an instrument with expired calibration | Sync returns a visible warning; sample flagged on the server | | |
| F9 | Sign out while a record is waiting to sync; sign in as a different user | Device refuses to hand over until the first user syncs | | |
| F10 | Suspend the technician's account on the server, then try to sync from the device | Sync refused; records stay on the device; message asks to sign in again | | |
| F11 | Keep the device offline for 8 days, then open Field sampling while still offline | Device refuses to use expired reference data and asks to reconnect | | |
| F12 | Use **Clear this device** with an unsynchronised record | Warning shown before anything is deleted | | |
| F13 | Check readability in direct sunlight and with gloves | Text, buttons and inputs usable | | |

## Known limits to brief users on

- Records are stored unencrypted in the browser until they sync. Devices must be managed and passcode-protected.
- A suspended user can still capture records on a device that stays offline; those records are rejected when it reconnects.
- Private/incognito browser windows may lose offline records when closed. Do not use them.

## Result

| Device | OS / browser | All tests passed? | Defects raised | Tester | Date |
|---|---|---|---|---|---|
| | | | | | |
