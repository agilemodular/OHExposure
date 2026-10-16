import { z } from 'zod';
import { audit, many, one, requirePerm, withActor, type Actor, type Tx } from '../db.js';
import { invalid } from '../errors.js';
import { bool, optStr, parse, reqStr } from './util.js';

/**
 * Versioned, optional integration contracts with other Assurentra products.
 * This product works fully without any of them. No live connection has been tested;
 * all links default to MOCK mode, which records the outbound message locally and transmits nothing.
 */
export const CONTRACTS = {
  integrarisk: {
    'ohea.reviewed_finding': { version: '1.0', direction: 'outbound', purpose: 'Reviewed exposure findings and resulting risk references',
      fields: ['finding_id', 'assessment_id', 'revision', 'approved_at', 'reviewer', 'site_ref', 'group_ref', 'substance', 'cas_number', 'data_quality_state', 'benchmark_state', 'conclusion_category', 'report_ref', 'provenance'] },
    'ohea.action': { version: '1.0', direction: 'outbound', purpose: 'Corrective actions and their verification status',
      fields: ['action_id', 'title', 'status', 'priority', 'due_date', 'verification_requirement', 'source_assessment_id', 'provenance'] },
  },
  workassura: {
    'ohea.required_controls': { version: '1.0', direction: 'outbound', purpose: 'Controls required for tasks and relevant assessment references (informational; never authorises work)',
      fields: ['control_id', 'name', 'kind', 'status', 'site_ref', 'process_ref', 'task_refs', 'assessment_refs', 'provenance'] },
  },
  foresensa: {
    'ohea.exposure_data': { version: '1.0', direction: 'outbound', purpose: 'Quality-labelled exposure results and reviewed findings',
      fields: ['assessment_id', 'revision', 'substance', 'shift_results[{worker_ref, shift_date, twa8h_lower, twa8h_upper, unit, indicative}]', 'data_quality_state', 'benchmark_state', 'professional_status', 'provenance'] },
  },
  sentrisafe: {
    'ohea.context_event': { version: '0.1-draft', direction: 'inbound', purpose: 'Contextual events — NOT ENABLED: requires a validated use case before implementation', fields: [] },
  },
  firesafe: {
    'ohea.shared_asset_ref': { version: '0.1-draft', direction: 'bidirectional', purpose: 'Shared asset references (e.g. ventilation plant) — NOT ENABLED: requires justification', fields: [] },
  },
} as const;
export type Target = keyof typeof CONTRACTS;

export async function upsertLink(a: Actor, input: unknown) {
  requirePerm(a, 'integrations.manage');
  const d = parse(z.object({ target: z.enum(['integrarisk', 'workassura', 'foresensa', 'sentrisafe', 'firesafe']), external_tenant_ref: reqStr(2, 200), enabled: bool, endpoint_url: optStr }), input);
  if (['sentrisafe', 'firesafe'].includes(d.target) && d.enabled) throw invalid(`The ${d.target} contract is a draft without a validated use case and cannot be enabled`);
  return withActor(a, async (tx) => {
    // 'live' mode is deliberately not selectable: no live connection has been built or tested.
    await tx.query(`insert into integration_links (tenant_id,target,external_tenant_ref,enabled,endpoint_url,mode) values ($1,$2,$3,$4,$5,'mock')
      on conflict (tenant_id,target) do update set external_tenant_ref=excluded.external_tenant_ref, enabled=excluded.enabled, endpoint_url=excluded.endpoint_url`,
      [a.tenantId, d.target, d.external_tenant_ref, d.enabled, d.endpoint_url]);
    await audit(tx, a, 'integration.link_set', 'integration', d.target, d);
  });
}

/** Enqueues an outbound message if the tenant has enabled that link. Idempotency key prevents duplicates. */
export async function enqueue(tx: Tx, tenantId: string, target: Target, contract: string, eventType: string, entityKey: string, payload: object) {
  const link = await one(tx, 'select * from integration_links where target=$1 and enabled', [target]);
  if (!link) return null;
  const spec = (CONTRACTS[target] as any)[contract];
  const key = `${target}:${contract}:${spec.version}:${eventType}:${entityKey}`;
  const r = await one(tx, `insert into integration_outbox (tenant_id,target,contract,contract_version,event_type,payload,idempotency_key)
    values ($1,$2,$3,$4,$5,$6,$7) on conflict (idempotency_key) do nothing returning id`,
    [tenantId, target, contract, spec.version, eventType, { ...payload, tenant_ref: link.external_tenant_ref, contract, contract_version: spec.version, idempotency_key: key }, key]);
  return r?.id ?? null;
}

export interface Transport { send(msg: any): Promise<void> }
export const mockTransport: Transport & { sent: any[] } = { sent: [], async send(m) { this.sent.push(m); } };

/** Delivery worker: retries with exponential backoff; dead-letters after 8 attempts. */
export async function deliverPending(a: Actor, transport: Transport = mockTransport) {
  requirePerm(a, 'integrations.manage');
  return withActor(a, async (tx) => {
    const due = await many(tx, `select o.*, l.mode from integration_outbox o join integration_links l on l.target=o.target and l.tenant_id=o.tenant_id
      where o.status in ('pending','failed') and o.next_attempt_at <= now() order by o.created_at limit 50 for update of o skip locked`);
    const res = { mock: 0, delivered: 0, failed: 0 };
    for (const m of due) {
      try {
        await transport.send(m);
        const status = m.mode === 'live' ? 'delivered' : 'mock_recorded';
        await tx.query('update integration_outbox set status=$2, attempts=attempts+1, delivered_at=now(), last_error=null where id=$1', [m.id, status]);
        status === 'delivered' ? res.delivered++ : res.mock++;
      } catch (e: any) {
        const attempts = m.attempts + 1;
        await tx.query(`update integration_outbox set status=$2, attempts=$3, last_error=$4, next_attempt_at=now() + ($5 || ' seconds')::interval where id=$1`,
          [m.id, attempts >= 8 ? 'dead' : 'failed', attempts, String(e.message).slice(0, 500), String(Math.min(3600, 2 ** attempts * 30))]);
        res.failed++;
      }
    }
    await audit(tx, a, 'integration.delivery_run', 'integration', null as any, res);
    return res;
  });
}

export async function integrationsOverview(a: Actor) {
  return withActor(a, async (tx) => ({
    links: await many(tx, 'select * from integration_links order by target'),
    outbox: await many(tx, 'select id, target, contract, contract_version, event_type, status, attempts, last_error, created_at, delivered_at from integration_outbox order by created_at desc limit 100'),
  }));
}
