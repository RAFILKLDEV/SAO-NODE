import { XMLBuilder, XMLParser, XMLValidator } from 'fast-xml-parser';
import { z } from 'zod';
import { entitySchemas } from '@sao/domain';

const ROOT_VERSION = '1.0';
const MAX_DEFAULT = 5 * 1024 * 1024;
const entityTypes = ['npc', 'location', 'item', 'monster', 'quest'];
const containers = { npc: 'npcs', location: 'locations', item: 'items', monster: 'monsters', quest: 'quests' };

const packSchema = z.object({
  schemaVersion: z.literal(ROOT_VERSION),
  packId: z.string().min(1),
  name: z.string().min(1),
  language: z.string().default('pt-BR'),
  presentContainers: z.array(z.enum(entityTypes)),
  entities: z.array(z.object({ type: z.enum(entityTypes), data: z.record(z.string(), z.unknown()) }))
});

function arr(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function attributes(node = {}) {
  return Object.fromEntries(
    Object.entries(node)
      .filter(([key]) => key.startsWith('@_'))
      .map(([key, value]) => [key.slice(2), value])
  );
}

function text(node) {
  if (node == null) return '';
  if (typeof node === 'string' || typeof node === 'number' || typeof node === 'boolean') return String(node);
  return String(node['#text'] ?? '');
}

function parseJsonValue(value) {
  if (value == null || value === '') return value;
  try {
    return JSON.parse(String(value));
  } catch {
    return String(value);
  }
}

function parseJsonNode(node, fallback = undefined) {
  const raw = text(node?.dataJson ?? node);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function parseBoolean(value, fallback = false) {
  if (value == null) return fallback;
  return String(value) === 'true';
}

function parseFields(node) {
  return arr(node?.fields?.field).map((field) => ({
    key: field['@_key'],
    visibility: field['@_visibility'] ?? 'public',
    value: text(field)
  }));
}

function parseTags(node) {
  return arr(node?.tags?.tag).map(text).filter(Boolean);
}

function parseReferences(node) {
  return arr(node?.references?.ref).map((ref) => ({
    type: ref['@_type'],
    id: ref['@_id'],
    role: ref['@_role'] ?? 'related',
    ...(ref['@_chance'] != null ? { chance: Number(ref['@_chance']) } : {})
  }));
}

function parseReferenceNode(node) {
  if (!node) return undefined;
  return {
    type: node['@_type'],
    id: node['@_id'],
    role: node['@_role'] ?? 'related',
    ...(node['@_chance'] != null ? { chance: Number(node['@_chance']) } : {})
  };
}

function parseObjectives(node) {
  return arr(node?.objectives?.objective).map((objective, index) => ({
    objectiveId: objective['@_objectiveId'],
    type: objective['@_type'] ?? 'custom',
    text: objective['@_text'] ?? text(objective?.text),
    order: Number(objective['@_order'] ?? index),
    requiredQuantity: Number(objective['@_requiredQuantity'] ?? 1),
    optional: parseBoolean(objective['@_optional']),
    secret: parseBoolean(objective['@_secret']),
    visibility: objective['@_visibility'] ?? 'public',
    playerEditable: parseBoolean(objective['@_playerEditable']),
    ...(objective.target ? { target: { type: objective.target['@_type'], id: objective.target['@_id'] } } : {}),
    dependsOn: arr(objective?.dependsOn?.objectiveId).map(text).filter(Boolean)
  }));
}

function parseRewards(node) {
  return arr(node?.rewards?.reward).map((reward) => {
    const data = parseJsonNode(reward, {});
    return {
      ...data,
      type: reward['@_type'] ?? data?.type ?? 'custom',
      ...(reward['@_amount'] != null ? { amount: Number(reward['@_amount']) } : {}),
      ...(reward['@_currency'] ? { currency: reward['@_currency'] } : {}),
      ...(reward['@_choiceGroup'] ? { choiceGroup: reward['@_choiceGroup'] } : {}),
      ...(reward.target ? { target: parseReferenceNode(reward.target) } : {})
    };
  });
}

function parseMonsterSheet(node) {
  if (!node) return {};
  const json = parseJsonNode(node);
  if (json && typeof json === 'object' && !Array.isArray(json)) return json;

  const attrs = attributes(node);
  const sheet = {
    ...(attrs.nd != null ? { nd: parseJsonValue(attrs.nd) } : {}),
    ...(attrs.type ? { type: attrs.type } : {}),
    ...(attrs.subtype ? { subtype: attrs.subtype } : {}),
    ...(attrs.size ? { size: attrs.size } : {}),
    combat: {},
    resources: {},
    resistances: {},
    attributes: {},
    statsVisibility: {}
  };

  for (const moduleName of ['combat', 'resources', 'resistances', 'attributes']) {
    const moduleNode = node[moduleName];
    if (!moduleNode) continue;
    if (moduleNode['@_visibility']) sheet.statsVisibility[moduleName] = moduleNode['@_visibility'];
    for (const stat of arr(moduleNode.stat)) {
      const key = stat['@_key'];
      if (!key) continue;
      sheet[moduleName][key] = parseJsonValue(stat['@_valueJson'] ?? stat['@_value'] ?? text(stat));
      if (stat['@_visibility']) sheet.statsVisibility[`${moduleName}.${key}`] = stat['@_visibility'];
    }
  }
  for (const stat of arr(node?.statVisibility?.stat)) {
    if (stat['@_key'] && stat['@_visibility']) sheet.statsVisibility[stat['@_key']] = stat['@_visibility'];
  }
  return sheet;
}

function parseMonsterComponents(node, container, element) {
  return arr(node?.[container]?.[element]).map((entry) => {
    const attrs = attributes(entry);
    const fallbackData = Object.fromEntries(
      Object.entries(attrs).filter(([key]) => !['id', 'visibility'].includes(key))
    );
    const parsedJson = parseJsonNode(entry);
    const data = parsedJson && typeof parsedJson === 'object'
      ? parsedJson
      : { ...fallbackData, ...(text(entry) ? { text: text(entry) } : {}) };
    return {
      id: entry['@_id'],
      visibility: entry['@_visibility'] ?? 'public',
      data
    };
  });
}

function common(node) {
  const attrs = attributes(node);
  return {
    id: attrs.id,
    name: attrs.name,
    active: String(attrs.active ?? 'true') !== 'false',
    tags: parseTags(node),
    fields: parseFields(node),
    references: parseReferences(node)
  };
}

function parseEntity(type, node) {
  const attrs = attributes(node);
  const base = common(node);
  if (type === 'npc') {
    return {
      ...base,
      title: attrs.title,
      race: attrs.race,
      gender: attrs.gender,
      age: attrs.age,
      profession: attrs.profession,
      ...(attrs.level != null ? { level: Number(attrs.level) } : {}),
      imageUrl: node?.image?.['@_url'],
      tokenUrl: node?.token?.['@_url'],
      portraitUrl: node?.portrait?.['@_url'],
      sourceUrl: node?.source?.['@_url'],
      factions: arr(node?.factions?.faction).map(text).filter(Boolean),
      services: arr(node?.services?.service).map(text).filter(Boolean),
      primaryLocationId: node?.primaryLocation?.['@_id'],
      currentLocationId: node?.currentLocation?.['@_id'],
      ...(node?.t20 ? { t20: parseJsonNode(node.t20, {}) } : {})
    };
  }
  if (type === 'location') {
    return {
      ...base,
      type: attrs.type ?? 'region',
      state: attrs.state,
      parentId: attrs.parentId,
      environment: attrs.environment,
      ...(attrs.recommendedLevel != null ? { recommendedLevel: Number(attrs.recommendedLevel) } : {}),
      imageUrl: node?.image?.['@_url'],
      mapUrl: node?.map?.['@_url'],
      services: arr(node?.services?.service).map(text).filter(Boolean),
      connections: arr(node?.connections?.connection).map((connection, index) => ({
        connectionId: connection['@_connectionId'] ?? `connection-${index + 1}`,
        targetId: connection['@_targetId'],
        direction: connection['@_direction'],
        ...(connection['@_distanceKm'] != null ? { distanceKm: Number(connection['@_distanceKm']) } : {}),
        ...(connection['@_travelMinutes'] != null ? { travelMinutes: Number(connection['@_travelMinutes']) } : {}),
        access: connection['@_access'] ?? 'public',
        unlockCondition: connection['@_unlockCondition'],
        visibility: connection['@_visibility'] ?? 'public'
      }))
    };
  }
  if (type === 'item') {
    return {
      ...base,
      category: attrs.category ?? 'misc',
      rarity: attrs.rarity ?? 'common',
      imageUrl: node?.image?.['@_url'],
      ...(node?.value ? { value: { amount: Number(node.value['@_amount']), currency: node.value['@_currency'] } } : {}),
      stats: arr(node?.stats?.stat).map((stat) => ({
        key: stat['@_key'],
        value: parseJsonValue(stat['@_valueJson'] ?? stat['@_value']),
        operation: stat['@_operation'] ?? 'set'
      }))
    };
  }
  if (type === 'monster') {
    return {
      ...base,
      group: attrs.group,
      imageUrl: node?.image?.['@_url'],
      sheet: parseMonsterSheet(node?.sheet),
      movements: parseMonsterComponents(node, 'movements', 'movement'),
      attacks: parseMonsterComponents(node, 'attacks', 'attack'),
      abilities: parseMonsterComponents(node, 'abilities', 'ability'),
      skills: parseMonsterComponents(node, 'skills', 'skill'),
      traits: parseMonsterComponents(node, 'traits', 'trait')
    };
  }
  return {
    ...base,
    subtitle: attrs.subtitle,
    type: attrs.type ?? 'side',
    state: attrs.state ?? 'available',
    briefing: text(node?.briefing) || undefined,
    completionText: text(node?.completionText) || undefined,
    ...(attrs.recommendedLevel != null ? { recommendedLevel: Number(attrs.recommendedLevel) } : {}),
    ...(attrs.timeLimitMinutes != null ? { timeLimitMinutes: Number(attrs.timeLimitMinutes) } : {}),
    startSource: parseReferenceNode(node?.startSource),
    completionReceiver: parseReferenceNode(node?.completionReceiver),
    objectiveMode: attrs.objectiveMode ?? 'free',
    requirementLogic: attrs.requirementLogic ?? 'all',
    objectives: parseObjectives(node),
    rewards: parseRewards(node),
    prerequisites: arr(node?.prerequisites?.questId).map(text).filter(Boolean),
    nextQuests: arr(node?.nextQuests?.questId).map(text).filter(Boolean)
  };
}

export async function validateAgainstXsd(xml, xsd, fileName = 'package.xml') {
  const module = await import('xmllint-wasm');
  const validateXML = module.validateXML ?? module.default?.validateXML ?? module.default;
  if (typeof validateXML !== 'function') throw new Error('xmllint-wasm validateXML API not available');
  const result = await validateXML({
    xml: [{ fileName, contents: xml }],
    schema: [{ fileName: 'saoData-v1.xsd', contents: xsd }]
  });
  if (result?.valid === false || result?.errors?.length) {
    const message = result.errors?.map((error) => error.message ?? String(error)).join('; ') || 'XSD validation failed';
    throw new Error(message);
  }
  return true;
}

export async function parseSaoData(xml, options = {}) {
  const maxBytes = options.maxBytes ?? MAX_DEFAULT;
  if (Buffer.byteLength(xml, 'utf8') > maxBytes) throw new Error('XML exceeds maximum size');
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('DTD and entities are not allowed');
  const wellFormed = XMLValidator.validate(xml);
  if (wellFormed !== true) throw new Error(`Malformed XML: ${wellFormed.err?.msg ?? 'unknown error'}`);
  if (options.xsd) await validateAgainstXsd(xml, options.xsd, options.fileName);

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    parseTagValue: false,
    parseAttributeValue: false,
    // DTD/ENTITY declarations are rejected above; built-in XML entities still need decoding.
    processEntities: true,
    trimValues: false
  });
  const root = parser.parse(xml)?.saoData;
  if (!root) throw new Error('Missing saoData root');
  const attrs = attributes(root);
  if (attrs.schemaVersion !== ROOT_VERSION) throw new Error(`Unsupported schemaVersion: ${attrs.schemaVersion}`);
  if (!attrs.packId) throw new Error('packId is required');

  const presentContainers = [];
  const entities = [];
  for (const type of entityTypes) {
    const container = containers[type];
    if (root[container] == null) continue;
    presentContainers.push(type);
    for (const node of arr(root[container][type])) {
      const data = parseEntity(type, node);
      const parsed = entitySchemas[type].parse(data);
      entities.push({ type, data: parsed });
    }
  }

  const ids = new Set();
  for (const entity of entities) {
    const key = `${entity.type}:${entity.data.id}`;
    if (ids.has(key)) throw new Error(`Duplicate ID: ${key}`);
    ids.add(key);
  }

  const pack = packSchema.parse({
    schemaVersion: attrs.schemaVersion,
    packId: attrs.packId,
    name: attrs.name ?? attrs.packId,
    language: attrs.language ?? 'pt-BR',
    presentContainers,
    entities
  });

  const known = new Set(entities.map((entity) => `${entity.type}:${entity.data.id}`));
  const warnings = [];
  for (const entity of entities) {
    for (const reference of entity.data.references ?? []) {
      if (!known.has(`${reference.type}:${reference.id}`)) {
        warnings.push({
          code: 'UNRESOLVED_REFERENCE',
          sourceType: entity.type,
          sourceId: entity.data.id,
          reference
        });
      }
    }
  }
  return { pack, warnings };
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}

