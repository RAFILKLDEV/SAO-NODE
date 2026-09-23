import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { parseSaoDataJson } from '@sao/json';

const args = process.argv.slice(2); const file = args.find(value => !value.startsWith('--'));
const catalogFlag = args.indexOf('--catalog'); const catalogFile = catalogFlag >= 0 ? args[catalogFlag + 1] : null;
if (!file) { console.error('Uso: node scripts/validate-pack.mjs arquivo.json [--catalog base.json]'); process.exit(2); }
const hash = value => createHash('sha256').update(value).digest('hex');
const backendSources = {};
for (const source of ['packages/shared/src/index.js', 'packages/domain/src/index.js', 'packages/domain/src/v2.js', 'packages/json/src/index.js']) {
  try { backendSources[source] = hash(await readFile(new URL(`../${source}`, import.meta.url))); } catch { /* report only available sources */ }
}
try {
  const input = await readFile(file, 'utf8'); const catalog = catalogFile ? (parseSaoDataJson(await readFile(catalogFile, 'utf8')).pack.entities) : [];
  const parsed = parseSaoDataJson(input, { catalog });
  const report = { valid: true, backendSchemaValidated: true, databaseImportTested: false, backendSources, schemaVersion: parsed.pack.schemaVersion, packId: parsed.pack.packId, warnings: parsed.warnings, diagnostics: parsed.diagnostics, discardedFields: [] };
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  console.log(JSON.stringify({ valid: false, backendSchemaValidated: false, databaseImportTested: false, backendSources, errors: [{ message: error.message }] }, null, 2));
  process.exitCode = 1;
}
