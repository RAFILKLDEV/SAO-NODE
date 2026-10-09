import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
const files = ['apps/web/src/App.jsx', 'apps/web/src/pages/EntityPage.jsx', 'apps/web/src/pages/ImportHistoryPage.jsx', 'apps/web/src/pages/MapPage.jsx', 'apps/web/src/components/MapNetworkDialog.jsx', 'apps/web/src/components/MapScaleDialog.jsx', 'apps/web/src/components/LocationImage.jsx', 'apps/web/src/components/MapRoutePopup.jsx', 'apps/web/src/components/MapPinPopup.jsx', 'apps/web/src/components/MapPinPicker.jsx', 'apps/web/src/components/NotificationMenu.jsx', 'apps/web/e2e/location-image.spec.js', 'apps/web/e2e/map-regional-tools.spec.js'];
for (const file of files) {
  const target = `.tmp/outside-dismiss/before/${file}`;
  if (existsSync(target)) continue;
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, await readFile(file));
}
console.log(`Snapshot: ${files.length} arquivos.`);
