// Name comparison used to keep the operator who records a decision separate from the people who made it.
// Names are compared after removing accents, punctuation, spacing, case and word order, so that "Smith, Jane" and
// "jane  smith" are treated as the same person. This cannot detect a different name for the same person; the signed
// documents (hashed on record) remain the evidence a gate reviewer checks.
import { hostname, userInfo } from 'node:os';

const LATIN_FOLD: Record<string, string> = { ł: 'l', Ł: 'L', ø: 'o', Ø: 'O', đ: 'd', Đ: 'D', ß: 'ss', æ: 'ae', Æ: 'AE', œ: 'oe', Œ: 'OE', ħ: 'h', Ħ: 'H', ı: 'i', þ: 'th', Þ: 'TH', ð: 'd', Ð: 'D' };

export function normaliseName(n: string): string {
  // Unicode letters and digits are kept (non-Latin names compare correctly); optional accents, apostrophes, other punctuation,
  // case, spacing and word order are ignored.
  // Marks are removed only where they are optional accents (Latin, Greek, Cyrillic, Arabic and Hebrew vowel points).
  // In scripts such as Devanagari, Thai or Japanese kana they distinguish names, so they are kept (R2-Q2).
  // Invisible joiners, variation selectors and zero-width characters, and marks not attached to a letter, are ignored (R2-Q4).
  // Every default-ignorable code point (soft hyphen, bidi controls, Hangul fillers, tags, joiners, variation selectors…)
  // is removed, as are inherited marks (e.g. a stray acute) on scripts where they carry no meaning (R2-Q4 re-check).
  // Kana voicing marks are kept: ガ and カ are different names.
  // Spacing kana voicing marks (゛゜) are read as the combining marks they stand for; control characters and the braille blank are removed.
  return n.replace(/\u309B/g, '\u3099').replace(/\u309C/g, '\u309A').replace(/[\p{Cc}\u2800]/gu, '').normalize('NFKD').replace(/\p{Default_Ignorable_Code_Point}/gu, '')
    .replace(/(^|[^\p{L}\p{M}])\p{M}+/gu, '$1')
    .replace(/([\p{Script=Latin}\p{Script=Greek}\p{Script=Cyrillic}\p{Script=Arabic}\p{Script=Hebrew}])\p{M}+/gu, '$1')
    .replace(/(?![\p{scx=Hira}\p{scx=Kana}])\p{Script=Inherited}/gu, '')
    .normalize('NFC')
    // Latin letters that do not decompose are folded to their plain spelling (Łukasz = Lukasz, Strauß = Strauss).
    .replace(/[łŁøØđĐßæÆœŒħĦıþÞðÐ]/g, (c) => LATIN_FOLD[c])
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
