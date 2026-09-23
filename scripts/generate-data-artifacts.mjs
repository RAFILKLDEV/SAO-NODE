import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { JSON_IMPORT_TEMPLATE, parseSaoDataJson, saoDataJsonSchema } from '@sao/json';

const root = new URL('../', import.meta.url);
const sample = parseSaoDataJson(
  await readFile(new URL('examples/floor01.sample.json', root), 'utf8')
).pack;
// The demo deliberately exposes entity existence; section and field gates remain explicit.
for (const entity of sample.entities) entity.data.visibility.entity = 'public';
const artifacts = {
  'schemas/saoData-v2.schema.json': saoDataJsonSchema(),
  'examples/saoData-v2.template.json': JSON_IMPORT_TEMPLATE,
  'examples/floor01.v2.sample.json': sample
};
await mkdir(new URL('schemas/', root), { recursive: true });
for (const [path, value] of Object.entries(artifacts)) {
  const content = `${JSON.stringify(value, null, 2)}\n`;
  if (process.argv.includes('--check')) {
    if ((await readFile(new URL(path, root), 'utf8')) !== content)
      throw new Error(`Artefato desatualizado: ${path}`);
  } else await writeFile(new URL(path, root), content);
}
console.log(`Artefatos v2 ${process.argv.includes('--check') ? 'conferidos' : 'gerados'}.`);
