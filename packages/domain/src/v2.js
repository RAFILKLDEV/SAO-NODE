import { z } from 'zod';
import { ENTITY_TYPES, VISIBILITIES, T20_CURRENT, T20_LEGACY } from '@sao/shared';
import {
  questTypeOptions,
  questStateOptions,
  locationTypeOptions,
  locationStateOptions,
  itemCategoryOptions,
  itemRarityOptions,
  operationOptions,
  monsterSizeOptions,
  monsterTypeOptions,
  monsterSubtypeOptions,
  objectiveTypeLabels,
  referenceRoleLabels,
  rewardTypeOptions
} from './entityMetadata.js';

export const SCHEMA_VERSION = '2.0';
export const ID_PREFIXES = {
  npc: 'npc.',
  location: 'loc.',
  item: 'item.',
  monster: 'monster.',
  quest: 'quest.'
};
export const COMPONENT_COLLECTIONS = {
  movement: 'movements',
  attack: 'attacks',
  ability: 'abilities',
  skill: 'skills',
  trait: 'traits'
};
export const COMPONENT_KINDS = Object.keys(COMPONENT_COLLECTIONS);
const text = z.string().min(1);
// These vocabularies are extensible in the runtime contract. Publish known values
// as annotations, not enums that would reject existing/custom campaign content.
const knownValues = (schema, options) =>
  schema.meta({
    description: `Valores conhecidos: ${options.map(({ value, label }) => `${value} (${label})`).join(', ')}. Aceita valores personalizados.`,
    examples: options.map(({ value }) => value),
    'x-known-values': options
  });
