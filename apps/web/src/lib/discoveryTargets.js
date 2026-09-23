import { fieldLabels, sectionLabels } from '@sao/domain';

export const baseDiscoveryTargets = [
  { kind: 'entity', key: 'existence', label: 'Existência do registro' },
  { kind: 'field', key: 'section.basic', label: 'Informações básicas' },
  { kind: 'field', key: 'imageURL', label: 'Foto de perfil' }
];
export const discoveryTargetKey = (target) => `${target.kind}:${target.key}`;

const fieldTarget = (key) => ({ kind: 'field', key, label: fieldLabels[key] ?? sectionLabels[key.replace('section.', '')] ?? key });

export const npcDiscoveryGroups = [
  { key: 'presentation', label: 'Apresentação', description: 'Resumo, descrição, aparência e identidade', keys: ['shortDescription', 'description', 'appearance', 'section.identity'] },
  { key: 'personality-history', label: 'Personalidade e história', description: 'Personalidade e história', keys: ['personality', 'history'] },
  { key: 'connections', label: 'Vínculos', description: 'Locais, relações e referências', keys: ['section.locations', 'section.relations', 'section.references'] },
  { key: 'services', label: 'Serviços', description: 'Seção de serviços', keys: ['section.services'] },
  { key: 'sheets', label: 'Ficha T20 e fichas adicionais', description: 'Ficha T20 e fichas adicionais', keys: ['section.t20', 'section.extraStatBlocks'] }
];

// Groups are UI-only: persist the existing field keys, including empty fields.
export function npcDiscoveryTargets(items) {
  const groups = npcDiscoveryGroups.map(({ keys, ...group }) => ({ ...group, kind: 'group', targets: keys.map(fieldTarget) }));
  const separate = [fieldTarget('gmNotes'), fieldTarget('section.additional'), { ...fieldTarget('section.extensions'), label: 'Extensões' }];
  const knownKeys = new Set(expandDiscoveryTargets([...baseDiscoveryTargets, ...groups, ...separate]).map(discoveryTargetKey));
  const customKeys = new Set(items.flatMap((item) => (item.fields ?? []).map((field) => field.key)));
  return [...baseDiscoveryTargets, ...groups, ...separate, ...[...customKeys].map(fieldTarget).filter((target) => !knownKeys.has(discoveryTargetKey(target)))];
}

export function expandDiscoveryTargets(targets) {
  const fields = targets.flatMap((target) => target.kind === 'group' ? target.targets : [target]);
  return [...new Map(fields.map((target) => [discoveryTargetKey(target), target])).values()];
}

export function availableDiscoveryTargets(targets, entities, selectedEntities, entityType, entityId) {
  const selectedIds = new Set(entities.filter((entry) => selectedEntities.has(`${entry.entityType ?? entityType}:${entry.entityId ?? entityId}`)).map((entry) => entry.entityId ?? entityId));
  return targets.filter((target) => !target.availableEntityIds || target.availableEntityIds.some((id) => selectedIds.has(id)));
}

export function toggleSelection(current, keys) {
  const allSelected = keys.length > 0 && keys.every((key) => current.has(key));
  const next = new Set(current);
  for (const key of keys) allSelected ? next.delete(key) : next.add(key);
  return next;
}
