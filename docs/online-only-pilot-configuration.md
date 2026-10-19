# Online-only pilot configuration

**Status: proposed for consideration. Not accepted.** Prepared 19 October 2026 (post-H2). This document defines the configuration in which the pilot would run with offline capture **disabled**, records what was verified, and proposes how gates G8 and G9 apply to it. The gate owners named below must accept or reject the proposal; until then G8 and G9 keep their full scope in `pilot-gate-register.md`.

Online-only operation reduces what is held on a device. It does **not** remove device, browser or privacy risks (§4).

## 1. Configuration

| Setting | Online-only value | How it is set and checked |
|---|---|---|
| Offline capture for the pilot organisation | **Off** | Off by default for every organisation created with `scripts/provision-tenant.ts`. Only a platform operator can change it (`platform-controls.ts offline`, audited with evidence). The application database role cannot update the column; organisation administrators have no control for it. |
| Organisation recovery key | Not issued to devices | The field bootstrap sends no recovery key or attestation key while offline capture is off. |
| Service worker and page-shell cache | None | The field page registers no service worker in online-only mode and removes any earlier registration and `ohea-field-*` cache. |
| Browser storage written by the field client | None | No IndexedDB, Cache Storage or localStorage writes in online-only mode. |
| HTTP caching of pages and API responses | `Cache-Control: no-store` | Set for every HTML and JSON response. |
| Records not acknowledged by the server | Held only in the open page, marked *Not saved — send again* | Never resent automatically (not on reconnection, not on a timer). The user presses **Send again**. Leaving or reloading the page asks for confirmation. |
| Duplicate protection | Server idempotency on the record's client identifier, plus one submission at a time from the page | A resend after a lost response is recognised as a duplicate; the unique sample code is a second barrier. |
| Earlier local data on a device | Explicit | An earlier unencrypted store is shown for review and sent only on **Send again**, then deleted. An encrypted store from a period when offline was on asks for the PIN, synchronises, and is removed only when nothing in it is unsynchronised (offline wind-down). Pilot devices should start from a clean browser profile (§5, O1). |
| Session | MFA required; idle expiry 120 min; absolute 10 h; `COOKIE_SECURE=true` behind TLS | `operations.md` §Security controls; hosting evidence under G5. |

## 2. Verification of the eight online-only requirements

Evidence class: automated desktop Chromium check on the demonstration organisation with synthetic data (`test/browser/field_online_only.py`, **17/17**, 19 Oct 2026), plus a review of commit `e385f7b` and a re-check of its fixes by a separate AI review agent with no part in writing the code (R3; not a human or external security review). **None of this is evidence from the pilot devices**: the same behaviours must be exercised on them (§5).

| # | Requirement | Result | Evidence |
|---|---|---|---|
| 1 | Offline enrolment and capture cannot be enabled by ordinary users | Pass | OO-1 checks; app role refused on the column (`review-regressions.test.ts`, independent review) |
| 2 | Sensitive responses not intentionally retained in offline caches | Pass | OO-2: no service worker, no shell cache, no browser database, `no-store` headers. Residual: a device winding down an earlier offline store keeps its shell cache until the next page load. |
| 3 | Previously enrolled devices and local data handled explicitly | Pass | OO-3 (earlier unencrypted store: review then user send, then deletion); offline wind-down (existing browser check and independent review) |
| 4 | Loss of connectivity gives a clear unsaved or failed state | Pass after fix | *Not saved — send again* with an explanation; *New sample* disabled offline; a half-completed form is kept on screen with a notice (review finding fixed in `3ac4474`) |
| 5 | No indication of saved without server acknowledgement | Pass | *Saved on the server* only after the server's response; rejections, 400 responses and suspension holds are never shown as saved |
| 6 | Repeated submissions do not create duplicates | Pass | OO-6: resend after a lost response, and a double submission from the page, each leave one record |
| 7 | Reconnection does not silently replay queued records | Pass | OO-7: no request on the `online` event or on resumption |
| 8 | Practical guidance for interrupted fieldwork | Pass after fix | On-screen messages; paper-sheet procedure in `pilot-user-guides.md` (field technician §6–7) |

The independent re-check of the fixes made after the review is recorded in `findings-register.md` §5.

## 3. Interrupted fieldwork (summary of the user guidance)

1. Check signal at the sampling locations before the visit; carry the paper field sheet.
2. If a record cannot be saved, keep sampling as planned and write the details on the sheet at the time.
3. Do not rely on the open page: a flat battery, a crash or a closed tab loses unsent records.
4. Back in signal, press **Send again** for each *Not saved* record, then enter paper-only records with **New sample**, noting in *Deviations* that they were entered from a paper sheet.
5. During a suspension, a record is not saved as a sample; a copy is held on the server for review. Keep the page open or keep the paper record, and send again once synchronisation is resumed.

## 4. Risks that remain in online-only operation