export function buildDiff(existing, incomingPack) {
  const current = new Map(existing.map((entity) => [`${entity.type}:${entity.id}`, entity]));
  const incoming = new Map(incomingPack.entities.map((entity) => [`${entity.type}:${entity.data.id}`, entity]));
  const diff = [];

  for (const [key, entity] of incoming) {
    const old = current.get(key);
    if (!old) {
      diff.push({ key, type: entity.type, id: entity.data.id, status: 'NEW', selected: true, before: null, after: entity.data });
      continue;
    }
    const before = stable(old.data ?? old);
    const after = stable(entity.data);
    const equal = JSON.stringify(before) === JSON.stringify(after);
    diff.push({
      key,
      type: entity.type,
      id: entity.data.id,
      status: equal ? 'EQUAL' : 'ALTERED',
      selected: !equal,
      before,
      after
    });
  }

  for (const [key, old] of current) {
    if (incoming.has(key) || !incomingPack.presentContainers.includes(old.type)) continue;
    diff.push({
      key,
      type: old.type,
      id: old.id,
      status: 'REMOVED_FROM_XML',
      selected: false,
      before: old.data ?? old,
      after: null
    });
  }
  return diff.sort((a, b) => a.key.localeCompare(b.key));
}

function xmlReference(reference) {
  if (!reference) return undefined;
  return {
    '@_type': reference.type,
    '@_id': reference.id,
    '@_role': reference.role ?? 'related',
    ...(reference.chance != null ? { '@_chance': String(reference.chance) } : {})
  };
}

