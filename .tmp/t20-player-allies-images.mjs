import { readFile, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { config } from '../apps/api/src/lib/config.js';

const characters = JSON.parse(await readFile('.tmp/t20-player-allies/characters.json', 'utf8'));
const images = await Promise.all(characters.map(async character => {
  const url = character.data.media?.image;
  let file;
  try {
    if (url?.startsWith(`/api/v1/campaigns/${character.campaignId}/media/`)) {
      file = path.join(config.uploadDir, character.campaignId, path.basename(url));
      try { await access(file); }
      catch {
        file = path.resolve(`.tmp/t20-player-allies/${character.id}${path.extname(url)}`);
        await promisify(execFile)('docker', ['cp', `sao-node-api-1:/app/data/uploads/${character.campaignId}/${path.basename(url)}`, file]);
      }
    } else if (url?.startsWith('https://')) {
      const response = await fetch(url, { signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const extension = response.headers.get('content-type')?.includes('png') ? 'png' : 'jpg';
      file = path.resolve(`.tmp/t20-player-allies/${character.id}.${extension}`);
      await writeFile(file, Buffer.from(await response.arrayBuffer()));
    } else throw new Error('Sem imagem acessível');
    return { id: character.id, name: character.name, file };
  } catch (error) {
    return { id: character.id, name: character.name, error: error.message };
  }
}));
await writeFile('.tmp/t20-player-allies/images.json', JSON.stringify(images, null, 2), 'utf8');
console.log(JSON.stringify(images, null, 2));
