import path from 'node:path';

export const config = {
  port: Number(process.env.API_PORT ?? 3001),
  webOrigin: process.env.WEB_ORIGIN ?? 'http://localhost:5173',
  sessionCookieName: process.env.SESSION_COOKIE_NAME ?? 'sao_session',
  sessionTtlHours: Number(process.env.SESSION_TTL_HOURS ?? 168),
  cookieSecure: String(process.env.COOKIE_SECURE ?? 'false') === 'true',
  maxJsonBytes: Number(process.env.MAX_JSON_BYTES ?? 5 * 1024 * 1024),
  maxImageBytes: Number(process.env.MAX_IMAGE_BYTES ?? 50 * 1024 * 1024),
  uploadDir: path.resolve(process.env.UPLOAD_DIR ?? 'data/uploads'),
  disableLogin: String(process.env.DISABLE_LOGIN ?? 'false').toLowerCase() === 'true',
  localAdminLogin: process.env.LOCAL_ADMIN_LOGIN ?? 'Rafilkl',
  localAdminPassword: process.env.LOCAL_ADMIN_PASSWORD ?? 'asadasan123',
  localAdminName: process.env.LOCAL_ADMIN_NAME ?? 'Rafilkl'
};
