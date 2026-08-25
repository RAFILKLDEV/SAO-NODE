import { prisma } from '../lib/prisma.js';
import { audit } from '../lib/audit.js';
import { isGm } from '../lib/auth.js';
import { assertSafeRemoteUrl } from '../lib/security.js';
import {
  assertNamespacedId,
  calculateTravelMinutes,
  entitySchemas,
  evaluateGrant
} from '@sao/domain';

const monsterKinds = {
  movements: 'monster_movement',
  attacks: 'monster_attack',
  abilities: 'monster_ability',
  skills: 'monster_skill',
  traits: 'monster_trait'
};

const targetKindByComponent = {
  movement: 'monster_movement',
  attack: 'monster_attack',
  ability: 'monster_ability',
  skill: 'monster_skill',
  trait: 'monster_trait'
};

const sectionFields = {
  npc: {
    basic: [
      'title',
      'level',
      'imageURL',
      'imageUrl',
      'tokenUrl',
      'portraitUrl',
      'sourceUrl',
      'tags'
    ],
    identity: ['identity', 'race', 'gender', 'age', 'profession'],
    locations: ['mainLocationId', 'primaryLocationId', 'currentLocationId', 'locations'],
    relations: ['relations', 'factions'],
    services: ['services'],
    t20: ['t20']
  },
  location: {
    basic: [
      'type',
      'state',
      'parentId',
      'environment',
      'levelRecommended',
      'recommendedLevel',
      'imageURL',
      'imageUrl',
      'mapUrl',
      'tags'
    ],
    services: ['services']
  },
  item: {
    basic: ['category', 'rarity', 'imageURL', 'imageUrl', 'value', 'tags'],
    stats: ['stats']
  },
  monster: {
    basic: ['group', 'imageURL', 'imageUrl', 'tags'],
    t20: ['t20']
  },
  quest: {
    basic: ['subtitle', 'type', 'state', 'levelRecommended', 'recommendedLevel', 'tags'],
    requirements: ['requirementLogic', 'requirements', 'prerequisites'],
    flow: ['startSource', 'completionReceiver', 'nextQuests', 'timeLimitMinutes'],
    rewards: ['rewards']
  }
};

function normalizeFields(fields) {
  if (Array.isArray(fields)) return fields;
  if (!fields || typeof fields !== 'object') return [];
  return Object.entries(fields).map(([key, field]) => ({ key, ...field }));
}

function normalizeMonsterComponent(component, index) {
  if (component.data) return component;
  const { id = `entry-${index + 1}`, visibility = 'public', ...data } = component;
  return { id, visibility, data };
}

