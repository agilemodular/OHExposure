# External dependency register

Items outside this build that block or limit a capability. "Blocks" states which capability cannot be claimed until the dependency is resolved.

| # | Dependency | Owner (proposed) | Blocks | Status / next step |
|---|---|---|---|---|
| D1 | Competent occupational hygiene review of calculations, safety rules, report content and workflows | SHEQ Experts — chartered/competent hygienist | Any claim of professional suitability; pilot | Not started. Review `calculation-and-benchmark-specifications.md` and `safety-rule-register.md` first. |
| D2 | Verified jurisdiction benchmark content (e.g. GB workplace exposure limits) from the current authoritative publication, with rights to reproduce | SHEQ Experts + reviewer | Real benchmark comparisons | **None loaded.** Tenants can enter limits that a second person verifies. Decide whether to maintain platform reference data, and check licensing of any proprietary limit database. |
| D3 | Sampling/analytical method parameters (flow tolerance, minimum volume, suitability) from the method publications in use | Hygienist | Correct flow-drift and volume flags for real methods | Only a synthetic demo method exists. Methods are tenant-configurable. |
| D4 | Laboratory data formats and agreements | Partner laboratories | Live laboratory integration | Manual entry and validated CSV import implemented. No live laboratory feed claimed. |
| D5 | Other Assurentra products' architecture and integration scope (IntegraRisk, WorkAssura, Foresensa, SentriAssure, FireSafe Assure) | Each product owner | Any live integration | Contracts defined; mock transport only. SentriAssure and FireSafe contracts blocked pending a validated use case. |
| D6 | AI provider, data-processing terms and evaluation | SHEQ Experts | AI-assisted extraction/summaries | Disabled (`AI_PROVIDER=none`). Interface and human-acceptance workflow exist; no provider integrated or evaluated. |
| D7 | Production hosting: managed PostgreSQL with PITR, object storage, TLS, secrets management, logging and alerting | SHEQ Experts / hosting partner | Production release; backup/recovery claims beyond rehearsal | Development rehearsal of dump/restore only. |
| D8 | Independent security testing (penetration test) and data-protection impact assessment | SHEQ Experts | Production release; any security claim | Not done. No certifications held or claimed. |
| D9 | Retention periods for exposure records, worker identities and audit logs | SHEQ Experts legal/DP adviser with each client | Configured retention | Configurable; no defaults asserted. Disposal requires two people. |
| D10 | Field device fleet testing (Android/iOS, managed devices) | Pilot site | Confidence in offline capture on site | Tested in desktop Chromium only. |
| D11 | Email delivery (invitations, password reset, notifications) | Hosting | Self-service password reset, reminders | Not implemented. Administrators issue temporary passwords, which must be changed at first sign-in. |
| D12 | Permanent product name and domain | SHEQ Experts | Final branding | Branding is configuration (`BRAND_*` variables). |
| D13 | Representative pilot organisation and data | SHEQ Experts | Phase H pilot validation | Not started. Only synthetic data used so far. |
