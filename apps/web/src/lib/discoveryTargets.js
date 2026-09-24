import { fieldLabels, sectionLabels } from '@sao/domain';

export const baseDiscoveryTargets = [
  { kind: 'entity', key: 'existence', label: 'Existência do registro' },
  { kind: 'field', key: 'section.basic', label: 'Informações básicas' },
  { kind: 'field', key: 'imageURL', label: 'Foto de perfil' }
];
export const discoveryTargetKey = (target) => `${target.kind}:${target.key}`;

const fieldTarget = (key) => ({ kind: 'field', key, label: fieldLabels[key] ?? sectionLabels[key.replace('section.', '')] ?? key });

const locationFieldCategories = [
  { key: 'identity', label: 'Identidade', keys: ['shortDescription', 'description', 'section.basic'] },
  { key: 'atmosphere', label: 'Ambiente e história', keys: ['environment', 'history'] },
  { key: 'purpose', label: 'Propósito do local', keys: ['funcaoPrincipal', 'designPurpose', 'baseMecanica'] },
  { key: 'hierarchy', label: 'Hierarquia', keys: ['andar', 'parentId'] },
  { key: 'map', label: 'Mapa e posição', keys: ['numeroNoMapa', 'posicaoNoMapa'] },
  { key: 'organization', label: 'Organização da área', keys: ['organizacao', 'organizacaoUrbana', 'estruturaDaZona'] },
  { key: 'movement', label: 'Movimentação e conexões', keys: ['viasUrbanas', 'deslocamentoPadrao', 'section.connections', 'section.references'] },
  { key: 'services', label: 'Serviços e economia', keys: ['section.services', 'catalogoEsperado', 'services', 'commercialServices', 'guildServices', 'propertyServices', 'economyRule', 'economyPurpose'] },
  { key: 'rest', label: 'Descanso e hospedagem', keys: ['descanso', 'restRequirement', 'pioneerLodging', 'commonLodging', 'comfortableLodging', 'luxuryLodging', 'availableRooms', 'roomManagement'] },
  { key: 'encounters', label: 'Encontros e desafios', keys: ['dificuldade', 'encontrosEsperados', 'levelRecommended', 'recommendedLevel', 'spawnPoint', 'duelArea', 'trainingDummies', 'missionBoard'] },
  { key: 'additional', label: 'Notas adicionais', keys: ['gmNotes', 'section.additional', 'section.extensions', 'notasDeAdaptacao'] }
];

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

export const categorizedDiscoveryTypes = ['location', 'monster', 'item'];

export function categorizedDiscoveryTargets(type, items = []) {
  const group = (key, label, keys, kind = 'field') => ({
    kind: 'group', key, label,
    targets: keys.map((targetKey) => ({ kind, key: targetKey, label: fieldLabels[targetKey] ?? sectionLabels[targetKey.replace('section.', '')] ?? targetKey }))
  });
  let groups;
  if (type === 'location') {
    groups = locationFieldCategories.map((category) => group(category.key, category.label, category.keys));
  } else if (type === 'item') {
    groups = [
      group('identity', 'Identidade do item', ['shortDescription', 'description', 'section.basic']),
      group('economy', 'Uso e economia', ['section.stats']),
      group('references', 'Referências', ['section.references'])
    ];
  } else {
    groups = [group('identity', 'Identidade da criatura', ['shortDescription', 'description', 'section.basic'])];
    groups.push(group('classification', 'Classificação e ND', ['basic', 'nd', 'type', 'subtype', 'size'], 'monster_stat'));
    for (const [key, label] of [['combat', 'Combate'], ['resources', 'Recursos'], ['resistances', 'Resistências'], ['attributes', 'Atributos']]) groups.push(group(key, label, [key], 'monster_stat'));
    groups.push(group('t20', 'Ficha T20', ['section.t20']), group('references', 'Referências e drops', ['section.references']));
  }
  const fixed = [...baseDiscoveryTargets, ...groups];
  const known = new Set(expandDiscoveryTargets(fixed).map(discoveryTargetKey));
  const custom = new Set(items.flatMap((item) => (item.fields ?? []).map((field) => field.key)));
  const additional = [fieldTarget('section.additional'), fieldTarget('section.extensions'), fieldTarget('gmNotes'), ...[...custom].map(fieldTarget)]
    .filter((target, index, targets) => !known.has(discoveryTargetKey(target)) && targets.findIndex((candidate) => discoveryTargetKey(candidate) === discoveryTargetKey(target)) === index);
  if (type !== 'location') return [...fixed, { kind: 'group', key: 'additional', label: 'Dados adicionais do cenário', targets: additional }];

  const categorized = locationFieldCategories.map((category) => ({
    kind: 'group',
    key: `location.${category.key}`,
    label: category.label,
    targets: []
  }));
  const categoryByKey = new Map(locationFieldCategories.flatMap((category) => category.keys.map((key) => [key, category.key])));
  const other = [];
  for (const target of additional) {
    const category = categorized.find((candidate) => candidate.key === `location.${categoryByKey.get(target.key)}`);
    if (category) category.targets.push(target);
    else other.push(target);
  }
  if (other.length) categorized.push({ kind: 'group', key: 'location.other', label: 'Outros dados do cenário', targets: other });
  return [...fixed, ...categorized.filter((category) => category.targets.length)];
}

