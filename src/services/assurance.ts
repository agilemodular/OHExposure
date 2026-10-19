import { CALCULATIONS, type CalcCode } from '../calc/engine.js';
import pg from 'pg';
import { config } from '../config.js';
import { many, one, withActor, type Actor, type Tx } from '../db.js';

let _auditPool: pg.Pool | null = null;
const auditPool = () => (_auditPool ??= new pg.Pool({ connectionString: config.databaseUrl, max: 2, connectionTimeoutMillis: 2000 }));
export const closeAuditPool = async () => { if (_auditPool) { await _auditPool.end(); _auditPool = null; } };
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

export async function tenantControls(tx: Tx, opts: { lock?: boolean } = {}): Promise<TenantControls> {
  // With lock: the tenant row is share-locked until the transaction ends, so a suspension (or level change) cannot be
  // committed between this check and the write that depends on it.
  const t = await one(tx, `select assurance_level, offline_capture_enabled, suspended_workflows, suspension_reason from tenants where id = app_tenant()${opts.lock ? ' for share' : ''}`);
  return { assuranceLevel: t.assurance_level, offlineCaptureEnabled: t.offline_capture_enabled, suspendedWorkflows: t.suspended_workflows ?? [], suspensionReason: t.suspension_reason };
}
/** Statuses that permit use of a method in conclusions. Compared exactly, never by pattern. */
export const METHOD_APPROVED = new Set(['approved', 'approved_with_conditions']);

export const controlsFor = (a: Actor) => withActor(a, tenantControls);

/** Refuses an action whose workflow has been suspended under a pilot stop condition. Records are not touched. */
export async function assertWorkflowActive(tx: Tx, w: Workflow, action = 'write') {
  const c = await tenantControls(tx, { lock: true });
  if (c.suspendedWorkflows.includes(w)) {
    await recordBlocked(tx, 'workflow.blocked', { workflow: w, action, reason: c.suspensionReason });
    throw new AppError(423, 'workflow_suspended', `${WORKFLOW_LABEL[w]} is suspended for this organisation${c.suspensionReason ? `: ${c.suspensionReason}` : ''}. Existing records are preserved and remain readable.`);
  }
}

/** Refuses changes to an assessment placed on hold by a platform operator. */
export async function assertAssessmentNotOnHold(tx: Tx, assessmentId: string, action = 'write') {
  // Share-lock the assessment row: placing a hold takes an update lock on it, so a hold cannot be committed between
  // this check and the dependent write.
  await tx.query('select 1 from assessments where id=$1 for share', [assessmentId]);
  const h = await one(tx, 'select reason from assessment_holds where assessment_id=$1 and released_at is null', [assessmentId]);
  if (h) {
    await recordBlocked(tx, 'assessment.blocked', { assessment_id: assessmentId, action, reason: h.reason });
    throw new AppError(423, 'assessment_on_hold', `This assessment is on hold: ${h.reason}. Existing records are preserved and remain readable.`);
  }
}

/**
 * Records a refused attempt in the audit trail. Written on a separate connection so that it survives the rollback of
 * the refused transaction; the actor and tenant are taken from the refused transaction's session settings.
 */
async function recordBlocked(tx: Tx, action: string, detail: Record<string, unknown>) {
  const ctx = await one(tx, `select current_setting('app.tenant_id', true) t, current_setting('app.user_id', true) u`);
  // A small dedicated pool with a short connection timeout: refused requests must never exhaust the main pool.
  let c: pg.PoolClient;
  try { c = await auditPool().connect(); } catch { console.error(JSON.stringify({ level: 'error', msg: 'blocked-attempt audit unavailable', action })); return; }
  try {
    await c.query('begin');
    await c.query(`select set_config('app.tenant_id',$1,true), set_config('app.client_id','',true), set_config('app.user_id',$2,true)`, [ctx.t, ctx.u]);
    await c.query(`insert into audit_events (tenant_id, user_id, action, entity_type, entity_id, detail) values ($1,$2,$3,'tenant',$4,$5)`, [ctx.t, ctx.u || null, action, ctx.t, detail]);
    await c.query('commit');
  } catch { await c.query('rollback').catch(() => {}); } finally { c.release(); }
}

export type MethodState = 'approved' | 'approved_with_conditions' | 'not_reviewed' | 'rejected' | 'withdrawn' | 'expired';
export interface MethodReview { code: string; version: string; status: MethodState; conditions: string | null; reviewer: string | null; reviewedOn: string | null; evidenceRef: string | null; scope: string | null; expiresOn: string | null }

/** The effective status is computed in the database (method_status_effective), the same function the triggers use. */
export async function methodReview(tx: Tx, code: string, version: string): Promise<MethodReview> {
  const r = await one(tx, 'select *, method_status_effective($1,$2) effective from current_method_reviews where calc_code=$1 and calc_version=$2', [code, version]);
  return { code, version, status: r?.effective ?? 'not_reviewed', conditions: r?.conditions ?? null, reviewer: r?.reviewer_name ?? null, reviewedOn: r?.reviewed_on ?? null,
    evidenceRef: r?.evidence_ref ?? null, scope: r?.permitted_scope ?? null, expiresOn: r?.expires_on ?? null };
}

/** Review state of every implemented calculation version, for display. */
export async function methodCapabilities(a: Actor) {
  return withActor(a, async (tx) => {
    const reviews = await many(tx, 'select *, method_status_effective(calc_code, calc_version) effective from current_method_reviews');
    const history = await many(tx, 'select calc_code, calc_version, status, reviewer_name, reviewed_on, recorded_at from method_reviews order by recorded_at desc limit 50');
    const controls = await tenantControls(tx);
    const rows = (Object.values(CALCULATIONS)).map((c) => {
      const r = reviews.find((x) => x.calc_code === c.code && x.calc_version === c.version);
      const status: MethodState = r?.effective ?? 'not_reviewed';
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
  const b = benchmarkVersionId ? await one(tx, 'select v.provenance, v.verification_status, bm.averaging_minutes from benchmark_versions v join benchmarks bm on bm.id=v.benchmark_id where v.id=$1', [benchmarkVersionId]) : null;
  if (c.assuranceLevel === 'pilot') {
    if (m.status !== 'approved' && m.status !== 'approved_with_conditions')
      throw new AppError(422, 'method_not_approved', `The ${CALCULATIONS[calcCode].label} method (v${calcVersion}) is ${m.status.replace(/_/g, ' ')} by a competent occupational hygienist and cannot be used for pilot conclusions.`);
    if (!b) throw new AppError(422, 'benchmark_required', 'Pilot conclusions require a professionally verified reference benchmark.');
    if (b.provenance !== 'professional_reference' || b.verification_status !== 'verified')
      throw new AppError(422, 'benchmark_not_reference', 'Pilot conclusions require a professionally verified reference benchmark. Organisation-entered and synthetic benchmarks can be used for calculation and discussion only.');
    if (b.averaging_minutes !== CALCULATIONS[calcCode].averagingMinutes)
      throw new AppError(422, 'benchmark_not_comparable', `The benchmark's averaging period (${b.averaging_minutes} min) does not match the ${CALCULATIONS[calcCode].label} (${CALCULATIONS[calcCode].averagingMinutes} min).`);
  }
  return { methodStatus: m.status, benchmarkProvenance: b?.provenance ?? null, controls: c };
}
