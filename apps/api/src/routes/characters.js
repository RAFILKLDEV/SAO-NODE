import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { audit } from '../lib/audit.js';
import { authenticate, requireCampaign, requireCsrf, requireGm } from '../lib/auth.js';
import { normalizeT20ProviderId } from '@sao/domain';
import { apiError, T20_CURRENT } from '@sao/shared';

const bindingSchema = z.object({
  userId: z.string().min(1),
  mode: z.enum(['auto', 'manual']),
  providerId: z.string().default(T20_CURRENT),
  externalId: z.string().min(1),
  snapshot: z
    .object({
      name: z.string().optional(),
      player: z.string().optional(),
      race: z.string().optional(),
      origin: z.string().optional(),
      class: z.string().optional(),
      level: z.union([z.string(), z.number()]).optional(),
      attributes: z.record(z.string(), z.unknown()).optional(),
      defense: z.unknown().optional(),
      resistances: z.unknown().optional(),
      hp: z.unknown().optional(),
      mp: z.unknown().optional(),
      avatar: z.string().optional()
    })
    .passthrough()
    .optional()
});

const associationSchema = z.object({
  npcId: z.string().min(1),
  ownerType: z.enum(['player', 'group']),
  ownerId: z.string().min(1)
});

export async function characterRoutes(app) {
  app.get('/api/v1/campaigns/:campaignId/bindings', { preHandler: [authenticate, requireCampaign] }, async (request) => {
    const where = request.membership.role === 'player'
      ? { campaignId: request.campaign.id, userId: request.auth.user.id }
      : { campaignId: request.campaign.id };
    return prisma.characterBinding.findMany({ where, orderBy: { updatedAt: 'desc' } });
  });

  app.put('/api/v1/campaigns/:campaignId/bindings', { preHandler: [authenticate, requireCampaign, requireGm, requireCsrf] }, async (request, reply) => {
    const parsed = bindingSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(apiError('INVALID_INPUT', 'Invalid character binding', parsed.error.flatten()));
    const providerId = normalizeT20ProviderId(parsed.data.providerId);
    const userMembership = await prisma.membership.findUnique({
      where: { campaignId_userId: { campaignId: request.campaign.id, userId: parsed.data.userId } }
    });
    if (!userMembership) return reply.code(400).send(apiError('INVALID_USER', 'User is not a campaign member'));
    const saved = await prisma.$transaction(async (tx) => {
      const binding = await tx.characterBinding.upsert({
        where: {
          campaignId_userId_externalId: {
            campaignId: request.campaign.id,
            userId: parsed.data.userId,
            externalId: parsed.data.externalId
          }
        },
        create: {
          campaignId: request.campaign.id,
          userId: parsed.data.userId,
          mode: parsed.data.mode,
          providerId,
          externalId: parsed.data.externalId,
          snapshot: parsed.data.snapshot
        },
        update: {
          mode: parsed.data.mode,
          providerId,
          snapshot: parsed.data.snapshot
        }
      });
      await audit(tx, {
        campaignId: request.campaign.id,
        actorUserId: request.auth.user.id,
        action: 'character.binding.upsert',
        subjectType: 'user',
        subjectId: parsed.data.userId,
        after: { ...parsed.data, providerId }
      });
      return binding;
    });
    return saved;
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
