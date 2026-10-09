import { spawn } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { createServer } from 'node:net';
const freePort = () => new Promise(resolve => { const server = createServer(); server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => resolve(port)); }); });
const apiPort = await freePort(), webPort = await freePort();
const db = new PrismaClient();
const name = `sao_canvas_test_${Date.now()}`;
const url = new URL(process.env.DATABASE_URL); url.pathname = `/${name}`;
const run = args => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, args, { stdio: 'inherit', env: { ...process.env, DATABASE_URL: url.href, TEST_DATABASE_URL: url.href, E2E_DATABASE_URL: url.href, E2E_API_URL: `http://127.0.0.1:${apiPort}`, E2E_WEB_URL: `http://127.0.0.1:${webPort}`, LOG_LEVEL: 'silent' } });
  child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(new Error(`Test command exited ${code}`)));
});
try {
  await db.$executeRawUnsafe(`CREATE DATABASE "${name}"`);
  await run(['node_modules/prisma/build/index.js', 'migrate', 'deploy', '--schema', 'apps/api/prisma/schema.prisma']);
  if (!process.argv.includes('--live-only')) await run(['node_modules/vitest/vitest.mjs', 'run', '--no-file-parallelism', 'apps/api/tests/map-canvas.integration.test.js', 'apps/api/tests/map-boards.integration.test.js', 'apps/api/tests/progress.integration.test.js']);
  await run(['node_modules/@playwright/test/cli.js', 'test', 'apps/web/e2e/map-canvas-live.spec.js', '--reporter=line', '--output=.tmp/map-canvas/live-results']);
} finally {
  await db.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  await db.$disconnect();
}
