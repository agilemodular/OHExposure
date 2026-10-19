// Security and operational alerts. Every alert is written to the structured log; when ALERT_WEBHOOK_URL is set it is
// also POSTed as JSON (signed with HMAC-SHA256 when ALERT_WEBHOOK_SECRET is set) so the hosting owner can route it to
// e-mail, chat or an on-call tool. Delivery is best-effort and never blocks or fails the user's request.
import { createHmac } from 'node:crypto';

export type AlertEvent =
  | 'auth.account_locked'
  | 'auth.mfa_lockout'
  | 'auth.ip_throttled'
  | 'integration.dead_letter'
  | 'backup.failed'
  | 'backup.succeeded'
  | 'restore_verify.failed'
  | 'workflow.suspended'
  | 'field.recovery_imported'
  | 'recovery_key.invalid';

const SEVERITY: Record<AlertEvent, 'info' | 'warning' | 'critical'> = {
  'auth.account_locked': 'warning',
  'auth.mfa_lockout': 'warning',
  'auth.ip_throttled': 'warning',
  'integration.dead_letter': 'warning',
  'backup.failed': 'critical',
  'backup.succeeded': 'info',
  'restore_verify.failed': 'critical',
  'workflow.suspended': 'critical',
  'field.recovery_imported': 'info',
  'recovery_key.invalid': 'critical',
};

// Suppress floods: one alert per event+key per window.
const recent = new Map<string, number>();
const WINDOW_MS = 10 * 60_000;
export const sentAlerts: { event: AlertEvent; detail: Record<string, unknown> }[] = [];

export async function sendAlert(event: AlertEvent, detail: Record<string, unknown> = {}, dedupeKey = '') {
  const k = `${event}|${dedupeKey}`;
  const now = Date.now();
  if ((recent.get(k) ?? 0) > now - WINDOW_MS) return false;
  recent.set(k, now);
  if (recent.size > 5000) for (const [rk, t] of recent) if (t <= now - WINDOW_MS) recent.delete(rk);
  const body = { event, severity: SEVERITY[event], at: new Date(now).toISOString(), service: 'ohea', detail };
  sentAlerts.push({ event, detail });
  if (sentAlerts.length > 200) sentAlerts.shift();
  console.warn(JSON.stringify({ level: 'warn', alert: body }));
  const url = process.env.ALERT_WEBHOOK_URL;
  if (!url) return true;
  const payload = JSON.stringify(body);
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (process.env.ALERT_WEBHOOK_SECRET) headers['x-ohea-signature'] = 'sha256=' + createHmac('sha256', process.env.ALERT_WEBHOOK_SECRET).update(payload).digest('hex');
  try {
    const r = await fetch(url, { method: 'POST', headers, body: payload, signal: AbortSignal.timeout(5000) });
    if (!r.ok) console.error(JSON.stringify({ level: 'error', msg: 'alert delivery failed', status: r.status, event }));
    return r.ok;
  } catch (e: any) {
    console.error(JSON.stringify({ level: 'error', msg: 'alert delivery failed', error: e.message, event }));
    return false;
  }
}
export const resetAlertDedupe = () => recent.clear();