function xmlJsonNode(data) {
  return { dataJson: { '#text': JSON.stringify(data ?? {}) } };
}

function xmlMonsterSheet(sheet = {}) {
  const node = {
    ...(sheet.nd != null ? { '@_nd': String(sheet.nd) } : {}),
    ...(sheet.type ? { '@_type': sheet.type } : {}),
    ...(sheet.subtype ? { '@_subtype': sheet.subtype } : {}),
    ...(sheet.size ? { '@_size': sheet.size } : {})
  };
  const visibility = sheet.statsVisibility ?? {};
  for (const moduleName of ['combat', 'resources', 'resistances', 'attributes']) {
    const entries = Object.entries(sheet[moduleName] ?? {}).sort(([a], [b]) => a.localeCompare(b));
    if (!entries.length && !visibility[moduleName]) continue;
    node[moduleName] = {
      ...(visibility[moduleName] ? { '@_visibility': visibility[moduleName] } : {}),
      ...(entries.length
        ? {
            stat: entries.map(([key, value]) => ({
              '@_key': key,
              '@_valueJson': JSON.stringify(value),
              ...(visibility[`${moduleName}.${key}`] ? { '@_visibility': visibility[`${moduleName}.${key}`] } : {})
            }))
          }
        : {})
    };
  }
  const simpleVisibility = Object.entries(visibility)
    .filter(([key]) => !key.includes('.') && !['combat', 'resources', 'resistances', 'attributes'].includes(key))
    .sort(([a], [b]) => a.localeCompare(b));
  if (simpleVisibility.length) {
    node.statVisibility = {
      stat: simpleVisibility.map(([key, value]) => ({ '@_key': key, '@_visibility': value }))
    };
  }
  return node;
}

