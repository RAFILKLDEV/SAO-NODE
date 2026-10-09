import React, { useEffect, useRef, useState } from 'react';
import { Navigate, NavLink, Outlet, Route, Routes, useNavigate, useParams } from 'react-router';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { io } from 'socket.io-client';
import { api } from './lib/api.js';
import { useOutsideDismiss } from './lib/useOutsideDismiss.js';
import { NotificationMenu } from './components/NotificationMenu.jsx';
import { formatEntityName } from './lib/entityDisplay.js';
import { resolveCampaignLinks } from './lib/campaignLinks.js';
import { getCampaignSelectionDecision } from './lib/campaignSelection.js';
import { LoginPage } from './pages/LoginPage.jsx';
import { EntityPage } from './pages/EntityPage.jsx';
import { AssociationsPage } from './pages/AssociationsPage.jsx';
import { ProgressPage } from './pages/ProgressPage.jsx';
import { GroupsPage } from './pages/GroupsPage.jsx';
import { DiscoveriesPage } from './pages/DiscoveriesPage.jsx';
import { JsonPage } from './pages/JsonPage.jsx';
import { AuditPage } from './pages/AuditPage.jsx';
import { PlayersPage } from './pages/PlayersPage.jsx';
import { ImportHistoryPage } from './pages/ImportHistoryPage.jsx';
import { MapPage } from './pages/MapPage.jsx';

function Loading() {
  return <div className="state-card">Carregando…</div>;
}

function RequireAuth() {
  const me = useQuery({ queryKey: ['me'], queryFn: () => api('/api/v1/auth/me'), retry: false });
  if (me.isLoading) return <Loading />;
  if (me.isError) return <Navigate to="/login" replace />;
  return <Outlet />;
}

const adminLinks = [
  ['discoveries', 'Descobertas', '◉'],
  ['json', 'Preparar para IA', '✦'],
  ['json/import', 'Importar JSON', '↓'],
  ['json/export', 'Exportar saoData', '↑'],
  ['json/history', 'Histórico', '◷'],
  ['audit', 'Auditoria', '≡']
];

function idFromCampaignName(name) {
  return String(name ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || `campanha-${Date.now()}`;
}

function SearchBox({ campaignId }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  useOutsideDismiss(rootRef, () => setOpen(false), open);
  const navigate = useNavigate();
  const results = useQuery({
    queryKey: ['search', campaignId, query],
    queryFn: () => api(`/api/v1/campaigns/${campaignId}/search?q=${encodeURIComponent(query)}`),
    enabled: query.trim().length >= 2
  });
  const plural = (type) => (type === 'location' ? 'locations' : `${type}s`);
  return (
    <div className="search-box" ref={rootRef}>
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
              title={formatEntityName(result)}
              onClick={() => {
                navigate(`/campaigns/${campaignId}/${plural(result.type)}?selected=${encodeURIComponent(result.id)}`);
                setOpen(false);
              }}
            >
              <strong>{formatEntityName(result)}</strong>
              <small>{result.type}</small>
            </button>
          ))}
          {results.data?.length === 0 && <span>Nenhum resultado visível.</span>}
        </div>
      )}
    </div>
  );
}

function NotificationToast({ toast, onDismiss }) {
  if (!toast) return null;
  return (
    <div className={`toast ${toast.kind}`} role="status" aria-live="polite">
      <strong>{toast.title}</strong>
      <span>{toast.message}</span>
      <button onClick={() => onDismiss(toast.id)}>×</button>
    </div>
  );
}

