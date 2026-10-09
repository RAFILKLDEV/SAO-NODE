import { describe, expect, it } from 'vitest';
import { mapPinCandidateKey, mapPinCandidateLabel, mapPinCandidateRows } from './mapPinCandidates.js';

describe('map pin candidate menus', () => {
  it('labels local options with the authorized region and handles regions and orphans', () => {
    expect(mapPinCandidateLabel({ type: 'location', name: 'Bosque do Peregrino', regionName: 'Planícies verdejantes' })).toBe('Planícies verdejantes — Bosque do Peregrino');
    expect(mapPinCandidateLabel({ type: 'location', pinType: 'region', name: 'Planícies verdejantes' })).toBe('Região — Planícies verdejantes');
    expect(mapPinCandidateLabel({ type: 'location', name: 'Ilha' })).toBe('Sem região — Ilha');
  });

  it('uses domain categories for items, monster ranks and quest types', () => {
    expect(mapPinCandidateLabel({ type: 'item', name: 'Carne', category: 'material' })).toBe('Material — Carne');
    expect(mapPinCandidateLabel({ type: 'item', name: 'Cristal', category: 'Alquimia' })).toBe('Alquimia — Cristal');
    expect(mapPinCandidateLabel({ type: 'monster', name: 'Lobo', rank: 'common' })).toBe('Comum — Lobo');
    expect(mapPinCandidateLabel({ type: 'monster', name: 'Lobo', rank: 'elite' })).toBe('Elite — Lobo');
    expect(mapPinCandidateLabel({ type: 'monster', name: 'Lobo', rank: 'boss' })).toBe('Boss — Lobo');
    expect(mapPinCandidateLabel({ type: 'quest', name: 'A jornada', questType: 'main' })).toBe('Principal — A jornada');
    expect(mapPinCandidateLabel({ type: 'quest', name: 'Colheita', questType: 'side' })).toBe('Secundária — Colheita');
  });

  it('orders character entities before NPCs and catalog records classified as players', () => {
    const candidates = [
      { type: 'npc', id: 'npc.player', name: 'Ana', characterType: 'player' },
      { type: 'npc', id: 'npc.npc', name: 'Bia' },
      { type: 'npc', id: 'npc.entity-z', name: 'Zara', characterType: 'entity' },
      { type: 'npc', id: 'npc.entity-a', name: 'Ária', characterType: 'entity' }
    ];
    expect(mapPinCandidateRows(candidates, 'npc').map((row) => row.id)).toEqual(['npc.entity-a', 'npc.entity-z', 'npc.npc', 'npc.player']);
    expect(mapPinCandidateLabel(candidates[0])).toBe('Jogador — Ana');
  });

  it('filters by type, pinned status and accent-insensitive category or region search', () => {
    const candidates = [
      { type: 'location', id: 'loc.farm', name: 'Fazenda Abelha Real', regionName: 'Planícies verdejantes' },
      { type: 'location', id: 'loc.woods', name: 'Bosque do Peregrino', regionName: 'Planícies verdejantes', pinned: true },
      { type: 'item', id: 'item.meat', name: 'Carne', category: 'material' }
    ];
    expect(mapPinCandidateRows(candidates, 'location', 'planicies').map((row) => row.id)).toEqual(['loc.farm']);
    expect(mapPinCandidateRows(candidates, 'item', 'material').map((row) => row.key)).toEqual(['item:item.meat']);
    expect(mapPinCandidateKey(candidates[0])).toBe('location:loc.farm');
    expect(mapPinCandidateRows(candidates, 'quest')).toEqual([]);
  });
});
