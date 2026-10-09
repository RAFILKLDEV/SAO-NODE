import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { audit } from '../lib/audit.js';
import { authenticate, requireCampaign, requireCsrf, requireGm } from '../lib/auth.js';
import { apiError } from '@sao/shared';
import { createNotifications } from '../services/notifications.js';
import { groupCharacters } from '../services/group-roster.js';

const groupSchema = z.object({ domainId: z.string().min(2), name: z.string().min(1) });
const memberSchema = z.object({ userId: z.string().min(1) });
const characterSchema = z.object({ characterId: z.string().min(1).max(256) });

export async function groupRoutes(app) {
  app.get('/api/v1/campaigns/:campaignId/groups', { preHandler: [authenticate, requireCampaign] }, async (request) => {
    const groups = await prisma.group.findMany({
      where: { campaignId: request.campaign.id },
      include: { members: { include: { user: true } } },
      orderBy: { name: 'asc' }
    });
    const characters = await groupCharacters(request, groups.map(group => group.domainId));
    return groups.map((group) => ({
      id: group.domainId,
      name: group.name,
      members: group.members.map((member) => ({ id: member.user.id, login: member.user.login, name: member.user.name })),
      characters: characters.get(group.domainId)
    }));
  });

  app.post('/api/v1/campaigns/:campaignId/groups', { preHandler: [authenticate, requireCampaign, requireGm, requireCsrf] }, async (request, reply) => {
    const parsed = groupSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(apiError('INVALID_INPUT', 'Invalid group', parsed.error.flatten()));
    const group = await prisma.$transaction(async (tx) => {
      const created = await tx.group.create({ data: { campaignId: request.campaign.id, ...parsed.data } });
      await audit(tx, { campaignId: request.campaign.id, actorUserId: request.auth.user.id, action: 'group.create', subjectType: 'group', subjectId: created.domainId, after: parsed.data });
      return created;
    });
    request.server.realtime?.to(`campaign:${request.campaign.id}`).emit('group.changed', { groupId: group.domainId });
    return reply.code(201).send({ id: group.domainId, name: group.name });
  });

  app.post('/api/v1/campaigns/:campaignId/groups/:groupId/members', { preHandler: [authenticate, requireCampaign, requireGm, requireCsrf] }, async (request, reply) => {
    const parsed = memberSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(apiError('INVALID_INPUT', 'Invalid member', parsed.error.flatten()));
    const group = await prisma.group.findUnique({ where: { campaignId_domainId: { campaignId: request.campaign.id, domainId: request.params.groupId } } });
    if (!group) return reply.code(404).send(apiError('NOT_FOUND', 'Group not found'));
    const membership = await prisma.membership.findUnique({ where: { campaignId_userId: { campaignId: request.campaign.id, userId: parsed.data.userId } } });
    if (!membership) return reply.code(404).send(apiError('NOT_FOUND', 'Jogador não encontrado nesta campanha'));
    await prisma.$transaction(async (tx) => {
      await tx.groupMember.upsert({ where: { groupId_userId: { groupId: group.id, userId: parsed.data.userId } }, create: { groupId: group.id, userId: parsed.data.userId }, update: {} });
      await audit(tx, { campaignId: request.campaign.id, actorUserId: request.auth.user.id, action: 'group.member.add', subjectType: 'group', subjectId: group.domainId, after: { userId: parsed.data.userId } });
    });
    request.server.realtime?.to(`campaign:${request.campaign.id}`).emit('permissions.changed', { reason: 'group-membership', groupId: group.domainId });
    const grants = await prisma.grant.findMany({
      where: {
        campaignId: request.campaign.id,
        subjectType: 'group',
        subjectId: group.domainId,
        allowance: 'allow'
      },
      select: { entityType: true, entityDomainId: true }
    });
    const entities = [
      ...new Map(
        grants.map((grant) => [
          `${grant.entityType}:${grant.entityDomainId}`,
          { entityType: grant.entityType, entityId: grant.entityDomainId }
        ])
      ).values()
    ];
    if (entities.length) {
      await createNotifications({
        db: prisma,
        realtime: request.server.realtime,
        campaignId: request.campaign.id,
        userIds: [parsed.data.userId],
        eventType: 'permissions.notification',
        kind: 'new',
        title: 'Novo conteúdo disponível',
        message: 'Um novo conteúdo foi liberado para você.',
        payload: { reason: 'group-membership', entities }
      });
    }
    return { ok: true };
  });

  app.delete('/api/v1/campaigns/:campaignId/groups/:groupId/members/:userId', { preHandler: [authenticate, requireCampaign, requireGm, requireCsrf] }, async (request, reply) => {
    const group = await prisma.group.findUnique({ where: { campaignId_domainId: { campaignId: request.campaign.id, domainId: request.params.groupId } } });
    if (!group) return reply.code(404).send(apiError('NOT_FOUND', 'Group not found'));
    await prisma.$transaction(async (tx) => {
      await tx.groupMember.deleteMany({ where: { groupId: group.id, userId: request.params.userId } });
      await audit(tx, { campaignId: request.campaign.id, actorUserId: request.auth.user.id, action: 'group.member.remove', subjectType: 'group', subjectId: group.domainId, before: { userId: request.params.userId } });
    });
    request.server.realtime?.to(`campaign:${request.campaign.id}`).emit('permissions.changed', { reason: 'group-membership', groupId: group.domainId });
    return reply.code(204).send();
  });

  app.post('/api/v1/campaigns/:campaignId/groups/:groupId/characters', { preHandler: [authenticate, requireCampaign, requireGm, requireCsrf] }, async (request, reply) => {
    const parsed = characterSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(apiError('INVALID_INPUT', 'Selecione um personagem', parsed.error.flatten()));
    const group = await prisma.group.findUnique({ where: { campaignId_domainId: { campaignId: request.campaign.id, domainId: request.params.groupId } } });
    if (!group) return reply.code(404).send(apiError('NOT_FOUND', 'Grupo não encontrado'));
    const character = await prisma.entity.findUnique({ where: { campaignId_type_domainId: { campaignId: request.campaign.id, type: 'npc', domainId: parsed.data.characterId } } });
    if (!character || character.deletedAt) return reply.code(404).send(apiError('NOT_FOUND', 'Personagem não encontrado nesta campanha'));
    const key = { campaignId: request.campaign.id, npcDomainId: parsed.data.characterId, ownerType: 'group', ownerId: group.domainId };
    await prisma.$transaction(async tx => {
      await tx.npcAssociation.upsert({ where: { campaignId_npcDomainId_ownerType_ownerId: key }, create: key, update: {} });
      await audit(tx, { campaignId: request.campaign.id, actorUserId: request.auth.user.id, action: 'group.character.add', subjectType: 'group', subjectId: group.domainId, entityType: 'npc', entityDomainId: parsed.data.characterId, after: key });
    });
    request.server.realtime?.to(`campaign:${request.campaign.id}`).emit('group.changed', { groupId: group.domainId });
    return { ok: true };
  });

  app.delete('/api/v1/campaigns/:campaignId/groups/:groupId/characters/:characterId', { preHandler: [authenticate, requireCampaign, requireGm, requireCsrf] }, async (request, reply) => {
    const group = await prisma.group.findUnique({ where: { campaignId_domainId: { campaignId: request.campaign.id, domainId: request.params.groupId } } });
    if (!group) return reply.code(404).send(apiError('NOT_FOUND', 'Grupo não encontrado'));
    const key = { campaignId: request.campaign.id, npcDomainId: request.params.characterId, ownerType: 'group', ownerId: group.domainId };
    await prisma.$transaction(async tx => {
      await tx.npcAssociation.deleteMany({ where: key });
      await audit(tx, { campaignId: request.campaign.id, actorUserId: request.auth.user.id, action: 'group.character.remove', subjectType: 'group', subjectId: group.domainId, entityType: 'npc', entityDomainId: request.params.characterId, before: key });
    });
    request.server.realtime?.to(`campaign:${request.campaign.id}`).emit('group.changed', { groupId: group.domainId });
    return reply.code(204).send();
  });
}
