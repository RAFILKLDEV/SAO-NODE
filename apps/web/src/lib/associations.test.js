import { describe, expect, it } from 'vitest';
import { associationDiff, filterAssociations, hasAssociation } from './associations.js';
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
  it('exposes a standalone menu for GM and never for players', () => {
    expect(resolveCampaignLinks({ isGm: true }).find(([path]) => path === 'associations')?.[1]).toBe('Associações');
    expect(resolveCampaignLinks({ isGm: false, visibleEntityTypes: new Set(['associations']) }).some(([path]) => path === 'associations')).toBe(false);
  });
});
