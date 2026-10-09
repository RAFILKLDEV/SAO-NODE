import React, { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useOutletContext, useParams } from 'react-router';
import { api } from '../lib/api.js';
import './GroupsPage.css';

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
  const [creating, setCreating] = useState(false);
  const groups = useQuery({ queryKey: ['groups', campaignId], queryFn: () => api(`/api/v1/campaigns/${campaignId}/groups`) });
  const memberships = useQuery({ queryKey: ['memberships', campaignId], queryFn: () => api(`/api/v1/campaigns/${campaignId}/memberships`), enabled: isGm });
  const create = useMutation({
    mutationFn: () => api(`/api/v1/campaigns/${campaignId}/groups`, { method: 'POST', body: { domainId: groupKey(name), name } }),
    onSuccess: () => { setName(''); setCreating(false); queryClient.invalidateQueries({ queryKey: ['groups', campaignId] }); }
  });
  const changed = () => {
    queryClient.invalidateQueries({ queryKey: ['groups', campaignId] });
    queryClient.invalidateQueries({ queryKey: ['map-group-members', campaignId] });
  };
  return <div className="groups-page"><div className="page-heading"><div><small className="eyebrow">ORGANIZAÇÃO DA CAMPANHA</small><h1>Grupos</h1><p>Jogadores e personagens da equipe.</p></div>{isGm && <button type="button" aria-expanded={creating} onClick={() => setCreating(current => !current)}>Novo grupo</button>}</div>{creating && isGm && <form className="group-create-form" onSubmit={event => { event.preventDefault(); if (name.trim()) create.mutate(); }}><label>Nome do grupo<input autoFocus value={name} maxLength={120} onChange={event => setName(event.target.value)} /></label><button type="submit" className="primary" disabled={!name.trim() || create.isPending}>Criar</button><button type="button" disabled={create.isPending} onClick={() => setCreating(false)}>Cancelar</button>{create.error && <p className="alert error" role="alert">{create.error.message}</p>}</form>}{groups.isLoading ? <p className="muted">Carregando grupos…</p> : groups.isError ? <p className="alert error" role="alert">{groups.error.message}</p> : <div className="group-card-list">{groups.data?.map(group => <GroupCard key={group.id} group={group} campaignId={campaignId} isGm={isGm} memberships={memberships.data ?? []} onChanged={changed} />)}</div>}{groups.data?.length === 0 && <div className="state-card">Nenhum grupo cadastrado.</div>}</div>;
}

function GroupCard({ group, campaignId, isGm, memberships, onChanged }) {
  const [editing, setEditing] = useState(false), [kind, setKind] = useState('player'), [selectedId, setSelectedId] = useState('');
  const [search, setSearch] = useState(''), [query, setQuery] = useState('');
  useEffect(() => { const timer = setTimeout(() => setQuery(search.trim()), 250); return () => clearTimeout(timer); }, [search]);
  const candidates = useQuery({ queryKey: ['group-character-candidates', campaignId, query], queryFn: () => api(`/api/v1/campaigns/${campaignId}/npcs?${new URLSearchParams({ pageSize: '100', ...(query ? { search: query } : {}) })}`), enabled: isGm && editing && kind === 'character' });
  const base = `/api/v1/campaigns/${campaignId}/groups/${encodeURIComponent(group.id)}`;
  const add = useMutation({ mutationFn: () => api(`${base}/${kind === 'player' ? 'members' : 'characters'}`, { method: 'POST', body: kind === 'player' ? { userId: selectedId } : { characterId: selectedId } }), onSuccess: () => { setSelectedId(''); onChanged(); } });
  const remove = useMutation({ mutationFn: member => api(`${base}/${member.type === 'player' ? 'members' : 'characters'}/${encodeURIComponent(member.id)}`, { method: 'DELETE' }), onSuccess: onChanged });
  const members = [...group.members.map(member => ({ ...member, type: 'player' })), ...(group.characters ?? []).map(member => ({ ...member, type: 'character' }))];
  const available = kind === 'player' ? memberships.filter(entry => !group.members.some(member => member.id === entry.user.id)).map(entry => ({ id: entry.user.id, name: entry.user.name })) : (candidates.data?.items ?? []).filter(entry => !(group.characters ?? []).some(member => member.id === entry.id));
  const busy = add.isPending || remove.isPending;
  return <article className="group-card" aria-label={`Grupo ${group.name}`}>
    <header><div><h2>{group.name}</h2><small>{members.length} {members.length === 1 ? 'integrante' : 'integrantes'}</small></div>{isGm && <button type="button" aria-label={`Editar integrantes de ${group.name}`} aria-expanded={editing} disabled={busy} onClick={() => setEditing(current => !current)}>{editing ? 'Concluir' : 'Integrantes'}</button>}</header>
    <ul className="group-members">{members.map(member => <li key={`${member.type}:${member.id}`}><span>{member.name}</span><small>{member.type === 'player' ? 'Jogador' : 'Personagem'}</small>{isGm && editing && <button type="button" className="group-remove" aria-label={`Remover ${member.name} do grupo ${group.name}`} title="Remover integrante" disabled={busy} onClick={() => remove.mutate(member)}>×</button>}</li>)}</ul>
    {!members.length && <p className="muted group-empty">Nenhum integrante visível.</p>}
    {isGm && editing && <form className="group-member-form" onSubmit={event => { event.preventDefault(); if (selectedId) add.mutate(); }}>
      <label>Tipo<select aria-label="Tipo" value={kind} disabled={busy} onChange={event => { setKind(event.target.value); setSelectedId(''); add.reset(); }}><option value="player">Jogador</option><option value="character">Personagem</option></select></label>
      {kind === 'character' && <label className="group-member-search">Buscar personagem<input value={search} disabled={busy} placeholder="Nome…" onChange={event => { setSearch(event.target.value); setSelectedId(''); }} /></label>}
      <label className="group-member-select">{kind === 'player' ? 'Jogador' : 'Personagem'}<select aria-label={kind === 'player' ? 'Jogador' : 'Personagem'} value={selectedId} disabled={busy || (candidates.isLoading && kind === 'character')} onChange={event => setSelectedId(event.target.value)}><option value="">Selecione…</option>{available.map(entry => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label>
      <button type="submit" disabled={!selectedId || busy}>Adicionar</button>
      {kind === 'character' && candidates.isError && <p className="alert error" role="alert">{candidates.error.message}</p>}
      {(add.error || remove.error) && <p className="alert error" role="alert">{(add.error || remove.error).message}</p>}
    </form>}
  </article>;
}
