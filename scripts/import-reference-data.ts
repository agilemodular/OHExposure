// Controlled import of platform reference benchmarks (owner connection; not available to organisations).
//
//   npx tsx scripts/import-reference-data.ts <file.json> [--dry-run] --imported-by "<operator name>"
//
// Every row is validated before anything is written; the import is all-or-nothing. Existing versions are never
// changed: a changed value must be a new version with its own source and effective date, so approved assessments
// that froze an earlier version are unaffected. See docs/reference-data-workflow.md for the file format and the
// verification steps required before a row may be marked professional_reference.
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { z } from 'zod';

const row = z.object({
  substance: z.object({
    name: z.string().trim().min(2),
    cas_number: z.string().regex(/^\d{2,7}-\d{2}-\d$/).nullable().optional(),
    ec_number: z.string().nullable().optional(),
    molecular_weight: z.number().positive().nullable().optional(),
    molecular_weight_source: z.string().nullable().optional(),
  }),
  jurisdiction: z.string().trim().min(2).max(10),
  benchmark_type: z.string().trim().min(2).max(40),
  averaging_minutes: z.number().int().positive(),
  value: z.number().positive(),
  unit: z.enum(['mg/m3', 'ppm', 'f/ml']),
  annotations: z.array(z.string()).default([]),
  source_title: z.string().trim().min(3),
  source_version: z.string().trim().min(1),
  source_url: z.string().url(),
  effective_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  effective_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  provenance: z.enum(['professional_reference', 'synthetic']),
  reviewer_name: z.string().trim().min(3),
  verified_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  permitted_use: z.string().trim().min(5),
  licence_note: z.string().trim().min(3),
}).superRefine((r, ctx) => {
  if (r.provenance === 'synthetic') {
    if (!/synthetic/i.test(r.substance.name)) ctx.addIssue({ code: 'custom', message: 'synthetic rows must have "synthetic" in the substance name' });
    if (r.substance.cas_number) ctx.addIssue({ code: 'custom', message: 'synthetic rows must not carry a real CAS number' });
  } else if (/synthetic/i.test(r.substance.name) || /synthetic/i.test(r.source_title)) {
    ctx.addIssue({ code: 'custom', message: 'a professional_reference row cannot describe a synthetic substance or source' });
  }
  if (Date.parse(r.verified_on) > Date.now()) ctx.addIssue({ code: 'custom', message: 'verified_on cannot be in the future' });
  if (r.effective_to && r.effective_to < r.effective_from) ctx.addIssue({ code: 'custom', message: 'effective_to is before effective_from' });
  if (r.substance.molecular_weight && !r.substance.molecular_weight_source) ctx.addIssue({ code: 'custom', message: 'molecular_weight needs molecular_weight_source' });
});
export type ReferenceRow = z.infer<typeof row>;

export function validateFile(json: unknown) {
  const arr = z.array(z.unknown()).min(1).parse(json);
  const errors: string[] = [];
  const rows: ReferenceRow[] = [];
  arr.forEach((r, i) => {
    const p = row.safeParse(r);
    if (p.success) rows.push(p.data);
    else errors.push(...p.error.issues.map((x) => `row ${i + 1}: ${x.path.join('.') || 'row'} — ${x.message}`));
  });
  return { rows, errors };
}