function normalizeRawInput(type, raw) {
  const input = { ...raw, fields: normalizeFields(raw.fields) };
  if (raw.discoveryVisibility && !raw.baseVisibility)
    input.baseVisibility = raw.discoveryVisibility;
  if (type === 'npc' && raw.identity) {
    input.race ??= raw.identity.race;
    input.gender ??= raw.identity.gender;
    input.age ??= raw.identity.age;
    input.profession ??= raw.identity.profession;
  }
  if (type === 'location') {
    input.connections = (raw.connections ?? []).map((connection, index) => ({
      ...connection,
      connectionId: connection.connectionId ?? `${raw.id}.connection.${index + 1}`,
      targetId: connection.targetId ?? connection.to
    }));
  }
  if (type === 'monster') {
    const t20 = raw.t20;
    if (t20) {
      input.sheet = {
        ...(raw.sheet ?? {}),
        nd: raw.sheet?.nd ?? t20.nd,
        type: raw.sheet?.type ?? t20.creatureType,
        subtype: raw.sheet?.subtype ?? t20.subtype,
        size: raw.sheet?.size ?? t20.size,
        combat: raw.sheet?.combat ?? {
          initiative: t20.initiative,
          perception: t20.perception,
          senses: t20.senses,
          defense: t20.defense,
          fortitude: t20.fortitude,
          reflex: t20.reflex,
          will: t20.will
        },
        resources: raw.sheet?.resources ?? {
          hp: t20.hp,
          hpMax: t20.hpMax,
          mp: t20.mp,
          mpMax: t20.mpMax
        },
        resistances: raw.sheet?.resistances ?? {},
        attributes: raw.sheet?.attributes ?? t20.attributes ?? {},
        statsVisibility: raw.sheet?.statsVisibility ?? t20.statVisibility ?? {}
      };
    }
    for (const key of ['movements', 'attacks', 'abilities', 'skills', 'traits']) {
      input[key] = (raw[key] ?? []).map(normalizeMonsterComponent);
    }
  }
  if (type === 'quest') {
    input.requirementLogic = raw.requirementLogic ?? raw.requirementsLogic ?? 'all';
    input.objectiveMode = raw.objectiveMode ?? raw.objectivesMode ?? 'free';
    input.objectives = (raw.objectives ?? []).map((objective) => ({
      ...objective,
      objectiveId: objective.objectiveId ?? objective.id,
      requiredQuantity: objective.requiredQuantity ?? objective.quantity ?? 1,
      target:
        objective.target ??
        (objective.targetType && objective.targetId
          ? { type: objective.targetType, id: objective.targetId }
          : undefined),
      dependsOn: objective.dependsOn ?? objective.dependsOnObjectiveIds ?? []
    }));
  }
  return input;
}

export function normalizeInput(type, raw) {
  const normalized = normalizeRawInput(type, raw);
  const parsed = entitySchemas[type].parse(normalized);
  assertNamespacedId(type, parsed.id);
  for (const key of Object.keys(parsed)) {
    if (key.toLowerCase().endsWith('url') && parsed[key])
      parsed[key] = assertSafeRemoteUrl(parsed[key]);
  }
  if (type === 'location') {
    parsed.connections = parsed.connections.map((connection) => ({
      ...connection,
      travelMinutes:
        connection.travelMinutes ??
        (connection.distanceKm != null ? calculateTravelMinutes(connection.distanceKm) : undefined)
    }));
  }
  parsed.baseVisibility = normalized.baseVisibility;
  return parsed;
}

function splitEntity(type, parsed) {
  const {
    fields = [],
    references = [],
    connections = [],
    movements = [],
    attacks = [],
    abilities = [],
    skills = [],
    traits = [],
    objectives = [],
    rewards = [],
    ...data
  } = parsed;
  delete data.baseVisibility;
  delete data.source;
  const monsterComponents = [];
  if (type === 'monster') {
    for (const [collection, targetKind] of Object.entries(monsterKinds)) {
      const kind = targetKind.replace('monster_', '');
      for (const component of { movements, attacks, abilities, skills, traits }[collection]) {
        monsterComponents.push({
          kind,
          componentId: component.id,
          visibility: component.visibility,
          data: component.data
        });
      }
    }
  }
  return { data, fields, references, connections, monsterComponents, objectives, rewards };
}

