import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';

export function notificationDestination(campaignId, notification) {
  const base = `/campaigns/${encodeURIComponent(campaignId)}`;
  if (notification.eventType === 'progress.changed') return `${base}/progress`;
  if (notification.eventType === 'import.applied') return `${base}/json`;
  const payload = notification.payload ?? {};
  const entity = payload.entities?.[0];
  const type = payload.type ?? entity?.entityType;
  const id = payload.id ?? entity?.entityId;
  const paths = { npc: 'npcs', location: 'locations', item: 'items', monster: 'monsters', quest: 'quests' };
  return paths[type] && id ? `${base}/${paths[type]}?selected=${encodeURIComponent(id)}` : null;
}

export function NotificationMenu({ campaignId, query, onRead, onReadAll, pending, error }) {
  const [open, setOpen] = useState(false);
  const root = useRef(null);
  const trigger = useRef(null);
  const navigate = useNavigate();
  const items = query.data?.items ?? [];
  const unread = items.filter((item) => !item.readAt).length;
  useEffect(() => {
    if (!open) return;
    const closeOutside = (event) => { if (!root.current?.contains(event.target)) setOpen(false); };
    const escape = (event) => { if (event.key === 'Escape') { setOpen(false); trigger.current?.focus(); } };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);
  return <div className="notification-menu" ref={root}>
    <button ref={trigger} className="notification-trigger" aria-expanded={open} aria-controls="recent-notifications" onClick={() => setOpen(!open)}>
      <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M9 21h6" /></svg>
      <span>Notificações</span>{unread > 0 && <span className="notification-count">{unread}</span>}
    </button>
    {open && <section id="recent-notifications" className="notification-popover" aria-label="Últimas notificações">
      <header><strong>Últimas notificações</strong><button disabled={pending || !unread} onClick={onReadAll}>Marcar todas como lidas</button></header>
      {(query.error || error) && <div role="alert" className="alert error">{(query.error || error).message}<button onClick={() => query.refetch()}>Tentar novamente</button></div>}
      {query.isLoading && <p role="status">Carregando notificações…</p>}
      {!query.isLoading && !query.error && !items.length && <p>Nenhuma notificação por enquanto.</p>}
      <ul>{items.map((item) => <li key={item.id} className={item.readAt ? '' : 'unread'}>
        <button disabled={pending} onClick={async () => {
          try {
            if (!item.readAt) await onRead(item.id);
            const destination = notificationDestination(campaignId, item);
            if (destination) { setOpen(false); navigate(destination); }
          } catch { /* Mutation error is displayed above. */ }
        }}>
          <strong>{item.title}{!item.readAt && <small> · Não lida</small>}</strong>
          <span>{item.message}</span>
          <time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString('pt-BR')}</time>
        </button>
      </li>)}</ul>
      {query.data?.nextCursor && <p className="muted">Exibindo as 100 notificações mais recentes.</p>}
    </section>}
  </div>;
}
