import { readFile, writeFile } from 'node:fs/promises';
import { convertLegacyJson, exportSaoData } from '@sao/xml';

const [, , inputPath, outputPath = 'legacy-converted.xml'] = process.argv;
if (!inputPath) {
  console.error('Usage: node scripts/import-legacy-json.mjs <input.json> [output.xml]');
  process.exit(1);
}
const json = JSON.parse(await readFile(inputPath, 'utf8'));
const pack = convertLegacyJson(json);
const xml = exportSaoData(pack);
await writeFile(outputPath, xml, 'utf8');
console.log(`Converted ${pack.entities.length} entities to ${outputPath}`);