async function replaceSimpleChildren(tx, entityId, type, split) {
  await Promise.all([
    tx.narrativeField.deleteMany({ where: { entityId } }),
    tx.reference.deleteMany({ where: { sourceEntityId: entityId } }),
    tx.locationConnection.deleteMany({ where: { entityId } }),
    tx.monsterComponent.deleteMany({ where: { entityId } }),
    tx.questReward.deleteMany({ where: { entityId } })
  ]);

  if (split.fields.length) {
    await tx.narrativeField.createMany({
      data: split.fields.map((field) => ({
        entityId,
        key: field.key,
        value: field.value,
        visibility: field.visibility
      }))
    });
  }
  if (split.references.length) {
    await tx.reference.createMany({
      data: split.references.map((reference) => ({
        sourceEntityId: entityId,
        targetType: reference.type,
        targetDomainId: reference.id,
        role: reference.role,
        chance: reference.chance
      }))
    });
  }
  if (type === 'location' && split.connections.length) {
    await tx.locationConnection.createMany({
      data: split.connections.map((connection) => ({
        entityId,
        connectionId: connection.connectionId,
        targetDomainId: connection.targetId,
        direction: connection.direction,
        distanceKm: connection.distanceKm,
        travelMinutes: connection.travelMinutes,
        access: connection.access,
        unlockCondition: connection.unlockCondition,
        visibility: connection.visibility
      }))
    });
  }
  if (type === 'monster' && split.monsterComponents.length) {
    await tx.monsterComponent.createMany({
      data: split.monsterComponents.map((component) => ({ entityId, ...component }))
    });
  }
  if (type === 'quest' && split.rewards.length) {
    await tx.questReward.createMany({
      data: split.rewards.map((reward, index) => ({
        entityId,
        rewardId: reward.rewardId ?? `reward-${index + 1}`,
        type: reward.type,
        data: reward
      }))
    });
  }
}

async function reconcileQuestObjectives(tx, entityId, objectives) {
  const existing = await tx.questObjective.findMany({ where: { entityId } });
  const incomingIds = new Set(objectives.map((objective) => objective.objectiveId));
  for (const current of existing) {
    if (incomingIds.has(current.objectiveId)) continue;
    await tx.questObjectiveProgress.updateMany({
      where: { questObjectiveId: current.id },
      data: { orphaned: true, questObjectiveId: null }
    });
    await tx.questObjective.delete({ where: { id: current.id } });
  }

  for (const objective of objectives) {
    const saved = await tx.questObjective.upsert({
      where: { entityId_objectiveId: { entityId, objectiveId: objective.objectiveId } },
      create: {
        entityId,
        objectiveId: objective.objectiveId,
        type: objective.type,
        text: objective.text,
        sortOrder: objective.order,
        requiredQuantity: objective.requiredQuantity,
        optional: objective.optional,
        secret: objective.secret,
        visibility: objective.visibility,
        targetType: objective.target?.type,
        targetDomainId: objective.target?.id,
        dependsOn: objective.dependsOn,
        playerEditable: objective.playerEditable
      },
      update: {
        type: objective.type,
        text: objective.text,
        sortOrder: objective.order,
        requiredQuantity: objective.requiredQuantity,
        optional: objective.optional,
        secret: objective.secret,
        visibility: objective.visibility,
        targetType: objective.target?.type,
        targetDomainId: objective.target?.id,
        dependsOn: objective.dependsOn,
        playerEditable: objective.playerEditable
      }
    });
    await tx.questObjectiveProgress.updateMany({
      where: { progress: { questEntityId: entityId }, objectiveId: objective.objectiveId },
      data: { orphaned: false, questObjectiveId: saved.id }
    });
  }
}

export async function createEntity({ campaignId, type, input, actorUserId, source }) {
  const parsed = normalizeInput(type, input);
  const split = splitEntity(type, parsed);
  return prisma.$transaction(async (tx) => {
    const entity = await tx.entity.create({
      data: {
        campaignId,
        type,
        domainId: parsed.id,
        name: parsed.name,
        active: parsed.active,
        baseVisibility: parsed.baseVisibility ?? 'public',
        data: split.data,
        source: source ?? parsed.source ?? undefined,
        localModifiedAt: source ? null : new Date()
      }
    });
    await replaceSimpleChildren(tx, entity.id, type, split);
    if (type === 'quest') await reconcileQuestObjectives(tx, entity.id, split.objectives);
    await audit(tx, {
      campaignId,
      actorUserId,
      action: 'entity.create',
      entityType: type,
      entityDomainId: parsed.id,
      after: parsed
    });
    return entity;
  });
}

