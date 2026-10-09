const LABELS = {
  id: 'ID',
  name: 'Nome',
  type: 'Tipo',
  subtype: 'Subtipo',
  size: 'Tamanho',
  nd: 'ND',
  classification: 'Classificação',
  description: 'Descrição',
  originalSheet: 'Texto original',
  links: 'Referências',
  references: 'Referências',
  drops: 'Drops',
  movements: 'Deslocamentos e sentidos',
  attacks: 'Ataques',
  abilities: 'Habilidades',
  skills: 'Perícias',
  traits: 'Características especiais'
};

const COMPONENT_GROUPS = {
  movements: 'Deslocamentos e sentidos',
  attacks: 'Ataques',
  abilities: 'Habilidades',
  skills: 'Perícias',
  traits: 'Características especiais'
};

const COMPONENT_KEYS = new Set(Object.keys(COMPONENT_GROUPS));
const STRUCTURAL_KEYS = new Set([
  'id',
  'name',
  'sheet',
  'statBlocks',
  'components',
  'fields',
  'originalSheet',
  'links',
  'references',
  'extraStatBlocks',
  'extensions',
  ...COMPONENT_KEYS
]);
const TECHNICAL_KEYS = new Set([
  'visibility',
  'baseVisibility',
  'source',
  'version',
  'createdAt',
  'updatedAt',
  'active',
  'entityType'
]);

function valueText(value) {
  if (value == null || value === '') return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    return value
      .map((entry) => {
        if (entry == null || entry === '') return '';
        if (typeof entry !== 'object') return String(entry);
        const name = entry.name ?? entry.id ?? entry.type;
        const details = Object.entries(entry)
          .filter(([key, item]) => key !== 'name' && item != null && item !== '')
          .map(([key, item]) => `${LABELS[key] ?? key}: ${valueText(item)}`)
          .join('; ');
        return [name, details].filter(Boolean).join(' — ');
      })
      .filter(Boolean)
      .map((entry) => `- ${entry}`)
      .join('\n');
  }
  if (typeof value === 'object') {
    return Object.entries(value)
      .filter(([, item]) => item != null && item !== '')
      .map(([key, item]) => `${LABELS[key] ?? key}: ${valueText(item)}`)
      .join('\n');
  }
  return String(value);
}

function mergeRecords(base, override) {
  const result = { ...(base ?? {}) };
  for (const [key, value] of Object.entries(override ?? {})) {
    const current = result[key];
    if (current && value && typeof current === 'object' && !Array.isArray(current) && typeof value === 'object' && !Array.isArray(value))
      result[key] = mergeRecords(current, value);
    else result[key] = value;
  }
  return result;
}

function sectionsOf(entity) {
  const data = entity?.data ?? entity ?? {};
  const statBlocks = mergeRecords(data.statBlocks, data.extraStatBlocks);
  const sheet = mergeRecords(statBlocks.default, data.sheet);
  const fields = Array.isArray(data.fields)
    ? Object.fromEntries(data.fields.filter((field) => field?.key).map((field) => [field.key, field.value]))
    : (data.fields && typeof data.fields === 'object' ? data.fields : {});
  const components = Array.isArray(data.components) ? data.components : [];
  const references = Array.isArray(data.links) ? data.links : (Array.isArray(data.references) ? data.references : []);
  const drops = references.filter((reference) => ['drop', 'drops'].includes(reference?.role));
  const groups = {};
  for (const [kind, key] of [['movement', 'movements'], ['attack', 'attacks'], ['ability', 'abilities'], ['skill', 'skills'], ['trait', 'traits']]) {
    groups[key] = data[key] ?? components.filter((component) => component.kind === kind).map(({ kind: _kind, ...component }) => component);
  }
  return { data, sheet, statBlocks, fields, groups, references, drops };
}

function linesForMap(map, prefix = '') {
  return Object.entries(map ?? {}).flatMap(([key, value]) => {
    const text = valueText(value);
    return text ? [`${prefix}${LABELS[key] ?? key}: ${text}`] : [];
  });
}

/** Render a monster without modifying source text stored in originalSheet. */
export function formatMonsterSheet(entity, { format = 'txt' } = {}) {
  const { data, sheet, statBlocks, fields, groups, references, drops } = sectionsOf(entity);
  const title = data.name ?? entity?.name ?? 'Monstro sem nome';
  const original = fields.originalSheet ?? data.originalSheet;
  const markdown = format === 'md';
  const lines = [markdown ? `# ${title}` : title, ''];
  const basic = { ...(data.id ? { id: data.id } : {}), ...sheet };

  for (const [key, value] of Object.entries(data)) {
    if (!STRUCTURAL_KEYS.has(key) && !TECHNICAL_KEYS.has(key) && !(key in basic)) basic[key] = value;
  }
  for (const [key, value] of Object.entries(fields)) {
    if (!(key in basic) && key !== 'originalSheet') basic[key] = value;
  }
  lines.push(...linesForMap(basic));

  const relatedReferences = references.filter((reference) => !drops.includes(reference));
  if (relatedReferences.length)
    lines.push('', markdown ? '## Referências' : 'REFERÊNCIAS', '', ...linesForMap({ references: relatedReferences }));
  if (drops.length)
    lines.push('', markdown ? '## Drops' : 'DROPS', '', ...linesForMap({ drops }));

  for (const [blockName, block] of Object.entries(statBlocks).filter(([key]) => key !== 'default')) {
    if (!block || typeof block !== 'object' || !Object.keys(block).length) continue;
    lines.push('', markdown ? `## Estatísticas — ${blockName}` : `ESTATÍSTICAS — ${blockName.toUpperCase()}`, '', ...linesForMap(block));
  }

  for (const [key, label] of Object.entries(COMPONENT_GROUPS)) {
    const entries = groups[key] ?? [];
    if (!entries.length) continue;
    lines.push('', markdown ? `## ${label}` : label.toUpperCase(), '');
    for (const entry of entries) {
      const entryData = entry?.data ?? entry ?? {};
      const entryName = entryData.name ?? entryData.type ?? entry.id ?? 'Registro';
      lines.push(markdown ? `### ${entryName}` : entryName);
      for (const [field, value] of Object.entries(entryData)) {
        if (field === 'name') continue;
        const text = valueText(value);
        if (text) lines.push(`${LABELS[field] ?? field}: ${text}`);
      }
      lines.push('');
    }
  }

  const extra = data.extensions;
  if (extra && Object.keys(extra).length)
    lines.push('', markdown ? '## Informações adicionais' : 'INFORMAÇÕES ADICIONAIS', '', ...linesForMap(extra));
  if (original !== undefined && original !== null)
    lines.push('', markdown ? '## Texto original' : 'TEXTO ORIGINAL', '', original);

  // Never trim or collapse this output: doing so would mutate originalSheet.
  return lines.join('\n') + '\n';
}

export function formatMonsterSheets(entities, options = {}) {
  return (entities ?? [])
    .map((entity) => formatMonsterSheet(entity, options))
    .join('\n\n' + (options.format === 'md' ? '---\n\n' : '====================\n\n'));
}
