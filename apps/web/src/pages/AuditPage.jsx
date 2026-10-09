import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router';
import { api } from '../lib/api.js';

export function AuditPage() {
  const { campaignId } = useParams();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const pageSize = 50;
  const audit = useQuery({ queryKey: ['audit', campaignId, page], queryFn: () => api(`/api/v1/campaigns/${campaignId}/audit?page=${page}&pageSize=${pageSize}`) });
  const undo = useMutation({
    mutationFn: (id) => api(`/api/v1/campaigns/${campaignId}/audit/${id}/undo`, { method: 'POST', body: {} }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['audit', campaignId] });
      await queryClient.invalidateQueries({ predicate: (query) => query.queryKey.includes(campaignId) });
    }
  });
  const totalPages = Math.max(1, Math.ceil((audit.data?.total ?? 0) / pageSize));
  return <>
    <div className="page-heading"><div><h1>Auditoria</h1><p>Alterações, responsáveis e conteúdo afetado.</p></div></div>
    {audit.isError && <div className="alert error" role="alert">{audit.error.message}</div>}
    {undo.error && <div className="alert error" role="alert">{undo.error.message}</div>}
    <div className="table-wrap"><table><thead><tr><th>Data</th><th>Ação</th><th>Ator</th><th>Conteúdo</th><th>Campo/destino</th><th>Assunto</th><th>Ações</th></tr></thead><tbody>{audit.data?.items?.map((entry) => <tr key={entry.id}>
      <td>{new Date(entry.createdAt).toLocaleString()}</td>
      <td>{actionLabel(entry.action)}{entry.revertedAt && <small className="block">Desfeito em {new Date(entry.revertedAt).toLocaleString()}</small>}</td>
      <td>{entry.actor?.name ?? 'Usuário removido'}<small className="block">{entry.actor?.login ?? entry.actorUserId}</small></td>
      <td>{entry.entityName ?? (entry.entityType ? entityLabel(entry.entityType) : 'Campanha')}<small className="block">{entry.entityType && `${entityLabel(entry.entityType)} · ${entry.entityDomainId}`}</small></td>
      <td>{entry.targetKind ? <>{targetLabel(entry.targetKind)}<small className="block">{entry.targetKey}</small></> : '—'}</td>
      <td>{entry.subjectName ?? (entry.subjectType ? subjectLabel(entry.subjectType) : '—')}</td>
      <td><details><summary>Detalhes</summary><pre>{JSON.stringify({ antes: entry.before, depois: entry.after }, null, 2)}</pre>{entry.reversible && <button type="button" className="danger" disabled={undo.isPending} onClick={() => { if (window.confirm(`Desfazer ${entry.action} em ${entry.entityName ?? entry.entityDomainId}? Isso só funciona se o conteúdo não tiver mudado depois.`)) undo.mutate(entry.id); }}>Desfazer</button>}</details></td>
    </tr>)}</tbody></table></div>
    {!audit.data?.items?.length && !audit.isPending && <div className="state-card">Nenhum evento de auditoria.</div>}
    <div className="audit-pagination"><button disabled={page === 1} onClick={() => setPage(1)}>Início</button><button disabled={page === 1} onClick={() => setPage((value) => value - 1)}>Anterior</button><span>Página {page} de {totalPages} · {audit.data?.total ?? 0} eventos</span><button disabled={page >= totalPages} onClick={() => setPage((value) => value + 1)}>Próxima</button><button disabled={page >= totalPages} onClick={() => setPage(totalPages)}>Fim</button></div>
  </>;
}

function entityLabel(type) {
  return ({ npc: 'Personagem', location: 'Local', item: 'Item', monster: 'Monstro', quest: 'Missão' })[type] ?? 'Conteúdo';
}

function targetLabel(kind) {
  return ({ entity: 'Registro', field: 'Campo', objective: 'Objetivo', location_connection: 'Conexão', monster_stat: 'Ficha', monster_movement: 'Deslocamento', monster_attack: 'Ataque', monster_ability: 'Habilidade', monster_skill: 'Perícia', monster_trait: 'Característica' })[kind] ?? 'Detalhe';
}

function subjectLabel(type) {
  return type === 'group' ? 'Grupo' : type === 'user' || type === 'player' ? 'Jogador' : 'Campanha';
}

function actionLabel(action) {
  return ({
    'campaign.create': 'Campanha criada',
    'entity.create': 'Conteúdo criado',
    'entity.update': 'Conteúdo atualizado',
    'entity.delete': 'Conteúdo removido',
    'entity.import.create': 'Conteúdo criado por importação',
    'entity.import.update': 'Conteúdo atualizado por importação',
    'entity.import.remove': 'Conteúdo removido por importação',
    'association.update': 'Associações alteradas',
    'import.undo': 'Importação desfeita',
    'audit.undo': 'Evento desfeito',
    'grant.upsert': 'Permissão alterada',
    'grant.delete': 'Permissão removida',
    'membership.upsert': 'Participação atualizada',
    'membership.delete': 'Participação removida',
    'user.update': 'Conta atualizada',
    'user.self.update': 'Perfil atualizado',
    'membership.photo.update': 'Foto atualizada'
  })[action] ?? action;
}