const labelOptions = (labels) => Object.entries(labels).map(([value, label]) => ({ value, label }));
const scalar = z.union([z.string(), z.number(), z.boolean()]);
const numberText = z.union([z.string(), z.number()]);
const visibility = z.enum(VISIBILITIES);
const map = z.record(z.string(), z.json());
const url = z.string().refine((value) => {
  if (
    !value ||
    /^\/api\/v1\/campaigns\/[^/]+\/media\/[a-f0-9-]+\.(png|jpe?g|gif|webp|avif|bmp)$/i.test(value)
  )
    return true;
  try {
    const parsed = new URL(value);
    return ['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}, 'URL de mídia inválida (use HTTP(S) ou mídia da campanha)');
export const targetSchema = z.strictObject({ type: z.enum(ENTITY_TYPES), id: text });
export const linkSchema = targetSchema
  .extend({
    role: knownValues(text, labelOptions(referenceRoleLabels)).default('related'),
    // Slot controls the existing section grant without duplicating the relation.
    slot: z.enum(['references', 'locations', 'relations']).default('references'),
    chance: z.number().int().min(1).max(100).optional(),
    quantityMin: z.number().int().positive().optional(),
    quantityMax: z.number().int().positive().optional()
  })
  .superRefine((link, ctx) => {
    if ((link.quantityMin ?? link.quantityMax ?? 1) > (link.quantityMax ?? link.quantityMin ?? 1))
      ctx.addIssue({ code: 'custom', path: ['quantityMax'], message: 'Máximo menor que mínimo' });
  });
const service = z.strictObject({ name: text, description: z.string().default('') });
const field = z.strictObject({
  key: text,
  value: z.string(),
  visibility: visibility.default('public')
});
export const connectionSchema = z.strictObject({
  id: text,
  target: targetSchema.extend({ type: z.literal('location') }),
  type: z.string().optional(),
  direction: z.string().optional(),
  distanceKm: z.number().nonnegative().optional(),
  travelMinutes: z.number().int().nonnegative().optional(),
  access: z.enum(['public', 'discoverable', 'hidden', 'conditional', 'blocked']).default('public'),
  unlockCondition: z.string().optional(),
  visibility: visibility.default('public')
});
const sheet = z.strictObject({
  nd: numberText.optional(),
  type: knownValues(z.string(), monsterTypeOptions).optional(),
  subtype: knownValues(z.string(), monsterSubtypeOptions).optional(),
  size: knownValues(z.string(), monsterSizeOptions).optional(),
  combat: map.default({}),
  resources: map.default({}),
  resistances: map.default({}),
  attributes: map.default({}),
  statsVisibility: z.record(z.string(), visibility).default({})
});
const binding = z.strictObject({
  mode: z.enum(['none', 'embedded', 'linked']).default('none'),
  providerId: text.default(T20_CURRENT),
  externalId: z.string().default(''),
  uri: z.string().default(''),
  snapshot: map.optional()
});
export const objectiveSchema = z.strictObject({
  objectiveId: text,
  type: knownValues(text, labelOptions(objectiveTypeLabels)),
  text: z.string().default(''),
  order: z.number().int().nonnegative(),
  requiredQuantity: z.number().int().positive().default(1),
  optional: z.boolean().default(false),
  secret: z.boolean().default(false),
  visibility: visibility.default('public'),
  target: targetSchema.optional(),
  dependsOn: z.array(text).default([]),
  playerEditable: z.boolean().default(false)
});
export const rewardSchema = z.strictObject({
  rewardId: text,
  type: knownValues(text, rewardTypeOptions),
  target: targetSchema.optional(),
  amount: numberText.optional(),
  quantity: numberText.optional(),
  currency: z.string().optional(),
  choiceGroup: z.string().optional(),
  data: map.optional()
});
export const baseV2Schema = z.strictObject({
  id: text,
  name: text,
  subtitle: z.string().optional(),
  active: z.boolean().default(true),
  tags: z.array(text).default([]),
  discoveryRevision: z.number().int().nonnegative().default(0),
  visibility: z
    .strictObject({
      entity: visibility.optional(),
      sections: z.record(z.string(), visibility).default({})
    })
    .default({ sections: {} }),
  media: z
    .strictObject({
      image: url.optional(),
      portrait: url.optional(),
      token: url.optional(),
      map: url.optional(),
      source: url.optional()
    })
    .default({}),
  fields: z.array(field).default([]),
  links: z.array(linkSchema).default([]),
  extensions: map.default({})
});
const shapes = {
  npc: baseV2Schema.extend({
    identity: z
      .strictObject({
        race: z.string().optional(),
        gender: z.string().optional(),
        age: numberText.optional(),
        profession: z.string().optional()
      })
      .default({}),
    level: numberText.optional(),
    factions: z.array(text).default([]),
    services: z.array(service).default([]),
    character: binding.optional()
  }),
  location: baseV2Schema.extend({
    type: knownValues(text, locationTypeOptions).default('region'),
    state: knownValues(z.string(), locationStateOptions).optional(),
    parentId: text.optional(),
    placement: z.strictObject({ floor: numberText.optional() }).default({}),
    environment: z.string().optional(),
    recommendedLevel: numberText.optional(),
    services: z.array(service).default([]),
    connections: z.array(connectionSchema).default([])
  }),
  item: baseV2Schema.extend({
    category: knownValues(text, itemCategoryOptions).default('misc'),
    rarity: knownValues(text, itemRarityOptions).default('common'),
    value: z.strictObject({ amount: numberText, currency: text }).optional(),
    stats: z
      .array(
        z.strictObject({
          key: text,
          value: scalar,
          operation: knownValues(text, operationOptions).optional()
        })
      )
      .default([])
  }),
  monster: baseV2Schema.extend({
    group: z.string().optional(),
    statBlocks: z.record(text, sheet).default({}),
    components: z
      .array(
        z.strictObject({
          id: text,
          kind: z.enum(COMPONENT_KINDS),
          visibility: visibility.default('public'),
          data: map
        })
      )
      .default([])
  }),
  quest: baseV2Schema.extend({
    type: knownValues(text, questTypeOptions).default('side'),
    state: knownValues(text, questStateOptions).default('available'),
    briefing: z.string().optional(),
    completionText: z.string().optional(),
    recommendedLevel: numberText.optional(),
    startSource: targetSchema.optional(),
    completionReceiver: targetSchema.optional(),
    prerequisites: z.array(text).default([]),
    requirements: z
      .array(
        z.strictObject({
          type: text,
          id: z.string().optional(),
          minimum: numberText.optional(),
          quantity: numberText.optional(),
          state: z.string().optional()
        })
      )
      .default([]),
    nextQuests: z.array(text).default([]),
    requirementLogic: z.enum(['all', 'any']).default('all'),
    objectiveMode: z.enum(['ordered', 'free']).default('free'),
    objectives: z.array(objectiveSchema).default([]),
    rewards: z.array(rewardSchema).default([]),
    timeLimitMinutes: z.number().int().positive().optional()
  })
};

function duplicateIssues(values, key, path, ctx) {
  const seen = new Set();
  (values ?? []).forEach((value, index) => {
    const id = key(value);
    if (seen.has(id))
      ctx.addIssue({ code: 'custom', path: [path, index], message: `Chave duplicada: ${id}` });
    seen.add(id);
  });
}
function acyclic(nodes, edges, path, ctx) {
  const visiting = new Set();
  const visited = new Set();
  function visit(id) {
    if (visiting.has(id)) {
      ctx.addIssue({ code: 'custom', path: [path], message: `Ciclo em ${id}` });
      return;
    }
    if (visited.has(id)) return;
    visiting.add(id);
    for (const next of edges(id)) if (nodes.has(next)) visit(next);
    visiting.delete(id);
    visited.add(id);
  }
  for (const id of nodes) visit(id);
}
export const entitySchemas = Object.fromEntries(
  Object.entries(shapes).map(([type, schema]) => [
    type,
    schema.superRefine((data, ctx) => {
      if (!data.id.startsWith(ID_PREFIXES[type]) || data.id.length <= ID_PREFIXES[type].length)
        ctx.addIssue({
          code: 'custom',
          path: ['id'],
          message: `O ID deve começar com "${ID_PREFIXES[type]}" e conter um identificador`
        });
      duplicateIssues(data.fields, (v) => v.key, 'fields', ctx);
      duplicateIssues(data.links, (v) => `${v.type}:${v.id}:${v.role}:${v.slot}`, 'links', ctx);
      duplicateIssues(data.stats, (v) => v.key, 'stats', ctx);
      duplicateIssues(data.connections, (v) => v.id, 'connections', ctx);
      duplicateIssues(data.components, (v) => `${v.kind}:${v.id}`, 'components', ctx);
      duplicateIssues(data.objectives, (v) => v.objectiveId, 'objectives', ctx);
      duplicateIssues(data.rewards, (v) => v.rewardId, 'rewards', ctx);
      const checkTarget = (value, path) => {
        if (
          value &&
          (!value.id.startsWith(ID_PREFIXES[value.type]) ||
            value.id.length <= ID_PREFIXES[value.type].length)
        )
          ctx.addIssue({ code: 'custom', path, message: 'Namespace incompatível com o destino' });
      };
      for (const [index, link] of data.links.entries()) {
        checkTarget(link, ['links', index, 'id']);
        if (type !== 'npc' && link.slot !== 'references')
          ctx.addIssue({
            code: 'custom',
            path: ['links', index, 'slot'],
            message: 'Slots locations e relations pertencem a NPCs'
          });
      }
      for (const key of ['connections', 'objectives', 'rewards'])
        for (const [index, entry] of (data[key] ?? []).entries())
          checkTarget(entry.target, [key, index, 'target']);
      for (const key of ['startSource', 'completionReceiver']) checkTarget(data[key], [key]);
      if (data.parentId) checkTarget({ type: 'location', id: data.parentId }, ['parentId']);
      for (const key of ['prerequisites', 'nextQuests'])
        for (const [index, id] of (data[key] ?? []).entries())
          checkTarget({ type: 'quest', id }, [key, index]);
      for (const [index, requirement] of (data.requirements ?? []).entries())
        if (ENTITY_TYPES.includes(requirement.type) && requirement.id)
          checkTarget(requirement, ['requirements', index, 'id']);
      if (data.parentId === data.id)
        ctx.addIssue({
          code: 'custom',
          path: ['parentId'],
          message: 'Local não pode ser seu próprio pai'
        });
      if (data.objectives) {
        const byId = new Map(data.objectives.map((v) => [v.objectiveId, v]));
        data.objectives.forEach((v, i) =>
          v.dependsOn.forEach((id) => {
            if (!byId.has(id))
              ctx.addIssue({
                code: 'custom',
                path: ['objectives', i, 'dependsOn'],
                message: `Objetivo inexistente: ${id}`
              });
          })
        );
        acyclic(new Set(byId.keys()), (id) => byId.get(id).dependsOn, 'objectives', ctx);
      }
    })
  ])
);

export function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .filter((key) => value[key] !== undefined)
        .sort()
        .map((key) => [key, stableValue(value[key])])
    );
  return value;
}
const equal = (a, b) => JSON.stringify(stableValue(a)) === JSON.stringify(stableValue(b));
const meaningful = (value) => value !== undefined && value !== null && value !== '';
const compact = (value) => JSON.parse(JSON.stringify(value));
const pick = (value, keys) =>
  Object.fromEntries(
    keys.filter((key) => value[key] !== undefined).map((key) => [key, value[key]])
  );
const target = (value) => (value ? pick(value, ['type', 'id']) : undefined);
const provider = (value) => (!value || value === T20_LEGACY ? T20_CURRENT : value);
export function stableChildId(prefix, value) {
  const source = JSON.stringify(stableValue(value));
  let hash = 2166136261;
  for (let i = 0; i < source.length; i++) {
    hash ^= source.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `${prefix}-${(hash >>> 0).toString(16)}`;
}

/** Loss-aware compatibility boundary. No Zod stripping is used before migration. */
export function migrateV1Entity(type, raw, { diagnostics = [], conflicts = 'error' } = {}) {
  const preservedConflicts = [];
  const take = (path, ...values) => {
    const present = values.filter(meaningful);
    if (
      present.length > 1 &&
      present.some(
        (value) =>
          !equal(value, present[0]) &&
          !(
            typeof value !== 'object' &&
            typeof present[0] !== 'object' &&
            String(value) === String(present[0])
          )
      )
    ) {
      const issue = { code: 'ALIAS_CONFLICT', path, values: present };
      diagnostics.push(issue);
      if (conflicts === 'error') throw new Error(`Conflito de aliases em ${path}`);
      if (conflicts === 'preserve') preservedConflicts.push(issue);
    }
    return present[0] ?? values.find((v) => v !== undefined);
  };
  const result = pick(raw, ['id', 'name', 'subtitle', 'active', 'tags', 'discoveryRevision']);
  result.subtitle = take('subtitle', raw.subtitle, raw.title);
  result.visibility = {
    entity: take(
      'visibility.entity',
      raw.visibility?.entity,
      raw.baseVisibility,
      raw.discoveryVisibility
    ),
    sections: take('visibility.sections', raw.visibility?.sections, raw.sectionVisibility) ?? {}
  };
  result.media = {
    ...raw.media,
    image: take('media.image', raw.media?.image, raw.imageURL, raw.imageUrl),
    portrait: take('media.portrait', raw.media?.portrait, raw.portraitUrl),
    token: take('media.token', raw.media?.token, raw.tokenUrl),
    map: take('media.map', raw.media?.map, raw.mapUrl),
    source: take('media.source', raw.media?.source, raw.sourceUrl)
  };
  result.fields = Array.isArray(raw.fields)
    ? raw.fields
    : Object.entries(raw.fields ?? {}).map(([key, value]) => ({ key, ...value }));
  result.extensions = { ...raw.extensions };
  // Provenance belongs to the server; retain legacy input as migration evidence.
  if (raw.source) result.extensions.legacySource = raw.source;
  // Preserve unsupported legacy members explicitly, including nested ones.
  const archive = (value, keys, path) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    const extra = Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key)));
    if (Object.keys(extra).length) {
      result.extensions.legacyNested = { ...result.extensions.legacyNested, [path]: extra };
      diagnostics.push({ code: 'LEGACY_EXTENSION', path, keys: Object.keys(extra) });
    }
  };
  const nestedKeys = {
    fields: ['key', 'value', 'visibility'],
    references: [
      'type',
      'id',
      'role',
      'slot',
      'chance',
      'quantityMin',
      'quantityMax',
      'name',
      'subtitle',
      'available',
      'broken'
    ],
    locations: [
      'type',
      'id',
      'role',
      'chance',
      'quantityMin',
      'quantityMax',
      'name',
      'subtitle',
      'available',
      'broken'
    ],
    relations: [
      'type',
      'id',
      'role',
      'chance',
      'quantityMin',
      'quantityMax',
      'name',
      'subtitle',
      'available',
      'broken'
    ],
    connections: [
      'connectionId',
      'targetId',
      'to',
      'id',
      'target',
      'type',
      'direction',
      'distanceKm',
      'travelMinutes',
      'access',
      'unlockCondition',
      'visibility'
    ],
    objectives: [
      'objectiveId',
      'id',
      'type',
      'text',
      'order',
      'requiredQuantity',
      'quantity',
      'optional',
      'secret',
      'visibility',
      'target',
      'targetType',
      'targetId',
      'dependsOn',
      'dependsOnObjectiveIds',
      'playerEditable'
    ],
    rewards: [
      'rewardId',
      'type',
      'id',
      'target',
      'amount',
      'quantity',
      'currency',
      'choiceGroup',
      'data'
    ],
    services: ['name', 'description', 'type'],
    requirements: ['type', 'id', 'minimum', 'quantity', 'state', 'target']
  };
  for (const [key, keys] of Object.entries(nestedKeys))
    if (Array.isArray(raw[key]))
      raw[key].forEach((value, index) => archive(value, keys, `${key}.${index}`));
  result.fields = result.fields.map((value) => pick(value, nestedKeys.fields));
  (raw.services ?? []).forEach((value, index) => {
    if (value?.name && value?.type && value.name !== value.type)
      archive(value, ['name', 'description'], `services.${index}`);
  });
  archive(raw.identity, ['race', 'gender', 'age', 'profession'], 'identity');
  archive(
    raw.sheet,
    [
      'nd',
      'type',
      'subtype',
      'size',
      'combat',
      'resources',
      'resistances',
      'attributes',
      'statsVisibility'
    ],
    'sheet'
  );
  if (type === 'npc')
    archive(raw.t20, ['mode', 'dataType', 'characterId', 'firecastUri', 'snapshot'], 't20');
  if (type === 'monster')
    archive(
      raw.t20,
      [
        'nd',
        'creatureType',
        'subtype',
        'size',
        'initiative',
        'perception',
        'senses',
        'defense',
        'fortitude',
        'reflex',
        'will',
        'hp',
        'hpMax',
        'mp',
        'mpMax',
        'attributes',
        'statVisibility'
      ],
      't20'
    );
  const links = [
    ...(raw.links ?? []),
    ...(raw.references ?? []).map((v) => ({ ...v, slot: 'references' }))
  ];
  for (const slot of ['locations', 'relations'])
    links.push(...(raw[slot] ?? []).map((v) => ({ ...v, slot })));
  for (const [key, role] of [
    ['mainLocationId', 'main'],
    ['primaryLocationId', 'main'],
    ['currentLocationId', 'current']
  ])
    if (raw[key]) links.push({ type: 'location', id: raw[key], role, slot: 'locations' });
  const unique = new Map();
  for (const link of links) {
    const normalized = {
      ...pick(link, ['type', 'id', 'role', 'slot', 'chance', 'quantityMin', 'quantityMax']),
      role: link.role === 'drop' ? 'drops' : (link.role ?? 'related'),
      slot: link.slot ?? 'references'
    };
    for (const key of ['chance', 'quantityMin', 'quantityMax'])
      if (normalized[key] == null) delete normalized[key];
    const key = `${normalized.type}:${normalized.id}:${normalized.role}:${normalized.slot}`;
    if (unique.has(key)) take(`links.${key}`, unique.get(key), normalized);
    else unique.set(key, normalized);
  }
  result.links = [...unique.values()];
  const typeKeys = {
    npc: ['level', 'factions', 'services'],
    location: ['type', 'state', 'parentId', 'environment', 'services'],
    item: ['category', 'rarity', 'value', 'stats'],
    monster: ['group'],
    quest: [
      'type',
      'state',
      'briefing',
      'completionText',
      'prerequisites',
      'requirements',
      'nextQuests',
      'timeLimitMinutes'
    ]
  };
  Object.assign(result, pick(raw, typeKeys[type] ?? []));
  if (['location', 'quest'].includes(type))
    result.recommendedLevel = take('recommendedLevel', raw.recommendedLevel, raw.levelRecommended);
  if (result.services)
    result.services = result.services.map((v) =>
      typeof v === 'string'
        ? { name: v, description: '' }
        : { name: v.name?.trim() || v.type, description: v.description ?? '' }
    );
  if (type === 'npc') {
    result.identity = pick(raw.identity ?? {}, ['race', 'gender', 'age', 'profession']);
    for (const key of ['race', 'gender', 'age', 'profession'])
      result.identity[key] = take(`identity.${key}`, raw.identity?.[key], raw[key]);
    if (raw.character || raw.t20)
      result.character = {
        ...raw.character,
        mode: take('character.mode', raw.character?.mode, raw.t20?.mode),
        providerId: take(
          'character.providerId',
          raw.character?.providerId,
          raw.t20 ? provider(raw.t20.dataType) : undefined
        ),
        externalId: take('character.externalId', raw.character?.externalId, raw.t20?.characterId),
        uri: take('character.uri', raw.character?.uri, raw.t20?.firecastUri),
        snapshot: take('character.snapshot', raw.character?.snapshot, raw.t20?.snapshot)
      };
  }
  if (type === 'location') {
    if (!result.parentId) delete result.parentId;
    const floorTag = (raw.tags ?? []).find((tag) => /^andar[-_.]/i.test(tag));
    // Only recognize the documented f<number> convention, never arbitrary ID segments.
    const idFloor = /^loc\.(?:f|andar[-_])(\d+)(?:\.|$)/i.exec(raw.id ?? '')?.[1];
    result.placement = raw.placement ?? { floor: floorTag?.replace(/^andar[-_.]/i, '') ?? idFloor };
    result.connections = (raw.connections ?? []).map((c) => ({
      ...pick(c, [
        'type',
        'direction',
        'distanceKm',
        'travelMinutes',
        'access',
        'unlockCondition',
        'visibility'
      ]),
      id:
        take('connection.id', c.id, c.connectionId) ??
        stableChildId('connection', {
          target: c.targetId ?? c.to,
          type: c.type,
          direction: c.direction
        }),
      target: take(
        'connection.target',
        target(c.target),
        c.targetId ? { type: 'location', id: c.targetId } : undefined,
        c.to ? { type: 'location', id: c.to } : undefined
      )
    }));
  }
  if (type === 'monster') {
    const t20 = raw.t20 ?? {};
    const oldSheet = {
      nd: t20.nd,
      type: t20.creatureType,
      subtype: t20.subtype,
      size: t20.size,
      combat: pick(t20, [
        'initiative',
        'perception',
        'senses',
        'defense',
        'fortitude',
        'reflex',
        'will'
      ]),
      resources: pick(t20, ['hp', 'hpMax', 'mp', 'mpMax']),
      attributes: t20.attributes ?? {},
      statsVisibility: t20.statVisibility ?? {}
    };
    const merged = {
      ...oldSheet,
      ...pick(raw.sheet ?? {}, [
        'nd',
        'type',
        'subtype',
        'size',
        'combat',
        'resources',
        'resistances',
        'attributes',
        'statsVisibility'
      ])
    };
    for (const group of ['combat', 'resources', 'attributes', 'statsVisibility']) {
      merged[group] = { ...oldSheet[group], ...raw.sheet?.[group] };
      for (const key of Object.keys(oldSheet[group] ?? {}))
        if (raw.sheet?.[group]?.[key] !== undefined)
          take(`sheet.${group}.${key}`, raw.sheet[group][key], oldSheet[group][key]);
    }
    for (const key of ['nd', 'type', 'subtype', 'size'])
      if (raw.sheet?.[key] !== undefined) take(`sheet.${key}`, raw.sheet[key], oldSheet[key]);
    result.statBlocks = raw.statBlocks ?? { ...(raw.extraStatBlocks ?? {}), [T20_CURRENT]: merged };
    result.components =
      raw.components ??
      Object.entries(COMPONENT_COLLECTIONS).flatMap(([kind, collection]) =>
        (raw[collection] ?? []).map((component) => {
          const { id, visibility = 'public', data, ...rest } = component;
          for (const key of Object.keys(rest))
            if (data?.[key] !== undefined)
              take(`components.${kind}.${id}.${key}`, data[key], rest[key]);
          return {
            id: id ?? stableChildId(kind, rest),
            kind,
            visibility,
            data: { ...rest, ...data }
          };
        })
      );
  }
  if (type === 'quest') {
    result.requirements = (raw.requirements ?? []).map((r) => ({
      ...pick(r, ['type', 'minimum', 'quantity', 'state']),
      id: take('requirement.id', r.id, r.target?.id)
    }));
    result.requirementLogic =
      take('requirementLogic', raw.requirementLogic, raw.requirementsLogic) ?? 'all';
    result.objectiveMode = take('objectiveMode', raw.objectiveMode, raw.objectivesMode) ?? 'free';
    result.startSource = target(raw.startSource);
    result.completionReceiver = target(raw.completionReceiver);
    result.objectives = (raw.objectives ?? []).map((o) => ({
      ...pick(o, ['type', 'text', 'order', 'optional', 'secret', 'visibility', 'playerEditable']),
      objectiveId: take('objectiveId', o.objectiveId, o.id),
      requiredQuantity: take('requiredQuantity', o.requiredQuantity, o.quantity) ?? 1,
      target: take(
        'objective.target',
        target(o.target),
        o.targetType && o.targetId ? { type: o.targetType, id: o.targetId } : undefined
      ),
      dependsOn: take('dependsOn', o.dependsOn, o.dependsOnObjectiveIds) ?? []
    }));
    result.rewards = (raw.rewards ?? []).map((r) => ({
      ...pick(r, ['type', 'amount', 'quantity', 'currency', 'choiceGroup', 'data']),
      rewardId: r.rewardId ?? stableChildId('reward', r),
      target: take(
        'reward.target',
        target(r.target),
        ENTITY_TYPES.includes(r.type) && r.id ? { type: r.type, id: r.id } : undefined
      ),
      ...(!ENTITY_TYPES.includes(r.type) && r.id ? { data: { ...r.data, legacyId: r.id } } : {})
    }));
  }
  const aliases = {
    npc: [
      'locations',
      'relations',
      'mainLocationId',
      'primaryLocationId',
      'currentLocationId',
      'race',
      'gender',
      'age',
      'profession',
      't20'
    ],
    location: ['levelRecommended'],
    quest: ['levelRecommended', 'requirementsLogic', 'objectivesMode'],
    monster: ['t20', 'sheet', 'extraStatBlocks', ...Object.values(COMPONENT_COLLECTIONS)]
  };
  const known = new Set([
    ...Object.keys(result),
    ...(aliases[type] ?? []),
    'imageURL',
    'imageUrl',
    'portraitUrl',
    'tokenUrl',
    'mapUrl',
    'sourceUrl',
    'title',
    'source',
    'sectionVisibility',
    'baseVisibility',
    'discoveryVisibility',
    'references'
  ]);
  const unknown = Object.fromEntries(Object.entries(raw).filter(([key]) => !known.has(key)));
  if (Object.keys(unknown).length) {
    result.extensions.legacy = { ...result.extensions.legacy, ...unknown };
    diagnostics.push({ code: 'LEGACY_EXTENSION', paths: Object.keys(unknown) });
  }
  if (preservedConflicts.length)
    result.extensions.legacyConflicts = [
      ...(result.extensions.legacyConflicts ?? []),
      ...preservedConflicts
    ];
  diagnostics.push({ code: 'MIGRATED_V1', type, id: raw.id });
  return compact(result);
}

