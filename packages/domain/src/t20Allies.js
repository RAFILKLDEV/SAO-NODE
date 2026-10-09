import { z } from 'zod';

// Tormenta20 — Jogo do Ano, Parceiros, pp. 260–261.
// https://jamboeditora.com.br/wp-content/uploads/2022/09/jamboeditora-t20-jogo-do-ano-.pdf
// Mechanical summaries; higher grades include earlier benefits only where specified.
export const t20AllyRanks = { iniciante: 'Iniciante', veterano: 'Veterano', mestre: 'Mestre' };
export const t20AllyTypes = [
  { id: 'adepto', name: 'Adepto', benefits: {
    iniciante: 'Magias de 1º círculo: custo reduzido em 1 PM.',
    veterano: 'Magias de 1º e 2º círculos: custo reduzido em 1 PM.',
    mestre: 'Magias de 1º e 2º círculos: custo reduzido em 1 PM, acumulável com outras reduções.'
  } },
  { id: 'ajudante', name: 'Ajudante', benefits: {
    iniciante: '+2 em duas perícias definidas pelo aliado, exceto Luta e Pontaria.',
    veterano: '+2 em três perícias definidas pelo aliado, exceto Luta e Pontaria.',
    mestre: '+4 em três perícias definidas pelo aliado, exceto Luta e Pontaria.'
  } },
  { id: 'assassino', name: 'Assassino', benefits: {
    iniciante: 'Ataque Furtivo +1d6, somado ao que já possui.',
    veterano: 'Ataque Furtivo +1d6 e flanqueamento contra um inimigo por rodada (+2 nos ataques corpo a corpo).',
    mestre: 'Ataque Furtivo +2d6, somado ao que já possui, e flanqueamento contra um inimigo por rodada (+2 nos ataques corpo a corpo).'
  } },
  { id: 'atirador', name: 'Atirador', benefits: {
    iniciante: 'Dano à distância +1d6 em uma rolagem por rodada.',
    veterano: 'Dano à distância +1d10 em uma rolagem por rodada.',
    mestre: 'Dano à distância +2d8 em uma rolagem por rodada.'
  } },
  { id: 'combatente', name: 'Combatente', benefits: {
    iniciante: 'Testes de ataque +1.',
    veterano: 'Testes de ataque +2.',
    mestre: 'Testes de ataque +3; ataque extra por 5 PM, uma vez por rodada.'
  } },
  { id: 'destruidor', name: 'Destruidor', benefits: {
    iniciante: 'Ação livre, 1 vez/rodada: 1 PM causa 2d6 de ácido, eletricidade, fogo ou frio (definido pelo aliado), em um alvo em alcance curto.',
    veterano: 'Ação livre, 1 vez/rodada: 2d6 por 1 PM ou 4d6 por 2 PM; elemento definido pelo aliado, um alvo em alcance curto.',
    mestre: 'Ação livre, 1 vez/rodada: 2d6 por 1 PM ou 4d6 por 2 PM em um alvo em alcance curto; ou 6d6 por 4 PM em área de raio 6 m em alcance médio. Ácido, eletricidade, fogo ou frio, definido pelo aliado.'
  } },
  { id: 'fortao', name: 'Fortão', benefits: {
    iniciante: 'Dano corpo a corpo +1d8 em uma rolagem por rodada.',
    veterano: 'Dano corpo a corpo +1d12 em uma rolagem por rodada.',
    mestre: 'Dano corpo a corpo +3d6 em uma rolagem por rodada.'
  } },
  { id: 'guardiao', name: 'Guardião', benefits: {
    iniciante: 'Defesa +2.',
    veterano: 'Defesa +3.',
    mestre: 'Defesa +4 e testes de resistência +2.'
  } },
  { id: 'magivocador', name: 'Magivocador', benefits: {
    iniciante: 'Magias de dano: +1 dado do mesmo tipo.',
    veterano: 'Magias de dano: +1 dado do mesmo tipo; CD de resistência das magias +1.',
    mestre: 'Magias de dano: +2 dados do mesmo tipo; CD de resistência das magias +1.'
  } },
  { id: 'medico', name: 'Médico', benefits: {
    iniciante: 'Ação livre, 1 vez/rodada: cura 1d8+1 PV de uma criatura adjacente por 1 PM.',
    veterano: 'Ação livre, 1 vez/rodada, criatura adjacente: cura 1d8+1 PV por 1 PM, cura 3d8+3 PV por 3 PM ou remove uma condição prejudicial por 3 PM.',
    mestre: 'Ação livre, 1 vez/rodada, criatura adjacente: cura 1d8+1 PV por 1 PM, 3d8+3 PV por 3 PM, 6d8+6 PV por 5 PM ou remove uma condição prejudicial por 3 PM.'
  } },
  { id: 'perseguidor', name: 'Perseguidor', benefits: {
    iniciante: 'Percepção e Sobrevivência +2.',
    veterano: 'Sentidos Aguçados: não fica desprevenido contra inimigos que não vê e pode repetir a chance de falha de ataques por camuflagem.',
    mestre: 'Percepção às Cegas: percebe criaturas em alcance curto sem depender da visão.'
  } },
  { id: 'vigilante', name: 'Vigilante', benefits: {
    iniciante: 'Percepção e Iniciativa +2.',
    veterano: 'Esquiva Sobrenatural: não fica surpreendido.',
    mestre: 'Olhos nas Costas: não pode ser flanqueado.'
  } }
].sort((first, second) => first.name.localeCompare(second.name, 'pt-BR'));

export function formatT20Ally(ally) {
  const type = t20AllyTypes.find(type => type.id === ally.type);
  return `${type?.name ?? ally.type} - ${t20AllyRanks[ally.rank] ?? ally.rank}`;
}

export function t20AllyBenefit(ally) {
  return t20AllyTypes.find(type => type.id === ally.type)?.benefits[ally.rank] ?? '';
}

export const t20AllyOptions = t20AllyTypes.flatMap(type => Object.keys(t20AllyRanks).map(rank => ({
  value: `${type.id}:${rank}`, label: formatT20Ally({ type: type.id, rank }), type: type.id, rank
}))).sort((first, second) => first.label.localeCompare(second.label, 'pt-BR'));

export const t20AllyTypesSchema = z.array(z.strictObject({
  type: z.enum(t20AllyTypes.map(type => type.id)),
  rank: z.enum(Object.keys(t20AllyRanks))
})).max(2, 'Cada personagem pode ter no máximo dois tipos de aliado.').refine(
  allies => new Set(allies.map(ally => ally.type)).size === allies.length,
  'Escolha tipos de aliado diferentes.'
);
