import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useOutletContext, useParams } from 'react-router';
import { api } from '../lib/api.js';

function groupKey(name) {
  const slug = String(name ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || `grupo-${Date.now()}`;
  return `group.${slug}`;
}

export function GroupsPage() {
  const { campaignId } = useParams();
  const { isGm } = useOutletContext();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const groups = useQuery({ queryKey: ['groups', campaignId], queryFn: () => api(`/api/v1/campaigns/${campaignId}/groups`) });
  const memberships = useQuery({ queryKey: ['memberships', campaignId], queryFn: () => api(`/api/v1/campaigns/${campaignId}/memberships`), enabled: isGm });
  const create = useMutation({
    mutationFn: () => api(`/api/v1/campaigns/${campaignId}/groups`, { method: 'POST', body: { domainId: groupKey(name), name } }),
    onSuccess: () => { setName(''); queryClient.invalidateQueries({ queryKey: ['groups', campaignId] }); }
  });
  return <><div className="page-heading"><div><small className="eyebrow">ORGANIZAÇÃO DA CAMPANHA</small><h1>Grupos</h1><p>Monte equipes e gerencie seus membros.</p></div></div>{isGm && <section className="module-card campaign-panel"><header><h3>Novo grupo</h3><span className="muted">Apenas o mestre pode alterar grupos</span></header><div className="module-content form-grid"><label>Nome<input value={name} onChange={(e) => setName(e.target.value)} /></label><button className="primary" onClick={() => create.mutate()} disabled={!name.trim() || create.isPending}>Criar grupo</button></div></section>}<div className="stack">{groups.data?.map((group) => <GroupCard key={group.id} group={group} campaignId={campaignId} isGm={isGm} memberships={memberships.data ?? []} onChanged={() => queryClient.invalidateQueries({ queryKey: ['groups', campaignId] })} />)}</div>{groups.data?.length === 0 && <div className="state-card">Nenhum grupo cadastrado.</div>}</>;
}

function GroupCard({ group, campaignId, isGm, memberships, onChanged }) {
  const [userId, setUserId] = useState('');
  const add = useMutation({ mutationFn: () => api(`/api/v1/campaigns/${campaignId}/groups/${encodeURIComponent(group.id)}/members`, { method: 'POST', body: { userId } }), onSuccess: () => { setUserId(''); onChanged(); } });
  const remove = useMutation({ mutationFn: (id) => api(`/api/v1/campaigns/${campaignId}/groups/${encodeURIComponent(group.id)}/members/${id}`, { method: 'DELETE' }), onSuccess: onChanged });
  const memberIds = new Set(group.members.map((member) => member.id));
  const available = memberships.filter((entry) => !memberIds.has(entry.user.id));
  return <article className="module-card campaign-panel"><header><div><h3>{group.name}</h3></div><span>{group.members.length} membros</span></header><div className="module-content"><div className="member-list">{group.members.map((member) => <div key={member.id}><span>{member.name} <small>{member.login}</small></span>{isGm && <button onClick={() => remove.mutate(member.id)}>Remover</button>}</div>)}</div>{isGm && <div className="inline-form"><select aria-label="Jogador" value={userId} onChange={(e) => setUserId(e.target.value)}><option value="">Selecione um jogador</option>{available.map((entry) => <option key={entry.user.id} value={entry.user.id}>{entry.user.name}</option>)}</select><button onClick={() => add.mutate()} disabled={!userId || add.isPending}>Adicionar membro</button></div>}</div></article>;
}
