import path from 'node:path';

export const config = {
  port: Number(process.env.API_PORT ?? 3001),
  webOrigin: process.env.WEB_ORIGIN ?? 'http://localhost:5173',
  sessionCookieName: process.env.SESSION_COOKIE_NAME ?? 'sao_session',
  sessionTtlHours: Number(process.env.SESSION_TTL_HOURS ?? 168),
  cookieSecure: String(process.env.COOKIE_SECURE ?? 'false') === 'true',
  // JSON imports can contain hundreds of complete monster sheets. Keep a
  // generous, configurable ceiling instead of the old 5 MiB default.
  maxJsonBytes: Number(process.env.MAX_JSON_BYTES ?? 128 * 1024 * 1024),
  importBatchSize: Math.max(1, Number(process.env.IMPORT_BATCH_SIZE ?? 100)),
  importTransactionTimeoutMs: Math.max(1000, Number(process.env.IMPORT_TRANSACTION_TIMEOUT_MS ?? 300000)),
  maxImageBytes: Number(process.env.MAX_IMAGE_BYTES ?? 50 * 1024 * 1024),
  uploadDir: path.resolve(process.env.UPLOAD_DIR ?? 'data/uploads'),
  disableLogin: String(process.env.DISABLE_LOGIN ?? 'false').toLowerCase() === 'true',
  localAdminLogin: process.env.LOCAL_ADMIN_LOGIN ?? 'Rafilkl',
  localAdminPassword: process.env.LOCAL_ADMIN_PASSWORD ?? 'asadasan123',
  localAdminName: process.env.LOCAL_ADMIN_NAME ?? 'Rafilkl',
  saoNodeBridgeToken: process.env.SAO_NODE_BRIDGE_TOKEN ?? '',
  firecastPublicBaseUrl: process.env.FIRECAST_PUBLIC_BASE_URL ?? ''
};
