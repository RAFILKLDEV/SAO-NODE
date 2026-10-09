import {
  collectEntityLinks, fieldLabels, itemCategoryOptions, itemRarityOptions,
  locationStateOptions, locationTypeOptions, questStateOptions, questTypeOptions
} from '@sao/domain';
import { prisma } from '../lib/prisma.js';
import { getEntityForRequest } from './content.js';

const entityTypes = new Set(['location', 'npc', 'monster', 'item', 'quest']);
const categoryTypes = { monstros: 'monster', missoes: 'quest', npcs: 'npc', itens: 'item' };
const aliases = { information: 'informacoes', services: 'servicos', monsters: 'monstros', quests: 'missoes', items: 'itens', references: 'referencias' };
const entityPaths = { location: 'locations', npc: 'npcs', monster: 'monsters', item: 'items', quest: 'quests' };
const entityKey = (type, id) => `${type}:${id}`;
const entityData = (entity) => entity.data ?? entity;
const optionLabel = (options, value) => options.find((option) => option.value === value)?.label ?? value;

function normalizedCategory(value) {
  const category = String(value ?? 'informacoes').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const result = aliases[category] ?? category;
  if (!['informacoes', 'servicos', 'referencias', ...Object.keys(categoryTypes)].includes(result)) {
    throw Object.assign(new Error('Categoria do conteúdo do pin inválida.'), { code: 'INVALID_CATEGORY', statusCode: 400 });
  }
  return result;
}

function referenceUrl(request, type, id) {
  return `/campaigns/${encodeURIComponent(request.campaign.id)}/${entityPaths[type]}?selected=${encodeURIComponent(id)}`;
}

function contentSummary(request, type, entity) {
  const data = entityData(entity);
  return {
    type, id: entity.id ?? data.id, name: entity.name ?? data.name,
    subtitle: data.subtitle ?? data.title ?? null,
    imageUrl: data.media?.image ?? data.media?.portrait ?? data.imageURL ?? data.imageUrl ?? data.portraitUrl ?? null,
    referenceUrl: referenceUrl(request, type, entity.id ?? data.id)
  };
}

// Both sides of an association are useful here. Backlinks already respect the
// source entity, relation, section and target permissions in content.js.
function visibleReferences(type, entity) {
  const data = entityData(entity);
  const references = [
    ...collectEntityLinks(type, data), ...(data.references ?? []),
    ...(data.locations ?? []), ...(data.relations ?? []), ...(entity.backlinks ?? [])
  ];
  for (const key of ['mainLocationId', 'primaryLocationId', 'currentLocationId']) {
    if (data[key]) references.push({ type: 'location', id: data[key] });
  }
  const unique = new Map();
  for (const reference of references) {
    if (!reference || !entityTypes.has(reference.type) || !reference.id || reference.available === false) continue;
    unique.set(entityKey(reference.type, reference.id), reference);
  }
  return [...unique.values()];
}

function informationFor(type, entity) {
  const data = entityData(entity);
  const visibleFields = data.fields ?? entity.fields ?? [];
  const description = visibleFields.find((field) => field.key === 'description')?.value
    ?? data.description ?? data.briefing ?? visibleFields.find((field) => field.key === 'shortDescription')?.value ?? null;
  const fields = new Map();
  const add = (key, value, label = fieldLabels[key] ?? key) => {
    if (value == null || value === '') return;
    const text = Array.isArray(value) ? value.join(', ') : typeof value === 'object' ? JSON.stringify(value) : String(value);
    fields.set(key, { label, value: text });
  };
  if (type === 'location') {
    add('type', optionLabel(locationTypeOptions, data.type));
    add('state', optionLabel(locationStateOptions, data.state));
    add('environment', data.environment);
    add('recommendedLevel', data.recommendedLevel);
  } else if (type === 'npc') {
    add('characterType', { entity: 'Entidade', npc: 'NPC', player: 'Jogador' }[data.characterType] ?? data.characterType, 'Personagem');
    add('level', data.level);
    for (const [key, value] of Object.entries(data.identity ?? {})) add(key, value);
  } else if (type === 'item') {
    add('category', optionLabel(itemCategoryOptions, data.category));
    add('rarity', optionLabel(itemRarityOptions, data.rarity));
  } else if (type === 'monster') {
    add('rank', { common: 'Comum', elite: 'Elite', boss: 'Boss' }[data.rank] ?? data.rank, 'Classificação');
    add('group', data.group);
  } else if (type === 'quest') {
    add('type', optionLabel(questTypeOptions, data.type));
    add('state', optionLabel(questStateOptions, data.state));
    add('recommendedLevel', data.recommendedLevel);
  }
  for (const field of visibleFields) {
    if (field.key !== 'description') add(field.key, field.value);
  }
  return { description: description == null ? null : String(description), fields: [...fields.values()] };
}

