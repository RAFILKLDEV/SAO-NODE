import { z } from 'zod';
import {
  baseEntitySchema,
  referenceSchema,
  visibilitySchema,
  T20_CURRENT,
  T20_LEGACY
} from '@sao/shared';

const extensibleString = z.string().min(1);
const stringValue = z.union([z.string(), z.number()]);
const urlValue = z.union([z.string().url(), z.literal('')]).optional();
const serviceSchema = z.union([
  z.string().min(1),
  z.object({ type: z.string().min(1), name: z.string().optional() })
]);

const t20SnapshotSchema = z
  .object({
    name: z.string().default(''),
    player: z.string().default(''),
    race: z.string().default(''),
    origin: z.string().default(''),
    job: z.string().default(''),
    level: z.string().default(''),
    strMod: z.string().default(''),
    dexMod: z.string().default(''),
    conMod: z.string().default(''),
    intMod: z.string().default(''),
    wisMod: z.string().default(''),
    chaMod: z.string().default(''),
    defense: z.string().default(''),
    fortitude: z.string().default(''),
    reflex: z.string().default(''),
    will: z.string().default(''),
    hp: z.string().default(''),
    hpMax: z.string().default(''),
    mp: z.string().default(''),
    mpMax: z.string().default(''),
    avatar: z.string().default(''),
    dataType: z.string().default(''),
    readAt: z.number().default(0),
    attributeSummary: z.string().default(''),
    hpText: z.string().default(''),
    mpText: z.string().default(''),
    saveSummary: z.string().default(''),
    summary: z.string().default('')
  })
  .partial();

const npcT20Schema = z.object({
  mode: z.enum(['none', 'embedded', 'linked']).default('none'),
  dataType: z.string().default(T20_CURRENT),
  characterId: z.string().default(''),
  firecastUri: z.string().default(''),
  snapshot: t20SnapshotSchema.optional()
});

export const npcSchema = baseEntitySchema.extend({
  title: z.string().optional(),
  identity: z
    .object({
      race: z.string().default(''),
      gender: z.string().default(''),
      age: z.string().default(''),
      profession: z.string().default('')
    })
    .optional(),
  race: z.string().optional(),
  gender: z.string().optional(),
  age: stringValue.optional(),
  profession: z.string().optional(),
  level: stringValue.optional(),
  imageURL: urlValue,
  imageUrl: urlValue,
  tokenUrl: urlValue,
  portraitUrl: urlValue,
  sourceUrl: urlValue,
  factions: z.array(z.string()).default([]),
  services: z.array(serviceSchema).default([]),
  mainLocationId: z.string().optional(),
  primaryLocationId: z.string().optional(),
  currentLocationId: z.string().optional(),
  locations: z.array(referenceSchema).default([]),
  relations: z.array(referenceSchema).default([]),
  t20: npcT20Schema.optional()
});

export const locationConnectionSchema = z
  .object({
    connectionId: z.string().min(1).optional(),
    targetId: z.string().min(3).optional(),
    to: z.string().min(3).optional(),
    type: z.string().optional(),
    direction: z.string().optional(),
    distanceKm: z.number().nonnegative().optional(),
    travelMinutes: z.number().int().nonnegative().optional(),
    access: z
      .enum(['public', 'discoverable', 'hidden', 'conditional', 'blocked'])
      .default('public'),
    unlockCondition: z.string().optional(),
    visibility: visibilitySchema.default('public')
  })
  .refine((value) => value.targetId || value.to, { message: 'targetId or to is required' });

export const locationSchema = baseEntitySchema.extend({
  type: extensibleString.default('region'),
  state: z.string().optional(),
  parentId: z.string().optional(),
  environment: z.string().optional(),
  levelRecommended: stringValue.optional(),
  recommendedLevel: stringValue.optional(),
  imageURL: urlValue,
  imageUrl: urlValue,
  mapUrl: urlValue,
  services: z.array(serviceSchema).default([]),
  connections: z.array(locationConnectionSchema).default([])
});

