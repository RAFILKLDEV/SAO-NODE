import { formatMonsterSheet } from '../monsterSheet.js';

// Converte uma entidade monster (v2 canônica) em um XML <criatura> no formato
// já consumido pelo plugin Firecast/Tormenta20 (parseCriaturaXML em MonsterIA.lua),
// o mesmo formato que hoje é gerado por uma IA a partir de texto livre.
//
// O schema de monstro do SAO-NODE é agnóstico de sistema: statBlocks.combat/
// resources/resistances/attributes são mapas chave/valor livres, sem vocabulário
// fixo (ver docs/data-v2.md). Por isso a extração abaixo usa sinônimos tolerantes
// em vez de nomes de chave fixos.

const stripAccents = (value) => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
const normalizeKey = (value) => stripAccents(value).toLowerCase().replace(/[^a-z0-9]/g, '');

const ATTRIBUTE_SYNONYMS = {
  for: ['for', 'forca', 'strength', 'str'],
  des: ['des', 'destreza', 'dexterity', 'dex'],
  con: ['con', 'constituicao', 'constitution', 'vigor'],
  int: ['int', 'inteligencia', 'intelligence'],
  sab: ['sab', 'sabedoria', 'wisdom', 'wis'],
  car: ['car', 'carisma', 'charisma', 'cha']
};
const RESISTANCE_SYNONYMS = {
  fort: ['fort', 'fortitude'],
  ref: ['ref', 'reflexos', 'reflex'],
  von: ['von', 'vontade', 'will']
};
const RESOURCE_SYNONYMS = {
  pv: ['pv', 'hp', 'pontosdevida', 'pontosvida', 'vida'],
  mana: ['mana', 'pm', 'pontosdemana', 'pontosmana']
};
const COMBAT_SYNONYMS = {
  defesa: ['defesa', 'ca', 'defense', 'armorclass', 'classedearmadura'],
  deslocamento: ['deslocamento', 'movimento', 'desloc', 'speed', 'movement']
};
const ATTACK_DETAIL_SYNONYMS = {
  quantidade: ['quantidade', 'qtd', 'qnt', 'numeroataques', 'numero'],
  bonus: ['bonus'],
  dano: ['dano', 'damage'],
  tipo: ['tipo', 'type'],
  alcance: ['alcance', 'range'],
  critico: ['critico', 'critical']
};
const IMMUNITY_KEYWORDS = ['imunidade', 'imune'];
const RESISTANCE_KEYWORDS = ['resistencia', 'resistente'];
const SENSE_KEYWORDS = [
  'sentido', 'visao', 'percepcao', 'faro', 'audicao', 'olfato', 'tremorsenso',
  'cego', 'surdo', 'visaonoescuro', 'infravisao', 'ouvido'
];

function pickBySynonyms(map, synonyms) {
  if (!map) return undefined;
  for (const [key, value] of Object.entries(map)) {
    const normalized = normalizeKey(key);
    if (synonyms.includes(normalized)) return value;
  }
  return undefined;
}

function textOrDefault(value, fallback) {
  const text = value === undefined || value === null ? '' : String(value).trim();
  return text === '' ? fallback : text;
}

// Valores descritivos (descrição, texto original e notas) são deliberadamente
// mantidos sem trim/collapse. O parser do Firecast pode apresentar uma versão
// compactada, mas o XML continua sendo uma transferência lossless.
function rawText(value, fallback = '') {
  if (value === undefined || value === null) return fallback;
  return String(value);
}

function numberTextOrDefault(value, fallback = '0') {
  if (value === undefined || value === null || value === '') return fallback;
  return String(value).trim();
}

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function tag(name, value) {
  return `<${name}>${escapeXml(value)}</${name}>`;
}

function itemListTag(name, items) {
  const list = items.length ? items : ['nenhum'];
  const body = list.map((item) => `        <item>${escapeXml(item)}</item>`).join('\n');
  return `    <${name}>\n${body}\n    </${name}>`;
}

