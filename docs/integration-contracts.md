# Assurentra integration contracts

**Status: defined, mock only, no live connection built or tested.** No other Assurentra product's code or API was available to review, so nothing outside this product was modified. Links can be enabled only in *mock* mode, which records each outbound message locally (status `mock_recorded`) and transmits nothing. The UI labels these "mock — not transmitted". "Live" mode cannot be selected.

Source of truth: `CONTRACTS` in `src/services/integrations.ts`.

| Target | Contract | Version | Direction | Trigger | Status |
|---|---|---|---|---|---|
| IntegraRisk | `ohea.reviewed_finding` | 1.0 | out | assessment revision approved | defined, mock |
| IntegraRisk | `ohea.action` | 1.0 | out | action created and each stage change | defined, mock |
| WorkAssura | `ohea.required_controls` | 1.0 | out | control created and status changed | defined, mock; informational only, never authorises work |
| Foresensa | `ohea.exposure_data` | 1.0 | out | assessment revision approved | defined, mock |
| SentriSafe (SentriAssure) | `ohea.context_event` | 0.1-draft | in | — | blocked: needs a validated use case; cannot be enabled |
| FireSafe (FireSafe Assure) | `ohea.shared_asset_ref` | 0.1-draft | both | — | blocked: needs justification; cannot be enabled |

Note: the portfolio now uses the names SentriAssure and FireSafe Assure; the brief's older names are kept in contract identifiers for traceability and should be renamed when the receiving products confirm their contract names.

## Common envelope

Every message payload includes `tenant_ref` (the tenant's identifier in the receiving product, configured per link), `contract`, `contract_version`, `idempotency_key`, and a `provenance` block: source product, assessment revision id, snapshot hash, calculation code and version.

## Delivery semantics

- **Tenant mapping:** one `integration_links` row per tenant and target, holding the external tenant reference. Messages are only created when a link exists and is enabled; the outbox is tenant-isolated by RLS.
- **Duplicate prevention:** `idempotency_key = target:contract:version:event:entity` is unique; re-enqueueing the same event is a no-op (tested). Receivers must de-duplicate on the same key.
- **Retries:** exponential backoff (30 s × 2ⁿ, max 1 h), dead-lettered after 8 attempts with the last error stored.
- **Permissions:** only `integrations.manage` (organisation administrator) can configure links or run delivery. Payloads carry pseudonymous worker references only, never identities.
- **Reconciliation (to build with receivers):** each receiver should expose an acknowledgement listing received keys; the sender compares against `integration_outbox` for the period. Not implemented.

## Payload fields (v1.0)

- `ohea.reviewed_finding`: finding_id, assessment_id, revision, approved_at, reviewer, site_ref, group_ref, substance, cas_number, data_quality_state, benchmark_state, conclusion_category, report_ref, provenance.
- `ohea.exposure_data`: assessment_id, revision, substance, professional_status, data_quality_state, benchmark_state, shift_results[{worker_ref, shift_date, twa8h_lower, twa8h_upper, unit, indicative}], provenance. Bounds are sent separately so a non-detect is never transmitted as a single number.
- `ohea.action`: action_id, title, status, priority, due_date, verification_requirement, source_assessment_id, provenance.
- `ohea.required_controls`: control_id, name, kind, status, site_ref, process_ref, task_refs, assessment_refs, provenance.

## Before claiming any integration complete

1. Review the receiving product's architecture and agree the contract with its owner.
2. Implement an authenticated transport (signed requests or mTLS) and receiver-side de-duplication.
3. Test against a real receiving instance, including retries, duplicates and tenant mismatch.
4. Only then enable `live` mode.
