// Name comparison used to keep the operator who records a decision separate from the people who made it.
// Names are compared after removing accents, punctuation, spacing, case and word order, so that "Smith, Jane" and
// "jane  smith" are treated as the same person. This cannot detect a different name for the same person; the signed
// documents (hashed on record) remain the evidence a gate reviewer checks.
import { hostname, userInfo } from 'node:os';

export function normaliseName(n: string): string {
  // Unicode letters and digits are kept (non-Latin names compare correctly); accents, apostrophes, other punctuation,
  // case, spacing and word order are ignored.
  return n.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/['\u2019`]/g, '').replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/).filter(Boolean).sort().join(' ');
}
export const samePerson = (a?: string | null, b?: string | null) => {
  if (!a || !b) return false;
  const x = normaliseName(a), y = normaliseName(b);
  return x ? x === y : a.trim().toLowerCase() === b.trim().toLowerCase();
};

/** Where an operator command was run from, recorded with every platform decision for traceability. */
export function operatorContext() {
  let user = 'unknown';
  try { user = userInfo().username; } catch { /* containers without a passwd entry */ }
  return { os_user: user, host: hostname() };
}
