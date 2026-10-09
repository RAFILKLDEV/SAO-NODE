import { describe, expect, it } from 'vitest';
import { associationDiff, buildBulkAssociationChanges, filterAssociations, hasAssociation } from './associations.js';
import { resolveCampaignLinks } from './campaignLinks.js';

describe('association drafts', () => {
  const link = { type: 'item', id: 'item.fur', role: 'drops', slot: 'references', name: 'Couro', available: true, chance: 25 };
  it('sends only canonical fields and edits by replacing the exact original identity', () => {
    expect(associationDiff([link], [{ ...link, chance: 70 }])).toEqual({
      remove: [{ type: 'item', id: 'item.fur', role: 'drops', slot: 'references' }],
      add: [{ type: 'item', id: 'item.fur', role: 'drops', slot: 'references', chance: 70 }]
    });
    expect(associationDiff([link], [{ ...link, name: 'Renomeado', available: false }])).toEqual({ add: [], remove: [] });
    expect(associationDiff([], [])).toEqual({ add: [], remove: [] });
  });
  it('does not confuse separate roles for the same target or manufacture inverse links', () => {
    expect(hasAssociation([link], [], link, 'related')).toBe(false);
    expect(hasAssociation([], [{ source: link, role: 'related' }], link, 'related')).toBe(true);
    expect(hasAssociation([], [{ source: link, role: 'used-by' }], link, 'used-by')).toBe(false);
  });
  it('filters incoming links by the referencing entity, name and role', () => {
    const backlinks = [{ ...link, source: { type: 'monster', id: 'monster.wolf', name: 'Lobo' } }];
    expect(filterAssociations(backlinks, { type: 'monster', search: 'LOBO', role: 'drops' })).toHaveLength(1);
    expect(filterAssociations(backlinks, { type: 'item' })).toHaveLength(0);
  });
  it('builds drops on each monster when starting from an item', () => {
    const changes = buildBulkAssociationChanges({ mode: 'drops', source: { type: 'item', id: 'item.meat' }, targets: [
      { id: 'monster.capivara', version: 3 }, { id: 'monster.boar', version: 8 }
    ], fields: { chance: 100, quantityFormula: '1d40', visibility: 'public' } });
    expect(changes).toHaveLength(2);
    expect(changes[0]).toMatchObject({ sourceType: 'monster', sourceId: 'monster.capivara', version: 3, add: [{ type: 'item', id: 'item.meat', role: 'drops', quantityFormula: '1d40' }] });
  });
  it('builds found-in links on each monster when starting from a location', () => {
    expect(buildBulkAssociationChanges({ mode: 'found-in', source: { type: 'location', id: 'loc.forest' }, targets: [{ id: 'monster.boar', version: 2 }] })).toEqual([
      { sourceType: 'monster', sourceId: 'monster.boar', version: 2, add: [{ type: 'location', id: 'loc.forest', role: 'found-in' }] }
    ]);
  });
  it('creates one structured reward for every selected quest', () => {
    const changes = buildBulkAssociationChanges({ mode: 'rewards', source: { type: 'item', id: 'item.meat' }, targets: [{ id: 'quest.hunt', version: 4 }], fields: { quantity: '1d4' } });
    expect(changes[0]).toMatchObject({ sourceType: 'quest', sourceId: 'quest.hunt', version: 4, rewards: [{ type: 'item', target: { type: 'item', id: 'item.meat' }, quantity: '1d4' }] });
    expect(changes[0].rewards[0].rewardId).toBeTruthy();
  });
  it('exposes a standalone menu for GM and never for players', () => {
    expect(resolveCampaignLinks({ isGm: true }).find(([path]) => path === 'associations')?.[1]).toBe('Associações');
    expect(resolveCampaignLinks({ isGm: false, visibleEntityTypes: new Set(['associations']) }).some(([path]) => path === 'associations')).toBe(false);
  });
});
