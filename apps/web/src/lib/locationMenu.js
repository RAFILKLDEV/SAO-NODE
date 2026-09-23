const isRoviaLocation = (item, byId) => {
  const seen = new Set();
  let current = item;
  while (current && !seen.has(current.id)) {
    if (/rovia/i.test(`${current.id} ${current.name ?? ''}`)) return true;
    seen.add(current.id);
    current = byId.get(current.parentId);
  }
  return false;
};

const visibleItems = (items) => {
  const byId = new Map(items.map((item) => [item.id, item]));
  return items.filter((item) => !isRoviaLocation(item, byId));
};

export function locationFloor(item, items = []) {
  const byId = new Map(items.map(location => [location.id, location]));
  const seen = new Set();
  let current = item;
  while (current && !seen.has(current.id)) {
    if (current.placement?.floor != null && current.placement.floor !== '') return String(current.placement.floor);
    seen.add(current.id); current = byId.get(current.parentId);
  }
  return 'sem-andar';
}

export function resolveLocationMenuState({ items = [], selectedId }) {
  if (!selectedId || !items.length) {
    return { floor: null, region: null, city: null };
  }

  const byId = new Map(items.map((item) => [item.id, item]));
  const selected = byId.get(selectedId) ?? null;

  if (!selected) {
    return { floor: null, region: null, city: null };
  }

  let current = selected;
  let cityId = null;
  let regionId = null;
  let rootCityId = null;
  let floor = locationFloor(selected, items);

  const seen = new Set();
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    if (current.type === 'city' && !cityId) cityId = current.id;
    if (current.type === 'region' && !regionId) regionId = current.id;
    if (current.type === 'city' && (!current.parentId || !byId.has(current.parentId))) {
      rootCityId = current.id;
    }
    if (!current.parentId) break;
    current = byId.get(current.parentId) ?? null;
  }

  if (!regionId && selected.parentId) {
    const parent = byId.get(selected.parentId);
    if (parent?.type === 'region') regionId = parent.id;
  }

  if (!cityId) {
    const cityCandidate = items.find((item) => item.type === 'city' && item.parentId === regionId);
    if (cityCandidate) cityId = cityCandidate.id;
  }

  return {
    floor: /^sem-andar$/i.test(floor) ? null : floor,
    region: regionId || rootCityId || null,
    city: cityId || null
  };
}

export function resolveLocationMenuRegions({ items = [] }) {
  items = visibleItems(items);
  const byId = new Map(items.map((item) => [item.id, item]));
  const candidates = items.filter(item => !item.parentId || !byId.has(item.parentId));

  return [...new Map(candidates.map((item) => [item.id, item])).values()].sort((a, b) =>
    a.name.localeCompare(b.name, 'pt-BR')
  );
}

export function resolveLocationMenuClick(item) {
  if (!item) return { selectedRegion: null, itemId: null };

  if (item.type === 'city' && item.parentId) {
    return { selectedRegion: item.parentId, itemId: item.id };
  }

  return { selectedRegion: null, itemId: item.id };
}

export function shouldShowLocationList({ regions = [], selectedRegion = null }) {
  return Boolean(selectedRegion) || regions.length === 0;
}

export function resolveLocationMenuEntries({ items = [], selectedRegion = null }) {
  items = visibleItems(items);
  if (!selectedRegion) return [];

  const byParent = new Map();
  for (const item of items) {
    if (!item.parentId) continue;
    const siblings = byParent.get(item.parentId) ?? [];
    siblings.push(item);
    byParent.set(item.parentId, siblings);
  }

  const ordered = [];
  const visited = new Set([selectedRegion]);
  const visit = (parentId) => {
    const children = [...(byParent.get(parentId) ?? [])].sort((a, b) =>
      a.name.localeCompare(b.name, 'pt-BR')
    );

    for (const child of children) {
      if (visited.has(child.id)) continue;
      visited.add(child.id);
      ordered.push(child);
      visit(child.id);
    }
  };

  visit(selectedRegion);
  return ordered;
}

export function resolveLocationBulkEntities({ items = [], selectedRegion = null }) {
  if (!selectedRegion) return [];
  const region = items.find((item) => item.id === selectedRegion) ?? null;
  if (!region) return [];

  return [region, ...resolveLocationMenuEntries({ items, selectedRegion })];
}