function xmlMonsterComponents(entries = []) {
  return [...entries]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((entry) => ({
      '@_id': entry.id,
      '@_visibility': entry.visibility,
      ...xmlJsonNode(entry.data)
    }));
}

function toXmlEntity(type, data) {
  const node = {
    '@_id': data.id,
    '@_name': data.name,
    '@_active': String(data.active !== false)
  };
  const simpleAttributes = {
    npc: ['title', 'race', 'gender', 'age', 'profession', 'level'],
    location: ['type', 'state', 'parentId', 'environment', 'recommendedLevel'],
    item: ['category', 'rarity'],
    monster: ['group'],
    quest: ['subtitle', 'type', 'state', 'recommendedLevel', 'objectiveMode', 'requirementLogic', 'timeLimitMinutes']
  }[type];
  for (const key of simpleAttributes) if (data[key] != null) node[`@_${key}`] = String(data[key]);

  if (data.tags?.length) node.tags = { tag: [...data.tags].sort() };
  if (data.fields?.length) {
    node.fields = {
      field: [...data.fields]
        .sort((a, b) => a.key.localeCompare(b.key))
        .map((field) => ({ '@_key': field.key, '@_visibility': field.visibility, '#text': field.value }))
    };
  }
  if (data.references?.length) {
    node.references = {
      ref: [...data.references]
        .sort((a, b) => `${a.type}:${a.id}:${a.role}`.localeCompare(`${b.type}:${b.id}:${b.role}`))
        .map(xmlReference)
    };
  }
  if (data.imageUrl) node.image = { '@_url': data.imageUrl };

  if (type === 'npc') {
    if (data.tokenUrl) node.token = { '@_url': data.tokenUrl };
    if (data.portraitUrl) node.portrait = { '@_url': data.portraitUrl };
    if (data.sourceUrl) node.source = { '@_url': data.sourceUrl };
    if (data.factions?.length) node.factions = { faction: [...data.factions].sort() };
    if (data.services?.length) node.services = { service: [...data.services].sort() };
    if (data.primaryLocationId) node.primaryLocation = { '@_id': data.primaryLocationId };
    if (data.currentLocationId) node.currentLocation = { '@_id': data.currentLocationId };
    if (data.t20 != null) node.t20 = xmlJsonNode(data.t20);
  }

  if (type === 'location') {
    if (data.mapUrl) node.map = { '@_url': data.mapUrl };
    if (data.services?.length) node.services = { service: [...data.services].sort() };
    if (data.connections?.length) {
      node.connections = {
        connection: [...data.connections]
          .sort((a, b) => a.connectionId.localeCompare(b.connectionId))
          .map((connection) => ({
            '@_connectionId': connection.connectionId,
            '@_targetId': connection.targetId,
            ...(connection.direction ? { '@_direction': connection.direction } : {}),
            ...(connection.distanceKm != null ? { '@_distanceKm': String(connection.distanceKm) } : {}),
            ...(connection.travelMinutes != null ? { '@_travelMinutes': String(connection.travelMinutes) } : {}),
            '@_access': connection.access,
            '@_visibility': connection.visibility,
            ...(connection.unlockCondition ? { '@_unlockCondition': connection.unlockCondition } : {})
          }))
      };
    }
  }

  if (type === 'item') {
    if (data.value) node.value = { '@_amount': String(data.value.amount), '@_currency': data.value.currency };
    if (data.stats?.length) {
      node.stats = {
        stat: [...data.stats]
          .sort((a, b) => a.key.localeCompare(b.key))
          .map((stat) => ({
            '@_key': stat.key,
            '@_valueJson': JSON.stringify(stat.value),
            '@_operation': stat.operation
          }))
      };
    }
  }

  if (type === 'monster') {
    node.sheet = xmlMonsterSheet(data.sheet ?? {});
    if (data.movements?.length) node.movements = { movement: xmlMonsterComponents(data.movements) };
    if (data.attacks?.length) node.attacks = { attack: xmlMonsterComponents(data.attacks) };
    if (data.abilities?.length) node.abilities = { ability: xmlMonsterComponents(data.abilities) };
    if (data.skills?.length) node.skills = { skill: xmlMonsterComponents(data.skills) };
    if (data.traits?.length) node.traits = { trait: xmlMonsterComponents(data.traits) };
  }

  if (type === 'quest') {
    if (data.briefing) node.briefing = { '#text': data.briefing };
    if (data.completionText) node.completionText = { '#text': data.completionText };
    if (data.startSource) node.startSource = xmlReference(data.startSource);
    if (data.completionReceiver) node.completionReceiver = xmlReference(data.completionReceiver);
    if (data.prerequisites?.length) node.prerequisites = { questId: [...data.prerequisites].sort() };
    if (data.nextQuests?.length) node.nextQuests = { questId: [...data.nextQuests].sort() };
    if (data.objectives?.length) {
      node.objectives = {
        objective: [...data.objectives]
          .sort((a, b) => a.order - b.order || a.objectiveId.localeCompare(b.objectiveId))
          .map((objective) => ({
            '@_objectiveId': objective.objectiveId,
            '@_type': objective.type,
            '@_text': objective.text,
            '@_order': String(objective.order),
            '@_requiredQuantity': String(objective.requiredQuantity),
            '@_optional': String(objective.optional),
            '@_secret': String(objective.secret),
            '@_visibility': objective.visibility,
            '@_playerEditable': String(objective.playerEditable),
            ...(objective.target ? { target: { '@_type': objective.target.type, '@_id': objective.target.id } } : {}),
            ...(objective.dependsOn?.length ? { dependsOn: { objectiveId: objective.dependsOn } } : {})
          }))
      };
    }
    if (data.rewards?.length) {
      node.rewards = {
        reward: data.rewards.map((reward) => ({
          '@_type': reward.type,
          ...(reward.amount != null ? { '@_amount': String(reward.amount) } : {}),
          ...(reward.currency ? { '@_currency': reward.currency } : {}),
          ...(reward.choiceGroup ? { '@_choiceGroup': reward.choiceGroup } : {}),
          ...(reward.target ? { target: xmlReference(reward.target) } : {}),
          ...xmlJsonNode(reward)
        }))
      };
    }
  }
  return node;
}

