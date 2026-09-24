import { isV2Entity, migrateV1Entity, normalizeEntity, toLegacyEntity, sectionFields } from '@sao/domain';
import { prepareEntityPayload } from './entityForm.js';

export function createEntityDraft(type, input) {
  if (input?.schemaVersion === '2.0' && input.data) return structuredClone(input.data);
  if (isV2Entity(input)) return structuredClone(input);
  const {
    entityType: _type,
    version: _version,
    createdAt: _created,
    updatedAt: _updated,
    backlinks: _backlinks,
    _technical: technical,
    parent: _parent,
    nextQuestReferences: _next,
    ...data
  } = input;
  return migrateV1Entity(
    type,
    { ...data, baseVisibility: technical?.baseVisibility ?? data.baseVisibility },
    { conflicts: 'prefer' }
  );
}

export function draftControls(type, draft) {
  return toLegacyEntity(type, draft);
}

export function updateEntityDraft(type, controls) {
  return migrateV1Entity(type, controls, { conflicts: 'prefer' });
}

export function prepareCanonicalPayload(type, draft) {
  const controls = draftControls(type, draft);
  const clean = prepareEntityPayload(type, controls);
  return normalizeEntity(type, updateEntityDraft(type, clean), { format: '2.0' });
}

// Apply only to new records created in the editor. Existing records retain their permissions.
export function discoverableCreation(type, data) {
  const result = structuredClone(data);
  const hidden = (value) => value === 'gm' ? 'gm' : 'discoverable';
  const sections = new Set([...Object.keys(sectionFields[type] ?? {}), 'references', 'additional',
    'extensions', 'extraStatBlocks', ...Object.keys(result.visibility?.sections ?? {})]);
  result.visibility = { ...result.visibility, entity: 'discoverable', sections: Object.fromEntries(
    [...sections].map((key) => [key, hidden(result.visibility?.sections?.[key])])
  ) };
  for (const collection of ['fields', 'objectives', 'connections', 'components']) {
    if (result[collection]) result[collection] = result[collection].map((entry) => ({ ...entry, visibility: hidden(entry.visibility) }));
  }
  if (type === 'monster') {
    for (const sheet of Object.values(result.statBlocks ?? {})) {
      const keys = new Set(['basic', 'nd', 'type', 'subtype', 'size', 'combat', 'resources', 'resistances', 'attributes', ...Object.keys(sheet.statsVisibility ?? {})]);
      sheet.statsVisibility = Object.fromEntries([...keys].map((key) => [key, hidden(sheet.statsVisibility?.[key])]));
    }
  }
  return result;
}