export const isV2Entity = (raw) =>
  Boolean(
    raw &&
    ('visibility' in raw ||
      'links' in raw ||
      'statBlocks' in raw ||
      'components' in raw ||
      'media' in raw)
  );
export function normalizeEntity(type, raw, options = {}) {
  if (!entitySchemas[type]) throw new Error(`Tipo de entidade desconhecido: ${type}`);
  const input =
    options.format === '1.0' || (options.format !== '2.0' && !isV2Entity(raw))
      ? migrateV1Entity(type, raw, options)
      : raw;
  const parsed = entitySchemas[type].parse(input);
  if (type === 'location')
    parsed.connections = parsed.connections.map((c) => ({
      ...c,
      ...(c.travelMinutes == null && c.distanceKm != null
        ? { travelMinutes: Math.round((c.distanceKm * 1000) / 90) }
        : {})
    }));
  for (const [key, identity] of Object.entries({
    fields: (v) => v.key,
    links: (v) => `${v.slot}:${v.type}:${v.id}:${v.role}`,
    connections: (v) => v.id,
    components: (v) => `${v.kind}:${v.id}`,
    rewards: (v) => v.rewardId,
    stats: (v) => v.key
  }))
    parsed[key]?.sort((a, b) => identity(a).localeCompare(identity(b), 'en'));
  parsed.objectives?.sort(
    (a, b) => a.order - b.order || a.objectiveId.localeCompare(b.objectiveId, 'en')
  );
  return compact(parsed);
}