export function exportSaoData({ packId, name, language = 'pt-BR', entities }) {
  const root = {
    '@_schemaVersion': ROOT_VERSION,
    '@_packId': packId,
    '@_name': name,
    '@_language': language
  };
  for (const type of entityTypes) {
    const items = entities
      .filter((entity) => entity.type === type)
      .sort((a, b) => a.data.id.localeCompare(b.data.id));
    if (items.length) root[containers[type]] = { [type]: items.map((entity) => toXmlEntity(type, entity.data)) };
  }
  const builder = new XMLBuilder({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    format: true,
    suppressEmptyNode: true,
    suppressBooleanAttributes: false,
    processEntities: true
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n${builder.build({ saoData: root })}`;
}

export function convertLegacyJson(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Legacy JSON root must be an object');
  const entities = [];
  for (const type of entityTypes) {
    const container = containers[type];
    for (const raw of arr(input[container])) {
      const parsed = entitySchemas[type].parse(raw);
      entities.push({ type, data: parsed });
    }
  }
  return {
    schemaVersion: ROOT_VERSION,
    packId: input.packId ?? 'legacy-json.import',
    name: input.name ?? 'Legacy JSON Import',
    language: input.language ?? 'pt-BR',
    presentContainers: entityTypes.filter((type) => Object.prototype.hasOwnProperty.call(input, containers[type])),
    entities
  };
}
