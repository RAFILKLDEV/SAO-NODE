const LABELS = {
  name: 'Nome', type: 'Tipo', subtype: 'Subtipo', size: 'Tamanho', nd: 'ND',
  classification: 'Classificação', description: 'Descrição', originalSheet: 'Texto original'
};

function valueText(value) {
  if (value == null || value === '') return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value, null, 2);
}

function sectionsOf(entity) {
  const data = entity?.data ?? entity ?? {};
  const sheet = data.sheet ?? data.statBlocks?.default ?? {};
  const fields = Array.isArray(data.fields)
    ? Object.fromEntries(data.fields.filter((field) => field?.key).map((field) => [field.key, field.value]))
    : (data.fields && typeof data.fields === 'object' ? data.fields : {});
  const components = Array.isArray(data.components) ? data.components : [];
  const groups = {};
  for (const [kind, key] of [['movement', 'movements'], ['attack', 'attacks'], ['ability', 'abilities'], ['skill', 'skills'], ['trait', 'traits']]) {
    groups[key] = data[key] ?? components.filter((component) => component.kind === kind).map(({ kind: _kind, ...component }) => component);
  }
  return { data, sheet, fields, groups };
}

function linesForMap(map, prefix = '') {
  return Object.entries(map ?? {}).flatMap(([key, value]) => {
    const text = valueText(value);
    return text ? [`${prefix}${LABELS[key] ?? key}: ${text}`] : [];
  });
}

export function formatMonsterSheet(entity, { format = 'txt' } = {}) {
  const { data, sheet, fields, groups } = sectionsOf(entity);
  const title = data.name ?? entity?.name ?? 'Monstro sem nome';
  const original = fields.originalSheet ?? data.originalSheet;
  const lines = [format === 'md' ? `# ${title}` : title, ''];
  const basic = { ...sheet };
  for (const [key, value] of Object.entries(fields)) if (!(key in basic) && key !== 'originalSheet') basic[key] = value;
  lines.push(...linesForMap(basic));
  for (const [key, label] of Object.entries({ movements: 'Deslocamentos e sentidos', attacks: 'Ataques', abilities: 'Habilidades', skills: 'Perícias', traits: 'Características especiais' })) {
    const entries = groups[key] ?? [];
    if (!entries.length) continue;
    lines.push('', format === 'md' ? `## ${label}` : label.toUpperCase(), '');
    for (const entry of entries) {
      const entryData = entry?.data ?? entry ?? {};
      const entryName = entryData.name ?? entryData.type ?? entry.id ?? 'Registro';
      lines.push(format === 'md' ? `### ${entryName}` : entryName);
      for (const [field, value] of Object.entries(entryData)) {
        if (field === 'name') continue;
        const text = valueText(value);
        if (text) lines.push(`${LABELS[field] ?? field}: ${text}`);
      }
      lines.push('');
    }
  }
  const extra = data.extraStatBlocks ?? data.extensions;
  if (extra && Object.keys(extra).length) lines.push('', format === 'md' ? '## Informações adicionais' : 'INFORMAÇÕES ADICIONAIS', '', ...linesForMap(extra));
  if (original) lines.push('', format === 'md' ? '## Texto original' : 'TEXTO ORIGINAL', '', original);
  return lines.join('\n').replace(/\n{4,}/g, '\n\n\n').trimEnd() + '\n';
}

export function formatMonsterSheets(entities, options = {}) {
  return (entities ?? []).map((entity) => formatMonsterSheet(entity, options)).join('\n\n' + (options.format === 'md' ? '---\n\n' : '====================\n\n'));
}

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