/** Read/display compatibility projection. Never persist this representation. */
export function toLegacyEntity(type, data) {
  if (!isV2Entity(data)) return { ...data };
  const result = {
    ...data,
    baseVisibility: data.visibility?.entity,
    sectionVisibility: data.visibility?.sections ?? {},
    imageURL: data.media?.image,
    portraitUrl: data.media?.portrait,
    tokenUrl: data.media?.token,
    mapUrl: data.media?.map,
    sourceUrl: data.media?.source,
    references: (data.links ?? [])
      .filter((l) => (l.slot ?? 'references') === 'references')
      .map(({ slot: _slot, ...l }) => l)
  };
  delete result.visibility;
  delete result.media;
  delete result.links;
  if (type === 'npc') {
    result.locations = (data.links ?? [])
      .filter((l) => l.slot === 'locations')
      .map(({ slot: _slot, ...l }) => l);
    result.relations = (data.links ?? [])
      .filter((l) => l.slot === 'relations')
      .map(({ slot: _slot, ...l }) => l);
    if (data.character) {
      const c = data.character;
      result.t20 = {
        mode: c.mode,
        dataType: c.providerId,
        characterId: c.externalId,
        firecastUri: c.uri,
        snapshot: c.snapshot
      };
    }
    delete result.character;
  }
  if (type === 'monster') {
    result.sheet = data.statBlocks?.[T20_CURRENT] ?? {};
    for (const [kind, key] of Object.entries(COMPONENT_COLLECTIONS))
      result[key] = (data.components ?? [])
        .filter((c) => c.kind === kind)
        .map(({ kind: _kind, ...c }) => c);
    const other = Object.fromEntries(
      Object.entries(data.statBlocks ?? {}).filter(([key]) => key !== T20_CURRENT)
    );
    if (Object.keys(other).length) result.extraStatBlocks = other;
    delete result.statBlocks;
    delete result.components;
  }
  if (type === 'location')
    result.connections = (data.connections ?? []).map(({ id, target, ...c }) => ({
      ...c,
      connectionId: id,
      targetId: target?.id
    }));
  if (type === 'quest')
    result.rewards = (data.rewards ?? []).map((r) => ({
      ...r,
      ...(r.target ? { id: r.target.id } : {})
    }));
  return compact(result);
}

