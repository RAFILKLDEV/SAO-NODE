import { describe, expect, it } from 'vitest';
import { normalizeAssociation, normalizeAssociationBatch, associationRoleAllowed } from '../src/index.js';

const source = { type: 'monster', id: 'monster.wolf' };
describe('association editor domain rules', () => {
  it('normalizes drops, defaults and legacy role aliases', () => {
    expect(normalizeAssociation(source, { type: 'item', id: 'item.fur', role: 'drop' })).toEqual({
      type: 'item', id: 'item.fur', role: 'drops', slot: 'references', chance: 100, quantityMin: 1, quantityMax: 1
    });
  });
  it('rejects self links, invalid namespace and NPC-only slots', () => {
    expect(() => normalizeAssociation(source, { ...source, role: 'related' })).toThrow('si mesma');
    expect(() => normalizeAssociation(source, { type: 'item', id: 'npc.wrong' })).toThrow('ID incompatível');
    expect(() => normalizeAssociation(source, { type: 'location', id: 'loc.forest', slot: 'locations' })).toThrow('Somente personagens');
  });
  it('validates contextual roles and numeric details without closing custom vocabulary', () => {
    expect(() => normalizeAssociation(source, { type: 'location', id: 'loc.forest', role: 'drops' })).toThrow('Papel incompatível');
    expect(() => normalizeAssociation(source, { type: 'item', id: 'item.fur', role: 'related', chance: 90 })).toThrow('Drop');
    expect(() => normalizeAssociation(source, { type: 'item', id: 'item.fur', role: 'drops', quantityMin: 4, quantityMax: 2 })).toThrow();
    expect(normalizeAssociation(source, { type: 'quest', id: 'quest.hunt', role: 'protects' }).role).toBe('protects');
    expect(associationRoleAllowed('found-in', 'monster', 'location')).toBe(true);
    expect(associationRoleAllowed('found-in', 'monster', 'item')).toBe(false);
  });
  it('deduplicates repeated links and rejects conflicting details', () => {
    const link = { type: 'item', id: 'item.fur', role: 'drops', chance: 40 };
    expect(normalizeAssociationBatch(source, [link, link])).toHaveLength(1);
    expect(() => normalizeAssociationBatch(source, [link, { ...link, chance: 80 }])).toThrow('detalhes diferentes');
  });
});
