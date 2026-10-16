import { many, withActor, type Actor } from '../db.js';

/** Small reference lists for form selects; all RLS-scoped. */
export async function lookups(a: Actor) {
  return withActor(a, async (tx) => ({
    clients: await many(tx, 'select id, name, is_default from clients order by name'),
    sites: await many(tx, 'select s.id, s.name, c.name client_name from sites s join clients c on c.id=s.client_id order by c.name, s.name'),
    substances: await many(tx, 'select id, name, cas_number, is_synthetic, molecular_weight, tenant_id is null as platform from substances order by name'),
    users: await many(tx, `select id, name, role from users where status='active' order by name`),
    workers: await many(tx, `select w.id, w.ref_code, w.client_id, wi.full_name from workers w left join worker_identities wi on wi.worker_id=w.id and wi.disposed_at is null order by w.ref_code`),
    groups: await many(tx, 'select g.id, g.name, s.name site_name, g.client_id from exposure_groups g join sites s on s.id=g.site_id order by g.name'),
    instruments: await many(tx, `select id, asset_tag, instrument_type, screening_only, status from instruments where status <> 'retired' order by asset_tag`),
    methods: await many(tx, `select v.id, m.code, v.version, m.title, v.result_basis, v.suitable_for_formal_assessment from sampling_method_versions v join sampling_methods m on m.id=v.method_id where v.status='active' order by m.code, v.version`),
    labs: await many(tx, 'select id, name from laboratories order by name'),
  }));
}
export const workerLabel = (w: any) => (w.full_name ? `${w.ref_code} — ${w.full_name}` : w.ref_code);
export const substanceLabel = (s: any) => `${s.name}${s.cas_number ? ` (${s.cas_number})` : ''}${s.is_synthetic ? ' [synthetic]' : ''}`;
