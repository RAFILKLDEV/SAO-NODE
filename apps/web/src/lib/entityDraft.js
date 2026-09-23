import { isV2Entity, migrateV1Entity, normalizeEntity, toLegacyEntity } from '@sao/domain';
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