export async function updateEntity({
  campaignId,
  type,
  domainId,
  input,
  version,
  actorUserId,
  source
}) {
  const parsed = normalizeInput(type, { ...input, id: domainId });
  const split = splitEntity(type, parsed);
  return prisma.$transaction(async (tx) => {
    const current = await tx.entity.findUnique({
      where: { campaignId_type_domainId: { campaignId, type, domainId } },
      include: { fields: true, references: true }
    });
    if (!current) return null;
    const result = await tx.entity.updateMany({
      where: { id: current.id, version },
      data: {
        deletedAt: null,
        name: parsed.name,
        active: parsed.active,
        baseVisibility: parsed.baseVisibility ?? current.baseVisibility,
        data: split.data,
        source: source ?? parsed.source ?? current.source,
        localModifiedAt: source ? current.localModifiedAt : new Date(),
        version: { increment: 1 }
      }
    });
    if (result.count !== 1) {
      const error = new Error('Version conflict');
      error.code = 'VERSION_CONFLICT';
      throw error;
    }
    await replaceSimpleChildren(tx, current.id, type, split);
    if (type === 'quest') await reconcileQuestObjectives(tx, current.id, split.objectives);
    await audit(tx, {
      campaignId,
      actorUserId,
      action: 'entity.update',
      entityType: type,
      entityDomainId: domainId,
      before: current.data,
      after: parsed
    });
    return tx.entity.findUnique({ where: { id: current.id } });
  });
}

export async function deleteEntity({ campaignId, type, domainId, actorUserId }) {
  return prisma.$transaction(async (tx) => {
    const current = await tx.entity.findUnique({
      where: { campaignId_type_domainId: { campaignId, type, domainId } }
    });
    if (!current) return false;
    await audit(tx, {
      campaignId,
      actorUserId,
      action: 'entity.delete',
      entityType: type,
      entityDomainId: domainId,
      before: current.data
    });
    await tx.entity.update({
      where: { id: current.id },
      data: { deletedAt: new Date(), version: { increment: 1 } }
    });
    return true;
  });
}

async function getViewerContext(request) {
  if (isGm(request)) return { gm: true, groups: [] };
  const groups = await prisma.groupMember.findMany({
    where: { userId: request.auth.user.id, group: { campaignId: request.campaign.id } },
    select: { group: { select: { domainId: true } } }
  });
  return { gm: false, groups: groups.map((membership) => membership.group.domainId) };
}

function accessFor({ baseVisibility, request, context, grants, targetKind, targetKey }) {
  const relevant = grants.filter(
    (grant) => grant.targetKind === targetKind && grant.targetKey === targetKey
  );
  return evaluateGrant({
    baseVisibility,
    isGm: context.gm,
    userId: request.auth.user.id,
    groups: context.groups,
    grants: relevant
  });
}

function sectionAccess({ entity, section, request, context, grants, fallback = 'public' }) {
  return accessFor({
    baseVisibility: entity.data?.sectionVisibility?.[section] ?? fallback,
    request,
    context,
    grants,
    targetKind: 'field',
    targetKey: `section.${section}`
  });
}

function filterEntityData({ entity, request, context, grants }) {
  if (context.gm) return entity.data;
  const definitions = sectionFields[entity.type] ?? {};
  const claimed = new Set(['sectionVisibility', 'sheet']);
  const output = {};
  for (const [section, keys] of Object.entries(definitions)) {
    keys.forEach((key) => claimed.add(key));
    if (!sectionAccess({ entity, section, request, context, grants }).allowed) continue;
    for (const key of keys) {
      if (entity.data[key] !== undefined) output[key] = entity.data[key];
    }
  }
  if (sectionAccess({ entity, section: 'additional', request, context, grants }).allowed) {
    for (const [key, value] of Object.entries(entity.data)) {
      if (!claimed.has(key)) output[key] = value;
    }
  }
  return output;
}

