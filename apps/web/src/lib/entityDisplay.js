export function entitySubtitle(entity) {
  return String(entity?.subtitle ?? entity?.title ?? '').trim();
}

export function formatEntityName(entity, fallback = 'Registro sem nome') {
  const name = String(entity?.name ?? fallback).trim() || fallback;
  const subtitle = entitySubtitle(entity);
  return subtitle ? `${name} - (${subtitle})` : name;
}