import React from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router';
import { api } from '../lib/api.js';
import { formatEntityName } from '../lib/entityDisplay.js';

const entityTypes = ['npc', 'location', 'item', 'monster', 'quest'];
const plural = (type) => type === 'location' ? 'locations' : `${type}s`;
const entityLabels = { npc: 'Personagem', location: 'Local', item: 'Item', monster: 'Monstro', quest: 'Missão' };
const fieldLabels = {
  existence: 'Registro completo',
  basic: 'Informações básicas',
  identity: 'Identidade',
  locations: 'Locais',
  relations: 'Relações',
  services: 'Serviços',
  t20: 'Ficha T20',
  references: 'Referências',
  additional: 'Informações adicionais',
  stats: 'Atributos',
  requirements: 'Requisitos',
  flow: 'Fluxo da missão',
  rewards: 'Recompensas',
  shortDescription: 'Resumo',
  description: 'Descrição',
  gmNotes: 'Anotações do mestre',
  appearance: 'Aparência',
  personality: 'Personalidade',
  history: 'História',
  environment: 'Ambiente',
  introduction: 'Introdução',
  completion: 'Conclusão',
  nd: 'Nível de desafio',
  type: 'Tipo',
  subtype: 'Subtipo',
  size: 'Tamanho',
  combat: 'Combate',
  resources: 'Recursos',
  resistances: 'Resistências',
  attributes: 'Atributos'
};

function fieldName(item, entity) {
  const key = item.targetKey?.replace(/^section\./, '');
  if (item.targetKind === 'entity') return 'Registro completo';
  if (item.targetKind === 'field' || item.targetKind === 'monster_stat')
    return fieldLabels[key] ?? 'Campo personalizado';
  if (item.targetKind === 'objective')
    return entity?.objectives?.find((objective) => objective.objectiveId === item.targetKey)?.text ?? 'Objetivo';
  if (item.targetKind === 'location_connection') {
    const connection = entity?.connections?.find((entry) => entry.connectionId === item.targetKey);
    return connection?.target?.name ? `Conexão com ${connection.target.name}` : 'Conexão';
  }
  const componentCollections = {
    monster_movement: ['movements', 'Deslocamento'],
    monster_attack: ['attacks', 'Ataque'],
    monster_ability: ['abilities', 'Habilidade'],
    monster_skill: ['skills', 'Perícia'],
    monster_trait: ['traits', 'Característica']
  };
  const [collection, fallback] = componentCollections[item.targetKind] ?? [];
  if (collection)
    return entity?.[collection]?.find((entry) => entry.id === item.targetKey)?.data?.name ?? fallback;
  return 'Detalhe';
}

export function DiscoveriesPage() {
  const { campaignId } = useParams();
  const grants = useQuery({ queryKey: ['discoveries', campaignId], queryFn: () => api(`/api/v1/campaigns/${campaignId}/discoveries`) });
  const memberships = useQuery({ queryKey: ['memberships', campaignId], queryFn: () => api(`/api/v1/campaigns/${campaignId}/memberships`) });
  const groups = useQuery({ queryKey: ['groups', campaignId], queryFn: () => api(`/api/v1/campaigns/${campaignId}/groups`) });
  const entityQueries = useQueries({ queries: entityTypes.map((type) => ({ queryKey: ['entities', campaignId, type], queryFn: () => api(`/api/v1/campaigns/${campaignId}/${plural(type)}?pageSize=100`) })) });
  const entityFor = (type, id) => entityQueries[entityTypes.indexOf(type)]?.data?.items?.find((item) => item.id === id);
  const entityName = (type, id) => formatEntityName(entityFor(type, id), `${entityLabels[type] ?? 'Conteúdo'} indisponível`);
  const subjectName = (item) => item.subjectType === 'group'
    ? groups.data?.find((group) => group.id === item.subjectId)?.name ?? 'Grupo indisponível'
    : memberships.data?.find((entry) => entry.user.id === item.subjectId)?.user.name ?? 'Jogador indisponível';
  return <><div className="page-heading"><div><h1>Histórico de descobertas</h1><p>Permissões aplicadas aos conteúdos da campanha.</p></div></div><div className="table-wrap"><table><thead><tr><th>Nome</th><th>Nome da entidade</th><th>Campo</th><th>Permitido ou negado</th><th>Data</th></tr></thead><tbody>{grants.data?.map((item) => { const entity = entityFor(item.entityType, item.entityDomainId); const name = entityName(item.entityType, item.entityDomainId); return <tr key={item.id}><td>{subjectName(item)}</td><td title={name}>{name}</td><td>{fieldName(item, entity)}</td><td><span className={`grant ${item.allowance}`}>{item.allowance === 'allow' ? '✓ Permitido' : '× Negado'}</span></td><td>{new Date(item.updatedAt).toLocaleString()}</td></tr>; })}</tbody></table></div>{grants.data?.length === 0 && <div className="state-card">Nenhuma descoberta no histórico.</div>}</>;
}
