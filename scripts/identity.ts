// Name comparison used to keep the operator who records a decision separate from the people who made it.
// Names are compared after removing accents, punctuation, spacing, case and word order, so that "Smith, Jane" and
// "jane  smith" are treated as the same person. This cannot detect a different name for the same person; the signed
// documents (hashed on record) remain the evidence a gate reviewer checks.
import { hostname, userInfo } from 'node:os';

export function normaliseName(n: string): string {
  return n.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/['\u2019`]/g, '').replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/).filter(Boolean).sort().join(' ');
}
export const samePerson = (a?: string | null, b?: string | null) => !!a && !!b && normaliseName(a) === normaliseName(b);

/** Where an operator command was run from, recorded with every platform decision for traceability. */
export function operatorContext() {
  let user = 'unknown';
  try { user = userInfo().username; } catch { /* containers without a passwd entry */ }
  return { os_user: user, host: hostname() };
}
