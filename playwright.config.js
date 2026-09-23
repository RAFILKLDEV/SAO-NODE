import { defineConfig } from '@playwright/test';

const database = process.env.E2E_DATABASE_URL;
const apiBase = process.env.E2E_API_URL ?? 'http://127.0.0.1:3001';
const webBase = process.env.E2E_WEB_URL ?? 'http://127.0.0.1:5173';
export default defineConfig({
  testDir: './apps/web/e2e',
  workers: 1,
  use: { baseURL: webBase, trace: 'retain-on-failure' },
  webServer: database ? [
    { command: 'node apps/api/src/server.js', url: `${apiBase}/health`, timeout: 30000, env: { DATABASE_URL: database, API_PORT: new URL(apiBase).port, WEB_ORIGIN: webBase, DISABLE_LOGIN: 'false', COOKIE_SECURE: 'false', LOG_LEVEL: 'silent' } },
    { command: `node ../../node_modules/vite/bin/vite.js --host 127.0.0.1 --port ${new URL(webBase).port} --strictPort`, cwd: 'apps/web', url: webBase, timeout: 30000, env: { API_PROXY_TARGET: apiBase } }
  ] : undefined
});
