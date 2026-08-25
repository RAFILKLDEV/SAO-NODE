import React, { useEffect, useState } from 'react';
import { Navigate, NavLink, Outlet, Route, Routes, useNavigate, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { io } from 'socket.io-client';
import { api } from './lib/api.js';
import { LoginPage } from './pages/LoginPage.jsx';
import { EntityPage } from './pages/EntityPage.jsx';
import { ProgressPage } from './pages/ProgressPage.jsx';
import { GroupsPage } from './pages/GroupsPage.jsx';
import { DiscoveriesPage } from './pages/DiscoveriesPage.jsx';
import { XmlPage } from './pages/XmlPage.jsx';
import { AuditPage } from './pages/AuditPage.jsx';
import { PlayersPage } from './pages/PlayersPage.jsx';
import { BindingsPage } from './pages/BindingsPage.jsx';
import { SettingsPage } from './pages/SettingsPage.jsx';

function Loading() {
  return <div className="state-card">Carregando…</div>;
}

function RequireAuth() {
  const me = useQuery({ queryKey: ['me'], queryFn: () => api('/api/v1/auth/me'), retry: false });
  if (me.isLoading) return <Loading />;
  if (me.isError) return <Navigate to="/login" replace />;
  return <Outlet />;
}

const campaignLinks = [
  ['npcs', 'Personagens'],
  ['locations', 'Locais'],
  ['items', 'Itens'],
  ['monsters', 'Monstros'],
  ['quests', 'Missões'],
  ['progress', 'Progresso'],
  ['groups', 'Grupos']
];

const adminLinks = [
  ['players', 'Jogadores'],
  ['discoveries', 'Descobertas'],
  ['xml', 'Importar/Exportar XML'],
  ['audit', 'Auditoria'],
  ['bindings', 'Vínculos T20'],
  ['settings', 'Configurações']
];

function SearchBox({ campaignId }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const results = useQuery({
    queryKey: ['search', campaignId, query],
    queryFn: () => api(`/api/v1/campaigns/${campaignId}/search?q=${encodeURIComponent(query)}`),
    enabled: query.trim().length >= 2
  });
  const plural = (type) => (type === 'location' ? 'locations' : `${type}s`);
  return (
    <div className="search-box">
      <input
        aria-label="Busca global"
        placeholder="Buscar NPC, local, item, monstro ou missão…"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
      />
      {open && query.length >= 2 && (
        <div className="search-results" role="listbox">
          {results.isLoading && <span>Buscando…</span>}
          {results.data?.map((result) => (
            <button
              key={`${result.type}:${result.id}`}
              onClick={() => {
                navigate(`/campaigns/${campaignId}/${plural(result.type)}?selected=${encodeURIComponent(result.id)}`);
                setOpen(false);
              }}
            >
              <strong>{result.name}</strong>
              <small>{result.type}</small>
            </button>
          ))}
          {results.data?.length === 0 && <span>Nenhum resultado visível.</span>}
        </div>
      )}
    </div>
  );
}

function CampaignLayout() {
  const { campaignId } = useParams();
  const queryClient = useQueryClient();
  const campaign = useQuery({ queryKey: ['campaign', campaignId], queryFn: () => api(`/api/v1/campaigns/${campaignId}`) });

  useEffect(() => {
    const socket = io({ auth: { campaignId } });
    const invalidate = () => queryClient.invalidateQueries({ predicate: (query) => query.queryKey.includes(campaignId) });
    socket.on('entity.changed', invalidate);
    socket.on('permissions.changed', invalidate);
    socket.on('progress.changed', invalidate);
    socket.on('import.applied', invalidate);
    return () => socket.close();
  }, [campaignId, queryClient]);

  if (campaign.isLoading) return <Loading />;
  if (campaign.isError) return <div className="state-card error">Campanha indisponível.</div>;
  const isGm = ['owner', 'gm', 'assistant_gm'].includes(campaign.data.role);

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">◇</span>
          <div><strong>SAO RPG</strong><small>Database</small></div>
        </div>
        <div className="campaign-name">{campaign.data.name}</div>
        <nav aria-label="Campanha">
          <span className="nav-caption">Campanha</span>
          {campaignLinks.map(([path, label]) => <NavLink key={path} to={`/campaigns/${campaignId}/${path}`}>{label}</NavLink>)}
          {isGm && <span className="nav-caption">Administração</span>}
          {isGm && adminLinks.map(([path, label]) => <NavLink key={path} to={`/campaigns/${campaignId}/${path}`}>{label}</NavLink>)}
        </nav>
      </aside>
      <main className="main-area">
        <header className="topbar">
          <SearchBox campaignId={campaignId} />
          <span className="role-pill">{campaign.data.role}</span>
        </header>
        <div className="content-area">
          <Outlet context={{ campaign: campaign.data, isGm }} />
        </div>
      </main>
    </div>
  );
}

function CampaignIndex() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ slug: '', name: '' });
  const campaigns = useQuery({ queryKey: ['campaigns'], queryFn: () => api('/api/v1/campaigns') });
  const create = useMutation({
    mutationFn: () => api('/api/v1/campaigns', { method: 'POST', body: form }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['campaigns'] })
  });
  if (campaigns.isLoading) return <Loading />;
  if (!campaigns.data?.length) {
    return <main className="login-screen"><div className="login-card"><h1>Criar primeira campanha</h1><label>Nome<input value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label><label>Slug<input value={form.slug} onChange={(event) => setForm({ ...form, slug: event.target.value })} placeholder="aincrad-floor-01" /></label><button className="primary" disabled={!form.name || !form.slug || create.isPending} onClick={() => create.mutate()}>Criar campanha</button>{create.error && <div className="alert error">{create.error.message}</div>}</div></main>;
  }
  return <Navigate to={`/campaigns/${campaigns.data[0].id}/npcs`} replace />;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireAuth />}>
        <Route path="/" element={<CampaignIndex />} />
        <Route path="/campaigns/:campaignId" element={<CampaignLayout />}>
          <Route index element={<Navigate to="npcs" replace />} />
          <Route path="npcs" element={<EntityPage type="npc" />} />
          <Route path="locations" element={<EntityPage type="location" />} />
          <Route path="items" element={<EntityPage type="item" />} />
          <Route path="monsters" element={<EntityPage type="monster" />} />
          <Route path="quests" element={<EntityPage type="quest" />} />
          <Route path="progress" element={<ProgressPage />} />
          <Route path="groups" element={<GroupsPage />} />
          <Route path="players" element={<PlayersPage />} />
          <Route path="discoveries" element={<DiscoveriesPage />} />
          <Route path="xml" element={<XmlPage />} />
          <Route path="audit" element={<AuditPage />} />
          <Route path="bindings" element={<BindingsPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
      </Route>
    </Routes>
  );
}
