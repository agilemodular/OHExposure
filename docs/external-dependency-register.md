# External dependency register

Items outside this build that block or limit a capability. "Blocks" states which capability cannot be claimed until the dependency is resolved.

| # | Dependency | Owner (proposed) | Blocks | Status / next step |
|---|---|---|---|---|
| D1 | Competent occupational hygiene review of calculations, safety rules, report content and workflows | SHEQ Experts — chartered/competent hygienist | Any claim of professional suitability; pilot | Professional validation pack ready (`hygienist-review-pack.md`: 19 conventions, 15 worked examples with tolerances, findings register, sign-off). Reviewer not appointed. Gates G2, G3. |
| D2 | Verified jurisdiction benchmark content (e.g. GB workplace exposure limits) from the current authoritative publication, with rights to reproduce | SHEQ Experts + reviewer | Real benchmark comparisons | **None loaded.** Controlled reference import and provenance enforcement ready (`reference-data-workflow.md`); pilot substances to be chosen by the pilot organisation. Gate G4. |
| D3 | Sampling/analytical method parameters (flow tolerance, minimum volume, suitability) from the method publications in use | Hygienist | Correct flow-drift and volume flags for real methods | Only a synthetic demo method exists. Methods are tenant-configurable. |
| D4 | Laboratory data formats and agreements | Partner laboratories | Live laboratory integration | Manual entry and validated CSV import implemented. No live laboratory feed claimed. |
| D5 | Other Assurentra products' architecture and integration scope (IntegraRisk, WorkAssura, Foresensa, SentriAssure, FireSafe Assure) | Each product owner | Any live integration | Contracts defined; mock transport only. SentriAssure and FireSafe contracts blocked pending a validated use case. |
| D6 | AI provider, data-processing terms and evaluation | SHEQ Experts | AI-assisted extraction/summaries | Disabled (`AI_PROVIDER=none`). Interface and human-acceptance workflow exist; no provider integrated or evaluated. |
| D7 | Production hosting: managed PostgreSQL with PITR, object storage, TLS, secrets management, logging and alerting | SHEQ Experts / hosting partner | Production release; backup/recovery claims beyond rehearsal | Deployment package, production entrypoint, alert webhook, backup and restore-verification scripts ready; hosting, TLS, secrets, alert routing, scheduled backups and a hosting-environment restore still to be provided. Gates G5, G6. |
| D8 | Independent security testing (penetration test) and data-protection impact assessment | SHEQ Experts | Production release; any security claim | Penetration test not done. PIA drafted (`privacy-impact-assessment.md`), not reviewed. No certifications held or claimed. Gates G5, G7. |
| D9 | Retention periods for exposure records, worker identities and audit logs | SHEQ Experts legal/DP adviser with each client | Configured retention | Configurable; no defaults asserted; decision table per record class in the PIA. Disposal requires two people. Gate G7. |
| D10 | Field device fleet testing (Android/iOS, managed devices) | Pilot site | Confidence in offline capture on site | Test script ready (`field-device-test-script.md`, 22 tests). Desktop Chromium only — not device evidence. Gate G9. |
| D11 | Email delivery (invitations, password reset, notifications) | Hosting | Self-service password reset, reminders | Not implemented. Administrators issue temporary passwords, which must be changed at first sign-in. |
| D12 | Permanent product name and domain | SHEQ Experts | Final branding | Branding is configuration (`BRAND_*` variables). |
| D13 | Representative pilot organisation and data | SHEQ Experts | Phase H pilot validation | Not started. Pilot protocol template ready (`pilot-protocol.md`). Gate G1. |
| D14 | Independent security review of offline data protection | SHEQ Experts / security reviewer | Enabling offline capture for real organisations | Implementation and documentation ready. Gate G8. |
| D15 | Support-access and incident procedures, contacts | SHEQ Experts + pilot organisation | Pilot | Not written. Gates G7, G10. |
