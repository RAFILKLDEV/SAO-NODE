export const config = {
  port: Number(process.env.API_PORT ?? 3001),
  webOrigin: process.env.WEB_ORIGIN ?? 'http://localhost:5173',
  sessionCookieName: process.env.SESSION_COOKIE_NAME ?? 'sao_session',
  sessionTtlHours: Number(process.env.SESSION_TTL_HOURS ?? 168),
  cookieSecure: String(process.env.COOKIE_SECURE ?? 'false') === 'true',
  maxXmlBytes: Number(process.env.MAX_XML_BYTES ?? 5 * 1024 * 1024)
};
