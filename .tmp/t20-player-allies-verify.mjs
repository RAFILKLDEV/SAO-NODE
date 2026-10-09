import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { prisma } from '../apps/api/src/lib/prisma.js';
import { config } from '../apps/api/src/lib/config.js';
import { t20AllyTypesSchema } from '../packages/domain/src/index.js';

const folder = '.tmp/t20-player-allies';
const before = JSON.parse(await readFile(`${folder}/before.json`, 'utf8'));
const classification = JSON.parse(await readFile(`${folder}/classification.json`, 'utf8'));
const saved = JSON.parse(await readFile(`${folder}/saved.json`, 'utf8'));
let cookie;
let csrfToken;
try {
  const rows = await prisma.entity.findMany({ where: { id: { in: before.map(row => row.id) } }, include: { fields: true, references: true } });
  for (const original of before) {
    const row = JSON.parse(JSON.stringify(rows.find(row => row.id === original.id)));
    const choice = classification.find(choice => choice.id === row.domainId);
    assert.equal(t20AllyTypesSchema.parse(row.data.allyTypes).length, 2);
    assert.deepEqual(row.data.allyTypes, choice.allyTypes);
    assert.equal(row.version, original.version + 1);
    const comparable = structuredClone(row);
    comparable.version = original.version;
    comparable.updatedAt = original.updatedAt;
    comparable.localModifiedAt = original.localModifiedAt;
    if ('allyTypes' in original.data) comparable.data.allyTypes = original.data.allyTypes;
    else delete comparable.data.allyTypes;
    assert.deepEqual(comparable, original, `Alteração fora de allyTypes: ${row.domainId}`);
  }
  const logs = await prisma.auditLog.findMany({ where: { id: { in: saved.map(row => row.auditId) } } });
  assert.equal(logs.length, 13);
  for (const log of logs) {
    assert.equal(log.action, 'entity.update');
    assert.deepEqual(log.after.data.allyTypes, classification.find(row => row.id === log.entityDomainId).allyTypes);
  }
  const login = await fetch('http://localhost:3001/api/v1/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ login: config.localAdminLogin, password: config.localAdminPassword }) });
  assert.equal(login.status, 200, 'Login local para verificação da API');
  cookie = login.headers.get('set-cookie').split(';')[0];
  csrfToken = (await login.json()).csrfToken;
  const apiChecks = await Promise.all(classification.map(async row => {
    const response = await fetch(`http://localhost:3001/api/v1/campaigns/${row.campaignId}/npcs/${row.id}`, { headers: { cookie } });
    assert.equal(response.status, 200, row.id);
    const entity = await response.json();
    assert.deepEqual(entity.allyTypes ?? entity.data?.allyTypes, row.allyTypes, `Aliados ausentes na API: ${row.id}`);
    return row.id;
  }));
  const result = { checked: rows.length, exactlyTwoTypes: true, otherFieldsUnchanged: true, audits: logs.length, apiResponses: apiChecks.length };
  await writeFile(`${folder}/verification.json`, JSON.stringify(result, null, 2), 'utf8');
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  console.error(error.code ?? 'VERIFICATION_FAILED', error.message);
  process.exitCode = 1;
} finally {
  if (cookie && csrfToken) await fetch('http://localhost:3001/api/v1/auth/logout', { method: 'POST', headers: { cookie, 'x-csrf-token': csrfToken } }).catch(() => undefined);
  await prisma.$disconnect();
}
