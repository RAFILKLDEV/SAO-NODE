import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { PrismaClient } from '@prisma/client';
import { stableValue } from '@sao/domain';
import { parseSaoDataJson, exportSaoDataJson, buildDiff } from '@sao/json';
import { contentInclude, planDataMigration } from '../apps/api/src/services/dataMigration.js';
import { entityRecordToCanonical } from '../apps/api/src/services/content.js';

const backupPath = process.argv[2];
if (!backupPath) throw new Error('Informe o backup JSON produzido por data:migrate --apply.');
const backup = JSON.parse(await readFile(backupPath, 'utf8'));
const prisma = new PrismaClient();
const json = (value) => JSON.parse(JSON.stringify(value));
const sorted = (values) => values.map(json).sort((a, b) => a.id.localeCompare(b.id));
try {
  const rows = await prisma.entity.findMany({ include: contentInclude });
  assert.equal(rows.length, backup.entities.length, 'Quantidade de entidades');
  const byId = new Map(rows.map((row) => [row.id, row]));
  for (const original of backup.entities) {
    const current = byId.get(original.id);
    assert.ok(current, original.domainId);
    for (const key of [
      'id',
      'campaignId',
      'type',
      'domainId',
      'name',
      'active',
      'baseVisibility',
      'version',
      'createdAt',
      'updatedAt',
      'deletedAt',
      'localModifiedAt',
      'source'
    ])
      assert.deepEqual(json(current[key]), original[key], `${original.domainId}.${key}`);
    for (const key of [
      'fields',
      'references',
      'locationConnections',
      'monsterComponents',
      'questObjectives',
      'questRewards'
    ]) {
      const children = new Map(current[key].map((child) => [child.id, json(child)]));
      for (const child of original[key]) {
        assert.ok(children.has(child.id), `Identidade preservada: ${key}.${child.id}`);
        const actual = children.get(child.id);
        if (key === 'questRewards') {
          const { data: _old, ...before } = child;
          const { data: _new, ...after } = actual;
          assert.deepEqual(after, before);
        } else assert.deepEqual(actual, child);
      }
    }
    const expected = entityRecordToCanonical(original, { conflicts: 'preserve' });
    assert.deepEqual(
      stableValue(entityRecordToCanonical(current)),
      stableValue(expected),
      `Conteúdo: ${original.domainId}`
    );
  }
  assert.deepEqual(
    sorted(await prisma.grant.findMany()),
    sorted(backup.grants),
    'Grants preservados'
  );
  const progress = await prisma.questProgress.findMany({ include: { objectives: true } });
  const stableProgress = (values) =>
    sorted(values.map((value) => ({ ...value, objectives: sorted(value.objectives) })));
  assert.deepEqual(
    stableProgress(progress),
    stableProgress(backup.progress),
    'Progresso preservado'
  );
  if (backup.audit)
    assert.deepEqual(
      sorted(await prisma.auditLog.findMany()),
      sorted(backup.audit),
      'Auditoria preservada'
    );
  const catalog = new Map();
  for (const row of rows.filter((row) => !row.deletedAt)) {
    const entries = catalog.get(row.campaignId) ?? [];
    entries.push({ type: row.type, data: entityRecordToCanonical(row) });
    catalog.set(row.campaignId, entries);
  }
  for (const [campaignId, entities] of catalog) {
    const pack = exportSaoDataJson({ packId: campaignId, name: campaignId, entities });
    const parsed = parseSaoDataJson(pack, { maxBytes: 100 * 1024 * 1024 }).pack;
    assert.deepEqual(parsed.entities, pack.entities);
    assert.ok(
      buildDiff(
        entities.map((e) => ({ ...e, id: e.data.id })),
        parsed
      ).every((entry) => entry.status === 'EQUAL')
    );
    if (process.argv.includes('--export'))
      await writeFile(`${backupPath}.${campaignId}.v2.json`, JSON.stringify(pack, null, 2));
  }
  const plan = planDataMigration(rows);
  assert.equal(plan.errors.length, 0);
  assert.equal(plan.changes.length, 0);
  console.log(
    JSON.stringify(
      {
        verified: true,
        entities: rows.length,
        campaigns: catalog.size,
        grants: backup.grants.length,
        progress: progress.length,
        pending: 0,
        warnings: plan.warnings.length,
        exports: process.argv.includes('--export')
      },
      null,
      2
    )
  );
} finally {
  await prisma.$disconnect();
}
