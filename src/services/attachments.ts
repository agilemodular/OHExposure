import { mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { sha256 } from '../auth/crypto.js';
import { audit, can, many, one, withActor, type Actor } from '../db.js';
import { forbidden, invalid, notFound } from '../errors.js';

// Entity types that accept attachments, and the permission required to add one.
const ENTITY: Record<string, { table: string; perm: Parameters<typeof can>[1][] }> = {
  sampling_event: { table: 'sampling_events', perm: ['field.capture', 'lab.write'] },
  calibration: { table: 'calibrations', perm: ['instruments.write'] },
  instrument: { table: 'instruments', perm: ['instruments.write'] },
  lab_submission: { table: 'lab_submissions', perm: ['lab.write'] },
  lab_result: { table: 'lab_results', perm: ['lab.write', 'lab.import'] },
  import_batch: { table: 'import_batches', perm: ['lab.import'] },
  control: { table: 'controls', perm: ['controls.write', 'controls.inspect'] },
  control_inspection: { table: 'control_inspections', perm: ['controls.inspect'] },
  action: { table: 'actions', perm: ['actions.implement', 'actions.assign'] },
  assessment: { table: 'assessments', perm: ['assess.write'] },
};

/** Detects type from content (not the client-supplied name or MIME) and accepts only an allowlist. */
export function sniff(buf: Buffer, filename: string): string | null {
  if (buf.subarray(0, 5).toString() === '%PDF-') return 'application/pdf';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  const lower = filename.toLowerCase();
  if (/\.(csv|txt)$/.test(lower)) {
    const sample = buf.subarray(0, 4096);
    if (sample.includes(0)) return null;
    return lower.endsWith('.csv') ? 'text/csv' : 'text/plain';
  }
  return null;
}

export async function saveAttachment(a: Actor, input: { entity_type: string; entity_id: string; filename: string; data: Buffer; contains_pii?: boolean }) {
  const ent = ENTITY[input.entity_type];
  if (!ent) throw invalid('Attachments are not supported on this record type');
  if (!ent.perm.some((p) => can(a, p))) throw forbidden();
  if (input.data.length === 0) throw invalid('Empty file');
  if (input.data.length > config.maxUploadBytes) throw invalid(`File exceeds ${Math.round(config.maxUploadBytes / 1048576)} MB`);
  const mime = sniff(input.data, input.filename);
  if (!mime) throw invalid('Unsupported file type. Accepted: PDF, PNG, JPEG, CSV, TXT');
  const safeName = input.filename.replace(/[^\w.\- ]+/g, '_').slice(0, 150) || 'file';
  return withActor(a, async (tx) => {
    const parent = await one(tx, `select ${input.entity_type === 'calibration' || input.entity_type === 'import_batch' ? 'null::uuid' : 'client_id'} as client_id from ${ent.table} where id=$1`, [input.entity_id]);
    if (!parent) throw notFound('Record');
    const key = `${a.tenantId}/${randomUUID()}`;
    const dir = join(config.storageDir, a.tenantId);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(config.storageDir, key), input.data, { mode: 0o600 });
    const r = await one(tx, `insert into attachments (tenant_id,client_id,entity_type,entity_id,filename,mime_type,size_bytes,sha256,storage_key,contains_pii,uploaded_by)
      values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning *`,
      [a.tenantId, parent.client_id, input.entity_type, input.entity_id, safeName, mime, input.data.length, sha256(input.data), key, !!input.contains_pii, a.userId]);
    await audit(tx, a, 'attachment.upload', input.entity_type, input.entity_id, { attachment_id: r.id, filename: safeName, sha256: r.sha256, size: r.size_bytes });
    return r;
  });
}

export async function readAttachment(a: Actor, id: string) {
  return withActor(a, async (tx) => {
    const r = await one(tx, 'select * from attachments where id=$1', [id]);
    if (!r || r.disposed_at) throw notFound('Attachment');
    if (r.contains_pii && !can(a, 'worker.identity.read')) throw forbidden('This file contains identifiable worker information');
    const path = join(config.storageDir, r.storage_key);
    if (!existsSync(path)) throw notFound('Stored file');
    const data = readFileSync(path);
    if (sha256(data) !== r.sha256) throw new Error(`Integrity check failed for attachment ${id}`);
    await audit(tx, a, 'attachment.download', r.entity_type, r.entity_id, { attachment_id: id });
    return { meta: r, data };
  });
}

export async function listAttachments(a: Actor, entityType: string, entityId: string) {
  return withActor(a, (tx) => many(tx, `select id, filename, mime_type, size_bytes, uploaded_at, contains_pii, sha256 from attachments where entity_type=$1 and entity_id=$2 and disposed_at is null order by uploaded_at`, [entityType, entityId]));
}

/** Physical deletion used only by the approved disposal workflow. */
export function purgeStoredFile(storageKey: string) {
  const p = join(config.storageDir, storageKey);
  if (existsSync(p)) rmSync(p);
}
