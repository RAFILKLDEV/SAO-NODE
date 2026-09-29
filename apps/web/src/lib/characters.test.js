import { describe, expect, it } from 'vitest';
import { characterEntries, characterTarget, isCharacterFavorite, isCharacterEntity } from './characters.js';

describe('character roster', () => {
  const npc = { id: 'npc.a', characterType: 'npc' };
  const entity = { id: 'npc.b', characterType: 'entity' };
  const player = { userId: 'user.a', name: 'Jogador' };
  it('uses characterType instead of tags', () => {
    expect(isCharacterEntity(entity)).toBe(true);
    expect(isCharacterEntity({ id: 'npc.c', tags: ['entity'] })).toBe(false);
  });
  it('filters favorites across NPCs, entities and players', () => {
    const favorites = [characterTarget(entity), characterTarget(player)];
    expect(characterEntries([npc, entity], [player], 'favorites', favorites)).toEqual([
      entity,
      expect.objectContaining({ userId: 'user.a' })
    ]);
    expect(isCharacterFavorite(player, favorites)).toBe(true);
    expect(isCharacterFavorite({ userId: 'user.other' }, favorites)).toBe(false);
  });
  it('keeps player IDs separate from NPC domain IDs', () => {
    expect(characterEntries([], [player], 'player')[0].id).toBe('player:user.a');
    expect(characterTarget(player)).toEqual({ targetType: 'player', targetId: 'user.a' });
  });
});
