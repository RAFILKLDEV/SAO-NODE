import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { extname } from 'node:path';
import { TextDecoder } from 'node:util';

// Escapes keep this checker from detecting its own examples as corruption.
const suspicious = /\uFFFD|\u00C3[\u0080-\u00BF]|\u00C2[\u0080-\u00BF]|\u00E2(?:[\u0080-\u009F]|\u20AC|\u201A)|\u00F0(?:\u009F|\u0178)|\u00EF\u00BB\u00BF/gu;
const textExtensions = new Set([
  '.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.json', '.md', '.mdx',
  '.html', '.css', '.scss', '.yaml', '.yml', '.txt', '.sql', '.prisma',
  '.svg', '.xml', '.csv', '.ps1', '.py', '.toml',
]);

function gitFiles(args) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
    .split('\0').filter(Boolean);
}

function changedFiles() {
  // HEAD includes staged and unstaged edits; untracked files are checked too.
  const files = [
    ...gitFiles(['diff', 'HEAD', '--name-only', '--diff-filter=ACMRT', '-z']),
    ...gitFiles(['ls-files', '--others', '--exclude-standard', '-z']),
  ];
  return [...new Set(files)].filter((file) => {
    const path = file.replaceAll('\\', '/');
    return textExtensions.has(extname(path).toLowerCase())
      && !/(^|\/)(node_modules|dist|coverage|playwright-report|test-results)(\/|$)/u.test(path)
      && !/(^|\/)data\/backups\//u.test(path)
      && !/(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock)$/u.test(path);
  });
}

export function inspectUtf8(bytes) {
  let content;
  try {
    content = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return [{ line: 1, column: 1, reason: 'invalid UTF-8 bytes' }];
  }
  const issues = [];
  for (const [index, line] of content.split(/\r\n|\n|\r/u).entries()) {
    for (const match of line.matchAll(suspicious)) {
      issues.push({ line: index + 1, column: match.index + 1, reason: 'suspected mojibake or replacement character' });
    }
  }
  return issues;
}

const args = process.argv.slice(2);
if (!args.length || args.some((arg) => arg.startsWith('--') && arg !== '--changed')
  || (args.includes('--changed') && args.length !== 1)) {
  console.error('Usage: node check-utf8.mjs <file> [file ...] | --changed');
  process.exitCode = 2;
} else {
  try {
    const files = args[0] === '--changed' ? changedFiles() : [...new Set(args)];
    let findings = 0;
    for (const file of files) {
      try {
        const issues = inspectUtf8(readFileSync(file));
        for (const issue of issues) {
          console.error(`${file}:${issue.line}:${issue.column}: ${issue.reason}`);
        }
        findings += issues.length;
      } catch (error) {
        console.error(`${file}: ${error.message}`);
        findings += 1;
      }
    }
    console.log(`UTF-8 check: ${files.length} file(s), ${findings} finding(s). Review suspicious text; no files were modified.`);
    process.exitCode = findings ? 1 : 0;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
  }
}
