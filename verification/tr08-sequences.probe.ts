// Evidence probe: runs the TR-08 concurrency scenarios (the same functions as test/tr08.test.ts) and writes the observed
// sequences — when the approval pauses after its evidence check, when the competing write starts, whether it waits for
// the approval's lock, and when each finishes — to OHEA_SEQUENCES_OUT. Asserts the required outcome as well.
import { writeFileSync } from 'node:fs';
import { afterAll, expect, it } from 'vitest';
import { closePool } from '../src/db.js';
import * as T from '../test/tr08-scenarios.js';
afterAll(async () => { await closePool(); });
it('TR-08 concurrency sequences', async () => {
  const S = await T.setup();
  const runs = [await T.concurrentAmendment(S), await T.concurrentCalibration(S)];
  writeFileSync(process.env.OHEA_SEQUENCES_OUT ?? 'tr08-sequences.json', JSON.stringify({ recorded_at: new Date().toISOString(), runs }, null, 2));
  for (const r of runs) { expect(r.blockedByApproval).toBe(true); expect(r.approval).toBe('succeeded'); expect(r.evidenceChangedBeforeApprovalCommitted).toBe(false); }
}, 180000);