export function collectEntityLinks(type, data) {
  const refs = [...(data.links ?? [])];
  if (data.parentId) refs.push({ type: 'location', id: data.parentId, role: 'parent' });
  for (const c of data.connections ?? []) refs.push({ ...c.target, role: 'connection' });
  for (const key of ['startSource', 'completionReceiver'])
    if (data[key]) refs.push({ ...data[key], role: key });
  for (const key of ['prerequisites', 'nextQuests'])
    for (const id of data[key] ?? []) refs.push({ type: 'quest', id, role: key });
  for (const key of ['objectives', 'rewards'])
    for (const entry of data[key] ?? [])
      if (entry.target) refs.push({ ...entry.target, role: key });
  for (const r of data.requirements ?? [])
    if (ENTITY_TYPES.includes(r.type) && r.id)
      refs.push({ type: r.type, id: r.id, role: 'requirement' });
  return refs.filter((r) => r.id && !(r.type === type && r.id === data.id));
}

export function validateEntityCatalog(entities, catalog = []) {
  const records = new Map([...catalog, ...entities].map((e) => [`${e.type}:${e.data.id}`, e]));
  const warnings = [];
  for (const entity of entities)
    for (const reference of collectEntityLinks(entity.type, entity.data))
      if (!records.has(`${reference.type}:${reference.id}`))
        warnings.push({
          code: 'UNRESOLVED_REFERENCE',
          sourceType: entity.type,
          sourceId: entity.data.id,
          reference
        });
  const ctx = {
    addIssue(issue) {
      throw new Error(issue.message);
    }
  };
  const locations = new Map(
    [...records.values()].filter((e) => e.type === 'location').map((e) => [e.data.id, e.data])
  );
  acyclic(
    new Set(locations.keys()),
    (id) => [locations.get(id).parentId].filter(Boolean),
    'parentId',
    ctx
  );
  const quests = new Map(
    [...records.values()].filter((e) => e.type === 'quest').map((e) => [e.data.id, e.data])
  );
  acyclic(new Set(quests.keys()), (id) => quests.get(id).prerequisites ?? [], 'prerequisites', ctx);
  return warnings;
}
