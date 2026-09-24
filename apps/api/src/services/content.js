import { sectionFields } from '@sao/domain';
import { prisma } from '../lib/prisma.js';
import { audit } from '../lib/audit.js';
import { isGm } from '../lib/auth.js';
import { assertSafeRemoteUrl } from '../lib/security.js';
import {
  collectEntityLinks,
  evaluateGrant,
  isV2Entity,
  normalizeEntity,
  validateEntityCatalog,
  migrateV1Entity,
  COMPONENT_COLLECTIONS,
  toLegacyEntity
} from '@sao/domain';

const targetKindByComponent = {
  movement: 'monster_movement',
  attack: 'monster_attack',
  ability: 'monster_ability',
  skill: 'monster_skill',
  trait: 'monster_trait'
};

export const monsterOutputKeys = {
  movement: 'movements',
  attack: 'attacks',
  ability: 'abilities',
  skill: 'skills',
  trait: 'traits'
};

export function normalizeInput(type, raw) {
  const canonical = normalizeEntity(type, raw, {
    format: isV2Entity(raw) ? '2.0' : '1.0',
    conflicts: 'error'
  });
  const parsed = toLegacyEntity(type, canonical);
  parsed.baseVisibility = canonical.visibility?.entity ?? raw.baseVisibility;
  parsed.source = raw.source;
  for (const key of Object.keys(parsed)) {
    if (key.toLowerCase().endsWith('url') && parsed[key]) parsed[key] = assertSafeRemoteUrl(parsed[key]);
  }
  Object.defineProperty(parsed, '_canonical', { value: canonical, enumerable: false });
  return parsed;
}

export function splitEntity(type, parsed) {
  const canonical = parsed._canonical ?? normalizeEntity(type, parsed);
  const data = { ...canonical };
  delete data.fields;
  delete data.links;
  delete data.connections;
  delete data.components;
  delete data.objectives;
  delete data.rewards;
  delete data.baseVisibility;
  delete data.source;
  delete data.id;
  delete data.name;
  delete data.active;
  data.visibility = { sections: canonical.visibility.sections };
  const monsterComponents = [];
  if (type === 'monster') {
    for (const component of canonical.components ?? []) {
      {
        monsterComponents.push({
          kind: component.kind,
          componentId: component.id,
          visibility: component.visibility,
          data: component.data
        });
      }
    }
  }
  return {
    data,
    fields: canonical.fields,
    references: canonical.links,
    connections: canonical.connections ?? [],
    monsterComponents,
    objectives: canonical.objectives ?? [],
    rewards: canonical.rewards ?? []
  };
}

