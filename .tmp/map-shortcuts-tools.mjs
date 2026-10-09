import { readFile, writeFile } from 'node:fs/promises';
const file = 'apps/web/src/components/MapCanvas.jsx';
await writeFile(file, (await readFile(file, 'utf8')).replace('Alt+clique: ping · Ctrl+Z: desfazer', 'Alt+clique: ping (3s) · Ctrl+arrastar: lápis · Ctrl+Z: desfazer'), 'utf8');