export async function importReferenceData(url: string, json: unknown, opts: { dryRun?: boolean; importedBy: string }) {
  if (!opts.importedBy?.trim()) throw new Error('--imported-by is required');
  const { rows, errors } = validateFile(json);
  if (errors.length) throw new Error(`Validation failed; nothing imported:\n  ${errors.join('\n  ')}`);
  const self = rows.filter((r) => r.provenance === 'professional_reference' && r.reviewer_name.trim().toLowerCase() === opts.importedBy.trim().toLowerCase());
  if (self.length) throw new Error('The operator importing professional reference rows cannot be their reviewer; nothing imported');
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  const result = { created: 0, skippedExisting: 0, substancesCreated: 0 };
  try {
    await c.query('begin');
    for (const r of rows) {
      const synthetic = r.provenance === 'synthetic';
      let sub = r.substance.cas_number
        ? (await c.query('select id from substances where tenant_id is null and cas_number=$1', [r.substance.cas_number])).rows[0]
        : (await c.query('select id from substances where tenant_id is null and lower(name)=lower($1) and cas_number is null', [r.substance.name])).rows[0];
      if (!sub) {
        sub = (await c.query(`insert into substances (tenant_id, name, cas_number, ec_number, molecular_weight, molecular_weight_source, is_synthetic) values (null,$1,$2,$3,$4,$5,$6) returning id`,
          [r.substance.name, r.substance.cas_number ?? null, r.substance.ec_number ?? null, r.substance.molecular_weight ?? null, r.substance.molecular_weight_source ?? null, synthetic])).rows[0];
        result.substancesCreated++;
      }
      let b = (await c.query('select id, averaging_minutes from benchmarks where tenant_id is null and substance_id=$1 and jurisdiction=$2 and benchmark_type=$3', [sub.id, r.jurisdiction, r.benchmark_type])).rows[0];
      if (b && b.averaging_minutes !== r.averaging_minutes) throw new Error(`${r.substance.name} ${r.jurisdiction} ${r.benchmark_type}: averaging period ${r.averaging_minutes} conflicts with existing ${b.averaging_minutes}`);
      if (!b) b = (await c.query('insert into benchmarks (tenant_id, substance_id, jurisdiction, benchmark_type, averaging_minutes) values (null,$1,$2,$3,$4) returning id', [sub.id, r.jurisdiction, r.benchmark_type, r.averaging_minutes])).rows[0];
      const exists = (await c.query('select id, value, unit from benchmark_versions where benchmark_id=$1 and source_version=$2 and effective_from=$3', [b.id, r.source_version, r.effective_from])).rows[0];
      if (exists) {
        if (Number(exists.value) !== r.value || exists.unit !== r.unit) throw new Error(`${r.substance.name} ${r.benchmark_type} ${r.source_version}: an existing version has a different value; record a new source version instead of changing it`);
        result.skippedExisting++;
        continue;
      }
      await c.query(`insert into benchmark_versions (tenant_id, benchmark_id, value, unit, annotations, source_title, source_version, source_url, effective_from, effective_to,
          verification_status, verified_by, verified_at, is_synthetic, provenance, reviewer_name, verified_on, permitted_use, licence_note)
        values (null,$1,$2,$3,$4,$5,$6,$7,$8,$9,'verified',$10,$11::date,$12,$13,$10,$11::date,$14,$15)`,
        [b.id, r.value, r.unit, r.annotations, r.source_title, r.source_version, r.source_url, r.effective_from, r.effective_to ?? null,
          r.reviewer_name, r.verified_on, synthetic, r.provenance, r.permitted_use, r.licence_note]);
      result.created++;
    }
    await c.query(`insert into audit_events (tenant_id, user_id, action, entity_type, entity_id, detail) values (null, null, 'platform.reference_import', 'reference_data', null, $1)`,
      [{ ...result, rows: rows.length, imported_by: opts.importedBy, dry_run: !!opts.dryRun }]);
    if (opts.dryRun) await c.query('rollback'); else await c.query('commit');
    return { ...result, dryRun: !!opts.dryRun };
  } catch (e) {
    await c.query('rollback').catch(() => {});
    throw e;
  } finally { await c.end(); }
}

if (process.argv[1]?.endsWith('import-reference-data.ts')) {
  const a = process.argv.slice(2);
  const file = a[0];
  const by = a[a.indexOf('--imported-by') + 1];
  const url = process.env.DATABASE_ADMIN_URL;
  if (!url || !file) { console.error('Usage: DATABASE_ADMIN_URL=... npx tsx scripts/import-reference-data.ts <file.json> [--dry-run] --imported-by "<name>"'); process.exit(1); }
  importReferenceData(url, JSON.parse(readFileSync(file, 'utf8')), { dryRun: a.includes('--dry-run'), importedBy: a.includes('--imported-by') ? by : '' })
    .then((r) => { console.log(JSON.stringify(r)); process.exit(0); }, (e) => { console.error(e.message); process.exit(1); });
}
