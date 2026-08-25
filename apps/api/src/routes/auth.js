import argon2 from 'argon2';
import { prisma } from '../lib/prisma.js';
import { config } from '../lib/config.js';
import { authenticate, requireCsrf } from '../lib/auth.js';
import { randomToken, hashToken, sessionCookieOptions } from '../lib/security.js';
import { apiError } from '@sao/shared';

export async function authRoutes(app) {
  app.post('/api/v1/auth/login', { config: { rateLimit: { max: 10, timeWindow: '1 minute' }, csrf: false } }, async (request, reply) => {
    const { login, password } = request.body ?? {};
    if (typeof login !== 'string' || typeof password !== 'string') {
      return reply.code(400).send(apiError('INVALID_INPUT', 'login and password are required'));
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
