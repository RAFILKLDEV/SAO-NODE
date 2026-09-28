export const isCharacterEntity = (item) => item?.characterType === 'entity';
export const characterTarget = (item) => ({
  targetType: item.userId ? 'player' : 'npc',
  targetId: item.userId ?? item.id
});
export const isCharacterFavorite = (item, favorites = []) => {
  const target = characterTarget(item);
  return favorites.some((favorite) => favorite.targetType === target.targetType && favorite.targetId === target.targetId);
};
export function characterEntries(npcs, players, filter, favorites = []) {
  const roster = players.map((player) => ({ ...player, id: `player:${player.userId}`, imageURL: player.characterImageUrl }));
  if (filter === 'player') return roster;
  if (filter === 'favorites') return [...npcs, ...roster].filter((item) => isCharacterFavorite(item, favorites));
  return npcs.filter((item) => filter === 'entity' ? isCharacterEntity(item) : !isCharacterEntity(item));
}