export function questDiscoveryTargets(entity = {}) {
  const fields = [
    ...(entity.fields ?? []).map((field) => fieldTarget(field.key)),
    ...Object.keys(entity.sectionVisibility ?? {}).map((section) => fieldTarget(`section.${section}`))
  ];
  const objectives = (entity.objectives ?? []).map((objective) => ({ kind: 'objective', key: objective.objectiveId, label: objective.text || 'Objetivo sem nome' }));
  const baseKeys = new Set(baseDiscoveryTargets.map(discoveryTargetKey));
  const uniqueFields = [...new Map(fields.map((target) => [discoveryTargetKey(target), target])).values()].filter((target) => !baseKeys.has(discoveryTargetKey(target)));
  const byKey = (keys) => uniqueFields.filter((target) => keys.includes(target.key));
  const groups = [
    { key: 'quest.details', label: 'Detalhes da missão', targets: byKey(['introduction', 'completion']) },
    { key: 'quest.requirements', label: 'Requisitos', targets: byKey(['section.requirements']) },
    { key: 'quest.flow', label: 'Fluxo da missão', targets: byKey(['section.flow']) },
    { key: 'quest.objectives', label: 'Objetivos', targets: objectives },
    { key: 'quest.rewards', label: 'Recompensas', targets: byKey(['section.rewards']) },
    { key: 'quest.references', label: 'Referências', targets: byKey(['section.references']) }
  ].filter((group) => group.targets.length).map((group) => ({ ...group, kind: 'group' }));
  const groupedKeys = new Set(groups.flatMap((group) => group.targets.map(discoveryTargetKey)));
  return [...baseDiscoveryTargets, ...groups, ...uniqueFields.filter((target) => !groupedKeys.has(discoveryTargetKey(target)))];
}

export function expandDiscoveryTargets(targets) {
  const fields = targets.flatMap((target) => target.kind === 'group' ? target.targets : [target]);
  return [...new Map(fields.map((target) => [discoveryTargetKey(target), target])).values()];
}

export function groupDiscoveryTargetsForDisplay(targets = []) {
  const required = new Set(['entity:existence', 'field:section.basic', 'field:imageURL']);
  const baseTargets = [];
  const groups = [];

  for (const target of targets) {
    if (required.has(discoveryTargetKey(target))) continue;

    if (target.kind === 'group') {
      const children = (target.targets ?? []).filter((child) => !required.has(discoveryTargetKey(child)));
      if (!children.length) continue;
      groups.push({ ...target, children });
    } else {
      baseTargets.push(target);
    }
  }

  return [...baseTargets, ...groups];
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
