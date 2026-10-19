// Name comparison used to keep the operator who records a decision separate from the people who made it.
// Names are compared after removing accents, punctuation, spacing, case and word order, so that "Smith, Jane" and
// "jane  smith" are treated as the same person. This cannot detect a different name for the same person; the signed
// documents (hashed on record) remain the evidence a gate reviewer checks.
import { hostname, userInfo } from 'node:os';

export function normaliseName(n: string): string {
  // Unicode letters and digits are kept (non-Latin names compare correctly); optional accents, apostrophes, other punctuation,
  // case, spacing and word order are ignored.
  // Marks are removed only where they are optional accents (Latin, Greek, Cyrillic, Arabic and Hebrew vowel points).
  // In scripts such as Devanagari, Thai or Japanese kana they distinguish names, so they are kept (R2-Q2).
  // Invisible joiners, variation selectors and zero-width characters, and marks not attached to a letter, are ignored (R2-Q4).
  return n.normalize('NFKD').replace(/[\u034F\u200B-\u200D\u2060\uFEFF\uFE00-\uFE0F\u{E0100}-\u{E01EF}]/gu, '')
    .replace(/(^|[^\p{L}\p{M}])\p{M}+/gu, '$1')
    .replace(/([\p{Script=Latin}\p{Script=Greek}\p{Script=Cyrillic}\p{Script=Arabic}\p{Script=Hebrew}])\p{M}+/gu, '$1')
    .normalize('NFC')
    // Spacing inside CJK names is not significant (王 伟 = 王伟).
    .replace(/(?<=[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}])\s+(?=[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}])/gu, '')
    .toLowerCase().replace(/['\u2019`]/g, '').replace(/[^\p{L}\p{M}\p{N}\s]/gu, ' ')
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