function fieldValue(monster, key) {
  const field = (monster.fields ?? []).find((entry) => entry.key === key);
  return field ? field.value : '';
}

function componentsOfKind(monster, kind) {
  return (monster.components ?? []).filter((component) => component.kind === kind);
}

function detailEntries(data) {
  return Object.entries(data ?? {}).filter(([key]) => key !== 'name');
}

function inferAttackDiceFromText(text) {
  const source = String(text ?? '');
  const dano = source.match(/\d+d\d+(?:\s*[+-]\s*\d+)?/i)?.[0] ?? '';
  const bonus = source.match(/[+-]\s*\d+(?=\s|$)/)?.[0]?.replace(/\s+/g, '') ?? '';
  const quantidade = source.match(/(\d+)\s*(?:ataques?|golpes?)/i)?.[1] ?? '';
  return { dano, bonus, quantidade };
}

function buildAttackItem(component) {
  const data = component.data ?? {};
  const nome = textOrDefault(data.name, 'Ataque');
  const details = Object.fromEntries(detailEntries(data));
  const quantidade = pickBySynonyms(details, ATTACK_DETAIL_SYNONYMS.quantidade);
  const bonus = pickBySynonyms(details, ATTACK_DETAIL_SYNONYMS.bonus);
  const dano = pickBySynonyms(details, ATTACK_DETAIL_SYNONYMS.dano);
  const tipo = pickBySynonyms(details, ATTACK_DETAIL_SYNONYMS.tipo);
  const alcance = pickBySynonyms(details, ATTACK_DETAIL_SYNONYMS.alcance);
  const critico = pickBySynonyms(details, ATTACK_DETAIL_SYNONYMS.critico);
  const descricao = details.descricao ?? details.description;
  const observacoes = details.observacoes ?? details.observations ?? details.notes;

  // Quando não há chaves estruturadas de dano/bônus, tenta extrair de um texto
  // livre qualquer (ex.: { text: "Investida com presas (+8, 1d8+4)" }).
  const freeText = dano === undefined
    ? Object.values(details).filter((value) => typeof value === 'string').join(' ')
    : '';
  const inferred = freeText ? inferAttackDiceFromText(freeText) : {};

  return [
    '        <item>',
    `            ${tag('nome', nome)}`,
    `            ${tag('quantidade', numberTextOrDefault(quantidade ?? inferred.quantidade, '1'))}`,
    `            ${tag('bonus', textOrDefault(bonus ?? inferred.bonus, ''))}`,
    `            ${tag('dano', textOrDefault(dano ?? inferred.dano, ''))}`,
    `            ${tag('tipo', textOrDefault(tipo, ''))}`,
    alcance !== undefined ? `            ${tag('alcance', textOrDefault(alcance, ''))}` : '',
    critico !== undefined ? `            ${tag('critico', textOrDefault(critico, ''))}` : '',
    descricao !== undefined ? `            ${tag('descricao', rawText(descricao))}` : '',
    observacoes !== undefined ? `            ${tag('observacoes', rawText(observacoes))}` : '',
    '        </item>'
  ].filter(Boolean).join('\n');
}

function buildAbilityItem(nome, descricao) {
  return [
    '        <item>',
    `            ${tag('nome', nome)}`,
    `            ${tag('descricao', descricao)}`,
    '        </item>'
  ].join('\n');
}

function buildStructuredItem(data, nameKeys = ['name']) {
  const name = rawText(data?.name ?? data?.nome ?? '');
  const fields = Object.entries(data ?? {}).filter(([key]) => !nameKeys.includes(key) && key !== 'name');
  const aliases = {
    description: 'descricao', observations: 'observacoes', notes: 'observacoes',
    trigger: 'gatilho', cost: 'custo', recharge: 'recarga', range: 'alcance',
    target: 'alvo', duration: 'duracao', type: 'tipo'
  };
  const tags = fields.map(([key, value]) => {
    let tagName = aliases[key] ?? key.replace(/[^A-Za-z0-9_:-]/g, '_');
    if (!/^[A-Za-z_]/.test(tagName)) tagName = `campo_${tagName}`;
    if (value === undefined || value === null || value === '') return '';
    const text = typeof value === 'object' ? JSON.stringify(value) : rawText(value);
    return `            ${tag(tagName, text)}`;
  }).filter(Boolean);
  return ['        <item>', `            ${tag('nome', name)}`, ...tags, '        </item>'].join('\n');
}

