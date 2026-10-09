import { itemCategoryOptions, questTypeOptions } from '@sao/domain';

export const mapPinTypes = [
  { value: 'location', label: 'Locais' },
  { value: 'npc', label: 'Personagens' },
  { value: 'item', label: 'Itens' },
  { value: 'monster', label: 'Monstros' },
  { value: 'quest', label: 'Missões' }
];

const characterLabels = { entity: 'Entidade', npc: 'NPC', player: 'Jogador' };
const characterOrder = { entity: 0, npc: 1, player: 2 };
const monsterLabels = { common: 'Comum', elite: 'Elite', boss: 'Boss' };
const monsterOrder = { common: 0, elite: 1, boss: 2 };
const questOrder = { main: 0, side: 1, daily: 2, event: 3 };
const optionLabel = (options, value, fallback) => options.find((option) => option.value === value)?.label ?? (value || fallback);
const normalize = (value) => String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('pt-BR');

export function mapPinCandidateKey(candidate) {
  return `${candidate.type}:${candidate.id}`;
}

export function mapPinCandidateLabel(candidate) {
  let prefix;
  switch (candidate.type) {
    case 'location': prefix = (candidate.locationType ?? candidate.pinType) === 'region' ? 'Região' : candidate.regionName || candidate.areaName || 'Sem região'; break;
    case 'npc': prefix = characterLabels[candidate.characterType] ?? 'NPC'; break;
    case 'item': prefix = optionLabel(itemCategoryOptions, candidate.category, 'Sem categoria'); break;
    case 'monster': prefix = monsterLabels[candidate.rank] ?? 'Comum'; break;
    case 'quest': prefix = optionLabel(questTypeOptions, candidate.questType, 'Sem categoria'); break;
    default: prefix = 'Entidade';
  }
  return `${prefix} — ${candidate.name}`;
}

export function mapPinCandidateRows(candidates, type, search = '') {
  const query = normalize(search.trim());
  const order = (candidate) => {
    if (type === 'npc') return characterOrder[candidate.characterType ?? 'npc'] ?? 1;
    if (type === 'monster') return monsterOrder[candidate.rank ?? 'common'] ?? 0;
    if (type === 'quest') return questOrder[candidate.questType] ?? 4;
    return 0;
  };
  return candidates.filter((candidate) => !candidate.pinned && candidate.type === type)
    .map((candidate) => ({ ...candidate, key: mapPinCandidateKey(candidate), label: mapPinCandidateLabel(candidate) }))
    .filter((candidate) => !query || normalize(`${candidate.label} ${candidate.subtitle ?? ''}`).includes(query))
    .sort((a, b) => order(a) - order(b) || a.label.localeCompare(b.label, 'pt-BR', { numeric: true }) || a.id.localeCompare(b.id));
}
