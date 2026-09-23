import { describe, expect, it } from 'vitest';
import { filterMonstersByLocation, locationIdsInRegion } from './monsterLocationFilter.js';

const locations = [
  { id: 'loc.region.norte', type: 'region', name: 'Norte' },
  { id: 'loc.region.norte.vila', type: 'city', name: 'Vila', parentId: 'loc.region.norte' },
  { id: 'loc.region.norte.vila.floresta', type: 'grove', name: 'Floresta', parentId: 'loc.region.norte.vila' },
  { id: 'loc.region.sul', type: 'region', name: 'Sul' }
];
const monsters = [
  { id: 'monster.lobo', references: [{ type: 'location', id: 'loc.region.norte.vila.floresta', role: 'found-in' }] },
  { id: 'monster.guarda', references: [{ type: 'location', id: 'loc.region.norte.vila', role: 'found-in' }] },
  { id: 'monster.serpente', references: [{ type: 'location', id: 'loc.region.sul', role: 'found-in' }] },
  { id: 'monster.sem-local', references: [] }
];

describe('monster location filter', () => {
  it('includes every nested location in the selected region', () => {
    expect([...locationIdsInRegion({ locations, regionId: 'loc.region.norte' })]).toEqual([
      'loc.region.norte',
      'loc.region.norte.vila',
      'loc.region.norte.vila.floresta'
    ]);
  });

  it('filters by region or an exact location reference', () => {
    expect(filterMonstersByLocation({ monsters, locations, regionId: 'loc.region.norte' }).map((monster) => monster.id)).toEqual([
      'monster.lobo',
      'monster.guarda'
    ]);
    expect(filterMonstersByLocation({ monsters, locations, regionId: 'loc.region.norte', locationId: 'loc.region.norte.vila' }).map((monster) => monster.id)).toEqual([
      'monster.guarda'
    ]);
  });
});