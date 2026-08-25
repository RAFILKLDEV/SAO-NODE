import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { audit } from '../lib/audit.js';
import { authenticate, requireCampaign, requireCsrf, requireGm } from '../lib/auth.js';
import { ALLOWANCES, TARGET_KINDS, apiError } from '@sao/shared';
import { evaluateGrant, summarizeGroupVisibility } from '@sao/domain';

const grantSchema = z.object({
  subjectType: z.enum(['user', 'group']),
  subjectId: z.string().min(1),
  entityType: z.string().min(1),
  entityId: z.string().min(1),
  targetKind: z.enum(TARGET_KINDS),
  targetKey: z.string().min(1),
  allowance: z.enum(ALLOWANCES)
});

const batchSchema = z.object({ grants: z.array(grantSchema).min(1).max(500) });

const componentKind = {
  monster_movement: 'movement',
  monster_attack: 'attack',
  monster_ability: 'ability',
  monster_skill: 'skill',
  monster_trait: 'trait'
};

async function baseVisibilityForGrant(grant) {
  const entity = await prisma.entity.findUnique({
    where: {
      campaignId_type_domainId: {
        campaignId: grant.campaignId,
        type: grant.entityType,
        domainId: grant.entityDomainId
      }
    },
    include: {
      fields: true,
      questObjectives: true,
      locationConnections: true,
      monsterComponents: true
    }
  });
  if (!entity || entity.deletedAt) return 'gm';
  if (grant.targetKind === 'entity') return entity.baseVisibility;
  if (grant.targetKind === 'field') {
    if (grant.targetKey.startsWith('section.'))
      return entity.data?.sectionVisibility?.[grant.targetKey.slice('section.'.length)] ?? 'public';
    return entity.fields.find((field) => field.key === grant.targetKey)?.visibility ?? 'gm';
  }
  if (grant.targetKind === 'objective')
    return (
      entity.questObjectives.find((objective) => objective.objectiveId === grant.targetKey)
        ?.visibility ?? 'gm'
    );
  if (grant.targetKind === 'location_connection')
    return (
      entity.locationConnections.find((connection) => connection.connectionId === grant.targetKey)
        ?.visibility ?? 'gm'
    );
  if (componentKind[grant.targetKind]) {
    return (
      entity.monsterComponents.find(
        (component) =>
          component.kind === componentKind[grant.targetKind] &&
          component.componentId === grant.targetKey
      )?.visibility ?? 'gm'
    );
  }
  if (grant.targetKind === 'monster_stat') {
    return entity.data?.sheet?.statsVisibility?.[grant.targetKey] ?? 'public';
  }
  return 'gm';
}

async function groupEffectiveState(grant) {
  if (grant.subjectType !== 'group') return undefined;
  const group = await prisma.group.findUnique({
    where: { campaignId_domainId: { campaignId: grant.campaignId, domainId: grant.subjectId } },
    include: { members: true }
  });
  if (!group || group.members.length === 0) return 'empty';
  const baseVisibility = await baseVisibilityForGrant(grant);
  const states = [];
  for (const member of group.members) {
    const memberships = await prisma.groupMember.findMany({
      where: { userId: member.userId, group: { campaignId: grant.campaignId } },
      select: { group: { select: { domainId: true } } }
    });
    const groupIds = memberships.map((item) => item.group.domainId);
    const grants = await prisma.grant.findMany({
      where: {
        campaignId: grant.campaignId,
        entityType: grant.entityType,
        entityDomainId: grant.entityDomainId,
        targetKind: grant.targetKind,
        targetKey: grant.targetKey,
        OR: [
          { subjectType: 'user', subjectId: member.userId },
          ...(groupIds.length ? [{ subjectType: 'group', subjectId: { in: groupIds } }] : [])
        ]
      }
    });
    states.push(
      evaluateGrant({
        baseVisibility,
        isGm: false,
        userId: member.userId,
        groups: groupIds,
        grants
      }).allowed
    );
  }
  return summarizeGroupVisibility(states);
}

async function upsertGrant(tx, campaignId, actorUserId, input) {
  const key = {
    campaignId_subjectType_subjectId_entityType_entityDomainId_targetKind_targetKey: {
      campaignId,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      entityType: input.entityType,
      entityDomainId: input.entityId,
      targetKind: input.targetKind,
      targetKey: input.targetKey
    }
  };
  const before = await tx.grant.findUnique({ where: key });
  const grant = await tx.grant.upsert({
    where: key,
    create: {
      campaignId,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      entityType: input.entityType,
      entityDomainId: input.entityId,
      targetKind: input.targetKind,
      targetKey: input.targetKey,
      allowance: input.allowance,
      actorUserId
    },
    update: { allowance: input.allowance, actorUserId }
  });
  await audit(tx, {
    campaignId,
    actorUserId,
    action: 'grant.upsert',
    entityType: input.entityType,
    entityDomainId: input.entityId,
    targetKind: input.targetKind,
    targetKey: input.targetKey,
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    before,
    after: grant
  });
  return grant;
}

