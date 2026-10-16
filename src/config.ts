// Runtime configuration. Branding is configuration, not code, so a permanent
// product name and domain can be introduced without restructuring the app.
export const config = {
  databaseUrl: process.env.DATABASE_URL ?? 'postgres://ohea_app:ohea_app_dev@localhost:5432/ohea',
  port: Number(process.env.PORT ?? 3000),
  storageDir: process.env.STORAGE_DIR ?? new URL('../storage/', import.meta.url).pathname,
  cookieSecure: process.env.COOKIE_SECURE === 'true',
  sessionHours: Number(process.env.SESSION_HOURS ?? 10),
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
