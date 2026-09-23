import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router';
import { api } from '../lib/api.js';

export function AuditPage() {
  const { campaignId } = useParams();
  const audit = useQuery({ queryKey: ['audit', campaignId], queryFn: () => api(`/api/v1/campaigns/${campaignId}/audit?pageSize=100`) });
  return <><div className="page-heading"><div><h1>Auditoria</h1><p>Histórico imutável de alterações sensíveis.</p></div></div><div className="table-wrap"><table><thead><tr><th>Data</th><th>Ação</th><th>Ator</th><th>Conteúdo</th><th>Destinatário</th></tr></thead><tbody>{audit.data?.map((entry) => <tr key={entry.id}><td>{new Date(entry.createdAt).toLocaleString()}</td><td>{entry.action}</td><td>Usuário autorizado</td><td>{entry.entityType ? entityLabel(entry.entityType) : 'Campanha'}{entry.targetKind ? <small className="block">{targetLabel(entry.targetKind)}</small> : null}</td><td>{entry.subjectType ? subjectLabel(entry.subjectType) : '—'}</td></tr>)}</tbody></table></div></>;
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
