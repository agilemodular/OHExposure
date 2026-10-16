import { z } from 'zod';
import { config } from '../config.js';
import { audit, many, one, requirePerm, withActor, type Actor } from '../db.js';
import { AppError, invalid, notFound } from '../errors.js';
import { parse, reqStr } from './util.js';

/**
 * AI assistance boundary. AI output is only ever stored as a labelled, pending suggestion
 * with source references; it never writes measurements, results, limits, calculations,
 * approvals or effectiveness decisions. A human must accept it, and acceptance only copies
 * text into a draft field that still goes through professional review.
 *
 * No AI provider is configured in this release (AI_PROVIDER=none). Every core workflow works without it.
 */
export interface AiProvider {
  name: string;
  draftNarrative(ctx: { calcOutput: unknown; question: string }): Promise<{ text: string; sourceRefs: string[] }>;
}

function provider(): AiProvider | null {
  return config.aiProvider === 'none' ? null : null;
}

export async function requestNarrativeDraft(a: Actor, revisionId: string) {
  requirePerm(a, 'assess.write');
  const p = provider();
  if (!p) throw new AppError(503, 'ai_disabled', 'AI assistance is not configured for this deployment. All assessment workflows remain available without it.');
  return withActor(a, async (tx) => {
    const r = await one(tx, 'select r.*, a.assessment_question from assessment_revisions r join assessments a on a.id=r.assessment_id where r.id=$1', [revisionId]);
    if (!r) throw notFound('Revision');
    if (!r.calc_output) throw invalid('Calculate first');
    const out = await p.draftNarrative({ calcOutput: r.calc_output, question: r.assessment_question });
    const s = await one(tx, `insert into ai_suggestions (tenant_id,client_id,kind,entity_type,entity_id,content,source_refs,provider) values ($1,$2,'narrative_draft','assessment_revision',$3,$4,$5,$6) returning *`,
      [a.tenantId, r.client_id, revisionId, { text: out.text }, out.sourceRefs, p.name]);
    await audit(tx, a, 'ai.suggestion_created', 'assessment_revision', revisionId, { suggestion: s.id, provider: p.name });
    return s;
  });
}

export async function decideSuggestion(a: Actor, id: string, input: unknown) {
  requirePerm(a, 'assess.write');
  const d = parse(z.object({ decision: z.enum(['accepted', 'rejected']), note: reqStr(3) }), input);
  return withActor(a, async (tx) => {
    const s = await one(tx, 'select * from ai_suggestions where id=$1 for update', [id]);
    if (!s || s.status !== 'pending') throw notFound('Pending suggestion');
    if (d.decision === 'accepted' && s.kind === 'narrative_draft') {
      const r = await one(tx, 'select status from assessment_revisions where id=$1', [s.entity_id]);
      if (r.status !== 'draft') throw invalid('Suggestions can only be applied to a draft revision');
      await tx.query(`update assessment_revisions set interpretation = $2 where id=$1`, [s.entity_id, `[AI-assisted draft, accepted by ${a.name}] ${s.content.text}`]);
    }
    await tx.query('update ai_suggestions set status=$2, decided_by=$3, decided_at=now() where id=$1', [id, d.decision, a.userId]);
    await audit(tx, a, `ai.suggestion_${d.decision}`, s.entity_type, s.entity_id, { suggestion: id, note: d.note });
  });
}

export async function listSuggestions(a: Actor, entityId: string) {
  return withActor(a, (tx) => many(tx, 'select * from ai_suggestions where entity_id=$1 order by created_at desc', [entityId]));
}
