import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const command = args[0];

const ignoredDirs = new Set([
  '.git',
  'node_modules',
  'dist',
  'coverage',
  'playwright-report',
  'test-results',
  'data/backups',
  'data/uploads'
]);
const ignoredFiles = new Set(['package-lock.json']);
const maxSearchMatches = 80;
const maxFileLines = 300;
const maxSearchFileBytes = 512 * 1024;

function normalizeRelative(input = '.') {
  const target = path.resolve(repoRoot, input);
  const rel = path.relative(repoRoot, target);
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error('Caminho fora do repositório.');
  return { target, rel: rel || '.' };
}

function isIgnored(rel) {
  const normalized = rel.split(path.sep).join('/');
  if (ignoredFiles.has(path.basename(normalized))) return true;
  const parts = normalized.split('/').filter(Boolean);
  for (const ignored of ignoredDirs) {
    if (ignored.includes('/')) {
      if (normalized === ignored || normalized.startsWith(`${ignored}/`) || normalized.includes(`/${ignored}/`) || normalized.endsWith(`/${ignored}`)) return true;
      continue;
    }
    if (parts.includes(ignored)) return true;
  }
  return false;
}

async function tree(input = '.', depthArg = '2') {
  const depth = Math.max(0, Math.min(Number(depthArg) || 2, 6));
  const { target, rel } = normalizeRelative(input);
  const lines = [];

  async function walk(dir, prefix, level, relDir) {
    if (level > depth) return;
    const entries = (await readdir(dir, { withFileTypes: true }))
      .filter((entry) => !isIgnored(path.join(relDir, entry.name)))
      .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (lines.length >= 220) return;
      const childRel = path.join(relDir, entry.name);
      lines.push(`${prefix}${entry.isDirectory() ? '📁' : '📄'} ${entry.name}`);
      if (entry.isDirectory() && level < depth) await walk(path.join(dir, entry.name), `${prefix}  `, level + 1, childRel);
    }
  }

  console.log(`# tree ${rel} (profundidade ${depth})`);
  await walk(target, '', 0, rel === '.' ? '' : rel);
  console.log(lines.join('\n'));
  if (lines.length >= 220) console.log('\n[saída limitada a 220 entradas]');
}

async function* filesUnder(dir, relDir = '') {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const rel = path.join(relDir, entry.name);
    if (isIgnored(rel)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* filesUnder(full, rel);
    else yield { full, rel };
  }
}

function looksText(rel) {
  return /\.(?:js|jsx|mjs|cjs|ts|tsx|json|md|prisma|css|html|ya?ml|toml|txt|sh)$/i.test(rel) || path.basename(rel) === 'Dockerfile';
}

async function search(term, input = '.') {
  if (!term) throw new Error('Uso: npm run context:search -- TERMO [diretorio]');
  const { target, rel } = normalizeRelative(input);
  const needle = term.toLowerCase();
  let matches = 0;
  console.log(`# search ${JSON.stringify(term)} em ${rel}`);
  for await (const file of filesUnder(target, rel === '.' ? '' : rel)) {
    if (!looksText(file.rel)) continue;
    const info = await stat(file.full);
    if (info.size > maxSearchFileBytes) continue;
    let content;
    try { content = await readFile(file.full, 'utf8'); } catch { continue; }
    const lines = content.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      if (!lines[i].toLowerCase().includes(needle)) continue;
      const text = lines[i].trim().replace(/\s+/g, ' ').slice(0, 240);
      console.log(`${file.rel}:${i + 1}: ${text}`);
      matches += 1;
      if (matches >= maxSearchMatches) {
        console.log(`[saída limitada a ${maxSearchMatches} ocorrências]`);
        return;
      }
    }
  }
  if (!matches) console.log('[nenhuma ocorrência]');
}

async function file(input, startArg = '1', endArg) {
  if (!input) throw new Error('Uso: npm run context:file -- CAMINHO [inicio] [fim]');
  const { target, rel } = normalizeRelative(input);
  if (isIgnored(rel)) throw new Error(`Arquivo ignorado para economia de contexto: ${rel}`);
  const lines = (await readFile(target, 'utf8')).split(/\r?\n/);
  const start = Math.max(1, Number(startArg) || 1);
  const requestedEnd = endArg ? Number(endArg) : start + 199;
  const end = Math.min(lines.length, Math.max(start, requestedEnd), start + maxFileLines - 1);
  console.log(`# ${rel}:${start}-${end} de ${lines.length}`);
  for (let i = start; i <= end; i += 1) console.log(`${String(i).padStart(5)} | ${lines[i - 1]}`);
  if (end < lines.length) console.log(`[há mais conteúdo; peça outro intervalo se necessário]`);
}

async function main() {
  if (command === 'tree') return tree(args[1], args[2]);
  if (command === 'search') return search(args[1], args[2]);
  if (command === 'file') return file(args[1], args[2], args[3]);
  console.error('Uso:\n  node scripts/codex-context.mjs tree [diretorio] [profundidade]\n  node scripts/codex-context.mjs search TERMO [diretorio]\n  node scripts/codex-context.mjs file CAMINHO [inicio] [fim]');
  process.exitCode = 2;
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
