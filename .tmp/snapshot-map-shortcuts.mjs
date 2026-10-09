import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
const files = ['apps/web/src/components/MapCanvas.jsx', 'apps/web/src/components/MapCanvas.css', 'apps/web/src/pages/MapPage.jsx', 'apps/api/src/routes/map-canvas.js', 'apps/web/e2e/map-canvas.spec.js', 'apps/api/tests/map-canvas.integration.test.js'];
for (const file of files) {
  const target = `.tmp/map-shortcuts/before/${file}`;
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, await readFile(file));
}
