// Platform operator controls. These run with the owner connection, outside any tenant session, so that no
// organisation administrator can change them through the application. Every change writes an audit event.
//
//   tenant-level   --tenant <id> --level evaluation|pilot           --authorised-by "<name>" --evidence "<gate ref>"
//   offline        --tenant <id> --offline on|off                    --authorised-by "<name>" --evidence "<gate ref>"
//   suspend        --tenant <id> --suspend field_sync,assessment_approval --reason "<stop condition>" --authorised-by "<name>"
//   resume         --tenant <id> --resume field_sync                 --authorised-by "<name>" --evidence "<revalidation ref>"
//   method-review  --method twa_8h --version 1.2.1 --status approved|approved_with_conditions|rejected|withdrawn|not_reviewed
//                  --reviewer "<name>" --competence "<e.g. Chartered Member, BOHS — membership no.>" --reviewed-on 2026-11-02
//                  --evidence "<signed review pack reference>" --evidence-file <path to the signed document>
//                  --scope "<permitted scope, e.g. personal 8-h TWA for dusts at site X>" [--expires-on 2027-11-02]
//                  [--conditions "<text>"] --recorded-by "<operator name>"
//   suspend        --tenant <id> --suspend all ...                   (organisation-wide: every workflow)
//   hold           --assessment <id> --reason "<stop condition>" --placed-by "<name>"
//   release        --assessment <id> --released-by "<name>" --evidence "<revalidation ref>"
//   method-impact  --method twa_8h --version 1.2.1        (lists approved assessments that used the version)
//   pilot-authorise --tenant <id> --scope-ref "<pilot protocol ref>" --provider "<SHEQ Experts authoriser>"
//                  --organisation "<pilot organisation authoriser>" --authorised-on 2026-12-01
//                  --document "<G11 record ref>" --document-file <path> --recorded-by "<operator>"
//   pilot-withdraw --tenant <id> --reason "<why>" --recorded-by "<operator>"   (also returns the tenant to evaluation)
//
// Recording a method review records what a named competent reviewer decided and where their signed evidence is held.
// It does not make the operator a reviewer: the reviewer, their competence and the evidence reference are mandatory.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import pg from 'pg';
import { CALCULATIONS } from '../src/calc/engine.js';
import { sendAlert } from '../src/alerts.js';

const WORKFLOWS = ['field_sync', 'lab_import', 'assessment_approval', 'report_issue', 'action_closure'];

