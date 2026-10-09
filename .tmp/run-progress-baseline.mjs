import { spawn } from 'node:child_process';
import { readFile, mkdir } from 'node:fs/promises';
import { PrismaClient } from '@prisma/client';
const db = new PrismaClient(), name = `sao_progress_baseline_${Date.now()}`;
const url = new URL(process.env.DATABASE_URL); url.pathname = `/${name}`;
const run = args => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, args, { stdio: 'inherit', env: { ...process.env, DATABASE_URL: url.href, TEST_DATABASE_URL: url.href, LOG_LEVEL: 'silent' } });
  child.on('error', reject); child.on('exit', resolve);
});
try {
  await db.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
  if (await run(['node_modules/prisma/build/index.js', 'migrate', 'deploy', '--schema', 'apps/api/prisma/schema.prisma'])) throw new Error('Baseline migrations failed.');
  await mkdir('.tmp/player-quest-updates', { recursive: true });
  await run(['node_modules/vitest/vitest.mjs', 'run', '--config', '.tmp/progress-before-policy.vitest.config.mjs', '--reporter=json', '--outputFile=.tmp/player-quest-updates/import-baseline.json']);
  const report = JSON.parse(await readFile('.tmp/player-quest-updates/import-baseline.json', 'utf8'));
  if (report.numFailedTests !== 3) throw new Error(`Unexpected baseline failures: ${report.numFailedTests}`);
  console.log(JSON.stringify({ preexistingImportFailures: report.numFailedTests, failures: report.testResults.flatMap(suite => suite.assertionResults.filter(test => test.status === 'failed').map(test => test.title)) }));
} finally {
  await db.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  await db.$disconnect();
}