function CampaignLayout() {
  const { campaignId } = useParams();
  const queryClient = useQueryClient();
  const [toast, setToast] = useState(null);
  const campaign = useQuery({ queryKey: ['campaign', campaignId], queryFn: () => api(`/api/v1/campaigns/${campaignId}`) });
  const notificationsQuery = useQuery({
    queryKey: ['notifications', campaignId],
    queryFn: () => api(`/api/v1/campaigns/${campaignId}/notifications?limit=100`),
    enabled: !!campaignId
  });
  const isGm = campaign.data ? ['owner', 'gm', 'assistant_gm'].includes(campaign.data.role) : false;
  const readNotification = useMutation({
    mutationFn: (id) => api(`/api/v1/campaigns/${campaignId}/notifications/${encodeURIComponent(id)}/read`, { method: 'PATCH' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications', campaignId] })
  });
  const readAllNotifications = useMutation({
    mutationFn: () => api(`/api/v1/campaigns/${campaignId}/notifications/read-all`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications', campaignId] })
  });
  const entityNavQueries = useQueries({
    queries: ['npcs', 'locations', 'items', 'monsters', 'quests'].map((path) => ({
      queryKey: ['entity-nav', campaignId, path],
      queryFn: () => api(`/api/v1/campaigns/${campaignId}/${path}?pageSize=100`),
      enabled: !!campaignId
    }))
  });
  const entityTypeByPath = {
    npcs: 'npc',
    locations: 'location',
    items: 'item',
    monsters: 'monster',
    quests: 'quest'
  };
  const unreadNotifications = (notificationsQuery.data?.items ?? []).filter((notification) => !notification.readAt);
  const menuNotifications = Object.fromEntries(
    ['npcs', 'locations', 'items', 'monsters', 'quests'].map((path) => {
      const type = entityTypeByPath[path];
      const hasNotification = unreadNotifications.some((notification) =>
        notification.payload?.type === type || notification.payload?.entities?.some((entity) => entity.entityType === type)
      );
      return [path, hasNotification];
    })
  );

  useEffect(() => {
    const socket = io(window.location.origin, {
      path: '/socket.io',
      withCredentials: true,
      transports: ['websocket', 'polling'],
      auth: { campaignId }
    });
    const invalidate = () => queryClient.invalidateQueries({ predicate: (query) => query.queryKey.includes(campaignId) });
    const pollTimer = window.setInterval(() => {
      if (document.visibilityState === 'visible') queryClient.invalidateQueries({ predicate: query => query.queryKey.includes(campaignId) && (!socket.connected || !String(query.queryKey[0]).startsWith('map-')) });
    }, 5000);
    socket.on('connect', () => {
      invalidate();
      console.info('[sao:socket] conectado à campanha', { campaignId, id: socket.id });
    });
    socket.on('connect_error', (error) => {
      console.error('[sao:socket] erro de conexão', error?.message ?? error);
    });
    socket.on('disconnect', (reason) => {
      console.warn('[sao:socket] desconectado', reason);
    });
    socket.on('entity.changed', (_payload) => {
      invalidate();
    });
    socket.on('permissions.changed', (_payload) => {
      invalidate();
    });
    socket.on('group.changed', () => {
      queryClient.invalidateQueries({ queryKey: ['groups', campaignId] });
      queryClient.invalidateQueries({ queryKey: ['map-group-members', campaignId] });
      queryClient.invalidateQueries({ queryKey: ['map-board', campaignId] });
    });
    socket.on('progress.changed', (_payload) => {
      invalidate();
    });
    socket.on('map.position.changed', (_payload) => {
      invalidate();
    });
    socket.on('map.layout.changed', (_payload) => {
      invalidate();
    });
    socket.on('map.pin.changed', (_payload) => {
      invalidate();
    });
    socket.on('map.route.changed', (_payload) => {
      invalidate();
    });
    socket.on('map.scale.changed', (_payload) => {
      invalidate();
    });
    socket.on('import.applied', (_payload) => {
      invalidate();
    });
    socket.on('notification.created', (notification) => {
      queryClient.setQueryData(['notifications', campaignId], (current) => ({
        items: [notification, ...(current?.items ?? []).filter((item) => item.id !== notification.id)],
        nextCursor: current?.nextCursor ?? null
      }));
      setToast(notification);
    });
    socket.on('notifications.read', () => queryClient.invalidateQueries({ queryKey: ['notifications', campaignId] }));
    return () => {
      window.clearInterval(pollTimer);
      socket.close();
    };
  }, [campaignId, queryClient]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(null), 4000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  if (campaign.isLoading) return <Loading />;
  if (campaign.isError) return <div className="state-card error">Campanha indisponível.</div>;
  const visibleEntityTypes = new Set(
    ['npcs', 'locations', 'items', 'monsters', 'quests']
      .filter((path, index) => (entityNavQueries[index]?.data?.items?.length ?? entityNavQueries[index]?.data?.returned ?? 0) > 0)
      .map((path) => path)
  );
  const visibleCampaignLinks = resolveCampaignLinks({ isGm, visibleEntityTypes });

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
          <NavLink to={`/campaigns/${campaignId}/map`}><span className="nav-icon">⌖</span><span>Mapa compartilhado</span></NavLink>
          {visibleCampaignLinks.map(([path, label, icon]) => (
            <NavLink key={path} to={`/campaigns/${campaignId}/${path}`}>
              <span className="nav-icon">{icon}</span>
              <span>{label}</span>
              {menuNotifications[path] && <span className="nav-notification" aria-label="Há conteúdo novo ou editado" />}
            </NavLink>
          ))}
          {isGm && <span className="nav-caption">Administração</span>}
          {isGm && adminLinks.map(([path, label, icon]) => <NavLink key={path} end={path === 'json'} to={`/campaigns/${campaignId}/${path}`}><span className="nav-icon">{icon}</span><span>{label}</span></NavLink>)}
        </nav>
      </aside>
      <main className="main-area">
        <header className="topbar">
          <SearchBox campaignId={campaignId} />
          <span className="role-pill">{campaign.data.role}</span>
          <NotificationMenu key={campaignId} campaignId={campaignId} query={notificationsQuery}
            onRead={readNotification.mutateAsync} onReadAll={() => readAllNotifications.mutate()}
            pending={readNotification.isPending || readAllNotifications.isPending}
            error={readNotification.error || readAllNotifications.error} />
        </header>
        <div className="content-area">
          <Outlet context={{ campaign: campaign.data, isGm }} />
        </div>
      </main>
      <NotificationToast
        toast={toast}
        onDismiss={(id) => {
          setToast(null);
          if (id) readNotification.mutate(id);
        }}
      />
    </div>
  );
}

function CampaignIndex() {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const campaigns = useQuery({ queryKey: ['campaigns'], queryFn: () => api('/api/v1/campaigns') });
  const create = useMutation({
    mutationFn: () => api('/api/v1/campaigns', { method: 'POST', body: { name, slug: idFromCampaignName(name) } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['campaigns'] })
  });
  if (campaigns.isLoading) return <Loading />;
  if (!campaigns.data?.length) {
    return <main className="login-screen"><div className="login-card"><h1>Criar primeira campanha</h1><label>Nome<input value={name} onChange={(event) => setName(event.target.value)} /></label><button className="primary" disabled={!name.trim() || create.isPending} onClick={() => create.mutate()}>Criar campanha</button>{create.error && <div className="alert error">{create.error.message}</div>}</div></main>;
  }
  const decision = getCampaignSelectionDecision(campaigns.data);
  if (decision.autoSelect) return <Navigate to={`/campaigns/${decision.campaignId}/npcs`} replace />;
  return <main className="login-screen"><div className="login-card"><h1>Escolha uma campanha</h1>{campaigns.data.map(campaign => <NavLink className="state-card" key={campaign.id} to={`/campaigns/${campaign.id}/npcs`}>{campaign.name}</NavLink>)}</div></main>;
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
          <Route path="map" element={<MapPage />} />
          <Route path="locations" element={<EntityPage type="location" />} />
          <Route path="items" element={<EntityPage type="item" />} />
          <Route path="monsters" element={<EntityPage type="monster" />} />
          <Route path="associations" element={<AssociationsPage />} />
          <Route path="quests" element={<EntityPage type="quest" />} />
          <Route path="progress" element={<ProgressPage />} />
          <Route path="groups" element={<GroupsPage />} />
          <Route path="players" element={<PlayersPage />} />
          <Route path="discoveries" element={<DiscoveriesPage />} />
          <Route path="json" element={<JsonPage view="prepare" />} />
          <Route path="json/import" element={<JsonPage view="import" />} />
          <Route path="json/export" element={<JsonPage view="export" />} />
          <Route path="json/history" element={<ImportHistoryPage />} />
          <Route path="audit" element={<AuditPage />} />
        </Route>
      </Route>
    </Routes>
  );
}