export const itemStatSchema = z.object({
  key: z.string().min(1),
  value: z.union([z.string(), z.number(), z.boolean()]),
  operation: z.string().min(1).optional()
});

export const itemSchema = baseEntitySchema.extend({
  category: extensibleString.default('misc'),
  rarity: extensibleString.default('common'),
  imageURL: urlValue,
  imageUrl: urlValue,
  value: z.object({ amount: stringValue, currency: z.string().min(1) }).optional(),
  stats: z.array(itemStatSchema).default([])
});

const visibleComponent = z.object({
  id: z.string().min(1),
  visibility: visibilitySchema.default('public')
});

export const monsterSchema = baseEntitySchema.extend({
  group: z.string().optional(),
  imageURL: urlValue,
  imageUrl: urlValue,
  sheet: z
    .object({
      nd: z.union([z.string(), z.number()]).optional(),
      type: z.string().optional(),
      subtype: z.string().optional(),
      size: z.string().optional(),
      combat: z.record(z.string(), z.unknown()).default({}),
      resources: z.record(z.string(), z.unknown()).default({}),
      resistances: z.record(z.string(), z.unknown()).default({}),
      attributes: z.record(z.string(), z.unknown()).default({}),
      statsVisibility: z.record(z.string(), visibilitySchema).default({})
    })
    .default({}),
  t20: z
    .object({
      nd: stringValue.optional(),
      creatureType: z.string().optional(),
      subtype: z.string().optional(),
      size: z.string().optional(),
      initiative: z.string().optional(),
      perception: z.string().optional(),
      senses: z.string().optional(),
      defense: z.string().optional(),
      fortitude: z.string().optional(),
      reflex: z.string().optional(),
      will: z.string().optional(),
      hp: z.string().optional(),
      hpMax: z.string().optional(),
      mp: z.string().optional(),
      mpMax: z.string().optional(),
      attributes: z.record(z.string(), z.unknown()).default({}),
      statVisibility: z.record(z.string(), visibilitySchema).default({})
    })
    .optional(),
  movements: z
    .array(visibleComponent.extend({ data: z.record(z.string(), z.unknown()) }))
    .default([]),
  attacks: z
    .array(visibleComponent.extend({ data: z.record(z.string(), z.unknown()) }))
    .default([]),
  abilities: z
    .array(visibleComponent.extend({ data: z.record(z.string(), z.unknown()) }))
    .default([]),
  skills: z.array(visibleComponent.extend({ data: z.record(z.string(), z.unknown()) })).default([]),
  traits: z.array(visibleComponent.extend({ data: z.record(z.string(), z.unknown()) })).default([])
});

export const questObjectiveSchema = z
  .object({
    objectiveId: z.string().min(1).optional(),
    id: z.string().min(1).optional(),
    type: extensibleString,
    text: z.string().min(1),
    order: z.number().int().nonnegative(),
    requiredQuantity: z.number().int().positive().optional(),
    quantity: z.number().int().positive().optional(),
    optional: z.boolean().default(false),
    secret: z.boolean().default(false),
    visibility: visibilitySchema.default('public'),
    target: z.object({ type: z.string().min(1), id: z.string().min(1) }).optional(),
    targetType: z.string().optional(),
    targetId: z.string().optional(),
    dependsOn: z.array(z.string()).default([]),
    dependsOnObjectiveIds: z.array(z.string()).optional(),
    playerEditable: z.boolean().default(false)
  })
  .refine((value) => value.objectiveId || value.id, { message: 'objectiveId or id is required' });

export const questRewardSchema = z.object({
  type: extensibleString,
  id: z.string().optional(),
  amount: stringValue.optional(),
  quantity: stringValue.optional(),
  currency: z.string().optional(),
  target: referenceSchema.optional(),
  choiceGroup: z.string().optional(),
  data: z.record(z.string(), z.unknown()).optional()
});