function buildSkillEntry(component) {
  const data = component.data ?? {};
  const nome = textOrDefault(data.name, '');
  const bonusLike = detailEntries(data)
    .map(([, value]) => value)
    .find((value) => /^[+-]?\d+$/.test(String(value ?? '').trim()));
  if (bonusLike === undefined) return nome;
  const bonus = String(bonusLike).trim();
  return `${nome} ${bonus.startsWith('+') || bonus.startsWith('-') ? bonus : `+${bonus}`}`;
}

function buildMovementEntry(component) {
  const data = component.data ?? {};
  const nome = textOrDefault(data.name, '');
  const values = detailEntries(data).map(([, value]) => value).filter((value) => value !== undefined && value !== '');
  return values.length ? `${nome} ${values.join(' ')}`.trim() : nome;
}

function classifyTrait(component) {
  const data = component.data ?? {};
  const nome = textOrDefault(data.name, '');
  const normalized = normalizeKey(nome);
  if (IMMUNITY_KEYWORDS.some((keyword) => normalized.includes(keyword))) return 'imunidades';
  if (RESISTANCE_KEYWORDS.some((keyword) => normalized.includes(keyword))) return 'resistencias';
  if (SENSE_KEYWORDS.some((keyword) => normalized.includes(keyword))) return 'sentidos';
  return 'habilidades';
}

function buildTipo(sheet) {
  const type = textOrDefault(sheet.type, '');
  const subtype = textOrDefault(sheet.subtype, '');
  if (subtype) return `${type || 'Criatura'} (${subtype})`;
  return textOrDefault(type, 'nenhum');
}

function componentNumericValue(monster, terms) {
  for (const component of monster?.components ?? []) {
    const data = component.data ?? {};
    const name = normalizeKey(data.name ?? data.nome ?? '');
    if (!terms.some((term) => name.includes(term))) continue;
    const value = Object.entries(data)
      .filter(([key]) => !['name', 'nome', 'description', 'descricao'].includes(key))
      .map(([, entry]) => String(entry ?? '').trim())
      .find((entry) => /^[+-]?\d+(?:\.\d+)?$/.test(entry));
    if (value !== undefined) return value;
  }
  return undefined;
}

/**
 * Gera o XML <criatura> (mesmo formato produzido pelo proxy Gemini) a partir de
 * uma entidade monster v2 canônica do SAO-NODE (com `statBlocks`, `components`
 * e `fields`, como devolvido por `entityRecordToCanonical`/`normalizeEntity`).
 */