function filterMonsterSheet({ sheet = {}, request, context, grants }) {
  if (context.gm) return sheet;
  const visibilityMap = sheet.statsVisibility ?? {};
  const allowed = (path, fallback = 'public') =>
    accessFor({
      baseVisibility: visibilityMap[path] ?? fallback,
      request,
      context,
      grants,
      targetKind: 'monster_stat',
      targetKey: path
    }).allowed;

  const output = {};
  const basicAllowed = allowed('basic', visibilityMap.basic ?? 'public');
  for (const key of ['nd', 'type', 'subtype', 'size']) {
    if (sheet[key] != null && basicAllowed && allowed(key, visibilityMap.basic ?? 'public'))
      output[key] = sheet[key];
  }
  for (const moduleName of ['combat', 'resources', 'resistances', 'attributes']) {
    const moduleValue = sheet[moduleName] ?? {};
    if (!allowed(moduleName)) continue;
    const filtered = {};
    for (const [key, value] of Object.entries(moduleValue)) {
      if (allowed(`${moduleName}.${key}`, visibilityMap[moduleName] ?? 'public'))
        filtered[key] = value;
    }
    if (Object.keys(filtered).length) output[moduleName] = filtered;
  }
  return output;
}

async function describeTargetForRequest({ type, id, role, chance }, request, context) {
  const target = await prisma.entity.findUnique({
    where: {
      campaignId_type_domainId: {
        campaignId: request.campaign.id,
        type,
        domainId: id
      }
    }
  });
  if (!target || target.deletedAt) {
    return { type, id, role, chance, available: false, ...(context.gm ? { broken: true } : {}) };
  }
  const available = await serializeEntityGateOnly(target, request);
  return {
    type,
    id,
    role,
    chance,
    available,
    ...(available || context.gm ? { name: target.name } : {})
  };
}

async function resolveEmbeddedReferences(result, request, context) {
  for (const key of ['locations', 'relations']) {
    if (!Array.isArray(result[key])) continue;
    result[key] = await Promise.all(
      result[key].map((reference) => describeTargetForRequest(reference, request, context))
    );
  }
  for (const key of ['startSource', 'completionReceiver']) {
    if (result[key]?.type && result[key]?.id)
      result[key] = await describeTargetForRequest(result[key], request, context);
  }
  if (result.parentId)
    result.parent = await describeTargetForRequest(
      { type: 'location', id: result.parentId, role: 'parent' },
      request,
      context
    );
  if (Array.isArray(result.nextQuests)) {
    result.nextQuestReferences = await Promise.all(
      result.nextQuests.map((id) =>
        describeTargetForRequest({ type: 'quest', id, role: 'next' }, request, context)
      )
    );
  }
  if (result.mainLocationId || result.primaryLocationId || result.currentLocationId) {
    const existing = new Set((result.locations ?? []).map((reference) => reference.id));
    for (const [id, role] of [
      [result.mainLocationId ?? result.primaryLocationId, 'main'],
      [result.currentLocationId, 'current']
    ]) {
      if (!id || existing.has(id)) continue;
      result.locations ??= [];
      result.locations.push(
        await describeTargetForRequest({ type: 'location', id, role }, request, context)
      );
      existing.add(id);
    }
  }
  if (Array.isArray(result.requirements)) {
    result.requirements = await Promise.all(
      result.requirements.map(async (requirement) => {
        if (
          !requirement.id ||
          !['npc', 'location', 'item', 'monster', 'quest'].includes(requirement.type)
        )
          return requirement;
        return {
          ...requirement,
          target: await describeTargetForRequest(
            { type: requirement.type, id: requirement.id, role: 'requirement' },
            request,
            context
          )
        };
      })
    );
  }
}

