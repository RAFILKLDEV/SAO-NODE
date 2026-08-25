import { prisma } from '../lib/prisma.js';
import { authenticate, requireCampaign, requireCsrf, requireGm } from '../lib/auth.js';
import { audit } from '../lib/audit.js';
import { apiError, roleSchema } from '@sao/shared';
import { z } from 'zod';

const campaignInput = z.object({ slug: z.string().min(2).regex(/^[a-z0-9-]+$/), name: z.string().min(1) });
const membershipInput = z.object({ userId: z.string().min(1), role: roleSchema });

export async function campaignRoutes(app) {
  app.get('/api/v1/campaigns', { preHandler: [authenticate] }, async (request) => {
    const memberships = await prisma.membership.findMany({
      where: { userId: request.auth.user.id },
      include: { campaign: true },
      orderBy: { campaign: { name: 'asc' } }
    });
    return memberships.map((membership) => ({
      id: membership.campaign.id,
      slug: membership.campaign.slug,
      name: membership.campaign.name,
      role: membership.role
    }));
  });

  app.post('/api/v1/campaigns', { preHandler: [authenticate, requireCsrf] }, async (request, reply) => {
    const parsed = campaignInput.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(apiError('INVALID_INPUT', 'Invalid campaign', parsed.error.flatten()));
    const campaign = await prisma.$transaction(async (tx) => {
      const created = await tx.campaign.create({ data: parsed.data });
      await tx.membership.create({ data: { campaignId: created.id, userId: request.auth.user.id, role: 'owner' } });
      await audit(tx, { campaignId: created.id, actorUserId: request.auth.user.id, action: 'campaign.create', after: parsed.data });
      return created;
    });
    return reply.code(201).send(campaign);
  });

  app.get('/api/v1/campaigns/:campaignId', { preHandler: [authenticate, requireCampaign] }, async (request) => ({
    id: request.campaign.id,
    slug: request.campaign.slug,
    name: request.campaign.name,
    role: request.membership.role
  }));

  app.get('/api/v1/campaigns/:campaignId/memberships', { preHandler: [authenticate, requireCampaign, requireGm] }, async (request) => {
    const rows = await prisma.membership.findMany({
      where: { campaignId: request.campaign.id },
      include: { user: true },
      orderBy: { user: { name: 'asc' } }
    });
    return rows.map((row) => ({ id: row.id, user: { id: row.user.id, login: row.user.login, name: row.user.name }, role: row.role }));
  });

  app.put('/api/v1/campaigns/:campaignId/memberships', { preHandler: [authenticate, requireCampaign, requireGm, requireCsrf] }, async (request, reply) => {
    const parsed = membershipInput.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(apiError('INVALID_INPUT', 'Invalid membership', parsed.error.flatten()));
    const membership = await prisma.$transaction(async (tx) => {
      const before = await tx.membership.findUnique({ where: { campaignId_userId: { campaignId: request.campaign.id, userId: parsed.data.userId } } });
      const saved = await tx.membership.upsert({
        where: { campaignId_userId: { campaignId: request.campaign.id, userId: parsed.data.userId } },
        create: { campaignId: request.campaign.id, ...parsed.data },
        update: { role: parsed.data.role }
      });
      await audit(tx, { campaignId: request.campaign.id, actorUserId: request.auth.user.id, action: 'membership.upsert', subjectType: 'user', subjectId: parsed.data.userId, before, after: saved });
      return saved;
    });
    return membership;
  });
}
