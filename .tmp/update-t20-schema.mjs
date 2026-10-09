import { readFile, writeFile } from 'node:fs/promises';
import { saoDataJsonSchema } from '@sao/json';
const generated = saoDataJsonSchema();
const allyTypes = generated.properties.entities.items.oneOf.find(entry => entry.properties.type.const === 'npc').properties.data.properties.allyTypes;
const schema = JSON.parse(await readFile('.tmp/t20-allies/before/schemas/saoData-v2.schema.json', 'utf8'));
let count = 0;
function update(value) {
  if (!value || typeof value !== 'object') return;
  if (value.properties?.type?.const === 'npc' && value.properties.data?.properties) {
    const properties = value.properties.data.properties;
    value.properties.data.properties = Object.fromEntries(Object.entries(properties).flatMap(([key, entry]) => key === 'characterType' ? [[key, entry], ['allyTypes', allyTypes]] : [[key, entry]]));
    count += 1;
  }
  for (const child of Object.values(value)) update(child);
}
update(schema);
if (count !== 2) throw new Error(`Expected two NPC schemas, received ${count}`);
await writeFile('schemas/saoData-v2.schema.json', `${JSON.stringify(schema, null, 2)}\n`, 'utf8');
