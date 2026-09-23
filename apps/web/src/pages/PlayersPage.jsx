import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useOutletContext, useParams } from 'react-router';
import { api } from '../lib/api.js';

export function PlayersPage() {
  const { campaignId } = useParams();
  const { isGm } = useOutletContext();
  const queryClient = useQueryClient();
  const players = useQuery({ queryKey: ['memberships', campaignId], queryFn: () => api(`/api/v1/campaigns/${campaignId}/memberships`) });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['memberships', campaignId] });

  return (
    <>
      <div className="page-heading">
        <div>
          <small className="eyebrow">PARTICIPANTES DA CAMPANHA</small>
          <h1>Jogadores</h1>
          <p>Pessoas participantes e seus papéis na campanha.</p>
        </div>
      </div>
      {isGm && <CreatePlayerCard campaignId={campaignId} onSaved={refresh} />}
      <div className="stack">
        {players.data?.map((entry) => <PlayerCard key={entry.id} entry={entry} campaignId={campaignId} onSaved={refresh} />)}
      </div>
    </>
  );
}

function CreatePlayerCard({ campaignId, onSaved }) {
  const [form, setForm] = useState({ login: '', name: '', password: '' });
  const queryClient = useQueryClient();
  const create = useMutation({
    mutationFn: () => api(`/api/v1/campaigns/${campaignId}/players`, {
      method: 'POST',
      body: {
        login: form.login,
        name: form.name,
        password: form.password
      }
    }),
    onSuccess: () => {
      setForm({ login: '', name: '', password: '' });
      queryClient.invalidateQueries({ queryKey: ['memberships', campaignId] });
      onSaved();
    }
  });

  return (
    <section className="module-card campaign-panel">
      <header>
        <h3>Novo jogador</h3>
        <span className="muted">Cria usuário e já o insere na campanha</span>
      </header>
      <div className="module-content form-grid">
        <label>
          Nome
          <input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} />
        </label>
        <label>
          Login
          <input value={form.login} onChange={(event) => setForm((current) => ({ ...current, login: event.target.value }))} />
        </label>
        <label>
          Senha
          <input type="password" value={form.password} onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))} />
        </label>
        <button
          className="primary"
          onClick={() => create.mutate()}
          disabled={create.isPending}
        >
          {create.isPending ? 'Criando…' : 'Criar jogador'}
        </button>
      </div>
      {create.error && <div className="alert error">{create.error.message}</div>}
    </section>
  );
}

function PlayerCard({ entry, campaignId, onSaved }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ login: entry.user.login, name: entry.user.name, password: '' });
  const [file, setFile] = useState(null);
  const [imageUrl, setImageUrl] = useState(entry.user.characterImageUrl ?? '');
  const queryClient = useQueryClient();
  const update = useMutation({
    mutationFn: () => api(`/api/v1/campaigns/${campaignId}/players/${entry.user.id}`, {
      method: 'PUT',
      body: { login: form.login, name: form.name, ...(form.password ? { password: form.password } : {}) }
    }),
    onSuccess: (saved) => {
      setForm({ login: saved.login, name: saved.name, password: '' });
      setEditing(false);
      onSaved();
    }
  });
  const remove = useMutation({
    mutationFn: () => api(`/api/v1/campaigns/${campaignId}/players/${entry.user.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['memberships', campaignId] });
      onSaved();
    }
  });
  const save = useMutation({
    mutationFn: async () => {
      let nextImageUrl = imageUrl || null;
      if (file) {
        const body = new FormData();
        body.append('image', file);
        const uploaded = await api(`/api/v1/campaigns/${campaignId}/media`, { method: 'POST', body });
        nextImageUrl = uploaded.url;
      }
      return api(`/api/v1/campaigns/${campaignId}/memberships`, {
        method: 'PUT',
        body: { userId: entry.user.id, role: entry.role, characterImageUrl: nextImageUrl }
      });
    },
    onSuccess: (saved) => {
      setImageUrl(saved.characterImageUrl ?? imageUrl);
      setFile(null);
      onSaved();
    }
  });
  return <article className="card compact player-card"><div className="player-card-main">{imageUrl ? <img className="player-avatar" src={imageUrl} alt={`Personagem de ${entry.user.name}`} /> : <div className="player-avatar player-avatar-empty" aria-hidden="true">◇</div>}<div className="card-head"><div><strong>{entry.user.name}</strong><small>{entry.user.login}</small></div><span className="role-pill">{entry.role}</span></div></div>{editing && <div className="module-content form-grid"><label>Nome<input value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} /></label><label>Login<input value={form.login} onChange={(event) => setForm((current) => ({ ...current, login: event.target.value }))} /></label><label>Senha<input type="password" value={form.password} onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))} /></label><div className="actions"><button className="primary" disabled={update.isPending} onClick={() => update.mutate()}>Salvar</button><button disabled={update.isPending} onClick={() => setEditing(false)}>Cancelar</button></div></div>}<div className="player-photo-controls"><label>Foto do personagem<input type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/avif,image/bmp,.png,.jpg,.jpeg,.gif,.webp,.avif,.bmp" onChange={(event) => { setFile(event.target.files?.[0] ?? null); }} /></label><label>Ou cole o link da imagem<input type="url" value={imageUrl} placeholder="https://…" onChange={(event) => { setImageUrl(event.target.value); setFile(null); }} /></label><div className="actions"><button onClick={() => setEditing((current) => !current)}>{editing ? 'Fechar edição' : 'Editar'}</button><button disabled={save.isPending} onClick={() => { setImageUrl(''); setFile(null); save.mutate(); }}>Remover foto</button><button className="primary" disabled={(!file && imageUrl === (entry.user.characterImageUrl ?? '')) || save.isPending} onClick={() => save.mutate()}>{save.isPending ? 'Salvando…' : 'Salvar foto'}</button><button className="danger" disabled={remove.isPending || entry.role === 'owner'} onClick={() => { if (window.confirm(`Excluir ${entry.user.name} da campanha?`)) remove.mutate(); }}>Excluir</button></div></div>{(save.error || update.error || remove.error) && <div className="alert error">{(save.error || update.error || remove.error).message}</div>}</article>;
}
