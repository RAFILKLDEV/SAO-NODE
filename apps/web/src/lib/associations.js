import { associationKey, isSymmetricAssociation } from '@sao/domain';

export const entityIdentity = (entity) => JSON.stringify([entity.type, entity.id]);
export function associationPayload(link) {
  return {
    type: link.type, id: link.id, role: link.role ?? 'related', slot: link.slot ?? 'references',
    ...(link.chance != null ? { chance: link.chance } : {}),
    ...(link.quantityMin != null ? { quantityMin: link.quantityMin } : {}),
    ...(link.quantityMax != null ? { quantityMax: link.quantityMax } : {})
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
export { associationKey };
