import { formatMonsterSheet, formatMonsterSheets } from '@sao/domain';

export { formatMonsterSheet, formatMonsterSheets };

export function downloadMonsterSheet(entity, format = 'txt') {
  const content = formatMonsterSheet(entity, { format });
  const blob = new Blob([content], { type: format === 'md' ? 'text/markdown;charset=utf-8' : 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${String(entity?.name ?? entity?.id ?? 'monstro').replace(/[^\p{L}\p{N}._-]+/gu, '_')}.${format}`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export async function copyMonsterSheet(entity, format = 'txt') {
  await navigator.clipboard.writeText(formatMonsterSheet(entity, { format }));
}
