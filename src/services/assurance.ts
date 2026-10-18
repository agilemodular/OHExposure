import { CALCULATIONS, type CalcCode } from '../calc/engine.js';
import { many, one, withActor, type Actor, type Tx } from '../db.js';
import { AppError } from '../errors.js';

/**
 * Pilot controls. Assurance levels:
 *  - demo:       synthetic data; everything usable, outputs labelled synthetic.
 *  - evaluation: real organisation trying the software; unreviewed methods and tenant-entered benchmarks may be used,
 *                but every output states their review status. Not for reliance.
 *  - pilot:      conclusions may only be approved with professionally approved methods and professionally verified
 *                reference benchmarks. Set only by a platform operator after the pilot gates are accepted.
 */
export type Workflow = 'field_sync' | 'lab_import' | 'assessment_approval' | 'report_issue' | 'action_closure';
export const WORKFLOW_LABEL: Record<Workflow, string> = {
  field_sync: 'Field capture and synchronisation',
  lab_import: 'Laboratory result entry and import',
  assessment_approval: 'Assessment approval',
  report_issue: 'Report issue',
  action_closure: 'Corrective action effectiveness review and closure',
};

export interface TenantControls {
  assuranceLevel: 'demo' | 'evaluation' | 'pilot';
  offlineCaptureEnabled: boolean;
  suspendedWorkflows: Workflow[];
  suspensionReason: string | null;
}

export async function tenantControls(tx: Tx): Promise<TenantControls> {
  const t = await one(tx, 'select assurance_level, offline_capture_enabled, suspended_workflows, suspension_reason from tenants where id = app_tenant()');
  return { assuranceLevel: t.assurance_level, offlineCaptureEnabled: t.offline_capture_enabled, suspendedWorkflows: t.suspended_workflows ?? [], suspensionReason: t.suspension_reason };
}
export const controlsFor = (a: Actor) => withActor(a, tenantControls);

/** Refuses an action whose workflow has been suspended under a pilot stop condition. Records are not touched. */
export async function assertWorkflowActive(tx: Tx, w: Workflow) {
  const c = await tenantControls(tx);
  if (c.suspendedWorkflows.includes(w))
    throw new AppError(423, 'workflow_suspended', `${WORKFLOW_LABEL[w]} is suspended for this organisation${c.suspensionReason ? `: ${c.suspensionReason}` : ''}. Existing records are preserved and remain readable.`);
}

export type MethodState = 'approved' | 'approved_with_conditions' | 'not_reviewed' | 'rejected';
export interface MethodReview { code: string; version: string; status: MethodState; conditions: string | null; reviewer: string | null; reviewedOn: string | null; evidenceRef: string | null }

export async function methodReview(tx: Tx, code: string, version: string): Promise<MethodReview> {
  const r = await one(tx, 'select * from current_method_reviews where calc_code=$1 and calc_version=$2', [code, version]);
  return { code, version, status: r?.status ?? 'not_reviewed', conditions: r?.conditions ?? null, reviewer: r?.reviewer_name ?? null, reviewedOn: r?.reviewed_on ?? null, evidenceRef: r?.evidence_ref ?? null };
}

/** Review state of every implemented calculation version, for display. */
export async function methodCapabilities(a: Actor) {
  return withActor(a, async (tx) => {
    const reviews = await many(tx, 'select * from current_method_reviews');
    const history = await many(tx, 'select calc_code, calc_version, status, reviewer_name, reviewed_on, recorded_at from method_reviews order by recorded_at desc limit 50');
    const controls = await tenantControls(tx);
    const rows = (Object.values(CALCULATIONS)).map((c) => {
      const r = reviews.find((x) => x.calc_code === c.code && x.calc_version === c.version);
      const status: MethodState = r?.status ?? 'not_reviewed';
      return { ...c, status, reviewer: r?.reviewer_name ?? null, reviewedOn: r?.reviewed_on ?? null, conditions: r?.conditions ?? null, evidenceRef: r?.evidence_ref ?? null,
        pilotEnabled: status === 'approved' || status === 'approved_with_conditions' };
    });
    return { rows, history, controls };
  });
}

/**
 * Server-side gate for using a calculation in a conclusion. In a pilot tenant, the method version must be
 * professionally approved and the benchmark must be professionally verified reference data.
 */
export async function assertConclusionAllowed(tx: Tx, calcCode: CalcCode, calcVersion: string, benchmarkVersionId: string | null) {
  const c = await tenantControls(tx);
  const m = await methodReview(tx, calcCode, calcVersion);
  const b = benchmarkVersionId ? await one(tx, 'select provenance, verification_status from benchmark_versions where id=$1', [benchmarkVersionId]) : null;
  if (c.assuranceLevel === 'pilot') {
    if (m.status !== 'approved' && m.status !== 'approved_with_conditions')
      throw new AppError(422, 'method_not_approved', `The ${CALCULATIONS[calcCode].label} method (v${calcVersion}) is ${m.status.replace(/_/g, ' ')} by a competent occupational hygienist and cannot be used for pilot conclusions.`);
    if (!b) throw new AppError(422, 'benchmark_required', 'Pilot conclusions require a professionally verified reference benchmark.');
    if (b.provenance !== 'professional_reference' || b.verification_status !== 'verified')
      throw new AppError(422, 'benchmark_not_reference', 'Pilot conclusions require a professionally verified reference benchmark. Organisation-entered and synthetic benchmarks can be used for calculation and discussion only.');
  }
  return { methodStatus: m.status, benchmarkProvenance: b?.provenance ?? null, controls: c };
}
