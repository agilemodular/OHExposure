// Runtime configuration. Branding is configuration, not code, so a permanent
// product name and domain can be introduced without restructuring the app.
export const config = {
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://ohea_app:ohea_app_dev@localhost:5432/ohea',
  port: Number(process.env.PORT ?? 3000),
  storageDir: process.env.STORAGE_DIR ?? new URL('../storage/', import.meta.url).pathname,
  cookieSecure: process.env.COOKIE_SECURE === 'true',
  sessionHours: Number(process.env.SESSION_HOURS ?? 10),
  // Sessions also end after this many minutes without any request (field devices must sign in again before syncing).
  sessionIdleMinutes: Number(process.env.SESSION_IDLE_MINUTES ?? 120),
  // Only trust X-Forwarded-For from known proxies: a hop count (e.g. '1') or a comma-separated list of proxy IPs/CIDRs.
  trustProxy: (() => { const v = process.env.TRUST_PROXY; if (!v) return false; if (/^\d+$/.test(v)) { const n = Number(v); return (_addr: string, hop: number) => hop < n; } return v.split(',').map((x) => x.trim()); })() as boolean | string[] | ((addr: string, hop: number) => boolean),
  loginIpLimit: Number(process.env.LOGIN_IP_LIMIT ?? 20),
  maxUploadBytes: Number(process.env.MAX_UPLOAD_BYTES ?? 15 * 1024 * 1024),
  aiProvider: (process.env.AI_PROVIDER ?? 'none') as 'none',
  branding: {
    productName: process.env.BRAND_PRODUCT_NAME ?? 'Occupational Hygiene & Exposure Assurance',
    endorsement: process.env.BRAND_ENDORSEMENT ?? 'by Assurentra',
    owner: process.env.BRAND_OWNER ?? 'SHEQ Experts Limited',
    promise: 'Understand workplace exposure. Verify controls. Demonstrate protection.',
    domain: process.env.BRAND_DOMAIN ?? '',
  },
};
