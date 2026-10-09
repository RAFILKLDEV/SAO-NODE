import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
const root = '.tmp/t20-allies';
await mkdir(root, { recursive: true });
const files = ['packages/domain/src/index.js', 'packages/domain/src/v2.js', 'packages/domain/src/entityMetadata.js', 'apps/web/src/pages/EntityPage.jsx', 'apps/web/src/styles.css', 'schemas/saoData-v2.schema.json'];
for (const path of files) {
  const target = join(root, 'before', path);
  if (!existsSync(target)) { await mkdir(dirname(target), { recursive: true }); await writeFile(target, await readFile(path)); }
}
const target = join(root, 'tormenta20-jogo-do-ano.pdf');
if (!existsSync(target)) {
  const response = await fetch('https://jamboeditora.com.br/wp-content/uploads/2022/09/jamboeditora-t20-jogo-do-ano-.pdf');
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  await writeFile(target, Buffer.from(await response.arrayBuffer()));
}
console.log('Snapshot e PDF oficial disponíveis em', root);
