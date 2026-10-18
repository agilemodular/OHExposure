// Platform operator controls. These run with the owner connection, outside any tenant session, so that no
// organisation administrator can change them through the application. Every change writes an audit event.
//
//   tenant-level   --tenant <id> --level evaluation|pilot           --authorised-by "<name>" --evidence "<gate ref>"
//   offline        --tenant <id> --offline on|off                    --authorised-by "<name>" --evidence "<gate ref>"
//   suspend        --tenant <id> --suspend field_sync,assessment_approval --reason "<stop condition>" --authorised-by "<name>"
//   resume         --tenant <id> --resume field_sync                 --authorised-by "<name>" --evidence "<revalidation ref>"
//   method-review  --method twa_8h --version 1.2.1 --status approved|approved_with_conditions|rejected|not_reviewed
//                  --reviewer "<name>" --competence "<e.g. Chartered Member, BOHS — membership no.>" --reviewed-on 2026-11-02
//                  --evidence "<signed review pack reference>" [--conditions "<text>"] --recorded-by "<operator name>"
//
// Recording a method review records what a named competent reviewer decided and where their signed evidence is held.
// It does not make the operator a reviewer: the reviewer, their competence and the evidence reference are mandatory.
import pg from 'pg';
import { CALCULATIONS } from '../src/calc/engine.js';
import { sendAlert } from '../src/alerts.js';

const WORKFLOWS = ['field_sync', 'lab_import', 'assessment_approval', 'report_issue', 'action_closure'];

export async function setTenantLevel(url: string, tenantId: string, level: 'evaluation' | 'pilot', authorisedBy: string, evidence: string) {
  if (!authorisedBy?.trim() || !evidence?.trim()) throw new Error('--authorised-by and --evidence are required');
  return withAdmin(url, async (c) => {
    const t = (await c.query('select is_demo, assurance_level from tenants where id=$1', [tenantId])).rows[0];
    if (!t) throw new Error('Tenant not found');
    if (t.is_demo) throw new Error('The demonstration tenant cannot be moved out of demo level');
    await c.query('update tenants set assurance_level=$2 where id=$1', [tenantId, level]);
    await auditEvent(c, tenantId, 'platform.assurance_level', { from: t.assurance_level, to: level, authorised_by: authorisedBy, evidence });
  });
}

export async function setOffline(url: string, tenantId: string, on: boolean, authorisedBy: string, evidence: string) {
  if (!authorisedBy?.trim() || (on && !evidence?.trim())) throw new Error('--authorised-by is required, and --evidence when enabling');
  return withAdmin(url, async (c) => {
    const r = await c.query('update tenants set offline_capture_enabled=$2 where id=$1 returning id', [tenantId, on]);
    if (!r.rowCount) throw new Error('Tenant not found');
    await auditEvent(c, tenantId, on ? 'platform.offline_enabled' : 'platform.offline_disabled', { authorised_by: authorisedBy, evidence });
  });
}

export async function suspendWorkflows(url: string, tenantId: string, workflows: string[], reason: string, authorisedBy: string) {
  if (!reason?.trim() || !authorisedBy?.trim()) throw new Error('--reason and --authorised-by are required');
  const bad = workflows.filter((w) => !WORKFLOWS.includes(w));
  if (bad.length || !workflows.length) throw new Error(`Unknown workflow(s): ${bad.join(', ')}. Valid: ${WORKFLOWS.join(', ')}`);
  return withAdmin(url, async (c) => {
    const r = await c.query(`update tenants set suspended_workflows = (select array(select distinct unnest(suspended_workflows || $2::text[]))), suspension_reason=$3 where id=$1 returning suspended_workflows`, [tenantId, workflows, reason]);
    if (!r.rowCount) throw new Error('Tenant not found');
    await auditEvent(c, tenantId, 'platform.workflow_suspended', { workflows, reason, authorised_by: authorisedBy });
    return r.rows[0].suspended_workflows as string[];
  }).then(async (now) => {
    await sendAlert('workflow.suspended', { tenant_id: tenantId, workflows, reason, authorised_by: authorisedBy }, `${tenantId}:${workflows.join(',')}`);
    return now;
  });
}

export async function resumeWorkflows(url: string, tenantId: string, workflows: string[], authorisedBy: string, evidence: string) {
  if (!authorisedBy?.trim() || !evidence?.trim()) throw new Error('--authorised-by and --evidence (revalidation record) are required');
  return withAdmin(url, async (c) => {
    const r = await c.query(`update tenants set suspended_workflows = (select array(select w from unnest(suspended_workflows) w where w <> all($2::text[]))) where id=$1 returning suspended_workflows`, [tenantId, workflows]);
    if (!r.rowCount) throw new Error('Tenant not found');
    if (!r.rows[0].suspended_workflows.length) await c.query('update tenants set suspension_reason=null where id=$1', [tenantId]);
    await auditEvent(c, tenantId, 'platform.workflow_resumed', { workflows, authorised_by: authorisedBy, evidence });
    return r.rows[0].suspended_workflows as string[];
  });
}

