const labels = {
  defense: 'Defesa', fortitude: 'Fortitude', reflex: 'Reflexos', will: 'Vontade',
  initiative: 'Iniciativa', perception: 'Percepção', senses: 'Sentidos',
  hp: 'PV', mp: 'PM', strength: 'Força', dexterity: 'Destreza', constitution: 'Constituição',
  intelligence: 'Inteligência', wisdom: 'Sabedoria', charisma: 'Carisma'
};

const line = (label, value) => value == null || value === '' ? '' : `${label}: ${Array.isArray(value) ? value.join(', ') : value}`;
const componentText = (component) => {
  const data = component?.data ?? component ?? {};
  const title = data.name ?? data.title ?? component?.id;
  const details = Object.entries(data).filter(([key, value]) => !['name', 'title'].includes(key) && value != null && value !== '')
    .map(([key, value]) => `${labels[key] ?? key}: ${Array.isArray(value) ? value.join(', ') : typeof value === 'object' ? JSON.stringify(value) : value}`).join('; ');
  return details ? `- ${title}: ${details}` : `- ${title}`;
};

export function formatT20StatBlock(monster = {}) {
  const sheet = monster.statBlocks?.['Ambesek.T20'] ?? monster.sheet ?? {};
  const sections = [
    [monster.name ?? sheet.name, [line('ND', sheet.nd), line('Tipo', [sheet.type, sheet.subtype, sheet.size].filter(Boolean).join(' / ')), line('Iniciativa', sheet.combat?.initiative), line('Percepção', sheet.combat?.perception), line('Sentidos', sheet.combat?.senses), line('Defesa', sheet.combat?.defense), line('Fortitude', sheet.combat?.fortitude), line('Reflexos', sheet.combat?.reflex), line('Vontade', sheet.combat?.will), line('PV', sheet.resources?.hp ?? sheet.combat?.hp), line('PM', sheet.resources?.mp ?? sheet.combat?.mp), line('Deslocamento', sheet.combat?.movement)]],
    ['Atributos', Object.entries(sheet.attributes ?? {}).map(([key, value]) => line(labels[key] ?? key, value))],
    ['Resistências', Object.entries(sheet.resistances ?? {}).map(([key, value]) => line(labels[key] ?? key, value))]
  ];
  for (const [kind, title] of [['attack', 'Ataques'], ['ability', 'Habilidades'], ['skill', 'Perícias'], ['trait', 'Características'], ['movement', 'Deslocamentos']]) {
    const values = (monster.components ?? []).filter((component) => component.kind === kind).map(componentText);
    if (!values.length) values.push(...(monster[{ attack: 'attacks', ability: 'abilities', skill: 'skills', trait: 'traits', movement: 'movements' }[kind]] ?? []).map(componentText));
    if (values.length) sections.push([title, values]);
  }
  return sections.filter(([, values]) => values?.filter(Boolean).length).map(([title, values]) => `${title}\n${values.filter(Boolean).join('\n')}`).join('\n\n');
}

export function parseT20StatBlock(text = '') {
  const result = { statBlocks: { 'Ambesek.T20': {} }, components: [], extensions: { t20Unparsed: [] } };
  for (const raw of String(text).split(/\r?\n/).map((v) => v.trim()).filter(Boolean)) {
    const match = raw.match(/^([^:]+):\s*(.+)$/);
    if (!match) { result.extensions.t20Unparsed.push(raw); continue; }
    const key = Object.entries(labels).find(([, label]) => label.toLowerCase() === match[1].toLowerCase())?.[0];
    if (!key) { result.extensions.t20Unparsed.push(raw); continue; }
    const group = ['defense', 'fortitude', 'reflex', 'will', 'initiative', 'perception', 'senses', 'hp', 'mp'].includes(key) ? 'combat' : 'attributes';
    result.statBlocks['Ambesek.T20'][group] ??= {};
    result.statBlocks['Ambesek.T20'][group][key] = /^-?\d+$/.test(match[2]) ? Number(match[2]) : match[2];
  }
  return result;
}