export async function serializeEntityForRequest(entity, request) {
  const context = await getViewerContext(request);
  const grants = context.gm
    ? []
    : await prisma.grant.findMany({
        where: {
          campaignId: request.campaign.id,
          entityType: entity.type,
          entityDomainId: entity.domainId,
          OR: [
            { subjectType: 'user', subjectId: request.auth.user.id },
            ...(context.groups.length
              ? [{ subjectType: 'group', subjectId: { in: context.groups } }]
              : [])
          ]
        }
      });

  const gate = accessFor({
    baseVisibility: entity.baseVisibility,
    request,
    context,
    grants,
    targetKind: 'entity',
    targetKey: 'existence'
  });
  if (!gate.allowed) return null;

  const fields = entity.fields
    .filter(
      (field) =>
        accessFor({
          baseVisibility: field.visibility,
          request,
          context,
          grants,
          targetKind: 'field',
          targetKey: field.key
        }).allowed
    )
    .map(({ key, value, visibility }) => ({ key, value, ...(context.gm ? { visibility } : {}) }));

  const references = [];
  if (sectionAccess({ entity, section: 'references', request, context, grants }).allowed) {
    for (const reference of entity.references) {
      references.push(
        await describeTargetForRequest(
          {
            type: reference.targetType,
            id: reference.targetDomainId,
            role: reference.role,
            chance: reference.chance
          },
          request,
          context
        )
      );
    }
  }

  const visibleData = filterEntityData({ entity, request, context, grants });
  const result = {
    entityType: entity.type,
    id: entity.domainId,
    name: entity.name,
    active: entity.active,
    version: entity.version,
    ...visibleData,
    fields,
    references
  };
  await resolveEmbeddedReferences(result, request, context);

  if (entity.type === 'location') {
    result.connections = entity.locationConnections
      .filter(
        (connection) =>
          accessFor({
            baseVisibility: connection.visibility,
            request,
            context,
            grants,
            targetKind: 'location_connection',
            targetKey: connection.connectionId
          }).allowed
      )
      .map(async (connection) => ({
        connectionId: connection.connectionId,
        targetId: connection.targetDomainId,
        direction: connection.direction,
        distanceKm: connection.distanceKm,
        travelMinutes: connection.travelMinutes,
        access: connection.access,
        unlockCondition: context.gm ? connection.unlockCondition : undefined,
        ...(context.gm ? { visibility: connection.visibility } : {}),
        target: await describeTargetForRequest(
          { type: 'location', id: connection.targetDomainId, role: 'connection' },
          request,
          context
        )
      }));
    result.connections = await Promise.all(result.connections);
  }

  if (entity.type === 'monster') {
    result.sheet = filterMonsterSheet({ sheet: entity.data.sheet ?? {}, request, context, grants });
    for (const kind of ['movement', 'attack', 'ability', 'skill', 'trait']) {
      const outputKey = `${kind}s`;
      result[outputKey] = entity.monsterComponents
        .filter((component) => component.kind === kind)
        .filter(
          (component) =>
            accessFor({
              baseVisibility: component.visibility,
              request,
              context,
              grants,
              targetKind: targetKindByComponent[kind],
              targetKey: component.componentId
            }).allowed
        )
        .map((component) => ({
          id: component.componentId,
          data: component.data,
          ...(context.gm ? { visibility: component.visibility } : {})
        }));
    }
  }

  if (entity.type === 'quest') {
    result.objectives = entity.questObjectives
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .filter((objective) => {
        const grant = accessFor({
          baseVisibility: objective.visibility,
          request,
          context,
          grants,
          targetKind: 'objective',
          targetKey: objective.objectiveId
        });
        if (!objective.secret) return grant.allowed;
        if (context.gm) return true;
        return grant.allowed && grant.source !== 'public';
      })
      .map(async (objective) => ({
        objectiveId: objective.objectiveId,
        type: objective.type,
        text: objective.text,
        order: objective.sortOrder,
        requiredQuantity: objective.requiredQuantity,
        optional: objective.optional,
        ...(context.gm
          ? {
              secret: objective.secret,
              visibility: objective.visibility,
              playerEditable: objective.playerEditable
            }
          : {}),
        ...(objective.targetType
          ? {
              target: await describeTargetForRequest(
                { type: objective.targetType, id: objective.targetDomainId, role: 'objective' },
                request,
                context
              )
            }
          : {}),
        dependsOn: context.gm ? objective.dependsOn : undefined
      }));
    result.objectives = await Promise.all(result.objectives);
    const rewardsAllowed = sectionAccess({
      entity,
      section: 'rewards',
      request,
      context,
      grants
    }).allowed;
    if (rewardsAllowed) {
      result.rewards = await Promise.all(
        entity.questRewards.map(async (reward) => {
          const data = reward.data;
          if (data?.target?.type && data?.target?.id)
            return {
              ...data,
              target: await describeTargetForRequest(data.target, request, context)
            };
          if (data?.id && ['item', 'skill'].includes(data.type))
            return {
              ...data,
              target: await describeTargetForRequest(
                { type: data.type, id: data.id, role: 'reward' },
                request,
                context
              )
            };
          return data;
        })
      );
    }
  }

  if (context.gm) {
    result._technical = {
      entityPk: entity.id,
      baseVisibility: entity.baseVisibility,
      source: entity.source
    };
  }
  return result;
}