function descendantOf(entity, regionId, authorizedLocations) {
  let parentId = entityData(entity).parentId;
  const visited = new Set([entity.id]);
  while (parentId && !visited.has(parentId)) {
    if (parentId === regionId) return true;
    visited.add(parentId);
    const parent = authorizedLocations.get(parentId);
    if (!parent) return false;
    parentId = entityData(parent).parentId;
  }
  return false;
}

/** Compact popup projection; never reads an unfiltered catalog document. */
export async function buildMapPinContent({ request, pin, category: requestedCategory }) {
  const category = normalizedCategory(requestedCategory);
  const type = pin.entityType ?? 'location';
  const id = pin.entityId ?? pin.locationId;
  if (!entityTypes.has(type) || !id) return null;
  const cache = new Map();
  const load = async (entityType, entityId, backlinks = false) => {
    const key = entityKey(entityType, entityId);
    if (!cache.has(key)) cache.set(key, getEntityForRequest({ request, type: entityType, domainId: entityId, options: { backlinks, format: '2' } }));
    return cache.get(key);
  };
  const root = await load(type, id, true);
  if (!root) return null;
  const sources = [{ type, entity: root }];
  if (type === 'location' && entityData(root).type === 'region') {
    const rows = await prisma.entity.findMany({ where: { campaignId: request.campaign.id, type: 'location', deletedAt: null }, select: { domainId: true } });
    const locations = (await Promise.all(rows.map((row) => load('location', row.domainId, true)))).filter(Boolean);
    const authorizedLocations = new Map(locations.map((location) => [location.id, location]));
    for (const location of locations) {
      if (location.id !== id && descendantOf(location, id, authorizedLocations)) sources.push({ type: 'location', entity: location });
    }
  }
  const result = { pinId: pin.id, category, items: [] };
  if (category === 'informacoes') {
    result.information = informationFor(type, root);
    result.items = sources.map((source) => contentSummary(request, source.type, source.entity));
    return result;
  }
  const references = new Map();
  for (const source of sources) {
    for (const reference of visibleReferences(source.type, source.entity)) {
      if (entityKey(reference.type, reference.id) !== entityKey(type, id)) references.set(entityKey(reference.type, reference.id), reference);
    }
  }
  const related = (await Promise.all([...references.values()]
    .filter((reference) => category === 'servicos' ? reference.type === 'npc' : !categoryTypes[category] || reference.type === categoryTypes[category])
    .map(async (reference) => ({ type: reference.type, entity: await load(reference.type, reference.id) })))).filter((source) => source.entity);
  if (category === 'servicos') {
    const serviceSources = new Map([...sources, ...related.filter((source) => source.type === 'npc')].map((source) => [entityKey(source.type, source.entity.id), source]));
    const services = new Map();
    for (const source of serviceSources.values()) {
      const summary = contentSummary(request, source.type, source.entity);
      (entityData(source.entity).services ?? []).forEach((service, index) => {
        const name = typeof service === 'string' ? service : service.name ?? service.title ?? service.label;
        if (!name) return;
        const subtitle = typeof service === 'string' ? null : service.description ?? service.summary ?? null;
        const key = `${source.type}:${summary.id}:${name}:${subtitle ?? ''}`;
        services.set(key, { type: 'service', id: `${summary.id}:service:${index}`, name, subtitle, imageUrl: summary.imageUrl, referenceUrl: summary.referenceUrl, sourceType: source.type, sourceId: summary.id, sourceName: summary.name });
      });
    }
    result.items = [...services.values()];
  } else {
    result.items = related.map((source) => contentSummary(request, source.type, source.entity));
  }
  result.items.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { numeric: true }) || a.id.localeCompare(b.id));
  return result;
}
