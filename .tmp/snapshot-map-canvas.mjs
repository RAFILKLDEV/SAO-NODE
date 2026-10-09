import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
for (const file of ['apps/api/prisma/schema.prisma', 'apps/api/src/app.js', 'apps/api/src/server.js', 'apps/api/src/routes/map.js', 'apps/web/src/App.jsx', 'apps/web/src/pages/MapPage.jsx', 'apps/web/src/pages/MapPage.css', 'apps/web/src/components/MapNetworkLayer.jsx', 'apps/web/e2e/map-regional-tools.spec.js']) {
  const target = `.tmp/map-canvas/before/${file}`;
  if (existsSync(target)) continue;
  await mkdir(dirname(target), { recursive: true }); await writeFile(target, await readFile(file));
}
