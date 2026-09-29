import { monsterTypeOptions, monsterSubtypeOptions, monsterSizeOptions } from '@sao/domain';

const labels = {
  name: 'Nome', title: 'Título', nd: 'ND', type: 'Tipo', subtype: 'Subtipo', size: 'Tamanho',
  defense: 'Defesa', fortitude: 'Fortitude', reflex: 'Reflexos', will: 'Vontade',
  initiative: 'Iniciativa', perception: 'Percepção', senses: 'Sentidos', movement: 'Deslocamento',
  hp: 'PV', mp: 'PM', hpMax: 'PV máximo', mpMax: 'PM máximo',
  strength: 'Força', dexterity: 'Destreza', constitution: 'Constituição',
  intelligence: 'Inteligência', wisdom: 'Sabedoria', charisma: 'Carisma',
  description: 'Descrição', text: 'Texto', effect: 'Efeito', notes: 'Notas',
  bonus: 'Bônus', damage: 'Dano', critical: 'Crítico', damageType: 'Tipo de dano',
  range: 'Alcance', action: 'Ação', quantity: 'Quantidade', meters: 'Metros',
  mpCost: 'Custo de PM', save: 'Resistência', dc: 'CD', duration: 'Duração',
  value: 'Valor', resistance: 'Resistência a dano', immunity: 'Imunidade',
  equipment: 'Equipamento', items: 'Itens'
};
const groups = { combat: 'Combate', resources: 'Recursos', attributes: 'Atributos', resistances: 'Resistências' };
const kinds = { movement: ['Deslocamentos', 'movements'], attack: ['Ataques', 'attacks'], ability: ['Habilidades', 'abilities'], skill: ['Perícias', 'skills'], trait: ['Características', 'traits'] };
const vocab = { type: monsterTypeOptions, subtype: monsterSubtypeOptions, size: monsterSizeOptions };
const fold = (text) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const keyFor = (label) => Object.keys(labels).find((key) => fold(labels[key]) === fold(label)) ?? label;
const present = (value) => value != null && value !== '';
const scalar = (value) => /^[-+]?\d+(?:\.\d+)?$/.test(value) ? Number(value) : value === 'true' ? true : value === 'false' ? false : value;
const translated = (key, value) => vocab[key]?.find((option) => option.value === value)?.label ?? value;
const persisted = (key, value) => vocab[key]?.find((option) => fold(option.label) === fold(value))?.value ?? scalar(value);

// Indented paths keep extensible maps/arrays readable without displaying JSON.
// Continuation lines preserve multiline descriptions and punctuation verbatim.
function fieldLines(data, prefix = '', indent = '') {
  return Object.entries(data ?? {}).flatMap(([key, value]) => {
    if (!present(value)) return [];
    const path = `${prefix}${labels[key] ?? key}`;
    if (typeof value === 'object') return fieldLines(value, `${path} / `, indent);
    const [first, ...rest] = String(translated(key, value)).split('\n');
    return [`${indent}${path}: ${first}`, ...rest.map((line) => `${indent}| ${line}`)];
  });
}

/** Accepts canonical data or the server's permission-filtered legacy projection. */
export function formatT20StatBlock(monster = {}) {
  const sheet = monster.statBlocks?.['Ambesek.T20'] ?? monster.sheet ?? {};
  const lines = fieldLines({ name: monster.name, nd: sheet.nd, type: sheet.type, subtype: sheet.subtype, size: sheet.size });
  for (const [key, title] of Object.entries(groups)) {
    const content = fieldLines(sheet[key]);
    if (content.length) lines.push('', title, ...content);
  }
  for (const [kind, [title, collection]] of Object.entries(kinds)) {
    const components = monster.components != null
      ? monster.components.filter((component) => component.kind === kind)
      : monster[collection] ?? [];
    if (!components.length) continue;
    lines.push('', title);
    for (const component of components) {
      // Component IDs/visibility stay in the structured model, not in the text.
      lines.push('-', ...fieldLines(component.data ?? {}, '', '  '));
    }
  }
  if (monster.extensions?.t20Unparsed?.length) lines.push('', 'Notas não interpretadas', ...monster.extensions.t20Unparsed);
  return lines.join('\n').trim();
}

