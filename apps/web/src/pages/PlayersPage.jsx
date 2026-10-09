import React, { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useOutletContext, useParams } from 'react-router';
import { api } from '../lib/api.js';

export function PlayersPage() {
  const { campaignId } = useParams();
  const { isGm } = useOutletContext();
  const queryClient = useQueryClient();
  const players = useQuery({ queryKey: ['memberships', campaignId], queryFn: () => api(`/api/v1/campaigns/${campaignId}/memberships`), enabled: isGm });
  const profile = useQuery({ queryKey: ['my-profile', campaignId], queryFn: () => api(`/api/v1/campaigns/${campaignId}/me/profile`), enabled: !isGm });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['memberships', campaignId] });

  if (!isGm) return <SelfProfilePage campaignId={campaignId} query={profile} />;

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

function SelfProfilePage({ campaignId, query }) {
  const queryClient = useQueryClient();
  const [account, setAccount] = useState({ name: '', login: '' });
  const [security, setSecurity] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' });
  const [imageUrl, setImageUrl] = useState('');
  const [file, setFile] = useState(null);
  useEffect(() => {
    if (!query.data) return;
    setAccount({ name: query.data.user.name, login: query.data.user.login });
    setImageUrl(query.data.membership.characterImageUrl ?? '');
  }, [query.data]);
  const refresh = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: ['my-profile', campaignId] }),
    queryClient.invalidateQueries({ queryKey: ['me'] }),
    queryClient.invalidateQueries({ queryKey: ['progress-players', campaignId] }),
    queryClient.invalidateQueries({ queryKey: ['character-players', campaignId] })
  ]);
  const saveAccount = useMutation({
    mutationFn: () => api(`/api/v1/campaigns/${campaignId}/me/profile`, { method: 'PUT', body: { ...(account.name !== query.data.user.name ? { name: account.name } : {}), ...(account.login !== query.data.user.login ? { login: account.login } : {}), ...(account.login !== query.data.user.login ? { currentPassword: security.currentPassword } : {}) } }),
    onSuccess: async () => { setSecurity({ currentPassword: '', newPassword: '', confirmPassword: '' }); await refresh(); }
  });
  const savePassword = useMutation({
    mutationFn: () => api(`/api/v1/campaigns/${campaignId}/me/profile`, { method: 'PUT', body: { currentPassword: security.currentPassword, newPassword: security.newPassword } }),
    onSuccess: async () => { setSecurity({ currentPassword: '', newPassword: '', confirmPassword: '' }); await refresh(); }
  });
  const savePhoto = useMutation({
    mutationFn: async () => {
      let nextImageUrl = imageUrl.trim() || null;
      if (file) {
        const body = new FormData(); body.append('image', file);
        const uploaded = await api(`/api/v1/campaigns/${campaignId}/media?purpose=profile`, { method: 'POST', body });
        nextImageUrl = uploaded.url;
      }
      return api(`/api/v1/campaigns/${campaignId}/me/profile`, { method: 'PUT', body: { characterImageUrl: nextImageUrl } });
    },
    onSuccess: async () => { setFile(null); await refresh(); }
  });
  if (query.isPending) return <div className="state-card">Carregando seu perfil…</div>;
  if (query.isError) return <div className="state-card error" role="alert">{query.error.message}</div>;
  const accountDirty = account.name !== query.data.user.name || account.login !== query.data.user.login;
  const passwordReady = security.currentPassword && security.newPassword && security.newPassword === security.confirmPassword;
  return <>
    <div className="page-heading"><div><small className="eyebrow">SUA CONTA NESTA CAMPANHA</small><h1>Meu perfil</h1><p>Atualize seus dados, sua foto e sua senha.</p></div></div>
    <div className="self-profile-grid">
      <section className="module-card campaign-panel"><header><h2>Dados da conta</h2></header><div className="module-content form-grid"><label>Nome de exibição<input autoComplete="name" value={account.name} onChange={(event) => setAccount((current) => ({ ...current, name: event.target.value }))} /></label><label>Login<input autoComplete="username" value={account.login} onChange={(event) => setAccount((current) => ({ ...current, login: event.target.value }))} /></label>{account.login !== query.data.user.login && <label>Senha atual<input type="password" autoComplete="current-password" value={security.currentPassword} onChange={(event) => setSecurity((current) => ({ ...current, currentPassword: event.target.value }))} /></label>}<button className="primary" disabled={!accountDirty || !account.name.trim() || (account.login !== query.data.user.login && !security.currentPassword) || saveAccount.isPending} onClick={() => saveAccount.mutate()}>{saveAccount.isPending ? 'Salvando…' : 'Salvar dados'}</button>{saveAccount.error && <p className="alert error" role="alert">{saveAccount.error.message}</p>}</div></section>
      <section className="module-card campaign-panel"><header><h2>Foto do personagem</h2></header><div className="module-content"><div className="self-profile-photo">{imageUrl ? <img src={imageUrl} alt={`Foto de ${query.data.user.name}`} /> : <span aria-hidden="true">◇</span>}</div><label>Enviar imagem<input type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/avif,image/bmp" onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></label><label>Ou URL HTTPS<input type="url" value={imageUrl} onChange={(event) => { setImageUrl(event.target.value); setFile(null); }} placeholder="https://…" /></label><div className="actions"><button disabled={!query.data.membership.characterImageUrl || savePhoto.isPending} onClick={() => { setImageUrl(''); setFile(null); savePhoto.mutate(); }}>Remover foto</button><button className="primary" disabled={(!file && imageUrl === (query.data.membership.characterImageUrl ?? '')) || savePhoto.isPending} onClick={() => savePhoto.mutate()}>{savePhoto.isPending ? 'Salvando…' : 'Salvar foto'}</button></div>{savePhoto.error && <p className="alert error" role="alert">{savePhoto.error.message}</p>}</div></section>
      <section className="module-card campaign-panel"><header><h2>Segurança</h2></header><div className="module-content form-grid"><label>Senha atual<input type="password" autoComplete="current-password" value={security.currentPassword} onChange={(event) => setSecurity((current) => ({ ...current, currentPassword: event.target.value }))} /></label><label>Nova senha<input type="password" autoComplete="new-password" value={security.newPassword} onChange={(event) => setSecurity((current) => ({ ...current, newPassword: event.target.value }))} /></label><label>Confirmar senha<input type="password" autoComplete="new-password" value={security.confirmPassword} onChange={(event) => setSecurity((current) => ({ ...current, confirmPassword: event.target.value }))} /></label><button className="primary" disabled={!passwordReady || savePassword.isPending} onClick={() => savePassword.mutate()}>{savePassword.isPending ? 'Salvando…' : 'Alterar senha'}</button>{security.newPassword && security.confirmPassword && security.newPassword !== security.confirmPassword && <small role="alert">As senhas não coincidem.</small>}{savePassword.error && <p className="alert error" role="alert">{savePassword.error.message}</p>}</div></section>
    </div>
  </>;
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
