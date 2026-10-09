import { associationKey, isSymmetricAssociation } from '@sao/domain';

export const entityIdentity = (entity) => JSON.stringify([entity.type, entity.id]);
export function associationPayload(link) {
  return {
    type: link.type, id: link.id, role: link.role ?? 'related', slot: link.slot ?? 'references',
    ...(link.chance != null ? { chance: link.chance } : {}),
    ...(link.quantityMin != null ? { quantityMin: link.quantityMin } : {}),
    ...(link.quantityMax != null ? { quantityMax: link.quantityMax } : {}),
    ...(link.quantityFormula ? { quantityFormula: link.quantityFormula } : {}),
    ...(link.valueFormula ? { valueFormula: link.valueFormula } : {})
    ,...(link.visibility ? { visibility: link.visibility } : {})
  };
}
export function associationDiff(before, after) {
  const equal = (a, b) => JSON.stringify(associationPayload(a)) === JSON.stringify(associationPayload(b));
  const add = after.filter((link) => !before.some((old) => equal(old, link)));
  const remove = before.filter((link) => !after.some((next) => equal(next, link)));
  return {
    add: add.map(associationPayload),
    remove: remove.map(({ type, id, role = 'related', slot = 'references' }) => ({ type, id, role, slot }))
  };
}
export function hasAssociation(links, backlinks, target, role) {
  return links.some((link) => link.type === target.type && link.id === target.id && (link.role === role || (role === 'drops' && link.role === 'drop'))) ||
    (isSymmetricAssociation(role) && backlinks.some((link) => entityIdentity(link.source) === entityIdentity(target) && link.role === role));
}
export function filterAssociations(links, { type = '', role = '', search = '' } = {}) {
  const text = search.trim().toLocaleLowerCase('pt-BR');
  return links.filter((link) => {
    const entity = link.source ?? link;
    return (!type || entity.type === type) && (!role || link.role === role) &&
      (!text || `${entity.name} ${entity.id}`.toLocaleLowerCase('pt-BR').includes(text));
  });
}
export function buildBulkAssociationChanges({ mode, source, targets, fields = {} }) {
  if (!source || !targets?.length) return [];
  if (mode === 'drops') return targets.map((monster) => ({
    sourceType: 'monster', sourceId: monster.id, version: monster.version,
    add: [{
      type: 'item', id: source.id, role: 'drops', chance: fields.chance ?? 100,
      quantityMin: fields.quantityMin ?? 1, quantityMax: fields.quantityMax ?? 1,
      ...(fields.quantityFormula ? { quantityFormula: fields.quantityFormula } : {}),
      ...(fields.valueFormula ? { valueFormula: fields.valueFormula } : {}),
      visibility: fields.visibility ?? 'public'
    }]
  }));
  if (mode === 'found-in') return targets.map((monster) => ({
    sourceType: 'monster', sourceId: monster.id, version: monster.version,
    add: [{ type: 'location', id: source.id, role: 'found-in' }]
  }));
  if (mode === 'rewards') return targets.map((quest) => ({
    sourceType: 'quest', sourceId: quest.id, version: quest.version,
    rewards: [{
      rewardId: crypto.randomUUID(), type: source.type,
      target: { type: source.type, id: source.id }, quantity: fields.quantity ?? 1
    }]
  }));
  throw new Error(`Modo de associação em lote inválido: ${mode}`);
}
export { associationKey };