function assignPath(target, path, value) {
  const keys = path.split(' / ').map(keyFor);
  // Never interpret prototype properties from pasted content.
  if (keys.some((key) => ['__proto__', 'prototype', 'constructor'].includes(key))) return false;
  let object = target;
  for (let i = 0; i < keys.length - 1; i++) {
    if (object[keys[i]] != null && typeof object[keys[i]] !== 'object') return false;
    object = object[keys[i]] ??= /^\d+$/.test(keys[i + 1]) ? [] : {};
  }
  object[keys.at(-1)] = persisted(keys.at(-1), value);
  return true;
}

/** Parses the formatter's text; only unsupported fragments enter extensions. */
export function parseT20StatBlock(text = '') {
  const sheet = {};
  const result = { statBlocks: { 'Ambesek.T20': sheet }, components: [], extensions: {} };
  const unknown = [];
  let group = null;
  let kind = null;
  let component = null;
  let previous = null;
  let unparsedSection = false;
  const lines = String(text).split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].trim();
    if (raw === 'Notas não interpretadas') { unparsedSection = true; continue; }
    if (unparsedSection) { unknown.push(lines[i]); continue; }
    if (!raw) { previous = null; continue; }
    const continuation = /^\s*\|(?: (.*))?$/.exec(lines[i]);
    if (continuation && previous) {
      previous.value += `\n${continuation[1] ?? ''}`;
      assignPath(previous.target, previous.path, previous.value);
      continue;
    }
    const nextGroup = Object.keys(groups).find((key) => fold(groups[key]) === fold(raw));
    const nextKind = Object.keys(kinds).find((key) => fold(kinds[key][0]) === fold(raw));
    if (nextGroup || nextKind) {
      group = nextGroup ?? null; kind = nextKind ?? null; component = null; previous = null; continue;
    }
    if (kind && raw === '-') {
      component = { id: `${kind}.${result.components.filter((entry) => entry.kind === kind).length + 1}`, kind, visibility: 'public', data: {} };
      result.components.push(component); previous = null; continue;
    }
    const match = raw.match(/^([^:]+):\s*(.*)$/);
    if (!match) { unknown.push(lines[i]); previous = null; continue; }
    const [, path, value] = match;
    const key = keyFor(path);
    if ((kind || group) && group !== 'resistances' && !Object.hasOwn(labels, keyFor(path.split(' / ')[0]))) {
      unknown.push(lines[i]); previous = null; continue;
    }
    let target;
    if (kind) target = component?.data;
    else if (group) target = sheet[group] ??= {};
    else if (key === 'name') target = result;
    else if (['nd', 'type', 'subtype', 'size'].includes(key)) target = sheet;
    else if (['initiative', 'perception', 'senses', 'defense', 'fortitude', 'reflex', 'will', 'movement'].includes(key)) target = sheet.combat ??= {};
    else if (['hp', 'mp', 'hpMax', 'mpMax'].includes(key)) target = sheet.resources ??= {};
    else if (['strength', 'dexterity', 'constitution', 'intelligence', 'wisdom', 'charisma'].includes(key)) target = sheet.attributes ??= {};
    if (key === 'type' && value.includes(' / ') && target === sheet) {
      const [type, subtype, size] = value.split(' / ').map((part) => persisted('type', part));
      sheet.type = type;
      if (subtype) sheet.subtype = persisted('subtype', subtype);
      if (size) sheet.size = persisted('size', size);
      previous = { target: sheet, path: 'Tipo', value };
      continue;
    }
    if (!target || !assignPath(target, path, value)) { unknown.push(lines[i]); previous = null; continue; }
    previous = { target, path, value };
  }
  if (unknown.length) result.extensions.t20Unparsed = unknown;
  return result;
}
