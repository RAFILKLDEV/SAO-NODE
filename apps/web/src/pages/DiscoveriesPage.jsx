import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router';
import { api } from '../lib/api.js';

const entityLabels = { npc: 'Personagem', location: 'Local', item: 'Item', monster: 'Monstro', quest: 'Missão' };
const fieldLabels = {
  existence: 'Registro completo',
  basic: 'Informações básicas',
  identity: 'Identidade',
  locations: 'Locais',
  relations: 'Relações',
  services: 'Serviços',
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
  const componentKinds = {
    monster_movement: ['movements', 'Deslocamento'],
    monster_attack: ['attacks', 'Ataque'],
    monster_ability: ['abilities', 'Habilidade'],
    monster_skill: ['skills', 'Perícia'],
    monster_trait: ['traits', 'Característica']
  };
  const [collection, fallback] = componentKinds[item.targetKind] ?? [];
  if (collection) {
    const component = entity?.components?.find((entry) => entry.kind === item.targetKind.replace('monster_', '') && entry.id === item.targetKey);
    return component?.data?.name ?? fallback;
  }
  return 'Detalhe';
}

export function DiscoveriesPage() {
  const { campaignId } = useParams();
  const [view, setView] = useState('players');
  const [page, setPage] = useState(1);
  const [subjectId, setSubjectId] = useState('');
  const pageSize = 100;
  const subjects = useQuery({ queryKey: ['discovery-subjects', campaignId], queryFn: () => api(`/api/v1/campaigns/${campaignId}/discoveries/subjects`) });
  const grants = useQuery({ queryKey: ['discoveries', campaignId, page, subjectId], queryFn: () => api(`/api/v1/campaigns/${campaignId}/discoveries?page=${page}&pageSize=${pageSize}${subjectId ? `&subjectType=user&subjectId=${encodeURIComponent(subjectId)}` : ''}`), enabled: view === 'recent' });
  const totalPages = Math.max(1, Math.ceil((grants.data?.total ?? 0) / pageSize));
  const openSubject = (id) => { setSubjectId(id); setPage(1); setView('recent'); };
  return <>
    <div className="page-heading"><div><h1>Descobertas</h1><p>Permissões por jogador e atualizações recentes.</p></div></div>
    <nav className="admin-tabs" aria-label="Visões de descobertas"><button type="button" className={view === 'players' ? 'active' : ''} onClick={() => { setView('players'); setSubjectId(''); }}>Por jogador</button><button type="button" className={view === 'recent' && !subjectId ? 'active' : ''} onClick={() => { setView('recent'); setSubjectId(''); setPage(1); }}>Últimas atualizações</button>{subjectId && <button type="button" className="active" onClick={() => setView('recent')}>Jogador selecionado</button>}</nav>
    {view === 'players' && <>
      {subjects.isPending && <div className="state-card">Carregando jogadores…</div>}
      {subjects.error && <div className="alert error" role="alert">{subjects.error.message}</div>}
      <section className="discovery-player-grid" aria-label="Descobertas por usuário">{subjects.data?.map((subject) => <article className="discovery-player-card" key={subject.userId}><div><small>{subject.role}</small><h2>{subject.name}</h2><span>{subject.login}</span></div><strong>{subject.count} {subject.count === 1 ? 'permissão' : 'permissões'}</strong><small className="muted">Última atualização: {subject.updatedAt ? new Date(subject.updatedAt).toLocaleString() : 'Nenhuma'}</small><button type="button" onClick={() => openSubject(subject.userId)}>Ver alterações</button></article>)}</section>
      {!subjects.data?.length && !subjects.isPending && !subjects.error && <div className="state-card">Nenhum jogador na campanha.</div>}
    </>}
    {view === 'recent' && <>
      <div className="discovery-recent-heading"><h2>{subjectId ? subjects.data?.find((entry) => entry.userId === subjectId)?.name ?? 'Jogador' : 'Últimas atualizações'}</h2>{subjectId && <button type="button" onClick={() => { setSubjectId(''); setPage(1); }}>Todas as atualizações</button>}</div>
      {grants.isPending && <div className="state-card">Carregando atualizações…</div>}
      {grants.error && <div className="alert error" role="alert">{grants.error.message}</div>}
      <section className="discovery-update-list">{grants.data?.items?.map((item) => <article className="discovery-update-card" key={item.id}><header><div><strong>{item.entityName}</strong><small>{entityLabels[item.entityType] ?? item.entityType} · {item.entityDomainId}</small></div><span className={`grant ${item.allowance}`}>{item.allowance === 'allow' ? '✓ Permitido' : '× Negado'}</span></header><p>{fieldName(item, item.entity)} · Para {item.subjectName}</p><small>Por {item.actorName} · {new Date(item.updatedAt).toLocaleString()}</small><small className="muted">{item.targetKey}</small></article>)}</section>
      {!grants.data?.items?.length && !grants.isPending && !grants.error && <div className="state-card">Nenhuma atualização nesta página.</div>}
      <div className="import-history-pagination"><button disabled={page <= 1} onClick={() => setPage(1)}>Início</button><button disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Anterior</button><span>Página {page} de {totalPages} · {grants.data?.total ?? 0} atualizações</span><button disabled={page >= totalPages} onClick={() => setPage((value) => value + 1)}>Próxima</button><button disabled={page >= totalPages} onClick={() => setPage(totalPages)}>Fim</button></div>
    </>}
  </>;
}