export interface MethodReviewInput { method: string; version: string; status: string; reviewer?: string; competence?: string; reviewedOn?: string; evidence?: string; conditions?: string; recordedBy: string }
export async function recordMethodReview(url: string, i: MethodReviewInput) {
  const calc = (CALCULATIONS as any)[i.method];
  if (!calc) throw new Error(`Unknown method ${i.method}. Implemented: ${Object.keys(CALCULATIONS).join(', ')}`);
  if (calc.version !== i.version) throw new Error(`Implemented ${i.method} version is ${calc.version}; reviews must name the implemented version (got ${i.version})`);
  if (!['approved', 'approved_with_conditions', 'rejected', 'not_reviewed'].includes(i.status)) throw new Error('Invalid status');
  if (!i.recordedBy?.trim()) throw new Error('--recorded-by is required');
  if (i.status !== 'not_reviewed') {
    for (const [k, v] of [['--reviewer', i.reviewer], ['--competence', i.competence], ['--reviewed-on', i.reviewedOn], ['--evidence', i.evidence]] as const)
      if (!v?.trim()) throw new Error(`${k} is required for a review decision`);
    if (i.reviewer!.trim().toLowerCase() === i.recordedBy.trim().toLowerCase())
      throw new Error('The operator recording a review cannot be the reviewer: a second person must record it from the signed evidence');
    if (i.status === 'approved_with_conditions' && !i.conditions?.trim()) throw new Error('--conditions is required for approved_with_conditions');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(i.reviewedOn!) || Date.parse(i.reviewedOn!) > Date.now()) throw new Error('--reviewed-on must be a past date (YYYY-MM-DD)');
  }
  return withAdmin(url, async (c) => {
    await c.query(`insert into method_reviews (calc_code, calc_version, status, conditions, reviewer_name, reviewer_competence, reviewed_on, evidence_ref, recorded_by)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [i.method, i.version, i.status, i.conditions ?? null, i.reviewer ?? null, i.competence ?? null, i.reviewedOn ?? null, i.evidence ?? null, i.recordedBy]);
  });
}

async function withAdmin<T>(url: string, fn: (c: pg.Client) => Promise<T>) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    await c.query('begin');
    const r = await fn(c);
    await c.query('commit');
    return r;
  } catch (e) {
    await c.query('rollback').catch(() => {});
    throw e;
  } finally { await c.end(); }
}
async function auditEvent(c: pg.Client, tenantId: string, action: string, detail: object) {
  await c.query(`insert into audit_events (tenant_id, user_id, action, entity_type, entity_id, detail) values ($1, null, $2, 'tenant', $3, $4)`, [tenantId, action, String(tenantId), detail]);
}

if (process.argv[1]?.endsWith('platform-controls.ts')) {
  const a = process.argv.slice(2);
  const get = (k: string) => { const i = a.indexOf(k); return i >= 0 ? a[i + 1] : undefined; };
  const url = process.env.DATABASE_ADMIN_URL;
  if (!url) { console.error('DATABASE_ADMIN_URL is required'); process.exit(1); }
  const cmd = a[0];
  const run = async () => {
    switch (cmd) {
      case 'tenant-level': return setTenantLevel(url, get('--tenant')!, get('--level') as any, get('--authorised-by')!, get('--evidence')!);
      case 'offline': return setOffline(url, get('--tenant')!, get('--offline') === 'on', get('--authorised-by')!, get('--evidence') ?? '');
      case 'suspend': return suspendWorkflows(url, get('--tenant')!, (get('--suspend') ?? '').split(','), get('--reason')!, get('--authorised-by')!);
      case 'resume': return resumeWorkflows(url, get('--tenant')!, (get('--resume') ?? '').split(','), get('--authorised-by')!, get('--evidence')!);
      case 'method-review': return recordMethodReview(url, { method: get('--method')!, version: get('--version')!, status: get('--status')!, reviewer: get('--reviewer'), competence: get('--competence'), reviewedOn: get('--reviewed-on'), evidence: get('--evidence'), conditions: get('--conditions'), recordedBy: get('--recorded-by')! });
      default: throw new Error('Commands: tenant-level, offline, suspend, resume, method-review');
    }
  };
  run().then((r) => { console.log('Done.', r ?? ''); process.exit(0); }, (e) => { console.error(`Refused: ${e.message}`); process.exit(1); });
}
