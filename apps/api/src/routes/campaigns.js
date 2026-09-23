import argon2 from 'argon2';
import { prisma } from '../lib/prisma.js';
import { authenticate, requireCampaign, requireCsrf, requireGm } from '../lib/auth.js';
import { audit } from '../lib/audit.js';
import { apiError, roleSchema } from '@sao/shared';
import { z } from 'zod';

const campaignInput = z.object({ slug: z.string().min(2).regex(/^[a-z0-9-]+$/), name: z.string().min(1) });
const membershipInput = z.object({ userId: z.string().min(1), role: roleSchema, characterImageUrl: z.string().max(500).nullable().optional() });
const playerCreateInput = z.object({
  login: z.string(),
  name: z.string(),
  password: z.string()
});
const playerUpdateInput = z.object({ login: z.string(), name: z.string(), password: z.string().optional() });

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
    return rows.map((row) => ({ id: row.id, user: { id: row.user.id, login: row.user.login, name: row.user.name, characterImageUrl: row.characterImageUrl }, role: row.role }));
  });

  app.post('/api/v1/campaigns/:campaignId/players', { preHandler: [authenticate, requireCampaign, requireGm, requireCsrf] }, async (request, reply) => {
    const parsed = playerCreateInput.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(apiError('INVALID_INPUT', 'Invalid player', parsed.error.flatten()));

    const payload = parsed.data;
    const player = await prisma.$transaction(async (tx) => {
      const user = await tx.user.upsert({
        where: { login: payload.login },
        create: {
          login: payload.login,
          name: payload.name,
          passwordHash: await argon2.hash(payload.password)
        },
        update: { name: payload.name }
      });

      const before = await tx.membership.findUnique({
        where: { campaignId_userId: { campaignId: request.campaign.id, userId: user.id } }
      });

      const saved = await tx.membership.upsert({
        where: { campaignId_userId: { campaignId: request.campaign.id, userId: user.id } },
        create: { campaignId: request.campaign.id, userId: user.id, role: 'player' },
        update: { role: 'player' }
      });

      await audit(tx, {
        campaignId: request.campaign.id,
        actorUserId: request.auth.user.id,
        action: 'membership.upsert',
        subjectType: 'user',
        subjectId: user.id,
        before,
        after: saved
      });

      return { user: { id: user.id, login: user.login, name: user.name }, role: saved.role };
    });

    return reply.code(201).send(player);
  });

  app.put('/api/v1/campaigns/:campaignId/players/:userId', { preHandler: [authenticate, requireCampaign, requireGm, requireCsrf] }, async (request, reply) => {
    const parsed = playerUpdateInput.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(apiError('INVALID_INPUT', 'Invalid player', parsed.error.flatten()));

    const membership = await prisma.membership.findUnique({
      where: { campaignId_userId: { campaignId: request.campaign.id, userId: request.params.userId } }
    });
    if (!membership) return reply.code(404).send(apiError('NOT_FOUND', 'Player not found'));

    const user = await prisma.$transaction(async (tx) => {
      const before = await tx.user.findUnique({ where: { id: request.params.userId } });
      if (!before) return null;
      const saved = await tx.user.update({
        where: { id: request.params.userId },
        data: {
          login: parsed.data.login,
          name: parsed.data.name,
          ...(parsed.data.password ? { passwordHash: await argon2.hash(parsed.data.password) } : {})
        }
      });
      await audit(tx, {
        campaignId: request.campaign.id,
        actorUserId: request.auth.user.id,
        action: 'user.update',
        subjectType: 'user',
        subjectId: saved.id,
        before: { login: before.login, name: before.name },
        after: { login: saved.login, name: saved.name }
      });
      return { id: saved.id, login: saved.login, name: saved.name };
    });
    if (!user) return reply.code(404).send(apiError('NOT_FOUND', 'Player not found'));
    return user;
  });

  app.delete('/api/v1/campaigns/:campaignId/players/:userId', { preHandler: [authenticate, requireCampaign, requireGm, requireCsrf] }, async (request, reply) => {
    const membership = await prisma.membership.findUnique({
      where: { campaignId_userId: { campaignId: request.campaign.id, userId: request.params.userId } }
    });
    if (!membership) return reply.code(404).send(apiError('NOT_FOUND', 'Player not found'));
    if (membership.role === 'owner') return reply.code(400).send(apiError('INVALID_OPERATION', 'The campaign owner cannot be removed'));

    await prisma.$transaction(async (tx) => {
      await tx.membership.delete({ where: { id: membership.id } });
      await audit(tx, {
        campaignId: request.campaign.id,
        actorUserId: request.auth.user.id,
        action: 'membership.delete',
        subjectType: 'user',
        subjectId: request.params.userId,
        before: membership
      });
    });
    return reply.code(204).send();
  });

  app.put('/api/v1/campaigns/:campaignId/memberships', { preHandler: [authenticate, requireCampaign, requireGm, requireCsrf] }, async (request, reply) => {
    const parsed = membershipInput.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(apiError('INVALID_INPUT', 'Invalid membership', parsed.error.flatten()));
    const membership = await prisma.$transaction(async (tx) => {
      const before = await tx.membership.findUnique({ where: { campaignId_userId: { campaignId: request.campaign.id, userId: parsed.data.userId } } });
      const saved = await tx.membership.upsert({
        where: { campaignId_userId: { campaignId: request.campaign.id, userId: parsed.data.userId } },
        create: { campaignId: request.campaign.id, ...parsed.data },
        update: { role: parsed.data.role, characterImageUrl: parsed.data.characterImageUrl }
      });
      await audit(tx, { campaignId: request.campaign.id, actorUserId: request.auth.user.id, action: 'membership.upsert', subjectType: 'user', subjectId: parsed.data.userId, before, after: saved });
      return saved;
    });
    return membership;
  });
}
