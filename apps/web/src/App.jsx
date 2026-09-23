import React, { useEffect, useState } from 'react';
import { Navigate, NavLink, Outlet, Route, Routes, useNavigate, useParams } from 'react-router';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { io } from 'socket.io-client';
import { api } from './lib/api.js';
import { formatEntityName } from './lib/entityDisplay.js';
import {
  collectPermissionChangeEntities,
  getEntityChangeState,
  readEntityActivityAt,
  readEntitySeenAt,
  setEntityActivityAt
} from './lib/notifications.js';
import { resolveCampaignLinks } from './lib/campaignLinks.js';
import { getCampaignSelectionDecision } from './lib/campaignSelection.js';
import { LoginPage } from './pages/LoginPage.jsx';
import { EntityPage } from './pages/EntityPage.jsx';
import { ProgressPage } from './pages/ProgressPage.jsx';
import { GroupsPage } from './pages/GroupsPage.jsx';
import { DiscoveriesPage } from './pages/DiscoveriesPage.jsx';
import { JsonPage } from './pages/JsonPage.jsx';
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

const adminLinks = [
  ['players', 'Jogadores', '♙'],
  ['discoveries', 'Descobertas', '◉'],
  ['json', 'IA e JSON', '⇄'],
  ['audit', 'Auditoria', '≡'],
  ['bindings', 'Vínculos T20', '∞'],
  ['settings', 'Configurações', '⚙']
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
  const isGm = campaign.data ? ['owner', 'gm', 'assistant_gm'].includes(campaign.data.role) : false;
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
  const menuNotifications = Object.fromEntries(
    ['npcs', 'locations', 'items', 'monsters', 'quests'].map((path) => {
      const items = entityNavQueries?.[Object.keys(entityTypeByPath).indexOf(path)]?.data?.items ?? [];
      const hasNotification = items.some((item) => {
        const type = entityTypeByPath[path];
        const lastSeenAt = readEntitySeenAt({ campaignId, type, entityId: item.id });
        const activityAt = readEntityActivityAt({ campaignId, type, entityId: item.id });
        const state = getEntityChangeState(item, lastSeenAt, activityAt);
        console.log('[sao:menuNotification]', {
          path,
          itemId: item.id,
          lastSeenAt,
          activityAt,
          state
        });
        if (!state) return false;
        return state.kind === 'new' || state.kind === 'edited';
      });
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
      invalidate();
    }, 5000);
    const handleCustomToast = (event) => {
      const details = event?.detail ?? {};
      const kind = details.kind ?? 'info';
      const title = details.title ?? 'Atualização';
      const message = details.message ?? 'Houve uma atualização no conteúdo da campanha.';
      setToast({ id: `toast-${Date.now()}-${Math.random()}`, kind, title, message });
    };
    const announce = (eventName, eventData = {}) => {
      const details = eventData?.details ?? eventData ?? {};
      const kind = details.kind ?? 'info';
      const title = details.title ?? 'Atualização';
      const message = details.message ?? 'Houve uma atualização no conteúdo da campanha.';
      setToast({ id: `${eventName}-${Date.now()}-${Math.random()}`, kind, title, message });
    };
    socket.on('connect', () => {
      console.info('[sao:socket] conectado à campanha', { campaignId, id: socket.id });
    });
    socket.on('connect_error', (error) => {
      console.error('[sao:socket] erro de conexão', error?.message ?? error);
    });
    socket.on('disconnect', (reason) => {
      console.warn('[sao:socket] desconectado', reason);
    });
    const entityResource = (type) => (type === 'location' ? 'locations' : `${type}s`);
    const maybeAnnounceEntityChanged = async (payload) => {
      if (isGm) {
        announce('entity.changed', payload);
        return;
      }
      const entityType = payload?.type;
      const entityId = payload?.id;
      if (!entityType || !entityId) return;
      try {
        const entity = await api(`/api/v1/campaigns/${campaignId}/${entityResource(entityType)}/${encodeURIComponent(entityId)}`);
        if (entity) announce('entity.changed', payload);
      } catch {
        // Ignore hidden or inaccessible content for players.
      }
    };
    window.addEventListener('sao:toast', handleCustomToast);
    socket.on('entity.changed', (payload) => {
      invalidate();
      maybeAnnounceEntityChanged(payload);
    });
    socket.on('permissions.changed', (payload) => {
      invalidate();
      if (isGm) announce('permissions.changed', payload);
    });
    socket.on('permissions.notification', async (payload) => {
      if (isGm) return;
      const changed = collectPermissionChangeEntities(payload);
      const visibleEntities = (
        await Promise.all(
          changed.map(async (item) => {
            try {
              const entity = await api(
                `/api/v1/campaigns/${campaignId}/${entityResource(item.entityType)}/${encodeURIComponent(item.entityId)}`
              );
              return { ...item, entity };
            } catch {
              return null;
            }
          })
        )
      ).filter(Boolean);

      for (const item of visibleEntities) {
        setEntityActivityAt({
          campaignId,
          type: item.entityType,
          entityId: item.entityId,
          at: Date.now(),
          reason: payload?.reason ?? 'permission'
        });
      }
      invalidate();
      const first = visibleEntities[0]?.entity;
      if (first) {
        announce('permissions.notification', {
          kind: 'new',
          title: 'Novo conteúdo disponível',
          message:
            visibleEntities.length === 1
              ? `${formatEntityName(first, 'Um registro')} foi liberado para você.`
              : `${visibleEntities.length} registros foram liberados para você.`
        });
      }
    });
    socket.on('progress.changed', (payload) => {
      invalidate();
      announce('progress.changed', payload);
    });
    socket.on('import.applied', (payload) => {
      invalidate();
      announce('import.applied', payload);
    });
    return () => {
      window.clearInterval(pollTimer);
      window.removeEventListener('sao:toast', handleCustomToast);
      socket.close();
    };
  }, [campaignId, isGm, queryClient]);

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
          {visibleCampaignLinks.map(([path, label, icon]) => (
            <NavLink key={path} to={`/campaigns/${campaignId}/${path}`}>
              <span className="nav-icon">{icon}</span>
              <span>{label}</span>
              {menuNotifications[path] && <span className="nav-notification" aria-label="Há conteúdo novo ou editado" />}
            </NavLink>
          ))}
          {isGm && <span className="nav-caption">Administração</span>}
          {isGm && adminLinks.map(([path, label, icon]) => <NavLink key={path} to={`/campaigns/${campaignId}/${path}`}><span className="nav-icon">{icon}</span><span>{label}</span></NavLink>)}
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
      <NotificationToast toast={toast} onDismiss={() => setToast(null)} />
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
          <Route path="locations" element={<EntityPage type="location" />} />
          <Route path="items" element={<EntityPage type="item" />} />
          <Route path="monsters" element={<EntityPage type="monster" />} />
          <Route path="quests" element={<EntityPage type="quest" />} />
          <Route path="progress" element={<ProgressPage />} />
          <Route path="groups" element={<GroupsPage />} />
          <Route path="players" element={<PlayersPage />} />
          <Route path="discoveries" element={<DiscoveriesPage />} />
          <Route path="json" element={<JsonPage />} />
          <Route path="audit" element={<AuditPage />} />
          <Route path="bindings" element={<BindingsPage />} />
          <Route path="settings" element={<SettingsPage />} />
        </Route>
      </Route>
    </Routes>
  );
}
