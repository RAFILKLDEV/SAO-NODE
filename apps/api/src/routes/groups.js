import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { audit } from '../lib/audit.js';
import { authenticate, requireCampaign, requireCsrf, requireGm } from '../lib/auth.js';
import { apiError } from '@sao/shared';
import { emitPermissionNotification } from '../lib/realtime.js';

const groupSchema = z.object({ domainId: z.string().min(2), name: z.string().min(1) });
const memberSchema = z.object({ userId: z.string().min(1) });

export async function groupRoutes(app) {
  app.get('/api/v1/campaigns/:campaignId/groups', { preHandler: [authenticate, requireCampaign] }, async (request) => {
    const groups = await prisma.group.findMany({
      where: { campaignId: request.campaign.id },
      include: { members: { include: { user: true } } },
      orderBy: { name: 'asc' }
    });
    return groups.map((group) => ({
      id: group.domainId,
      name: group.name,
      members: group.members.map((member) => ({ id: member.user.id, login: member.user.login, name: member.user.name }))
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
    return reply.code(201).send({ id: group.domainId, name: group.name });
  });

  app.post('/api/v1/campaigns/:campaignId/groups/:groupId/members', { preHandler: [authenticate, requireCampaign, requireGm, requireCsrf] }, async (request, reply) => {
    const parsed = memberSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(apiError('INVALID_INPUT', 'Invalid member', parsed.error.flatten()));
    const group = await prisma.group.findUnique({ where: { campaignId_domainId: { campaignId: request.campaign.id, domainId: request.params.groupId } } });
    if (!group) return reply.code(404).send(apiError('NOT_FOUND', 'Group not found'));
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
      emitPermissionNotification({
        realtime: request.server.realtime,
        campaignId: request.campaign.id,
        userIds: [parsed.data.userId],
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
}