export const questSchema = baseEntitySchema.extend({
  subtitle: z.string().optional(),
  type: extensibleString.default('side'),
  state: extensibleString.default('available'),
  briefing: z.string().optional(),
  completionText: z.string().optional(),
  levelRecommended: stringValue.optional(),
  recommendedLevel: stringValue.optional(),
  startSource: referenceSchema.optional(),
  completionReceiver: referenceSchema.optional(),
  prerequisites: z.array(z.string()).default([]),
  requirements: z
    .array(
      z.object({
        type: z.string().min(1),
        id: z.string().optional(),
        minimum: z.string().optional(),
        quantity: z.string().optional(),
        state: z.string().optional()
      })
    )
    .default([]),
  nextQuests: z.array(z.string()).default([]),
  requirementLogic: z.enum(['all', 'any']).default('all'),
  objectiveMode: z.enum(['ordered', 'free']).default('free'),
  objectives: z.array(questObjectiveSchema).default([]),
  rewards: z.array(questRewardSchema).default([]),
  timeLimitMinutes: z.number().int().positive().optional()
});

export const entitySchemas = {
  npc: npcSchema,
  location: locationSchema,
  item: itemSchema,
  monster: monsterSchema,
  quest: questSchema
};

export function assertNamespacedId(type, id) {
  const prefixes = {
    npc: 'npc.',
    location: 'loc.',
    item: 'item.',
    monster: 'monster.',
    quest: 'quest.'
  };
  if (!prefixes[type] || !id.startsWith(prefixes[type])) {
    throw new Error(`Invalid ${type} id: ${id}`);
  }
  return true;
}

export function calculateTravelMinutes(distanceKm) {
  if (distanceKm == null) return undefined;
  if (!Number.isFinite(distanceKm) || distanceKm < 0) throw new Error('distanceKm must be >= 0');
  return Math.round((distanceKm * 1000) / 90);
}

export function buildLocationTree(locations) {
  const nodes = new Map(
    locations.map((location) => [location.id, { ...location, children: [], warnings: [] }])
  );
  const roots = [];

  function wouldCycle(nodeId, parentId) {
    let current = parentId;
    const seen = new Set([nodeId]);
    while (current) {
      if (seen.has(current)) return true;
      seen.add(current);
      current = nodes.get(current)?.parentId;
    }
    return false;
  }

  for (const node of nodes.values()) {
    if (!node.parentId) {
      roots.push(node);
      continue;
    }
    const parent = nodes.get(node.parentId);
    if (!parent) {
      node.warnings.push('orphan-parent');
      roots.push(node);
      continue;
    }
    if (wouldCycle(node.id, node.parentId)) {
      node.warnings.push('cycle');
      roots.push(node);
      continue;
    }
    parent.children.push(node);
  }

  const sort = (items) => {
    items.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
    items.forEach((item) => sort(item.children));
  };
  sort(roots);
  return roots;
}

export function resolveReferences(entities, references) {
  const index = new Map(entities.map((entity) => [`${entity.type}:${entity.id}`, entity]));
  return references.map((reference) => {
    const target = index.get(`${reference.type}:${reference.id}`);
    return {
      ...reference,
      resolved: Boolean(target),
      name: target?.name,
      warning: target ? undefined : 'unresolved-reference'
    };
  });
}

export function buildBacklinks(entities) {
  const backlinks = new Map();
  for (const source of entities) {
    for (const reference of source.references ?? []) {
      const key = `${reference.type}:${reference.id}`;
      const list = backlinks.get(key) ?? [];
      list.push({ type: source.type, id: source.id, role: reference.role });
      backlinks.set(key, list);
    }
  }
  return backlinks;
}

export function rollDrops(references, random = Math.random) {
  return references
    .filter((ref) => ref.type === 'item' && ref.role === 'drops')
    .filter((ref) => {
      const chance = ref.chance ?? 100;
      if (!Number.isInteger(chance) || chance < 1 || chance > 100) {
        throw new Error(`Invalid drop chance for ${ref.id}`);
      }
      return Math.floor(random() * 100) + 1 <= chance;
    });
}