export function buildTormenta20CriaturaXml(monster) {
  // Accept both the canonical entity and the entity-record wrapper returned by
  // older API services (`{ data: canonical }`).
  monster = monster?.data ?? monster ?? {};
  const sheet = monster?.statBlocks?.default ?? {};
  const attributes = sheet.attributes ?? {};
  const combat = sheet.combat ?? {};
  const resources = sheet.resources ?? {};
  const resistances = sheet.resistances ?? {};

  const nome = textOrDefault(monster?.name, 'Criatura');
  const tipo = buildTipo(sheet);
  const descricao = rawText(fieldValue(monster, 'description'), '');
  const originalSheet = rawText(fieldValue(monster, 'originalSheet') ?? monster?.originalSheet, '');
  const media = monster?.media ?? {};
  const imagemURL = rawText(media.image || media.portrait, '');

  const movements = componentsOfKind(monster, 'movement');
  const movementValues = [];
  const combatMovement = pickBySynonyms(combat, COMBAT_SYNONYMS.deslocamento);
  if (combatMovement !== undefined && combatMovement !== '') movementValues.push(rawText(combatMovement));
  movementValues.push(...movements.map(buildMovementEntry).filter(Boolean));
  const deslocamento = [...new Set(movementValues)].join(', ');

  const linkedEquipamentos = (monster?.links ?? [])
    // Item references are the only typed links that can be represented as
    // equipment. Keep them even when older records omit the role.
    .filter((link) => link.type === 'item')
    .map((link) => link.name ?? link.resolvedName ?? link.label ?? link.id);
  const componentEquipamentos = componentsOfKind(monster, 'equipment')
    .concat(componentsOfKind(monster, 'item'))
    .map((component) => {
      const data = component.data ?? {};
      const name = data.name ?? data.nome ?? '';
      const details = Object.entries(data)
        .filter(([key, value]) => !['name', 'nome'].includes(key) && value !== undefined && value !== '')
        .map(([key, value]) => `${key}: ${typeof value === 'object' ? JSON.stringify(value) : value}`);
      return [name, ...details].filter(Boolean).join(' ');
    }).filter(Boolean);
  const fieldEquipamentos = fieldValue(monster, 'equipment') || fieldValue(monster, 'equipamentos');
  const equipamentos = [...linkedEquipamentos, ...componentEquipamentos];
  if (typeof fieldEquipamentos === 'string' && fieldEquipamentos) equipamentos.push(fieldEquipamentos);
  else if (Array.isArray(fieldEquipamentos)) equipamentos.push(...fieldEquipamentos.map((value) => typeof value === 'string' ? value : JSON.stringify(value)).filter(Boolean));

  const skills = componentsOfKind(monster, 'skill').map(buildSkillEntry).filter(Boolean);
  const allAbilities = componentsOfKind(monster, 'ability');
  const spellLike = (component) => {
    const data = component?.data ?? {};
    const marker = normalizeKey(data.kind ?? data.type ?? data.category ?? data.tipo ?? '');
    return marker === 'spell' || marker === 'magia' || data.isSpell === true;
  };
  const abilities = allAbilities.filter((component) => !spellLike(component));
  const spells = componentsOfKind(monster, 'spell')
    .concat(componentsOfKind(monster, 'magic'))
    .concat(allAbilities.filter(spellLike));
  const traits = componentsOfKind(monster, 'trait');

  const sentidos = [];
  const resistenciasEspeciais = [];
  const imunidades = [];
  const extraAbilities = [];
  for (const trait of traits) {
    const data = trait.data ?? {};
    const nomeTrait = textOrDefault(data.name, '');
    if (!nomeTrait) continue;
    const bucket = classifyTrait(trait);
    // Keep the canonical label in list fields expected by the Lua sheet. The
    // complete value/description remains available in dadosAdicionais/source JSON.
    if (bucket === 'imunidades') imunidades.push(nomeTrait);
    else if (bucket === 'resistencias') resistenciasEspeciais.push(nomeTrait);
    else if (bucket === 'sentidos') sentidos.push(nomeTrait);
    else {
      // Traits sem categoria reconhecida não são descartados: viram habilidades extras.
      const descricaoTrait = detailEntries(data).map(([, value]) => value).filter(Boolean).join(' ');
      extraAbilities.push(buildAbilityItem(nomeTrait, descricaoTrait));
    }
  }

  const attackItems = componentsOfKind(monster, 'attack').map(buildAttackItem);
  const abilityItems = [
    ...abilities.map((component) => buildStructuredItem(component.data ?? {})),
    ...extraAbilities
  ];

  const initiative = pickBySynonyms(combat, ['iniciativa', 'initiative', 'init'])
    ?? componentNumericValue(monster, ['iniciativa', 'initiative']);
  const percepcao = pickBySynonyms(combat, ['percepcao', 'perception'])
    ?? pickBySynonyms(attributes, ['percepcao', 'perception'])
    ?? componentNumericValue(monster, ['percepcao', 'perception']);
  const sourceJson = (() => { try { return JSON.stringify(monster); } catch { return ''; } })();
  let additionalText = '';
  try { additionalText = formatMonsterSheet(monster); } catch { additionalText = ''; }

  const xml = [
    '<criatura>',
    `    ${tag('nome', nome)}`,
    `    ${tag('nd', numberTextOrDefault(sheet.nd, '0'))}`,
    `    ${tag('tipo', tipo)}`,
    `    ${tag('tamanho', textOrDefault(sheet.size, 'Médio'))}`,
    `    ${tag('descricao', descricao)}`,
    `    ${tag('imagemURL', imagemURL)}`,
    `    ${tag('iniciativa', numberTextOrDefault(initiative, '0'))}`,
    `    ${tag('percepcao', numberTextOrDefault(percepcao, '0'))}`,
    `    ${tag('originalSheet', originalSheet)}`,
    `    ${tag('dadosAdicionais', additionalText)}`,
    `    ${tag('saoNodeSourceJson', sourceJson)}`,
    '',
    `    ${tag('mana', numberTextOrDefault(pickBySynonyms(resources, RESOURCE_SYNONYMS.mana), '0'))}`,
    '',
    '    <atributos>',
    `        ${tag('for', numberTextOrDefault(pickBySynonyms(attributes, ATTRIBUTE_SYNONYMS.for), '0'))}${tag('des', numberTextOrDefault(pickBySynonyms(attributes, ATTRIBUTE_SYNONYMS.des), '0'))}${tag('con', numberTextOrDefault(pickBySynonyms(attributes, ATTRIBUTE_SYNONYMS.con), '0'))}`,
    `        ${tag('int', numberTextOrDefault(pickBySynonyms(attributes, ATTRIBUTE_SYNONYMS.int), '0'))}${tag('sab', numberTextOrDefault(pickBySynonyms(attributes, ATTRIBUTE_SYNONYMS.sab), '0'))}${tag('car', numberTextOrDefault(pickBySynonyms(attributes, ATTRIBUTE_SYNONYMS.car), '0'))}`,
    '    </atributos>',
    '',
    `    ${tag('pv', numberTextOrDefault(pickBySynonyms(resources, RESOURCE_SYNONYMS.pv), '0'))}`,
    `    ${tag('defesa', numberTextOrDefault(pickBySynonyms(combat, COMBAT_SYNONYMS.defesa), '0'))}`,
    `    ${tag('deslocamento', textOrDefault(deslocamento, 'nenhum'))}`,
    '',
    '    <defesas>',
    `        ${tag('fort', numberTextOrDefault(pickBySynonyms(resistances, RESISTANCE_SYNONYMS.fort), '0'))}`,
    `        ${tag('ref', numberTextOrDefault(pickBySynonyms(resistances, RESISTANCE_SYNONYMS.ref), '0'))}`,
    `        ${tag('von', numberTextOrDefault(pickBySynonyms(resistances, RESISTANCE_SYNONYMS.von), '0'))}`,
    '    </defesas>',
    '',
    itemListTag('equipamentos', equipamentos),
    '',
    itemListTag('sentidos', sentidos),
    '',
    itemListTag('pericias', skills),
    '',
    itemListTag('resistencias', resistenciasEspeciais),
    '',
    itemListTag('imunidades', imunidades),
    '',
    '    <magias>',
    spells.length ? spells.map((component) => buildStructuredItem(component.data ?? {})).join('\n') : buildStructuredItem({ name: 'nenhuma' }),
    '    </magias>',
    '',
    '    <ataques>',
    attackItems.length ? attackItems.join('\n') : buildAttackItem({ data: { name: 'Ataque' } }),
    '    </ataques>',
    '',
    '    <habilidades>',
    abilityItems.length ? abilityItems.join('\n') : buildAbilityItem('nenhuma', ''),
    '    </habilidades>',
    '</criatura>'
  ].join('\n');

  return xml;
}
