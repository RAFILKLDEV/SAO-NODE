import { prisma } from './prisma.js';
import { config } from './config.js';
import { hashToken } from './security.js';
import { apiError } from '@sao/shared';

const gmRoles = new Set(['owner', 'gm', 'assistant_gm']);

export async function authenticate(request, reply) {
  const token = request.cookies?.[config.sessionCookieName];
  if (!token) return reply.code(401).send(apiError('UNAUTHENTICATED', 'Authentication required'));
  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true }
  });
  if (!session || session.expiresAt <= new Date()) {
    return reply.code(401).send(apiError('UNAUTHENTICATED', 'Session expired'));
  }
  request.auth = { user: session.user, session };
}

export async function requireCampaign(request, reply) {
  const campaignId = request.params?.campaignId ?? request.body?.campaignId ?? request.query?.campaignId;
  if (!campaignId) return reply.code(400).send(apiError('CAMPAIGN_REQUIRED', 'campaignId is required'));
  const membership = await prisma.membership.findUnique({
    where: { campaignId_userId: { campaignId, userId: request.auth.user.id } },
    include: { campaign: true }
  });
  if (!membership) return reply.code(404).send(apiError('NOT_FOUND', 'Campaign not found'));
  request.campaign = membership.campaign;
  request.membership = membership;
}

export function isGm(request) {
  return gmRoles.has(request.membership?.role);
}

export async function requireGm(request, reply) {
  if (!isGm(request)) return reply.code(403).send(apiError('FORBIDDEN', 'GM permission required'));
}

export async function requireCsrf(request, reply) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return;
  if (request.routeOptions?.config?.csrf === false) return;
  const token = request.headers['x-csrf-token'];
  if (!request.auth?.session || !token || token !== request.auth.session.csrfToken) {
    return reply.code(403).send(apiError('CSRF', 'Invalid CSRF token'));
  }
}