export async function replaceSimpleChildren(tx, entityId, type, split) {
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
        slot: reference.slot ?? 'references',
        chance: reference.chance,
        quantityMin: reference.quantityMin,
        quantityMax: reference.quantityMax
      }))
    });
  }
  if (type === 'location' && split.connections.length) {
    await tx.locationConnection.createMany({
      data: split.connections.map((connection) => ({
        entityId,
        connectionId: connection.id,
        targetDomainId: connection.target.id,
        direction: connection.direction,
        distanceKm: connection.distanceKm,
        travelMinutes: connection.travelMinutes,
        access: connection.access,
        unlockCondition: connection.unlockCondition,
        visibility: connection.visibility,
        data: connection.type ? { type: connection.type } : undefined
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
      data: split.rewards.map((reward) => ({
        entityId,
        rewardId: reward.rewardId,
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
        targetType: objective.target?.type ?? null,
        targetDomainId: objective.target?.id ?? null,
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
        targetType: objective.target?.type ?? null,
        targetDomainId: objective.target?.id ?? null,
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

async function validateCatalogWrite(tx, campaignId, type, data) {
  if (!['location', 'quest'].includes(type)) return;
  const rows = await tx.entity.findMany({ where: { campaignId, type, deletedAt: null } });
  const catalog = rows.map(row => ({ type, data: { ...row.data, id: row.domainId } }));
  try { validateEntityCatalog([{ type, data }], catalog); }
  catch (error) { error.code = 'INVALID_CONTENT'; throw error; }
}

export async function createEntity({ campaignId, type, input, actorUserId, source }) {
  const parsed = normalizeInput(type, input);
  const split = splitEntity(type, parsed);
  return prisma.$transaction(async (tx) => {
    await validateCatalogWrite(tx, campaignId, type, parsed._canonical);
    const entity = await tx.entity.create({
      data: {
        campaignId,
        type,
        domainId: parsed.id,
        name: parsed.name,
        active: parsed.active,
        baseVisibility: parsed.baseVisibility ?? 'gm',
        schemaVersion: 2,
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
  }, { isolationLevel: 'Serializable' });
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
    await validateCatalogWrite(tx, campaignId, type, parsed._canonical);
    const result = await tx.entity.updateMany({
      where: { id: current.id, version },
      data: {
        deletedAt: null,
        name: parsed.name,
        active: parsed.active,
        baseVisibility: parsed.baseVisibility ?? current.baseVisibility,
        schemaVersion: 2,
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
  }, { isolationLevel: 'Serializable' });
}

export async function deleteEntity({ campaignId, type, domainId, actorUserId }) {
  return prisma.$transaction(async (tx) => {
    const current = await tx.entity.findUnique({
      where: { campaignId_type_domainId: { campaignId, type, domainId } }
    });
    if (!current) return false;
    // References are derived from the same canonical documents used for
    // backlinks, so deletion cannot silently leave broken IDs behind.
    const sources = await tx.entity.findMany({
      where: { campaignId, deletedAt: null },
      include: includeAll
    });
    const incoming = [];
    for (const source of sources) {
      if (source.id === current.id) continue;
      const data = entityRecordToCanonical(source);
      for (const reference of collectOutboundReferences(source.type, data)) {
        if (reference.type === type && reference.id === domainId) {
          incoming.push({ type: source.type, id: source.domainId, field: reference.role });
        }
      }
    }
    if (incoming.length) return { blocked: true, references: incoming };
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
    return { blocked: false };
  });
}

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function changePath(path) {
  if (typeof path !== 'string' || !path || path.includes('__proto__') || path.includes('constructor'))
    throw Object.assign(new Error(`Invalid change path: ${path}`), { code: 'INVALID_CONTENT' });
  return path.replace(/^\//, '').split(/[/.]/).filter(Boolean);
}

function setAt(root, path, value) {
  const parts = changePath(path);
  let target = root;
  for (const part of parts.slice(0, -1)) {
    if (!target[part] || typeof target[part] !== 'object') target[part] = {};
    target = target[part];
  }
  target[parts.at(-1)] = clone(value);
}

function listAt(root, path) {
  const parts = changePath(path);
  let target = root;
  for (const part of parts) target = target?.[part];
  if (target == null) return [];
  if (!Array.isArray(target))
    throw Object.assign(new Error(`Change target is not a list: ${path}`), { code: 'INVALID_CONTENT' });
  return target;
}

export function applyEntityChangeDocument(document, { set = {}, add = {}, remove = {} } = {}) {
  const next = clone(document);
  for (const [path, value] of Object.entries(set)) setAt(next, path, value);
  for (const [path, values] of Object.entries(add)) {
    const list = listAt(next, path);
    for (const value of (Array.isArray(values) ? values : [values]))
      if (!list.some((item) => JSON.stringify(item) === JSON.stringify(value))) list.push(clone(value));
  }
  for (const [path, values] of Object.entries(remove)) {
    const list = listAt(next, path);
    for (const value of (Array.isArray(values) ? values : [values]))
      for (let i = list.length - 1; i >= 0; i--)
        if (JSON.stringify(list[i]) === JSON.stringify(value) || (value?.type && value?.id && list[i]?.type === value.type && list[i]?.id === value.id)) list.splice(i, 1);
  }
  return next;
}

/** Apply a small, validated changeset while preserving every omitted field. */
export async function applyEntityChanges({
  campaignId, type, domainId, expectedVersion, set = {}, add = {}, remove = {}, actorUserId
}) {
  return prisma.$transaction(async (tx) => {
    const current = await tx.entity.findUnique({
      where: { campaignId_type_domainId: { campaignId, type, domainId } }, include: includeAll
    });
    if (!current) return null;
    if (current.version !== expectedVersion) {
      const error = new Error('Version conflict'); error.code = 'VERSION_CONFLICT'; throw error;
    }
    const next = applyEntityChangeDocument(entityRecordToAuthoritative(current), { set, add, remove });
    const parsed = normalizeInput(type, { ...next, id: domainId });
    const split = splitEntity(type, parsed);
    await validateCatalogWrite(tx, campaignId, type, parsed._canonical);
    const result = await tx.entity.updateMany({
      where: { id: current.id, version: expectedVersion },
      data: {
        deletedAt: null, name: parsed.name, active: parsed.active,
        baseVisibility: parsed.baseVisibility ?? current.baseVisibility,
        schemaVersion: 2, data: split.data, localModifiedAt: new Date(), version: { increment: 1 }
      }
    });
    if (result.count !== 1) { const error = new Error('Version conflict'); error.code = 'VERSION_CONFLICT'; throw error; }
    await replaceSimpleChildren(tx, current.id, type, split);
    if (type === 'quest') await reconcileQuestObjectives(tx, current.id, split.objectives);
    await audit(tx, { campaignId, actorUserId, action: 'entity.update', entityType: type, entityDomainId: domainId, before: current.data, after: parsed });
    return tx.entity.findUnique({ where: { id: current.id } });
  }, { isolationLevel: 'Serializable' });
}

async function getViewerContext(request) {
  if (request.viewerContext) return request.viewerContext;
  const requestedUserId = isGm(request) ? request.query?.viewAsUserId : undefined;
  if (isGm(request) && !requestedUserId) {
    request.viewerContext = { gm: true, userId: request.auth.user.id, groups: [] };
    return request.viewerContext;
  }
  const userId = requestedUserId ?? request.auth.user.id;
  if (requestedUserId) {
    const membership = await prisma.membership.findUnique({
      where: { campaignId_userId: { campaignId: request.campaign.id, userId } }
    });
    if (!membership || ['owner', 'gm', 'assistant_gm'].includes(membership.role)) {
      const error = new Error('Selecione um jogador válido desta campanha.');
      error.code = 'INVALID_VIEWER';
      throw error;
    }
  }
  const groups = await prisma.groupMember.findMany({
    where: { userId, group: { campaignId: request.campaign.id } },
    select: { group: { select: { domainId: true } } }
  });
  request.viewerContext = {
    gm: false,
    userId,
    groups: groups.map((membership) => membership.group.domainId)
  };
  return request.viewerContext;
}

function accessFor({ baseVisibility, context, grants, targetKind, targetKey }) {
  const relevant = grants.filter(
    (grant) => grant.targetKind === targetKind && grant.targetKey === targetKey
  );
  return evaluateGrant({
    baseVisibility,
    isGm: context.gm,
    userId: context.userId,
    groups: context.groups,
    grants: relevant
  });
}

function collectionAccess({ baseVisibility, context, grants, targetKind, targetKey, section }) {
  const hasDirectGrant = grants.some((grant) => grant.targetKind === targetKind && grant.targetKey === targetKey);
  if (hasDirectGrant) return accessFor({ baseVisibility, context, grants, targetKind, targetKey });
  return accessFor({ baseVisibility, context, grants, targetKind: 'field', targetKey: `section.${section}` });
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
  const outputExtras = {};
  const claimed = new Set(['sectionVisibility', 'sheet', 'baseVisibility', 'extensions', 'extraStatBlocks']);
  for (const section of ['extensions', 'extraStatBlocks']) {
    if (entity.data[section] && sectionAccess({ entity, section, request, context, grants, fallback: 'gm' }).allowed) outputExtras[section] = entity.data[section];
  }
  const output = { ...outputExtras };
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

export function filterMonsterSheet({ sheet = {}, request, context, grants }) {
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
    const hasOwnVisibility = Object.hasOwn(visibilityMap, key);
    if (sheet[key] != null && basicAllowed && (!hasOwnVisibility || allowed(key)))
      output[key] = sheet[key];
  }
  for (const moduleName of ['combat', 'resources', 'resistances', 'attributes']) {
    const moduleValue = sheet[moduleName] ?? {};
    if (!allowed(moduleName)) continue;
    const filtered = {};
    for (const [key, value] of Object.entries(moduleValue)) {
      const path = `${moduleName}.${key}`;
      if (!Object.hasOwn(visibilityMap, path) || allowed(path))
        filtered[key] = value;
    }
    if (Object.keys(filtered).length) output[moduleName] = filtered;
  }
  return output;
}

async function describeTargetForRequest(
  { type, id, role, chance, quantityMin, quantityMax },
  request,
  context
) {
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
    return {
      type,
      id,
      role,
      ...(chance != null ? { chance } : {}),
      ...(quantityMin != null ? { quantityMin } : {}),
      ...(quantityMax != null ? { quantityMax } : {}),
      available: false,
      ...(context.gm ? { broken: true } : {})
    };
  }
  const available = await serializeEntityGateOnly(target, request, context);
  return {
    type,
    id,
    role,
    ...(chance != null ? { chance } : {}),
    ...(quantityMin != null ? { quantityMin } : {}),
    ...(quantityMax != null ? { quantityMax } : {}),
    available,
    ...(available || context.gm ? { name: target.name, subtitle: target.data?.subtitle ?? target.data?.title } : {})
  };
}

export function filterKnownReferences(references, context) {
  const normalized = (references ?? []).filter(Boolean);
  if (context?.gm) return normalized;
  return normalized.filter((reference) => reference.available === true);
}

export function collectOutboundReferences(type, data) {
  if (isV2Entity(data)) return collectEntityLinks(type, data);
  const references = [...(data.references ?? [])];
  for (const key of ['locations', 'relations']) references.push(...(data[key] ?? []));
  for (const key of ['startSource', 'completionReceiver']) {
    if (data[key]) references.push(data[key]);
  }
  if (data.parentId) references.push({ type: 'location', id: data.parentId, role: 'parent' });
  for (const key of ['mainLocationId', 'primaryLocationId', 'currentLocationId']) {
    if (data[key]) references.push({ type: 'location', id: data[key], role: key });
  }
  for (const connection of data.connections ?? []) {
    const id = connection.targetId ?? connection.to;
    if (id) references.push({ type: 'location', id, role: 'connection' });
  }
  for (const requirement of data.requirements ?? []) {
    if (requirement.type && requirement.id)
      references.push({ type: requirement.type, id: requirement.id, role: 'requirement' });
  }
  for (const id of data.prerequisites ?? []) references.push({ type: 'quest', id, role: 'prerequisite' });
  for (const id of data.nextQuests ?? [])
    references.push({ type: 'quest', id, role: 'next' });
  for (const objective of data.objectives ?? []) {
    if (objective.target) references.push({ ...objective.target, role: 'objective' });
  }
  for (const reward of data.rewards ?? []) {
    if (reward.target) references.push({ ...reward.target, role: 'reward' });
    else if (['npc', 'location', 'item', 'monster', 'quest'].includes(reward.type) && reward.id)
      references.push({ type: reward.type, id: reward.id, role: 'reward' });
  }

  const unique = new Map();
  for (const reference of references) {
    if (!reference?.type || !reference.id) continue;
    const key = `${reference.type}:${reference.id}:${reference.role ?? 'related'}`;
    unique.set(key, { type: reference.type, id: reference.id, role: reference.role ?? 'related' });
  }
  return [...unique.values()].filter((reference) => !(reference.type === type && reference.id === data.id));
}

async function backlinkIndexForRequest(request) {
  if (request.backlinkIndex) return request.backlinkIndex;
  request.backlinkIndex = (async () => {
    const rows = await prisma.entity.findMany({
      where: { campaignId: request.campaign.id, deletedAt: null },
      include: {
        fields: true,
        references: true,
        locationConnections: true,
        monsterComponents: true,
        questObjectives: true,
        questRewards: true
      }
    });
    const index = new Map();
    for (const source of rows) {
      const context = await getViewerContext(request);
      const data = context.gm ? entityRecordToAuthoritative(source) : await serializeEntityForRequest(source, request, { backlinks: false, format: '1' });
      if (!data) continue;
      for (const reference of collectOutboundReferences(source.type, data)) {
        const key = `${reference.type}:${reference.id}`;
        const entries = index.get(key) ?? [];
        entries.push({
          type: source.type,
          id: source.domainId,
          role: `referenciado por · ${reference.role}`
        });
        index.set(key, entries);
      }
    }
    return index;
  })();
  return request.backlinkIndex;
}

async function backlinksForRequest(entity, request, context) {
  const index = await backlinkIndexForRequest(request);
  const candidates = index.get(`${entity.type}:${entity.domainId}`) ?? [];
  const backlinks = await Promise.all(
    candidates.map((reference) => describeTargetForRequest(reference, request, context))
  );
  return backlinks.filter((reference) => context.gm || reference.available);
}

async function resolveEmbeddedReferences(result, request, context) {
  for (const key of ['locations', 'relations']) {
    if (!Array.isArray(result[key])) continue;
    result[key] = filterKnownReferences(
      await Promise.all(
        result[key].map((reference) => describeTargetForRequest(reference, request, context))
      ),
      context
    );
  }
  for (const key of ['startSource', 'completionReceiver']) {
    if (!result[key]?.type || !result[key]?.id) continue;
    const reference = await describeTargetForRequest(result[key], request, context);
    if (filterKnownReferences([reference], context).length) result[key] = reference;
    else delete result[key];
  }
  if (result.parentId) {
    const parent = await describeTargetForRequest(
      { type: 'location', id: result.parentId, role: 'parent' },
      request,
      context
    );
    if (filterKnownReferences([parent], context).length) result.parent = parent;
    else {
      delete result.parent;
      delete result.parentId;
    }
  }
  if (Array.isArray(result.prerequisites) && !context.gm) {
    const known = await Promise.all(result.prerequisites.map(id => describeTargetForRequest({ type: 'quest', id, role: 'prerequisite' }, request, context)));
    result.prerequisites = known.filter(r => r.available).map(r => r.id);
  }
  if (Array.isArray(result.nextQuests)) {
    result.nextQuestReferences = filterKnownReferences(
      await Promise.all(
        result.nextQuests.map((id) =>
          describeTargetForRequest({ type: 'quest', id, role: 'next' }, request, context)
        )
      ),
      context
    );
    if (!context.gm)
      result.nextQuests = result.nextQuestReferences.map((reference) => reference.id);
  }
  if (result.mainLocationId || result.primaryLocationId || result.currentLocationId) {
    const existing = new Set((result.locations ?? []).map((reference) => reference.id));
    for (const [key, role] of [
      ['mainLocationId', 'main'],
      ['primaryLocationId', 'main'],
      ['currentLocationId', 'current']
    ]) {
      const id = result[key];
      if (!id || existing.has(id)) continue;
      const reference = await describeTargetForRequest(
        { type: 'location', id, role },
        request,
        context
      );
      if (!filterKnownReferences([reference], context).length) {
        delete result[key];
        continue;
      }
      result.locations ??= [];
      result.locations.push(reference);
      existing.add(id);
    }
  }
  if (Array.isArray(result.requirements)) {
    result.requirements = (
      await Promise.all(
        result.requirements.map(async (requirement) => {
          if (
            !requirement.id ||
            !['npc', 'location', 'item', 'monster', 'quest'].includes(requirement.type)
          )
            return requirement;
          const target = await describeTargetForRequest(
            { type: requirement.type, id: requirement.id, role: 'requirement' },
            request,
            context
          );
          if (!filterKnownReferences([target], context).length) return null;
          return {
            ...requirement,
            target
          };
        })
      )
    ).filter(Boolean);
  }
}

export async function serializeEntityForRequest(entity, request, options = {}) {
  const context = await getViewerContext(request);
  const grants = context.gm
    ? []
    : await prisma.grant.findMany({
        where: {
          campaignId: request.campaign.id,
          entityType: entity.type,
          entityDomainId: entity.domainId,
          OR: [
            { subjectType: 'user', subjectId: context.userId },
            ...(context.groups.length
              ? [{ subjectType: 'group', subjectId: { in: context.groups } }]
              : [])
          ]
        }
      });
  const canonical = entityRecordToCanonical(entity);
  const projection = toLegacyEntity(entity.type, canonical);
  for (const key of ['fields', 'references', 'connections', 'objectives', 'rewards', ...Object.values(COMPONENT_COLLECTIONS)]) delete projection[key];
  entity = { ...entity, data: projection };

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
    for (const reference of entity.references.filter(r => (r.slot ?? 'references') === 'references')) {
      const described = await describeTargetForRequest(
        {
          type: reference.targetType,
          id: reference.targetDomainId,
          role: reference.role,
          chance: reference.chance,
          quantityMin: reference.quantityMin,
          quantityMax: reference.quantityMax
        },
        request,
        context
      );
      if (filterKnownReferences([described], context).length) references.push(described);
    }
  }

  const visibleData = filterEntityData({ entity, request, context, grants });
  const result = {
    entityType: entity.type,
    id: entity.domainId,
    name: entity.name,
    active: entity.active,
    version: entity.version,
    createdAt: entity.createdAt,
    updatedAt: entity.updatedAt,
    ...visibleData,
    fields,
    references
  };
  result.backlinks = options.backlinks === false ? [] : await backlinksForRequest(entity, request, context);
  await resolveEmbeddedReferences(result, request, context);

  if (entity.type === 'location') {
    result.connections = entity.locationConnections
      .filter(
        (connection) =>
          collectionAccess({
            baseVisibility: connection.visibility,
            request,
            context,
            grants,
            targetKind: 'location_connection',
            targetKey: connection.connectionId,
            section: 'connections'
          }).allowed
      )
      .map(async (connection) => ({
        connectionId: connection.connectionId,
        targetId: connection.targetDomainId,
        ...(connection.direction != null ? { direction: connection.direction } : {}),
        ...(connection.distanceKm != null ? { distanceKm: connection.distanceKm } : {}),
        ...(connection.travelMinutes != null ? { travelMinutes: connection.travelMinutes } : {}),
        ...(connection.data?.type != null ? { type: connection.data.type } : {}),
        access: connection.access,
        ...(context.gm && connection.unlockCondition != null
          ? { unlockCondition: connection.unlockCondition }
          : {}),
        ...(context.gm ? { visibility: connection.visibility } : {}),
        target: await describeTargetForRequest(
          { type: 'location', id: connection.targetDomainId, role: 'connection' },
          request,
          context
        )
      }));
    result.connections = (await Promise.all(result.connections)).filter(
      (connection) => context.gm || connection.target?.available === true
    );
  }

  if (entity.type === 'monster') {
    result.sheet = filterMonsterSheet({ sheet: entity.data.sheet ?? {}, request, context, grants });
    for (const kind of ['movement', 'attack', 'ability', 'skill', 'trait']) {
      const outputKey = monsterOutputKeys[kind];
      result[outputKey] = entity.monsterComponents
        .filter((component) => component.kind === kind)
        .filter(
          (component) =>
            collectionAccess({
              baseVisibility: component.visibility,
              request,
              context,
              grants,
              targetKind: targetKindByComponent[kind],
              targetKey: component.componentId,
              section: kind === 'movement' ? 'movements' : `${kind}s`
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
    result.objectives = (await Promise.all(result.objectives)).map((objective) => {
      if (context.gm || !objective.target || objective.target.available === true) return objective;
      const withoutHiddenTarget = { ...objective };
      delete withoutHiddenTarget.target;
      return withoutHiddenTarget;
    });
    const rewardsAllowed = sectionAccess({
      entity,
      section: 'rewards',
      request,
      context,
      grants
    }).allowed;
    if (rewardsAllowed) {
      result.rewards = (
        await Promise.all(
          entity.questRewards.map(async (reward) => {
            const data = reward.data;
            if (data?.target?.type && data?.target?.id) {
              const target = await describeTargetForRequest(data.target, request, context);
              if (!filterKnownReferences([target], context).length) return null;
              return { ...data, target };
            }
            if (data?.id && data.type === 'item') {
              const target = await describeTargetForRequest(
                { type: data.type, id: data.id, role: 'reward' },
                request,
                context
              );
              if (!filterKnownReferences([target], context).length) return null;
              return { ...data, target };
            }
            return data;
          })
        )
      ).filter(Boolean);
    }
  }

  if (context.gm) {
    result._technical = {
      entityPk: entity.id,
      baseVisibility: entity.baseVisibility,
      source: entity.source
    };
  }
  if ((options.format ?? request.query?.format) === '2') {
    const { entityType, version, createdAt, updatedAt, backlinks, _technical, parent: _parent, nextQuestReferences: _next, ...visible } = result;
    return {
      schemaVersion: '2.0', entityType, id: result.id, name: result.name, version, createdAt, updatedAt, backlinks,
      ...(context.gm ? { _technical } : {}),
      data: context.gm ? canonical : migrateV1Entity(entity.type, visible)
    };
  }

  return result;
}

async function serializeEntityGateOnly(entity, request, suppliedContext) {
  const context = suppliedContext ?? (await getViewerContext(request));
  if (context.gm) return true;
  const groupIds = context.groups;
  const grants = await prisma.grant.findMany({
    where: {
      campaignId: request.campaign.id,
      entityType: entity.type,
      entityDomainId: entity.domainId,
      targetKind: 'entity',
      targetKey: 'existence',
      OR: [
        { subjectType: 'user', subjectId: context.userId },
        ...(groupIds.length ? [{ subjectType: 'group', subjectId: { in: groupIds } }] : [])
      ]
    }
  });
  return evaluateGrant({
    baseVisibility: entity.baseVisibility,
    isGm: false,
    userId: context.userId,
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
    .map((row) => ({ type: row.entityType, id: row.id, name: row.name, subtitle: row.subtitle ?? row.title }));
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
        schemaVersion: 2,
        baseVisibility: parsed.baseVisibility ?? current.baseVisibility,
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
        baseVisibility: parsed.baseVisibility ?? 'gm',
        schemaVersion: 2,
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
    after: { removedFromImport: true }
  });
  return entity;
}

export function entityRecordToAuthoritative(entity) {
  return toLegacyEntity(entity.type, entityRecordToCanonical(entity));
}

/** Rebuild a single authoritative document; no derived links are persisted. */
export function entityRecordToCanonical(entity, options = {}) {
  const raw = {
    ...entity.data, id: entity.domainId, name: entity.name, active: entity.active,
    fields: (entity.fields ?? []).map(({ key, value, visibility }) => ({ key, value, visibility }))
  };
  const links = (entity.references ?? []).map(r => ({
    type: r.targetType, id: r.targetDomainId, role: r.role, slot: r.slot ?? 'references',
    ...(r.chance != null ? { chance: r.chance } : {}),
    ...(r.quantityMin != null ? { quantityMin: r.quantityMin } : {}),
    ...(r.quantityMax != null ? { quantityMax: r.quantityMax } : {})
  }));
  const canonical = isV2Entity(entity.data);
  if (canonical) raw.links = links;
  else raw.references = links.filter(l => l.slot === 'references');
  if (entity.type === 'location') raw.connections = (entity.locationConnections ?? []).map(c => ({
    connectionId: c.connectionId, targetId: c.targetDomainId,
    ...(c.data?.type != null ? { type: c.data.type } : {}),
    ...(c.direction != null ? { direction: c.direction } : {}),
    ...(c.distanceKm != null ? { distanceKm: c.distanceKm } : {}),
    ...(c.travelMinutes != null ? { travelMinutes: c.travelMinutes } : {}),
    access: c.access, visibility: c.visibility,
    ...(c.unlockCondition != null ? { unlockCondition: c.unlockCondition } : {})
  }));
  if (entity.type === 'monster') {
    for (const [kind, key] of Object.entries(COMPONENT_COLLECTIONS)) raw[key] = (entity.monsterComponents ?? [])
      .filter(c => c.kind === kind).map(c => ({ id: c.componentId, visibility: c.visibility, data: c.data }));
  }
  if (entity.type === 'quest') {
    raw.objectives = (entity.questObjectives ?? []).sort((a, b) => a.sortOrder - b.sortOrder).map(o => ({
      objectiveId: o.objectiveId, type: o.type, text: o.text, order: o.sortOrder, requiredQuantity: o.requiredQuantity,
      optional: o.optional, secret: o.secret, visibility: o.visibility, dependsOn: o.dependsOn, playerEditable: o.playerEditable,
      ...(o.targetType ? { target: { type: o.targetType, id: o.targetDomainId } } : {})
    }));
    raw.rewards = (entity.questRewards ?? []).map(r => ({ ...r.data, rewardId: r.rewardId }));
  }
  // Convert the normalized children together with the legacy document exactly once.
  if (canonical) {
    raw.visibility = { entity: entity.baseVisibility, sections: entity.data.visibility?.sections ?? {} };
    if (entity.type === 'location') raw.connections = raw.connections.map(({ connectionId, targetId, ...c }) => ({ ...c, id: connectionId, target: { type: 'location', id: targetId } }));
    if (entity.type === 'monster') {
      raw.components = Object.entries(COMPONENT_COLLECTIONS).flatMap(([kind, key]) => raw[key].map(c => ({ ...c, kind })));
      for (const key of Object.values(COMPONENT_COLLECTIONS)) delete raw[key];
    }
    return normalizeEntity(entity.type, raw, { format: '2.0' });
  }
  raw.baseVisibility = entity.baseVisibility;
  return normalizeEntity(entity.type, raw, { format: '1.0', ...options });
}
