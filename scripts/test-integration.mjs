import { spawnSync } from 'node:child_process';

if (!process.env.TEST_DATABASE_URL)
  throw new Error('Defina TEST_DATABASE_URL para um PostgreSQL exclusivo de testes.');
const result = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run'], {
  stdio: 'inherit',
  env: { ...process.env, DATABASE_URL: process.env.TEST_DATABASE_URL, LOG_LEVEL: 'silent' }
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
