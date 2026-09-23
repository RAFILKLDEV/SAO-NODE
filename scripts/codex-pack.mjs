import { readFile } from 'node:fs/promises';
import path from 'node:path';

const [command, file, value] = process.argv.slice(2);
const outputLimit = 60;

function entityId(entity) {
  return entity?.data?.id ?? entity?.domainId ?? entity?.id;
}

function entityName(entity) {
  return entity?.data?.name ?? entity?.name ?? '';
}

function canonicalData(entity) {
  if (entity?.data?.id) return entity.data;
  if (entity?.domainId && entity?.data) {
    return {
      ...entity.data,
      id: entity.domainId,
      name: entity.name ?? entity.data.name,
      fields: entity.fields ?? entity.data.fields,
      links: entity.references ?? entity.data.links,
      connections: entity.locationConnections ?? entity.data.connections,
      components: entity.monsterComponents ?? entity.data.components,
      objectives: entity.questObjectives ?? entity.data.objectives,
      rewards: entity.questRewards ?? entity.data.rewards
    };
  }
  return entity?.data ?? entity;
}

function collectTargets(node, results = [], location = '$') {
  if (!node || typeof node !== 'object') return results;
  if (Array.isArray(node)) {
    node.forEach((value, index) => collectTargets(value, results, `${location}[${index}]`));
    return results;
  }
  if (typeof node.type === 'string' && typeof node.id === 'string') {
    results.push({ location, type: node.type, id: node.id });
  }
  if (typeof node.targetType === 'string' && typeof node.targetDomainId === 'string') {
    results.push({ location, type: node.targetType, id: node.targetDomainId });
  }
  for (const [key, child] of Object.entries(node)) collectTargets(child, results, `${location}.${key}`);
  return results;
}

async function load(filePath) {
  if (!filePath) throw new Error('Informe o arquivo JSON.');
  const full = path.resolve(filePath);
  const document = JSON.parse(await readFile(full, 'utf8'));
  if (!Array.isArray(document.entities)) throw new Error('JSON não possui um array entities.');
  return document.entities;
}

async function get(filePath, id) {
  if (!id) throw new Error('Uso: npm run data:entity -- arquivo.json ID');
  const entities = await load(filePath);
  const found = entities.find((entity) => entityId(entity) === id);
  if (!found) throw new Error(`Entidade não encontrada: ${id}`);
  console.log(JSON.stringify({ type: found.type, data: canonicalData(found) }, null, 2));
}

async function search(filePath, term) {
  if (!term) throw new Error('Uso: npm run data:search -- arquivo.json TERMO');
  const entities = await load(filePath);
  const needle = term.toLowerCase();
  const results = [];
  for (const entity of entities) {
    const id = entityId(entity) ?? '';
    const name = entityName(entity);
    let hit = id.toLowerCase().includes(needle) || name.toLowerCase().includes(needle);
    if (!hit) {
      const data = canonicalData(entity);
      hit = JSON.stringify(data).toLowerCase().includes(needle);
    }
    if (hit) results.push({ type: entity.type, id, name });
    if (results.length >= outputLimit) break;
  }
  console.log(JSON.stringify(results, null, 2));
  if (results.length >= outputLimit) console.error(`[saída limitada a ${outputLimit} entidades]`);
}

async function refs(filePath, id) {
  if (!id) throw new Error('Uso: npm run data:refs -- arquivo.json ID');
  const entities = await load(filePath);
  const target = entities.find((entity) => entityId(entity) === id);
  if (!target) throw new Error(`Entidade não encontrada: ${id}`);

  const outgoing = collectTargets(canonicalData(target))
    .filter((ref) => ref.id !== id)
    .slice(0, outputLimit);
  const incoming = [];
  for (const entity of entities) {
    if (entityId(entity) === id) continue;
    const hits = collectTargets(canonicalData(entity)).filter((ref) => ref.id === id);
    if (hits.length) incoming.push({ type: entity.type, id: entityId(entity), name: entityName(entity), at: hits.map((hit) => hit.location) });
    if (incoming.length >= outputLimit) break;
  }
  console.log(JSON.stringify({ entity: { type: target.type, id, name: entityName(target) }, outgoing, incoming }, null, 2));
}

async function main() {
  if (command === 'get') return get(file, value);
  if (command === 'search') return search(file, value);
  if (command === 'refs') return refs(file, value);
  console.error('Uso:\n  node scripts/codex-pack.mjs get arquivo.json ID\n  node scripts/codex-pack.mjs search arquivo.json TERMO\n  node scripts/codex-pack.mjs refs arquivo.json ID');
  process.exitCode = 2;
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