| Risk | Why it remains | Control |
|---|---|---|
| Unsent records lost if the page closes | By design nothing is stored on the device | Paper field sheet; warnings; leave-page confirmation |
| Signed-in session on a lost or unattended device | Session cookies live in the browser until expiry or sign-out | Device screen lock; idle expiry; MFA; suspend the user if a device is lost (SC6) |
| Shared devices and shared browser profiles | Another person may use the same browser | One profile per user; sign out at the end of the shift (O9) |
| Browser features outside the application | Autofill, screenshots, download folder (reports, exports), browser sync, extensions | Managed devices; restrict downloads and extensions where the device management allows |
| Malware or a compromised browser | Outside the application's control | Device management, OS updates |
| Worker data visible on screen | Worker reference codes only in the field client; names only to authorised roles | Role design; PIA (G7) |

## 5. Proposed scope of G8 and G9 for an online-only pilot

These are **proposals**. A gate is not accepted because offline capture is disabled; each gate keeps its identity and its remaining requirements.

### G8 Offline data protection

| G8 requirement | Concerns offline protection? | Proposal for the online-only pilot | Accepts the scope decision |
|---|---|---|---|
| Independent review of the offline design and implementation finds no unresolved high-severity issue | Yes | **Exclude while offline capture is off.** Reopens if offline is enabled for any pilot organisation (reopening table). | Platform owner + controller |
| Controller accepts documented offline limitations (PIN strength R-M8, page cache R-L1) | Yes | **Exclude while offline capture is off.** | Controller |
| Device-management requirements agreed | Partly | **Retain** for online-only: screen lock, supported OS and browser versions, one browser profile per user, no browser password or form autofill for the application, OS updates, ability to report and suspend a lost device | Controller + pilot site lead |
| Offline capture stays off for real organisations until accepted | Yes | **Retain** (this is the online-only configuration) | Platform owner |
| Online-only verification (§2) on the pilot build | No (new) | **Add** as a G8 condition: §2 results accepted, independent re-check closed | Platform owner + independent security reviewer |
| External security review of the online application | No | **Retain under G5** (penetration test or a documented decision to pilot without one) | Hosting owner / SHEQ Experts director |
| Data-protection requirements (roles, retention, support access) | No | **Retain under G7** | DP adviser + controller |

### G9 Actual field-device testing

Device testing is **retained** for the online-only pilot. Each named device model, OS version and browser actually intended for use must be tested in its managed configuration.

| Test | Proposal | Reason |
|---|---|---|
| F1 PIN setup, F2 offline access, F3 offline capture, F6 restart offline, F7 lock, F8 wrong PIN, F18 recovery file, F19 reference expiry, F20 retention, F23 change PIN | **Exclude** while offline capture is off | They exercise the encrypted on-device store, PIN and recovery, which are not used in online-only mode |
| F16 storage pressure | **Exclude** | Nothing is stored on the device in online-only mode |
| F21 offline switched off | **Exclude for new pilot devices; retain** for any device that ran with offline capture on | Applies only where an encrypted store exists |
| F4 interruptions, F5 attachments online, F12 conflict, F13 clock and time zone, F14 session expiry, F15 revocation, F17 shared device, F22 usability | **Retain**, run online | Behaviour does not depend on offline storage |
| F9–F11 sync, interrupted upload, duplicates | **Replace** with O3–O6 below | Online-only equivalents |
| O1–O10 (below) | **Add** | Online-only behaviours |

Online-only device tests (to add to `field-device-test-script.md`):

| # | Test | Expected |
|---|---|---|
| O1 | Fresh managed browser profile; open Field sampling | *Online-only capture* banner; no PIN prompt; browser storage for the site empty (developer tools or MDM inspection) |
| O2 | Capture and **Save and send** in good signal | *Saved on the server*; record visible on the server |
| O3 | Start **Save and send**, cut the connection mid-request | *Not saved — send again*; nothing shows as saved |
| O4 | Restore the connection; wait 2 minutes | Nothing is sent automatically; the record is still *Not saved* |
| O5 | Press **Send again** | *Saved on the server*; exactly one record on the server |
| O6 | Lose the response (toggle airplane mode just after pressing) then **Send again** | One record on the server (duplicate recognised) |
| O7 | Begin a form, then lose signal | The form and its contents stay on screen; Save disabled; notice shown |
| O8 | With a *Not saved* record, try to close or reload the page | The browser asks for confirmation |
| O9 | Sign out and sign in as a second user on the same profile | No previous user's records or form visible |
| O10 | Paper-sheet fallback drill: enter a record from the paper sheet after a simulated outage | Record saved with the deviation note; the times match the sheet |

## 6. Decisions requested

| Decision | Owner | Evidence for acceptance |
|---|---|---|
| Run the pilot online-only (offline capture off) | SHEQ Experts director + pilot organisation (G1/G11) | This document; pilot protocol |
| Accept the proposed G8 scope | Platform owner + controller | Signed scope decision recorded in the G8 decision log |
| Accept the proposed G9 test list | Pilot site lead + SHEQ field technician | Test list attached to the G9 record; results on each named device |
| Device-management requirements | Controller + pilot site lead | Written device standard for the named devices |