async function serializeEntityGateOnly(entity, request) {
  if (isGm(request)) return true;
  const groups = await prisma.groupMember.findMany({
    where: { userId: request.auth.user.id, group: { campaignId: request.campaign.id } },
    select: { group: { select: { domainId: true } } }
  });
  const groupIds = groups.map((membership) => membership.group.domainId);
  const grants = await prisma.grant.findMany({
    where: {
      campaignId: request.campaign.id,
      entityType: entity.type,
      entityDomainId: entity.domainId,
      targetKind: 'entity',
      targetKey: 'existence',
      OR: [
        { subjectType: 'user', subjectId: request.auth.user.id },
        ...(groupIds.length ? [{ subjectType: 'group', subjectId: { in: groupIds } }] : [])
      ]
    }
  });
  return evaluateGrant({
    baseVisibility: entity.baseVisibility,
    isGm: false,
    userId: request.auth.user.id,
    groups: groupIds,
    grants
  }).allowed;
}

const includeAll = {
  fields: true,
  references: true,
  locationConnections: true,
  monsterComponents: true,
  questObjectives: true,
  questRewards: true
};

export async function listEntitiesForRequest({
  request,
  type,
  page = 1,
  pageSize = 50,
  search = '',
  sort = 'name'
}) {
  const where = {
    campaignId: request.campaign.id,
    type,
    deletedAt: null,
    ...(search ? { name: { contains: search, mode: 'insensitive' } } : {})
  };
  const rows = await prisma.entity.findMany({
    where,
    include: includeAll,
    orderBy: sort === 'updatedAt' ? { updatedAt: 'desc' } : { name: 'asc' },
    skip: (page - 1) * pageSize,
    take: pageSize
  });
  const items = (
    await Promise.all(rows.map((entity) => serializeEntityForRequest(entity, request)))
  ).filter(Boolean);
  return { items, page, pageSize, returned: items.length };
}

export async function getEntityForRequest({ request, type, domainId }) {
  const entity = await prisma.entity.findUnique({
    where: { campaignId_type_domainId: { campaignId: request.campaign.id, type, domainId } },
    include: includeAll
  });
  if (!entity || entity.deletedAt) return null;
  return serializeEntityForRequest(entity, request);
}

export async function searchForRequest({ request, query, limit = 30 }) {
  const rows = await prisma.entity.findMany({
    where: {
      campaignId: request.campaign.id,
      deletedAt: null,
      name: { contains: query, mode: 'insensitive' }
    },
    include: includeAll,
    orderBy: { name: 'asc' },
    take: Math.min(limit * 3, 100)
  });
  const visible = (
    await Promise.all(rows.map((row) => serializeEntityForRequest(row, request)))
  ).filter(Boolean);
  return visible
    .slice(0, limit)
    .map((row) => ({ type: row.entityType, id: row.id, name: row.name }));
}