async function validateEntities(campaignId, grants) {
  const keys = [...new Set(grants.map((input) => `${input.entityType}:${input.entityId}`))];
  for (const key of keys) {
    const [type, ...idParts] = key.split(':');
    const domainId = idParts.join(':');
    const entity = await prisma.entity.findUnique({
      where: { campaignId_type_domainId: { campaignId, type, domainId } }
    });
    if (!entity || entity.deletedAt) return key;
  }
  return null;
}

export async function grantRoutes(app) {
  app.get(
    '/api/v1/campaigns/:campaignId/discoveries',
    { preHandler: [authenticate, requireCampaign, requireGm] },
    async (request) => {
      const rows = await prisma.grant.findMany({
        where: { campaignId: request.campaign.id },
        orderBy: { updatedAt: 'desc' }
      });
      return Promise.all(
        rows.map(async (row) => ({
          ...row,
          ...(row.subjectType === 'group' ? { effectiveState: await groupEffectiveState(row) } : {})
        }))
      );
    }
  );

  app.put(
    '/api/v1/campaigns/:campaignId/discoveries',
    { preHandler: [authenticate, requireCampaign, requireGm, requireCsrf] },
    async (request, reply) => {
      const parsed = grantSchema.safeParse(request.body);
      if (!parsed.success)
        return reply
          .code(400)
          .send(apiError('INVALID_INPUT', 'Invalid grant', parsed.error.flatten()));
      const missing = await validateEntities(request.campaign.id, [parsed.data]);
      if (missing)
        return reply.code(404).send(apiError('NOT_FOUND', `Entity not found: ${missing}`));
      const saved = await prisma.$transaction((tx) =>
        upsertGrant(tx, request.campaign.id, request.auth.user.id, parsed.data)
      );
      request.server.realtime
        ?.to(`campaign:${request.campaign.id}`)
        .emit('permissions.changed', {
          entityType: parsed.data.entityType,
          entityId: parsed.data.entityId
        });
      return saved;
    }
  );

  app.post(
    '/api/v1/campaigns/:campaignId/discoveries/batch',
    { preHandler: [authenticate, requireCampaign, requireGm, requireCsrf] },
    async (request, reply) => {
      const parsed = batchSchema.safeParse(request.body);
      if (!parsed.success)
        return reply
          .code(400)
          .send(apiError('INVALID_INPUT', 'Invalid grants batch', parsed.error.flatten()));
      const missing = await validateEntities(request.campaign.id, parsed.data.grants);
      if (missing)
        return reply.code(404).send(apiError('NOT_FOUND', `Entity not found: ${missing}`));
      const saved = await prisma.$transaction(async (tx) => {
        const results = [];
        for (const input of parsed.data.grants) {
          results.push(await upsertGrant(tx, request.campaign.id, request.auth.user.id, input));
        }
        return results;
      });
      request.server.realtime
        ?.to(`campaign:${request.campaign.id}`)
        .emit('permissions.changed', { reason: 'batch', count: saved.length });
      return { count: saved.length };
    }
  );

  app.delete(
    '/api/v1/campaigns/:campaignId/discoveries',
    { preHandler: [authenticate, requireCampaign, requireGm, requireCsrf] },
    async (request, reply) => {
      const parsed = grantSchema.omit({ allowance: true }).safeParse(request.body);
      if (!parsed.success)
        return reply
          .code(400)
          .send(apiError('INVALID_INPUT', 'Invalid grant key', parsed.error.flatten()));
      const input = parsed.data;
      const where = {
        campaignId_subjectType_subjectId_entityType_entityDomainId_targetKind_targetKey: {
          campaignId: request.campaign.id,
          subjectType: input.subjectType,
          subjectId: input.subjectId,
          entityType: input.entityType,
          entityDomainId: input.entityId,
          targetKind: input.targetKind,
          targetKey: input.targetKey
        }
      };
      await prisma.$transaction(async (tx) => {
        const before = await tx.grant.findUnique({ where });
        if (before) await tx.grant.delete({ where });
        await audit(tx, {
          campaignId: request.campaign.id,
          actorUserId: request.auth.user.id,
          action: 'grant.delete',
          entityType: input.entityType,
          entityDomainId: input.entityId,
          targetKind: input.targetKind,
          targetKey: input.targetKey,
          subjectType: input.subjectType,
          subjectId: input.subjectId,
          before
        });
      });
      request.server.realtime
        ?.to(`campaign:${request.campaign.id}`)
        .emit('permissions.changed', { entityType: input.entityType, entityId: input.entityId });
      return reply.code(204).send();
    }
  );
}
