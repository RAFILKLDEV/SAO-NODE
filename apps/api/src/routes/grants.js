import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { audit } from '../lib/audit.js';
import { authenticate, requireCampaign, requireCsrf, requireGm } from '../lib/auth.js';
import { ALLOWANCES, TARGET_KINDS, apiError } from '@sao/shared';
import { evaluateGrant, summarizeGroupVisibility } from '@sao/domain';
import {
  emitPermissionNotification,
  resolveGrantRecipientUserIds
} from '../lib/realtime.js';

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
      return (entity.data?.visibility?.sections ?? entity.data?.sectionVisibility)?.[grant.targetKey.slice('section.'.length)] ?? 'public';
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
    return (entity.data?.statBlocks?.['Ambesek.T20']?.statsVisibility ?? entity.data?.sheet?.statsVisibility)?.[grant.targetKey] ?? 'public';
  }
  return 'gm';
}

function grantTargets(entity) {
  const targets = new Map();
  const add = (kind, key, visibility) =>
    targets.set(`${kind}:${key}`, { kind, key, visibility: visibility ?? 'public' });

  add('entity', 'existence', entity.baseVisibility);
  for (const field of entity.fields) add('field', field.key, field.visibility);
  for (const [section, visibility] of Object.entries((entity.data?.visibility?.sections ?? entity.data?.sectionVisibility) ?? {}))
    add('field', `section.${section}`, visibility);
  for (const objective of entity.questObjectives) {
    add('objective', objective.objectiveId, objective.visibility);
    targets.get(`objective:${objective.objectiveId}`).secret = objective.secret;
  }
  for (const connection of entity.locationConnections)
    add('location_connection', connection.connectionId, connection.visibility);
  for (const component of entity.monsterComponents)
    add(`monster_${component.kind}`, component.componentId, component.visibility);

  if (entity.type === 'monster') {
    const visibility = (entity.data?.statBlocks?.['Ambesek.T20']?.statsVisibility ?? entity.data?.sheet?.statsVisibility) ?? {};
    for (const key of [
      'basic',
      'nd',
      'type',
      'subtype',
      'size',
      'combat',
      'resources',
      'resistances',
      'attributes',
      ...Object.keys(visibility)
    ])
      add('monster_stat', key, visibility[key]);
  }
  return [...targets.values()];
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

function changedEntities(grants) {
  return [
    ...new Map(
      grants.map((grant) => [
        `${grant.entityType}:${grant.entityDomainId}`,
        { entityType: grant.entityType, entityId: grant.entityDomainId }
      ])
    ).values()
  ];
}

async function notifyGrantRecipients(request, grants, extra = {}) {
  const allowedGrants = grants.filter((grant) => grant.allowance === 'allow');
  if (!allowedGrants.length) return;
  const userIds = await resolveGrantRecipientUserIds({
    db: prisma,
    campaignId: request.campaign.id,
    grants: allowedGrants
  });
  emitPermissionNotification({
    realtime: request.server.realtime,
    campaignId: request.campaign.id,
    userIds,
    payload: { ...extra, entities: changedEntities(allowedGrants) }
  });
}

export async function grantRoutes(app) {
  app.get(
    '/api/v1/campaigns/:campaignId/discoveries/:entityType/:entityId/viewers',
    { preHandler: [authenticate, requireCampaign, requireGm] },
    async (request, reply) => {
      const entity = await prisma.entity.findUnique({
        where: {
          campaignId_type_domainId: {
            campaignId: request.campaign.id,
            type: request.params.entityType,
            domainId: request.params.entityId
          }
        },
        include: {
          fields: true,
          questObjectives: true,
          locationConnections: true,
          monsterComponents: true
        }
      });
      if (!entity || entity.deletedAt)
        return reply.code(404).send(apiError('NOT_FOUND', 'Entity not found'));

      const [memberships, groupMemberships, grants] = await Promise.all([
        prisma.membership.findMany({
          where: { campaignId: request.campaign.id },
          include: { user: true },
          orderBy: { user: { name: 'asc' } }
        }),
        prisma.groupMember.findMany({
          where: { group: { campaignId: request.campaign.id } },
          select: { userId: true, group: { select: { domainId: true } } }
        }),
        prisma.grant.findMany({
          where: {
            campaignId: request.campaign.id,
            entityType: entity.type,
            entityDomainId: entity.domainId
          }
        })
      ]);
      const groupsByUser = new Map();
      for (const member of groupMemberships) {
        const groups = groupsByUser.get(member.userId) ?? [];
        groups.push(member.group.domainId);
        groupsByUser.set(member.userId, groups);
      }
      const users = memberships.map((membership) => ({
        id: membership.user.id,
        name: membership.user.name,
        login: membership.user.login,
        characterImageUrl: membership.characterImageUrl,
        role: membership.role
      }));
      const viewers = {};
      for (const target of grantTargets(entity)) {
        viewers[`${target.kind}:${target.key}`] = memberships
          .filter((membership) => {
            const isGm = ['owner', 'gm', 'assistant_gm'].includes(membership.role);
            if (isGm) return false;
            const common = {
              isGm,
              userId: membership.userId,
              groups: groupsByUser.get(membership.userId) ?? [],
              grants
            };
            const entityAccess = evaluateGrant({
              ...common,
              baseVisibility: entity.baseVisibility,
              grants: grants.filter(
                (grant) => grant.targetKind === 'entity' && grant.targetKey === 'existence'
              )
            });
            if (!entityAccess.allowed) return false;
            const targetAccess = evaluateGrant({
              ...common,
              baseVisibility: target.visibility,
              grants: grants.filter(
                (grant) => grant.targetKind === target.kind && grant.targetKey === target.key
              )
            });
            return (
              targetAccess.allowed && (!target.secret || isGm || targetAccess.source !== 'public')
            );
          })
          .map((membership) => membership.userId);
      }
      return { users, viewers };
    }
  );

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
      request.server.realtime?.to(`campaign:${request.campaign.id}`).emit('permissions.changed', {
        entityType: parsed.data.entityType,
        entityId: parsed.data.entityId
      });
      await notifyGrantRecipients(request, [saved]);
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
      const entities = saved.map((grant) => ({
        entityType: grant.entityType,
        entityId: grant.entityDomainId
      }));
      request.server.realtime
        ?.to(`campaign:${request.campaign.id}`)
        .emit('permissions.changed', { reason: 'batch', count: saved.length, entities });
      await notifyGrantRecipients(request, saved, { reason: 'batch' });
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
