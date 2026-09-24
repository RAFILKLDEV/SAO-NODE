import { locationFloor } from './locationMenu.js';

export function locationBranchEntries(items = [], rootEntry) {
  const rootId = rootEntry?.entityId ?? rootEntry?.id;
  const byId = new Map(items.map((entry) => [entry.entityId ?? entry.id, entry]));
  return items.filter((entry) => {
    let current = entry;
    const visited = new Set();
    while (current && !visited.has(current.entityId ?? current.id)) {
      const currentId = current.entityId ?? current.id;
      if (currentId === rootId) return true;
      visited.add(currentId);
      current = byId.get(current.parentId);
    }
    return false;
  });
}

// Presentation only: hierarchy never changes IDs or the grant selection.
export function locationDiscoveryRows(items = []) {
  const locations = items;
  const getId = (entry) => entry?.entityId ?? entry?.id;
  const byId = new Map(locations.map((entry) => [getId(entry), entry]));
  const floors = new Map();
  const compare = (a, b) => a.localeCompare(b, 'pt-BR', { numeric: true });
  for (const entry of locations) {
    const floor = locationFloor(entry, locations);
    if (!floors.has(floor)) floors.set(floor, { regions: new Map(), entry: null });
    const bucket = floors.get(floor);
    if (entry.type === 'floor') { bucket.entry = entry; continue; }
    let current = entry;
    let region = null;
    const visited = new Set();
    while (current && !visited.has(getId(current))) {
      visited.add(getId(current));
      if (current.type === 'region' || (current.type === 'city' && !current.parentId)) { region = current; break; }
      current = byId.get(current.parentId);
    }
    const key = getId(region) ?? 'unassigned';
    if (!bucket.regions.has(key)) bucket.regions.set(key, { entry: region, children: [] });
    if (getId(entry) !== getId(region)) bucket.regions.get(key).children.push(entry);
  }
  const rows = [];
  for (const [floor, bucket] of [...floors].sort(([a], [b]) => a === 'sem-andar' ? 1 : b === 'sem-andar' ? -1 : compare(a, b))) {
    const label = floor === 'sem-andar' ? 'Sem andar' : `Andar ${floor.replace(/^(?:f|andar\s*)0*/i, '')}`;
    rows.push({ key: `floor:${floor}`, label: bucket.entry?.treeName ?? bucket.entry?.name ?? label, entry: bucket.entry, depth: 0, kind: 'floor' });
    for (const [id, region] of [...bucket.regions].sort(([, a], [, b]) => compare(a.entry?.name ?? 'Sem região', b.entry?.name ?? 'Sem região'))) {
      rows.push({ key: `region:${floor}:${id}`, label: region.entry?.treeName ?? region.entry?.name ?? 'Sem região', entry: region.entry, depth: 1, kind: 'region' });
      for (const entry of region.children.sort((a, b) => compare(a.name, b.name))) {
        rows.push({ key: getId(entry), label: entry.treeName ?? entry.name, entry, depth: 2, kind: 'location' });
      }
    }
  }
  return rows;
}
