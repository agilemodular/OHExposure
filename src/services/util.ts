import { z } from 'zod';
import { invalid } from '../errors.js';

export function parse<T extends z.ZodTypeAny>(schema: T, input: unknown): z.infer<T> {
  const r = schema.safeParse(input);
  if (!r.success) {
    const issues = r.error.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`);
    throw invalid(issues.join('; '), r.error.issues);
  }
  return r.data;
}

// Form-friendly coercions: empty strings become null/undefined.
const blank = (v: unknown) => (v === null || (typeof v === 'string' && v.trim() === '') ? undefined : v);
export const optStr = z.preprocess(blank, z.string().trim().max(10000).optional()).transform((v) => v ?? null);
export const reqStr = (min = 1, max = 10000) => z.string().trim().min(min).max(max);
export const optNum = z.preprocess(blank, z.coerce.number().finite().optional()).transform((v) => v ?? null);
export const optUuid = z.preprocess(blank, z.string().uuid().optional()).transform((v) => v ?? null);
export const uuid = z.string().uuid();
export const optDate = z.preprocess(blank, z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()).transform((v) => v ?? null);
export const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const optDateTime = z
  .preprocess(blank, z.string().refine((s) => !Number.isNaN(Date.parse(s)), 'invalid date/time').optional())
  .transform((v) => (v ? new Date(v).toISOString() : null));
/** Converts a wall-clock 'YYYY-MM-DDTHH:mm' in an IANA zone to a UTC ISO string. ISO strings with an offset pass through. */
export function zonedToUtc(local: string, tz: string): string {
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(local)) return new Date(local).toISOString();
  const naive = Date.parse(local + 'Z');
  if (Number.isNaN(naive)) throw invalid(`Invalid date/time: ${local}`);
  const offsetAt = (ms: number) => {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - ms;
  };
  let guess = naive - offsetAt(naive);
  guess = naive - offsetAt(guess);
  return new Date(guess).toISOString();
}
export function utcToZonedInput(iso: string | null, tz: string | null): string {
  if (!iso) return '';
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz ?? 'UTC', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    .formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
export const isValidTz = (tz: string) => { try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true; } catch { return false; } };

export const strArray = z.preprocess(
  (v) => (v === undefined || v === '' ? [] : Array.isArray(v) ? v : [v]),
  z.array(z.string().trim().min(1)),
);
export const bool = z.preprocess((v) => v === true || v === 'true' || v === 'on' || v === '1', z.boolean());
