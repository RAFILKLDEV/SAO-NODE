import { spawn } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
const db = new PrismaClient(), name = `sao_progress_test_${Date.now()}`;
const url = new URL(process.env.DATABASE_URL); url.pathname = `/${name}`;
const run = args => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, args, { stdio: 'inherit', env: { ...process.env, DATABASE_URL: url.href, TEST_DATABASE_URL: url.href, LOG_LEVEL: 'silent' } });
  child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(new Error(`Test command exited ${code}`)));
});
try {
  await db.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
  await run(['node_modules/prisma/build/index.js', 'migrate', 'deploy', '--schema', 'apps/api/prisma/schema.prisma']);
  await run(['node_modules/vitest/vitest.mjs', 'run', '--no-file-parallelism', 'apps/api/tests/progress.integration.test.js']);
} finally {
  await db.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  await db.$disconnect();
}