export async function setTenantLevel(url: string, tenantId: string, level: 'evaluation' | 'pilot', authorisedBy: string, evidence: string) {
  if (!['evaluation', 'pilot'].includes(level)) throw new Error('--level must be evaluation or pilot');
  if (!authorisedBy?.trim() || !evidence?.trim()) throw new Error('--authorised-by and --evidence are required');
  return withAdmin(url, async (c) => {
    const t = (await c.query('select is_demo, assurance_level from tenants where id=$1', [tenantId])).rows[0];
    if (!t) throw new Error('Tenant not found');
    if (t.is_demo) throw new Error('The demonstration tenant cannot be moved out of demo level');
    if (level === 'pilot') {
      // An assurance upgrade must rest on recorded professional and authorisation evidence, not on a status change.
      const auth = (await c.query('select id from pilot_authorisations where tenant_id=$1 and withdrawn_at is null', [tenantId])).rows[0];
      if (!auth) throw new Error('No recorded pilot authorisation (G11) for this organisation; record it with pilot-authorise first');
      const methods = (await c.query(`select count(*)::int n from (select distinct calc_code, calc_version from method_reviews) m
        where method_status_effective(m.calc_code, m.calc_version) in ('approved','approved_with_conditions')`)).rows[0].n;
      if (!methods) throw new Error('No calculation method has a current professional approval; a pilot organisation could not reach any conclusion');
      const refs = (await c.query(`select count(*)::int n from benchmark_versions where provenance='professional_reference' and verification_status='verified'`)).rows[0].n;
      if (!refs) throw new Error('No professionally verified reference benchmark exists; a pilot organisation could not reach any conclusion');
    }
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
  if (workflows.length === 1 && workflows[0] === 'all') workflows = [...WORKFLOWS]; // organisation-wide suspension
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

export interface MethodReviewInput { method: string; version: string; status: string; reviewer?: string; competence?: string; reviewedOn?: string; evidence?: string; evidenceFile?: string; scope?: string; expiresOn?: string; conditions?: string; recordedBy: string }
export async function recordMethodReview(url: string, i: MethodReviewInput) {
  const calc = (CALCULATIONS as any)[i.method];
  if (!calc) throw new Error(`Unknown method ${i.method}. Implemented: ${Object.keys(CALCULATIONS).join(', ')}`);
  if (calc.version !== i.version) throw new Error(`Implemented ${i.method} version is ${calc.version}; reviews must name the implemented version (got ${i.version})`);
  if (!['approved', 'approved_with_conditions', 'rejected', 'withdrawn', 'not_reviewed'].includes(i.status)) throw new Error('Invalid status');
  if (!i.recordedBy?.trim()) throw new Error('--recorded-by is required');
  if (i.status !== 'not_reviewed') {
    for (const [k, v] of [['--reviewer', i.reviewer], ['--competence', i.competence], ['--reviewed-on', i.reviewedOn], ['--evidence', i.evidence]] as const)
      if (!v?.trim()) throw new Error(`${k} is required for a review decision`);
    if (i.reviewer!.trim().toLowerCase() === i.recordedBy.trim().toLowerCase())
      throw new Error('The operator recording a review cannot be the reviewer: a second person must record it from the signed evidence');
    if (i.status === 'approved_with_conditions' && !i.conditions?.trim()) throw new Error('--conditions is required for approved_with_conditions');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(i.reviewedOn!) || Date.parse(i.reviewedOn!) > Date.now()) throw new Error('--reviewed-on must be a past date (YYYY-MM-DD)');
  }
  let evidenceSha: string | null = null;
  if (i.status === 'approved' || i.status === 'approved_with_conditions') {
    // Approval must name its permitted scope and point at the signed document itself, whose hash is recorded so the
    // evidence cannot later be swapped.
    if (!i.scope?.trim()) throw new Error('--scope (permitted scope of the approval) is required');
    if (!i.evidenceFile || !existsSync(i.evidenceFile)) throw new Error('--evidence-file must point to the signed review document');
    evidenceSha = createHash('sha256').update(readFileSync(i.evidenceFile)).digest('hex');
    if (i.expiresOn && (!/^\d{4}-\d{2}-\d{2}$/.test(i.expiresOn) || i.expiresOn <= (i.reviewedOn ?? ''))) throw new Error('--expires-on must be a date after --reviewed-on');
  }
  return withAdmin(url, async (c) => {
    await c.query(`insert into method_reviews (calc_code, calc_version, status, conditions, reviewer_name, reviewer_competence, reviewed_on, evidence_ref, recorded_by, permitted_scope, expires_on, evidence_sha256)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, [i.method, i.version, i.status, i.conditions ?? null, i.reviewer ?? null, i.competence ?? null, i.reviewedOn ?? null, i.evidence ?? null, i.recordedBy,
        i.scope ?? null, i.expiresOn ?? null, evidenceSha]);
    await c.query(`insert into audit_events (tenant_id, user_id, action, entity_type, entity_id, detail) values (null, null, 'platform.method_review', 'method', $1, $2)`,
      [`${i.method}@${i.version}`, { status: i.status, reviewer: i.reviewer ?? null, evidence: i.evidence ?? null, evidence_sha256: evidenceSha, scope: i.scope ?? null, expires_on: i.expiresOn ?? null, recorded_by: i.recordedBy }]);
  });
}

/** Places an assessment on hold (e.g. stop condition SC2 for one assessment). Records stay readable. */
export async function holdAssessment(url: string, assessmentId: string, reason: string, placedBy: string) {
  if (!reason?.trim() || reason.trim().length < 5 || !placedBy?.trim()) throw new Error('--reason and --placed-by are required');
  return withAdmin(url, async (c) => {
    const a = (await c.query('select tenant_id from assessments where id=$1', [assessmentId])).rows[0];
    if (!a) throw new Error('Assessment not found');
    await c.query('insert into assessment_holds (tenant_id, assessment_id, reason, placed_by) values ($1,$2,$3,$4)', [a.tenant_id, assessmentId, reason, placedBy]);
    await auditEvent(c, a.tenant_id, 'platform.assessment_hold', { assessment_id: assessmentId, reason, placed_by: placedBy });
  });
}
export async function releaseAssessment(url: string, assessmentId: string, releasedBy: string, evidence: string) {
  if (!releasedBy?.trim() || !evidence?.trim()) throw new Error('--released-by and --evidence (revalidation record) are required');
  return withAdmin(url, async (c) => {
    const r = await c.query('update assessment_holds set released_by=$2, released_at=now(), release_evidence=$3 where assessment_id=$1 and released_at is null returning tenant_id', [assessmentId, releasedBy, evidence]);
    if (!r.rowCount) throw new Error('No active hold on this assessment');
    await auditEvent(c, r.rows[0].tenant_id, 'platform.assessment_release', { assessment_id: assessmentId, released_by: releasedBy, evidence });
  });
}

/** Approved assessments (all organisations) that used a calculation version — for review after a withdrawal. */
export async function methodImpact(url: string, method: string, version: string) {
  return withAdmin(url, async (c) => (await c.query(`select t.name organisation, a.title assessment, r.revision, r.approved_at, r.method_review_status, r.status,
      (select count(*)::int from reports p where p.assessment_revision_id = r.id and p.status='issued') issued_reports
    from assessment_revisions r join assessments a on a.id=r.assessment_id join tenants t on t.id=r.tenant_id
    where coalesce(r.calc_code,'twa_8h')=$1 and r.calc_version=$2 and r.status in ('approved','superseded') order by r.approved_at`, [method, version])).rows);
}

export interface PilotAuthorisationInput { tenantId: string; scopeRef: string; provider: string; organisation: string; authorisedOn: string; document: string; documentFile: string; recordedBy: string }
/** Records the G11 decision made by the named authorisers. The operator records it; the operator cannot be an authoriser. */
export async function recordPilotAuthorisation(url: string, i: PilotAuthorisationInput) {
  for (const [k, v] of [['--scope-ref', i.scopeRef], ['--provider', i.provider], ['--organisation', i.organisation], ['--authorised-on', i.authorisedOn], ['--document', i.document], ['--recorded-by', i.recordedBy]] as const)
    if (!v?.trim()) throw new Error(`${k} is required`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(i.authorisedOn) || Date.parse(i.authorisedOn) > Date.now()) throw new Error('--authorised-on must be a past date');
  if ([i.provider, i.organisation].some((x) => x.trim().toLowerCase() === i.recordedBy.trim().toLowerCase())) throw new Error('The operator recording an authorisation cannot be one of the authorisers');
  if (!i.documentFile || !existsSync(i.documentFile)) throw new Error('--document-file must point to the signed authorisation');
  const sha = createHash('sha256').update(readFileSync(i.documentFile)).digest('hex');
  return withAdmin(url, async (c) => {
    const r = await c.query(`insert into pilot_authorisations (tenant_id, scope_ref, authorised_by_provider, authorised_by_organisation, authorised_on, document_ref, document_sha256, recorded_by)
      values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`, [i.tenantId, i.scopeRef, i.provider, i.organisation, i.authorisedOn, i.document, sha, i.recordedBy]);
    await auditEvent(c, i.tenantId, 'platform.pilot_authorised', { id: r.rows[0].id, scope_ref: i.scopeRef, provider: i.provider, organisation: i.organisation, document: i.document, document_sha256: sha, recorded_by: i.recordedBy });
    return r.rows[0].id as string;
  });
}
export async function withdrawPilotAuthorisation(url: string, tenantId: string, reason: string, recordedBy: string) {
  if (!reason?.trim() || !recordedBy?.trim()) throw new Error('--reason and --recorded-by are required');
  return withAdmin(url, async (c) => {
    const r = await c.query('update pilot_authorisations set withdrawn_at=now() where tenant_id=$1 and withdrawn_at is null returning id', [tenantId]);
    await c.query(`update tenants set assurance_level='evaluation' where id=$1 and assurance_level='pilot'`, [tenantId]);
    await auditEvent(c, tenantId, 'platform.pilot_withdrawn', { reason, recorded_by: recordedBy, authorisations: r.rows.map((x) => x.id) });
    return r.rowCount;
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
      case 'method-review': return recordMethodReview(url, { method: get('--method')!, version: get('--version')!, status: get('--status')!, reviewer: get('--reviewer'), competence: get('--competence'), reviewedOn: get('--reviewed-on'), evidence: get('--evidence'), evidenceFile: get('--evidence-file'), scope: get('--scope'), expiresOn: get('--expires-on'), conditions: get('--conditions'), recordedBy: get('--recorded-by')! });
      case 'hold': return holdAssessment(url, get('--assessment')!, get('--reason')!, get('--placed-by')!);
      case 'release': return releaseAssessment(url, get('--assessment')!, get('--released-by')!, get('--evidence')!);
      case 'method-impact': return console.table(await methodImpact(url, get('--method')!, get('--version')!));
      case 'pilot-authorise': return recordPilotAuthorisation(url, { tenantId: get('--tenant')!, scopeRef: get('--scope-ref')!, provider: get('--provider')!, organisation: get('--organisation')!, authorisedOn: get('--authorised-on')!, document: get('--document')!, documentFile: get('--document-file')!, recordedBy: get('--recorded-by')! });
      case 'pilot-withdraw': return withdrawPilotAuthorisation(url, get('--tenant')!, get('--reason')!, get('--recorded-by')!);
      default: throw new Error('Commands: tenant-level, offline, suspend, resume, method-review, method-impact, pilot-authorise, pilot-withdraw, hold, release');
    }
  };
  run().then((r) => { console.log('Done.', r ?? ''); process.exit(0); }, (e) => { console.error(`Refused: ${e.message}`); process.exit(1); });
}