export function evaluateQuestProgress(quest, progressByObjective = {}) {
  const objectives = [...quest.objectives].sort((a, b) => a.order - b.order);
  let orderedBlocked = false;
  let completedRequired = 0;
  let requiredTotal = 0;
  const objectiveStates = {};

  for (const objective of objectives) {
    const value = Math.max(0, Number(progressByObjective[objective.objectiveId] ?? 0));
    const complete = value >= objective.requiredQuantity;
    if (!objective.optional) requiredTotal += 1;

    const blocked = quest.objectiveMode === 'ordered' && orderedBlocked;
    objectiveStates[objective.objectiveId] = { value, complete, blocked };

    if (!objective.optional && complete) completedRequired += 1;
    if (quest.objectiveMode === 'ordered' && !objective.optional && !complete)
      orderedBlocked = true;
  }

  const percentage =
    requiredTotal === 0 ? 100 : Math.round((completedRequired / requiredTotal) * 100);
  return {
    percentage,
    readyToComplete: completedRequired === requiredTotal,
    objectives: objectiveStates
  };
}

export function visiblePlayerProgress(quest, evaluation) {
  const visible = {};
  for (const objective of quest.objectives) {
    if (objective.secret) continue;
    visible[objective.objectiveId] = evaluation.objectives[objective.objectiveId];
  }
  return {
    percentage: evaluation.percentage,
    readyToComplete: evaluation.readyToComplete,
    objectives: visible
  };
}

export function canPlayerUpdateObjective(quest, objectiveId) {
  const objective = quest.objectives.find((item) => item.objectiveId === objectiveId);
  return Boolean(objective && !objective.secret && objective.playerEditable);
}

export function normalizeT20ProviderId(value) {
  if (value === T20_LEGACY) return T20_CURRENT;
  return value;
}

export function evaluateGrant({ baseVisibility, isGm, userId, groups = [], grants = [] }) {
  if (isGm) return { allowed: true, source: 'gm' };

  const subjects = new Set([`user:${userId}`, ...groups.map((id) => `group:${id}`)]);
  const applicable = grants.filter((grant) =>
    subjects.has(`${grant.subjectType}:${grant.subjectId}`)
  );
  const userGrant = applicable.find((grant) => grant.subjectType === 'user');
  if (userGrant) return { allowed: userGrant.allowance === 'allow', source: 'user-grant' };

  const denies = applicable.filter((grant) => grant.allowance === 'deny');
  if (denies.length) return { allowed: false, source: 'group-deny' };
  const allows = applicable.filter((grant) => grant.allowance === 'allow');
  if (allows.length) return { allowed: true, source: 'group-grant' };

  return { allowed: baseVisibility === 'public', source: baseVisibility };
}

export function summarizeGroupVisibility(results) {
  if (!results.length) return 'empty';
  const allowed = results.filter(Boolean).length;
  if (allowed === 0) return 'hidden';
  if (allowed === results.length) return 'visible';
  return 'partial';
}

export class ManualCharacterProvider {
  constructor(characters = []) {
    this.characters = new Map(characters.map((character) => [character.externalId, character]));
  }

  async listCharacters() {
    return [...this.characters.values()];
  }

  async getCharacterByExternalId(externalId) {
    return this.characters.get(externalId) ?? null;
  }

  async getSnapshot(externalId) {
    const character = await this.getCharacterByExternalId(externalId);
    return character?.snapshot ?? null;
  }

  async openExternalCharacter(externalId) {
    const character = await this.getCharacterByExternalId(externalId);
    return character?.url ?? null;
  }

  async createCharacter(input) {
    if (!input.externalId) throw new Error('externalId is required');
    this.characters.set(input.externalId, input);
    return input;
  }
}

export class MockCharacterProvider extends ManualCharacterProvider {}
