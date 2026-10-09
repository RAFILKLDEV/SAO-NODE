import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { audit } from '../lib/audit.js';
import { authenticate, requireCampaign, requireCsrf, requireGm } from '../lib/auth.js';
import { apiError } from '@sao/shared';
import { getEntityForRequest } from '../services/content.js';

const favoriteTarget = z.object({ targetType: z.enum(['npc', 'player', 'location', 'item', 'monster', 'quest']), targetId: z.string().min(1).max(256) });

const associationSchema = z.object({
  npcId: z.string().min(1),
  ownerType: z.enum(['player', 'group']),
  ownerId: z.string().min(1)
});

export async function characterRoutes(app) {
  // Public campaign roster, deliberately excluding private account details.
  app.get('/api/v1/campaigns/:campaignId/characters/players', { preHandler: [authenticate, requireCampaign] }, async (request) => {
    const rows = await prisma.membership.findMany({
      where: { campaignId: request.campaign.id, role: 'player' },
      select: { userId: true, characterImageUrl: true, user: { select: { name: true } } },
      orderBy: { user: { name: 'asc' } }
    });
    return rows.map(({ userId, characterImageUrl, user }) => ({ userId, name: user.name, characterImageUrl }));
  });

  const favoriteBase = '/api/v1/campaigns/:campaignId/character-favorites';
  const owner = (request) => ({ campaignId: request.campaign.id, userId: request.auth.user.id });
  app.get(favoriteBase, { preHandler: [authenticate, requireCampaign] }, async (request) =>
    prisma.characterFavorite.findMany({ where: owner(request), select: { targetType: true, targetId: true } }));

  app.put(`${favoriteBase}/:targetType/:targetId`, { preHandler: [authenticate, requireCampaign, requireCsrf] }, async (request, reply) => {
    const parsed = favoriteTarget.safeParse(request.params);
    if (!parsed.success) return reply.code(400).send(apiError('INVALID_INPUT', 'Alvo inválido'));
    const { targetType, targetId } = parsed.data;
    const target = targetType === 'player'
      ? await prisma.membership.findFirst({ where: { campaignId: request.campaign.id, userId: targetId, role: 'player' } })
      : await getEntityForRequest({ request, type: targetType, domainId: targetId });
    if (!target) return reply.code(404).send(apiError('NOT_FOUND', 'Conteúdo não encontrado ou não visível'));
    const key = { ...owner(request), targetType, targetId };
    await prisma.characterFavorite.upsert({ where: { campaignId_userId_targetType_targetId: key }, create: key, update: {} });
    return { targetType, targetId };
  });

  app.delete(`${favoriteBase}/:targetType/:targetId`, { preHandler: [authenticate, requireCampaign, requireCsrf] }, async (request, reply) => {
    const parsed = favoriteTarget.safeParse(request.params);
    if (!parsed.success) return reply.code(400).send(apiError('INVALID_INPUT', 'Alvo inválido'));
    await prisma.characterFavorite.deleteMany({ where: { ...owner(request), ...parsed.data } });
    return { ok: true };
  });

  app.get('/api/v1/campaigns/:campaignId/npc-associations', { preHandler: [authenticate, requireCampaign, requireGm] }, async (request) => {
    return prisma.npcAssociation.findMany({ where: { campaignId: request.campaign.id }, orderBy: { createdAt: 'desc' } });
  });

  app.put('/api/v1/campaigns/:campaignId/npc-associations', { preHandler: [authenticate, requireCampaign, requireGm, requireCsrf] }, async (request, reply) => {
    const parsed = associationSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(apiError('INVALID_INPUT', 'Invalid NPC association', parsed.error.flatten()));
    const npc = await prisma.entity.findUnique({
      where: { campaignId_type_domainId: { campaignId: request.campaign.id, type: 'npc', domainId: parsed.data.npcId } }
    });
    if (!npc || npc.deletedAt) return reply.code(404).send(apiError('NOT_FOUND', 'NPC not found'));
    const association = await prisma.$transaction(async (tx) => {
      const saved = await tx.npcAssociation.upsert({
        where: {
          campaignId_npcDomainId_ownerType_ownerId: {
            campaignId: request.campaign.id,
            npcDomainId: parsed.data.npcId,
            ownerType: parsed.data.ownerType,
            ownerId: parsed.data.ownerId
          }
        },
        create: { campaignId: request.campaign.id, npcDomainId: parsed.data.npcId, ownerType: parsed.data.ownerType, ownerId: parsed.data.ownerId },
        update: {}
      });
      await audit(tx, { campaignId: request.campaign.id, actorUserId: request.auth.user.id, action: 'npc.association.upsert', entityType: 'npc', entityDomainId: parsed.data.npcId, subjectType: parsed.data.ownerType, subjectId: parsed.data.ownerId, after: parsed.data });
      return saved;
    });
    return association;
  });
}
