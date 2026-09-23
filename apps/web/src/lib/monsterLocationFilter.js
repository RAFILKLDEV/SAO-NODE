import { resolveLocationMenuEntries } from './locationMenu.js';

export function locationIdsInRegion({ locations = [], regionId }) {
  if (!regionId) return new Set();
  return new Set([
    regionId,
    ...resolveLocationMenuEntries({ items: locations, selectedRegion: regionId }).map((location) => location.id)
  ]);
}

export function filterMonstersByLocation({ monsters = [], locations = [], regionId, locationId }) {
  const locationIds = locationId
    ? new Set([locationId])
    : locationIdsInRegion({ locations, regionId });

  if (!locationIds.size) return monsters;
  return monsters.filter((monster) =>
    (monster.references ?? []).some((reference) => {
      const target = reference.target ?? reference;
      return target.type === 'location' && locationIds.has(target.id);
    })
  );
}