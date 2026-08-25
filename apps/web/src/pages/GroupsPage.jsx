import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useOutletContext, useParams } from 'react-router';
import { api } from '../lib/api.js';

export function GroupsPage() {
  const { campaignId } = useParams();
  const { isGm } = useOutletContext();
  const queryClient = useQueryClient();
  const [newGroup, setNewGroup] = useState({ domainId: '', name: '' });
  const groups = useQuery({ queryKey: ['groups', campaignId], queryFn: () => api(`/api/v1/campaigns/${campaignId}/groups`) });
  const create = useMutation({ mutationFn: () => api(`/api/v1/campaigns/${campaignId}/groups`, { method: 'POST', body: newGroup }), onSuccess: () => { setNewGroup({ domainId: '', name: '' }); queryClient.invalidateQueries({ queryKey: ['groups', campaignId] }); } });
  return <><div className="page-heading"><div><h1>Grupos</h1><p>Permissões são recalculadas a partir dos membros atuais.</p></div></div>{isGm && <div className="card form-grid"><label>ID permanente<input value={newGroup.domainId} onChange={(e) => setNewGroup({ ...newGroup, domainId: e.target.value })} placeholder="group.frontline" /></label><label>Nome<input value={newGroup.name} onChange={(e) => setNewGroup({ ...newGroup, name: e.target.value })} /></label><button className="primary" onClick={() => create.mutate()}>Criar grupo</button></div>}<div className="stack">{groups.data?.map((group) => <GroupCard key={group.id} group={group} campaignId={campaignId} isGm={isGm} onChanged={() => queryClient.invalidateQueries({ queryKey: ['groups', campaignId] })} />)}</div></>;
}

function GroupCard({ group, campaignId, isGm, onChanged }) {
  const [userId, setUserId] = useState('');
  const add = useMutation({ mutationFn: () => api(`/api/v1/campaigns/${campaignId}/groups/${encodeURIComponent(group.id)}/members`, { method: 'POST', body: { userId } }), onSuccess: () => { setUserId(''); onChanged(); } });
  const remove = useMutation({ mutationFn: (id) => api(`/api/v1/campaigns/${campaignId}/groups/${encodeURIComponent(group.id)}/members/${id}`, { method: 'DELETE' }), onSuccess: onChanged });
  return <article className="card"><div className="card-head"><div><strong>{group.name}</strong><small>{group.id}</small></div><span>{group.members.length} membros</span></div><div className="member-list">{group.members.map((member) => <div key={member.id}><span>{member.name} <small>{member.login}</small></span>{isGm && <button onClick={() => remove.mutate(member.id)}>Remover</button>}</div>)}</div>{isGm && <div className="inline-form"><input placeholder="User ID" value={userId} onChange={(e) => setUserId(e.target.value)} /><button onClick={() => add.mutate()} disabled={!userId}>Adicionar</button></div>}</article>;
}
