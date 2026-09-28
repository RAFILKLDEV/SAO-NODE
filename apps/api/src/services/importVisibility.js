import { sectionFields } from '@sao/domain';

// Import permissions are enforced before diffing, so the preview matches the saved data.
export function discoverableImport(type, data) {
  const result = structuredClone(data);
  const restrict = (value) => value === 'gm' ? 'gm' : 'discoverable';
  const sections = new Set([...Object.keys(sectionFields[type] ?? {}), 'references', 'additional',
    'extensions', 'extraStatBlocks', ...Object.keys(result.visibility?.sections ?? {})]);
  result.visibility = {
    entity: restrict(result.visibility?.entity),
    sections: Object.fromEntries([...sections].map((key) => [key, restrict(result.visibility?.sections?.[key])]))
  };
  for (const collection of ['fields', 'objectives', 'connections', 'components']) {
    if (result[collection]) result[collection] = result[collection].map((entry) => ({ ...entry, visibility: restrict(entry.visibility) }));
  }
  for (const sheet of Object.values(result.statBlocks ?? {})) {
    const keys = new Set(['basic', 'nd', 'type', 'subtype', 'size', 'combat', 'resources', 'resistances', 'attributes', ...Object.keys(sheet.statsVisibility ?? {})]);
    sheet.statsVisibility = Object.fromEntries([...keys].map((key) => [key, restrict(sheet.statsVisibility?.[key])]));
  }
  return result;
}
