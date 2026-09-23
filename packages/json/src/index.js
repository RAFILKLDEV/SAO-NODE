import { z } from 'zod';
import {
  entitySchemas,
  migrateV1Entity,
  normalizeEntity,
  stableValue,
  toLegacyEntity,
  validateEntityCatalog
} from '@sao/domain';

export const ROOT_VERSION = '2.0';
export const LEGACY_VERSION = '1.0';
export const MAX_DEFAULT = 5 * 1024 * 1024;
export const entityTypes = ['npc', 'location', 'item', 'monster', 'quest'];
const v2PackSchema = z.strictObject({
  schemaVersion: z.literal(ROOT_VERSION),
  packId: z.string().min(1),
  name: z.string().min(1),
  language: z.string().default('pt-BR'),
  containers: z.array(z.enum(entityTypes)).optional(),
  entities: z.array(
    z.strictObject({ type: z.enum(entityTypes), data: z.record(z.string(), z.unknown()) })
  )
});
const v1PackSchema = z.strictObject({
  schemaVersion: z.literal(LEGACY_VERSION),
  packId: z.string().min(1),
  name: z.string().min(1),
  language: z.string().default('pt-BR'),
  presentContainers: z.array(z.enum(entityTypes)).optional(),
  entities: z.array(
    z.strictObject({ type: z.enum(entityTypes), data: z.record(z.string(), z.unknown()) })
  )
});
const v2OperationsSchema = z.strictObject({
  schemaVersion: z.literal(ROOT_VERSION),
  packId: z.string().min(1),
  name: z.string().min(1),
  language: z.string().default('pt-BR'),
  operations: z.array(
    z.strictObject({
      type: z.enum(entityTypes),
      id: z.string().min(1),
      set: z.record(z.string(), z.unknown()).optional(),
      add: z.record(z.string(), z.unknown()).optional(),
      remove: z.record(z.string(), z.unknown()).optional()
    }).refine((operation) => Object.keys(operation).some((key) => ['set', 'add', 'remove'].includes(key)), 'A operação precisa de set, add ou remove')
  ).min(1)
});
export function stable(value) {
  return stableValue(value);
}
function byteLength(value) {
  return Buffer.byteLength(typeof value === 'string' ? value : JSON.stringify(value), 'utf8');
}
function parseRaw(input) {
  try {
    return typeof input === 'string' ? JSON.parse(input) : input;
  } catch (error) {
    throw new Error(`JSON inválido: ${error.message}`);
  }
}
export function parseSaoDataJson(input, options = {}) {
  const source = typeof input === 'string' ? input : JSON.stringify(input);
  if (byteLength(source) > (options.maxBytes ?? MAX_DEFAULT))
    throw new Error('JSON exceeds maximum size');
  const raw = parseRaw(input);
  if (raw?.schemaVersion === ROOT_VERSION && Object.hasOwn(raw, 'operations')) {
    const envelope = v2OperationsSchema.parse(raw);
    const keys = new Set();
    for (const operation of envelope.operations) {
      const key = `${operation.type}:${operation.id}`;
      if (keys.has(key)) throw new Error(`Operação duplicada: ${key}`);
      keys.add(key);
    }
    return {
      pack: {
        schemaVersion: ROOT_VERSION,
        packId: envelope.packId,
        name: envelope.name,
        language: envelope.language,
        containers: [],
        entities: [],
        operations: envelope.operations
      },
      warnings: [],
      diagnostics: []
    };
  }
  const legacy = raw?.schemaVersion === LEGACY_VERSION;
  const envelope = (legacy ? v1PackSchema : v2PackSchema).parse(raw);
  const diagnostics = [];
  const entities = envelope.entities.map((entry) => ({
    type: entry.type,
    data: normalizeEntity(entry.type, entry.data, {
      format: legacy ? LEGACY_VERSION : ROOT_VERSION,
      diagnostics,
      conflicts: options.conflicts ?? 'error'
    })
  }));
  const keys = new Set();
  for (const entity of entities) {
    const key = `${entity.type}:${entity.data.id}`;
    if (keys.has(key)) throw new Error(`ID duplicado: ${key}`);
    keys.add(key);
  }
  const pack = {
    schemaVersion: ROOT_VERSION,
    packId: envelope.packId,
    name: envelope.name,
    language: envelope.language,
    containers: envelope.containers ??
      envelope.presentContainers ?? [...new Set(entities.map((entity) => entity.type))],
    entities
  };
  if (new Set(pack.containers).size !== pack.containers.length)
    throw new Error('Containers duplicados');
  if (entities.some((e) => !pack.containers.includes(e.type)))
    throw new Error('Entidade fora dos containers declarados');
  return { pack, warnings: validateEntityCatalog(entities, options.catalog ?? []), diagnostics };
}
export function migrateSaoDataV1(input, options = {}) {
  return {
    ...parseSaoDataJson(input, { ...options, conflicts: options.conflicts ?? 'error' }),
    migrated: true
  };
}
export function buildDiff(existing, incomingPack) {
  const containers = incomingPack.containers ?? incomingPack.presentContainers ?? entityTypes;
  const current = new Map(existing.map((entity) => [`${entity.type}:${entity.id}`, entity]));
  const incoming = new Map(
    incomingPack.entities.map((entity) => [`${entity.type}:${entity.data.id}`, entity])
  );
  const diff = [];
  for (const [key, entity] of incoming) {
    const old = current.get(key);
    const before = old ? stable(old.data ?? old) : null;
    const after = stable({
      ...entity.data,
      visibility: {
        ...entity.data.visibility,
        entity: entity.data.visibility?.entity ?? before?.visibility?.entity ?? 'gm'
      }
    });
    const equal = JSON.stringify(before) === JSON.stringify(after);
    diff.push({
      key,
      type: entity.type,
      id: entity.data.id,
      status: !old ? 'NEW' : equal ? 'EQUAL' : 'ALTERED',
      selected: !old || !equal,
      before,
      after,
      visibilityChange:
        before?.visibility?.entity !== after.visibility?.entity
          ? { before: before?.visibility?.entity ?? null, after: after.visibility?.entity }
          : null
    });
  }
  for (const [key, old] of current)
    if (!incoming.has(key) && containers.includes(old.type))
      diff.push({
        key,
        type: old.type,
        id: old.id,
        status: 'REMOVED_FROM_JSON',
        selected: false,
        before: old.data ?? old,
        after: null
      });
  return diff.sort((a, b) => a.key.localeCompare(b.key));
}
export function exportSaoDataJson({
  packId,
  name,
  language = 'pt-BR',
  entities,
  containers,
  presentContainers,
  format = ROOT_VERSION
}) {
  const types = containers ??
    presentContainers ?? [...new Set(entities.map((entity) => entity.type))];
  const ordered = entities
    .map((e) => ({ type: e.type, data: normalizeEntity(e.type, e.data) }))
    .sort((a, b) => `${a.type}:${a.data.id}`.localeCompare(`${b.type}:${b.data.id}`));
  const legacy = format === LEGACY_VERSION;
  const outputEntities = legacy
    ? ordered.map((entity) => ({
        type: entity.type,
        data: toLegacyEntity(entity.type, entity.data)
      }))
    : ordered;
  return stable(
    legacy
      ? {
          schemaVersion: LEGACY_VERSION,
          packId,
          name,
          language,
          presentContainers: types,
          entities: outputEntities
        }
      : {
          schemaVersion: ROOT_VERSION,
          packId,
          name,
          language,
          containers: types,
          entities: outputEntities
        }
  );
}
export const JSON_IMPORT_TEMPLATE = {
  schemaVersion: ROOT_VERSION,
  packId: 'minha-campanha.importacao',
  name: 'Conteúdo da campanha',
  language: 'pt-BR',
  containers: entityTypes,
  entities: entityTypes.map((type) => ({
    type,
    data: normalizeEntity(
      type,
      {
        id: `${type === 'location' ? 'loc' : type}.exemplo`,
        name: `Exemplo de ${type}`,
        visibility: { entity: 'gm', sections: {} },
        fields: [{ key: 'description', value: 'Descrição', visibility: 'public' }],
        ...(type === 'quest'
          ? {
              objectives: [
                {
                  objectiveId: 'objetivo-exemplo',
                  type: 'custom',
                  text: 'Descreva o objetivo',
                  order: 1
                }
              ],
              rewards: [
                { rewardId: 'recompensa-exemplo', type: 'currency', amount: 10, currency: 'T$' }
              ]
            }
          : {}),
        ...(type === 'location' ? { placement: { floor: '1' } } : {}),
        ...(type === 'monster'
          ? {
              statBlocks: { 'Ambesek.T20': { nd: '1' } },
              components: [
                {
                  id: 'habilidade-exemplo',
                  kind: 'ability',
                  visibility: 'public',
                  data: { name: 'Habilidade', text: 'Descrição' }
                }
              ]
            }
          : {})
      },
      { format: '2.0' }
    )
  }))
};
export function saoDataJsonSchema() {
  return z.toJSONSchema(
    z.union([
      v2PackSchema.extend({
        entities: z.array(
          z.discriminatedUnion(
            'type',
            entityTypes.map((type) =>
              z.strictObject({ type: z.literal(type), data: entitySchemas[type] })
            )
          )
        )
      }),
      v2OperationsSchema
    ]),
    { unrepresentable: 'any' }
  );
}
export { entitySchemas, migrateV1Entity };
