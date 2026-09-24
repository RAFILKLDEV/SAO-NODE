import { linkSchema, ID_PREFIXES } from './v2.js';

// Associations remain ordinary saoData links; these are editor rules, not a new wire format.
export const associationRoles = [
  { value: 'related', label: 'Relacionado', symmetric: true },
  { value: 'friend', label: 'Amigo', symmetric: true },
  { value: 'ally', label: 'Aliado', symmetric: true },
  { value: 'enemy', label: 'Inimigo', symmetric: true },
  { value: 'family', label: 'Família', symmetric: true },
  { value: 'rival', label: 'Rival', symmetric: true },
  { value: 'found-in', label: 'Encontrado em', targetType: 'location' },
  { value: 'used-by', label: 'Utilizado por' },
  { value: 'managed-by', label: 'Administrado por' },
  { value: 'part-of', label: 'Parte de (referência)' },
  { value: 'drops', label: 'Drop', sourceType: 'monster', targetType: 'item', drop: true }
];

export const isAssociationDrop = (role) => role === 'drop' || role === 'drops';
export const associationKey = (link) => JSON.stringify([link.type, link.id, link.role ?? 'related', link.slot ?? 'references']);
export const isSymmetricAssociation = (role) => Boolean(associationRoles.find((entry) => entry.value === role)?.symmetric);

export function associationRoleAllowed(role, sourceType, targetType) {
  const definition = associationRoles.find((entry) => entry.value === (role === 'drop' ? 'drops' : role));
  return !definition || ((!definition.sourceType || definition.sourceType === sourceType) && (!definition.targetType || definition.targetType === targetType));
}

export function normalizeAssociation(source, input) {
  const link = linkSchema.parse(input);
  const fail = (message) => { throw Object.assign(new Error(message), { code: 'INVALID_CONTENT' }); };
  if (!link.id.startsWith(ID_PREFIXES[link.type]) || link.id.length <= ID_PREFIXES[link.type].length) fail('ID incompatível com o tipo de destino.');
  if (source.type === link.type && source.id === link.id) fail('Uma entidade não pode ser associada a si mesma.');
  if (source.type !== 'npc' && link.slot !== 'references') fail('Somente personagens possuem seções de locais e relações.');
  if (!associationRoleAllowed(link.role, source.type, link.type)) fail('Papel incompatível com os tipos de origem e destino.');
  if (isAssociationDrop(link.role)) {
    link.role = 'drops';
    link.chance ??= 100;
    link.quantityMin ??= link.quantityMax ?? 1;
    link.quantityMax ??= link.quantityMin;
  } else if (link.chance != null || link.quantityMin != null || link.quantityMax != null) {
    fail('Chance e quantidade pertencem a associações de Drop.');
  }
  return link;
}

export function normalizeAssociationBatch(source, links) {
  const unique = new Map();
  for (const input of links) {
    const link = normalizeAssociation(source, input);
    const key = associationKey(link);
    if (unique.has(key) && JSON.stringify(unique.get(key)) !== JSON.stringify(link))
      throw Object.assign(new Error('O lote contém detalhes diferentes para a mesma associação.'), { code: 'INVALID_CONTENT' });
    unique.set(key, link);
  }
  return [...unique.values()];
}