export async function upsertImportedEntityTx({ tx, campaignId, type, input, actorUserId, source }) {
  const parsed = normalizeInput(type, input);
  const split = splitEntity(type, parsed);
  const current = await tx.entity.findUnique({
    where: { campaignId_type_domainId: { campaignId, type, domainId: parsed.id } }
  });
  let entity;
  if (current) {
    entity = await tx.entity.update({
      where: { id: current.id },
      data: {
        deletedAt: null,
        name: parsed.name,
        active: parsed.active,
        data: split.data,
        source,
        version: { increment: 1 }
      }
    });
  } else {
    entity = await tx.entity.create({
      data: {
        campaignId,
        type,
        domainId: parsed.id,
        name: parsed.name,
        active: parsed.active,
        baseVisibility: 'public',
        data: split.data,
        source
      }
    });
  }
  await replaceSimpleChildren(tx, entity.id, type, split);
  if (type === 'quest') await reconcileQuestObjectives(tx, entity.id, split.objectives);
  await audit(tx, {
    campaignId,
    actorUserId,
    action: current ? 'entity.import.update' : 'entity.import.create',
    entityType: type,
    entityDomainId: parsed.id,
    before: current?.data,
    after: parsed
  });
  return entity;
}

export async function softRemoveImportedEntityTx({
  tx,
  campaignId,
  type,
  domainId,
  actorUserId,
  source
}) {
  const current = await tx.entity.findUnique({
    where: { campaignId_type_domainId: { campaignId, type, domainId } }
  });
  if (!current) return null;
  const entity = await tx.entity.update({
    where: { id: current.id },
    data: { deletedAt: new Date(), source, version: { increment: 1 } }
  });
  await audit(tx, {
    campaignId,
    actorUserId,
    action: 'entity.import.remove',
    entityType: type,
    entityDomainId: domainId,
    before: current.data,
    after: { removedFromXml: true }
  });
  return entity;
}

export function entityRecordToAuthoritative(entity) {
  const result = {
    ...entity.data,
    id: entity.domainId,
    name: entity.name,
    active: entity.active,
    fields: (entity.fields ?? []).map((field) => ({
      key: field.key,
      value: field.value,
      visibility: field.visibility
    })),
    references: (entity.references ?? []).map((reference) => ({
      type: reference.targetType,
      id: reference.targetDomainId,
      role: reference.role,
      ...(reference.chance != null ? { chance: reference.chance } : {})
    }))
  };
  if (entity.type === 'location') {
    result.connections = (entity.locationConnections ?? []).map((connection) => ({
      connectionId: connection.connectionId,
      targetId: connection.targetDomainId,
      direction: connection.direction ?? undefined,
      distanceKm: connection.distanceKm ?? undefined,
      travelMinutes: connection.travelMinutes ?? undefined,
      access: connection.access,
      unlockCondition: connection.unlockCondition ?? undefined,
      visibility: connection.visibility
    }));
  }
  if (entity.type === 'monster') {
    result.sheet = entity.data.sheet ?? {};
    for (const kind of ['movement', 'attack', 'ability', 'skill', 'trait']) {
      result[`${kind}s`] = (entity.monsterComponents ?? [])
        .filter((component) => component.kind === kind)
        .map((component) => ({
          id: component.componentId,
          visibility: component.visibility,
          data: component.data
        }));
    }
  }
  if (entity.type === 'quest') {
    result.objectives = (entity.questObjectives ?? []).map((objective) => ({
      objectiveId: objective.objectiveId,
      type: objective.type,
      text: objective.text,
      order: objective.sortOrder,
      requiredQuantity: objective.requiredQuantity,
      optional: objective.optional,
      secret: objective.secret,
      visibility: objective.visibility,
      ...(objective.targetType
        ? { target: { type: objective.targetType, id: objective.targetDomainId } }
        : {}),
      dependsOn: objective.dependsOn,
      playerEditable: objective.playerEditable
    }));
    result.rewards = (entity.questRewards ?? []).map((reward) => reward.data);
  }
  return result;
}
