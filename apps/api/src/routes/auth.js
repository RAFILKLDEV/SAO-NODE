import argon2 from 'argon2';
import { prisma } from '../lib/prisma.js';
import { config } from '../lib/config.js';
import { authenticate, requireCsrf } from '../lib/auth.js';
import { randomToken, hashToken, sessionCookieOptions } from '../lib/security.js';
import { apiError } from '@sao/shared';

function getLocalAdminBypass() {
  return {
    disabled: String(process.env.DISABLE_LOGIN ?? config.disableLogin ?? 'false').toLowerCase() === 'true',
    login: process.env.LOCAL_ADMIN_LOGIN ?? config.localAdminLogin,
    password: process.env.LOCAL_ADMIN_PASSWORD ?? config.localAdminPassword,
    name: process.env.LOCAL_ADMIN_NAME ?? config.localAdminName
  };
}

export async function authRoutes(app) {
  app.post('/api/v1/auth/login', { config: { rateLimit: { max: 10, timeWindow: '1 minute' }, csrf: false } }, async (request, reply) => {
    const { login, password } = request.body ?? {};
    if (typeof login !== 'string' || typeof password !== 'string') {
      return reply.code(400).send(apiError('INVALID_INPUT', 'login and password are required'));
    }

    const localAdmin = getLocalAdminBypass();
    if (localAdmin.disabled && login === localAdmin.login && password === localAdmin.password) {
      const token = randomToken();
      const csrfToken = randomToken(24);
      const expiresAt = new Date(Date.now() + config.sessionTtlHours * 60 * 60 * 1000);
      let adminUser = { id: 'local-admin', login: localAdmin.login, name: localAdmin.name };

      try {
        adminUser = await prisma.user.upsert({
          where: { login: localAdmin.login },
          create: { login: localAdmin.login, name: localAdmin.name, passwordHash: await argon2.hash(localAdmin.password) },
          update: { name: localAdmin.name }
        });
        await prisma.session.create({ data: { tokenHash: hashToken(token), csrfToken, userId: adminUser.id, expiresAt } });
      } catch (error) {
        const message = String(error?.message ?? '');
        if (!message.includes('DATABASE_URL') && !message.includes('Environment variable not found')) {
          throw error;
        }
      }

      reply.setCookie(config.sessionCookieName, token, sessionCookieOptions());
      return { user: { id: adminUser.id, login: adminUser.login, name: adminUser.name }, csrfToken };
    }

    const user = await prisma.user.findUnique({ where: { login } });
    if (!user || !(await argon2.verify(user.passwordHash, password))) {
      return reply.code(401).send(apiError('INVALID_CREDENTIALS', 'Invalid credentials'));
    }
    const token = randomToken();
    const csrfToken = randomToken(24);
    const expiresAt = new Date(Date.now() + config.sessionTtlHours * 60 * 60 * 1000);
    await prisma.session.create({ data: { tokenHash: hashToken(token), csrfToken, userId: user.id, expiresAt } });
    reply.setCookie(config.sessionCookieName, token, sessionCookieOptions());
    return { user: { id: user.id, login: user.login, name: user.name }, csrfToken };
  });

  app.get('/api/v1/auth/me', { preHandler: [authenticate] }, async (request) => ({
    user: { id: request.auth.user.id, login: request.auth.user.login, name: request.auth.user.name }
  }));

  app.get('/api/v1/auth/csrf', { preHandler: [authenticate] }, async (request) => ({ csrfToken: request.auth.session.csrfToken }));

  app.post('/api/v1/auth/logout', { preHandler: [authenticate, requireCsrf] }, async (request, reply) => {
    await prisma.session.delete({ where: { id: request.auth.session.id } }).catch(() => undefined);
    reply.clearCookie(config.sessionCookieName, { path: '/' });
    return { ok: true };
  });
}
