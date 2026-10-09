import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../lib/api.js';
import { mapUndoShortcut } from '../lib/mapUndo.js';
import { useMapHistory } from '../lib/useMapHistory.js';
import { useOutsideDismiss } from '../lib/useOutsideDismiss.js';
import './MapCanvas.css';

const tools = [['pencil', 'Lápis'], ['line', 'Linha'], ['arrow', 'Seta'], ['rectangle', 'Retângulo'], ['ellipse', 'Elipse'], ['text', 'Texto'], ['eraser', 'Borracha'], ['ping', 'Ping']];
const colors = ['#ffda65', '#36e9ff', '#fb7185', '#a78bfa', '#4ade80', '#fb923c', '#ffffff', '#111827'];
const clamp = value => Math.max(0, Math.min(1, value));

function Drawing({ drawing, size, onErase, editable }) {
  const first = drawing.points[0], last = drawing.points.at(-1);
  const x = first.x * size.width, y = first.y * size.height, endX = last.x * size.width, endY = last.y * size.height;
  const props = { stroke: drawing.color, strokeWidth: drawing.width, opacity: drawing.opacity, fill: 'none', strokeLinecap: 'round', strokeLinejoin: 'round' };
  let shape;
  if (drawing.kind === 'text') shape = <text x={x} y={y} fill={drawing.color} opacity={drawing.opacity} fontSize={14 + drawing.width * 2} stroke="none">{drawing.text}</text>;
  else if (drawing.kind === 'rectangle') shape = <rect {...props} x={Math.min(x, endX)} y={Math.min(y, endY)} width={Math.abs(endX - x)} height={Math.abs(endY - y)} />;
  else if (drawing.kind === 'ellipse') shape = <ellipse {...props} cx={(x + endX) / 2} cy={(y + endY) / 2} rx={Math.abs(endX - x) / 2} ry={Math.abs(endY - y) / 2} />;
  else {
    shape = <polyline {...props} points={drawing.points.map(p => `${p.x * size.width},${p.y * size.height}`).join(' ')} />;
    if (drawing.kind === 'arrow') {
      const angle = Math.atan2(endY - y, endX - x), length = 10 + drawing.width * 2;
      shape = <>{shape}<polyline {...props} points={`${endX - length * Math.cos(angle - .45)},${endY - length * Math.sin(angle - .45)} ${endX},${endY} ${endX - length * Math.cos(angle + .45)},${endY - length * Math.sin(angle + .45)}`} /></>;
    }
  }
  return <g className={onErase && editable ? 'erasable-drawing' : ''} data-drawing-id={drawing.id} role={onErase && editable ? 'button' : undefined} aria-label={onErase && editable ? `Apagar desenho de ${drawing.authorName}` : undefined} tabIndex={onErase && editable ? 0 : undefined} onPointerDown={event => { if (onErase) { event.preventDefault(); event.stopPropagation(); if (editable) onErase(drawing); } }} onKeyDown={event => { if (onErase && editable && ['Enter', 'Delete', 'Backspace'].includes(event.key)) { event.preventDefault(); onErase(drawing); } }}><title>{drawing.authorName ?? 'Desenho'}</title>{shape}</g>;
}

export const MapCanvas = memo(function MapCanvas({ campaignId, boardId, imageRef, socket, viewAsUserId, disabled, pending, isGm }) {
  const queryClient = useQueryClient();
  const base = `/api/v1/campaigns/${campaignId}/map`;
  const query = `boardId=${encodeURIComponent(boardId)}${viewAsUserId ? `&viewAsUserId=${encodeURIComponent(viewAsUserId)}` : ''}`;
  const endpoint = resource => `${base}/${resource}?${query}`;
  const historyBase = `${base}?${query}`;
  const history = useMapHistory(base, query, () => queryClient.invalidateQueries({ queryKey: ['map-canvas', campaignId, boardId] }), ({ direction, ping }) => setPings(current => direction === 'undo' ? current.filter(p => p.id !== ping.id) : [...current.filter(p => p.id !== ping.id), ping]));
  const drawings = useQuery({ queryKey: ['map-canvas', campaignId, boardId, viewAsUserId], queryFn: () => api(endpoint('drawings')), enabled: Boolean(boardId) });
  const [tool, setTool] = useState(null), [expanded, setExpanded] = useState(false);
  const [color, setColor] = useState(colors[0]), [width, setWidth] = useState(3), [opacity, setOpacity] = useState(1), [text, setText] = useState('');
  const [draft, setDraft] = useState(null), [previews, setPreviews] = useState({}), [pings, setPings] = useState([]), [error, setError] = useState('');
  const [size, setSize] = useState({ width: 1, height: 1 }), [connected, setConnected] = useState(Boolean(socket?.connected));
  const toolbarRef = useRef(null), gesture = useRef(null), csrf = useRef(null), lastPreview = useRef(0), previewSequence = useRef(0);
  const shortcutHistory = useRef(false), suppressClick = useRef(false);
  useOutsideDismiss(toolbarRef, () => setExpanded(false), expanded);
  const allowed = !disabled && !viewAsUserId;
  const shortcutsAllowed = !pending && !viewAsUserId;
  const clearPreview = useCallback(id => { if (socket?.connected && csrf.current) socket.emit('map.drawing.preview', { boardId, id, seq: ++previewSequence.current, csrfToken: csrf.current, drawing: null }); }, [socket, boardId]);
  const cancel = useCallback(() => {
    const active = gesture.current; gesture.current = null; setDraft(null);
    if (active) { clearPreview(active.drawing.id); if (active.element.hasPointerCapture(active.pointerId)) active.element.releasePointerCapture(active.pointerId); }
  }, [clearPreview]);
  const refresh = useCallback(() => queryClient.invalidateQueries({ queryKey: ['map-canvas', campaignId, boardId] }), [queryClient, campaignId, boardId]);
  const save = useMutation({ mutationFn: ({ id, ...drawing }) => api(endpoint('drawings'), { method: 'POST', headers: { 'x-map-preview-id': id }, body: drawing }), onSuccess: async result => { history.push(result.edit); await refresh(); }, onError: err => setError(err.message) });
  const erase = useMutation({ mutationFn: drawing => api(endpoint(`drawings/${drawing.id}`), { method: 'DELETE', headers: { 'if-match': String(drawing.version) } }), onSuccess: async result => { history.push(result.edit); await refresh(); }, onError: err => setError(err.message) });
  const clear = useMutation({ mutationFn: scope => api(endpoint('drawings/clear'), { method: 'POST', body: { scope, versions: (drawings.data?.items ?? []).filter(row => scope === 'all' || row.authorUserId === drawings.data.userId).map(row => ({ id: row.id, version: row.version })) } }), onSuccess: async result => { history.push(result.edit); await refresh(); }, onError: err => setError(err.message) });
  const ping = useMutation({ mutationFn: point => api(endpoint('pings'), { method: 'POST', body: { ...point, color } }), onSuccess: result => { history.pushPing(result.ping); setPings(current => [...current.filter(p => p.id !== result.ping.id), result.ping]); }, onError: err => setError(err.message) });
  const busy = save.isPending || erase.isPending || clear.isPending || history.pending;

  useEffect(() => { shortcutHistory.current = false; suppressClick.current = false; setTool(null); setExpanded(false); setDraft(null); setPreviews({}); setPings([]); setError(''); }, [historyBase]);
  useEffect(() => () => { if (gesture.current) cancel(); }, [cancel]);
  useEffect(() => { if (drawings.data?.pings) setPings(current => [...current, ...drawings.data.pings].filter((p, i, all) => p.expiresAt > Date.now() && all.findIndex(item => item.id === p.id) === i)); }, [drawings.data?.pings]);
  useEffect(() => {
    const image = imageRef.current, measure = () => { const bounds = image.getBoundingClientRect(); setSize(current => current.width === bounds.width && current.height === bounds.height ? current : { width: bounds.width, height: bounds.height }); };
    measure(); const observer = new ResizeObserver(measure); observer.observe(image);
    return () => observer.disconnect();
  }, [imageRef]);
  useEffect(() => {
    api('/api/v1/auth/csrf').then(value => { csrf.current = value.csrfToken; }).catch(() => {});
    if (!socket) return;
    const onPing = event => { if (event.boardId === boardId) setPings(current => [...current.filter(p => p.id !== event.ping.id), event.ping]); };
    const onRemove = event => { if (event.boardId === boardId) setPings(current => current.filter(p => p.id !== event.id)); };
    const onPreview = event => { if (event.boardId === boardId && event.authorUserId !== drawings.data?.userId) setPreviews(current => current[event.id]?.seq >= event.seq ? current : { ...current, [event.id]: event }); };
    const onChange = event => { if (event.boardId === boardId) refresh(); };
    const connection = () => setConnected(socket.connected);
    socket.on('map.ping', onPing); socket.on('map.ping.removed', onRemove); socket.on('map.drawing.preview', onPreview); socket.on('map.canvas.changed', onChange); socket.on('connect', connection); socket.on('disconnect', connection); connection();
    return () => { socket.off('map.ping', onPing); socket.off('map.ping.removed', onRemove); socket.off('map.drawing.preview', onPreview); socket.off('map.canvas.changed', onChange); socket.off('connect', connection); socket.off('disconnect', connection); };
  }, [socket, boardId, drawings.data?.userId, refresh]);
  useEffect(() => {
    const timer = setInterval(() => {
      const now = Date.now();
      setPings(current => current.some(p => p.expiresAt <= now) ? current.filter(p => p.expiresAt > now) : current);
      setPreviews(current => Object.values(current).some(p => p.expiresAt <= now) ? Object.fromEntries(Object.entries(current).filter(([, p]) => p.expiresAt > now)) : current);
    }, 250);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => { if (!allowed) { cancel(); setTool(null); setExpanded(false); } }, [allowed, cancel]);
  useEffect(() => { if (!shortcutsAllowed) cancel(); }, [shortcutsAllowed, cancel]);
  useEffect(() => {
    const key = event => {
      if (event.key === 'Escape') { cancel(); setTool(null); setExpanded(false); return; }
      const direction = mapUndoShortcut(event);
      if (shortcutsAllowed && shortcutHistory.current && busy && direction) { event.preventDefault(); event.stopImmediatePropagation(); return; }
      if (shortcutsAllowed && (allowed || shortcutHistory.current) && !busy && direction && (gesture.current || (direction === 'undo' ? history.canUndo : history.canRedo))) {
        event.preventDefault(); event.stopImmediatePropagation(); if (gesture.current) cancel(); else history.step(direction);
      }
    };
    window.addEventListener('keydown', key, true); window.addEventListener('blur', cancel);
    return () => { window.removeEventListener('keydown', key, true); window.removeEventListener('blur', cancel); };
  }, [allowed, shortcutsAllowed, busy, history.canUndo, history.canRedo, history.step, cancel]);
  const coordinate = (event, bounds = imageRef.current.getBoundingClientRect()) => ({ x: clamp((event.clientX - bounds.left) / bounds.width), y: clamp((event.clientY - bounds.top) / bounds.height) });
  const publish = next => {
    if (socket?.connected && csrf.current && Date.now() - lastPreview.current >= 80 && next.points.length > 1) { lastPreview.current = Date.now(); const { id, ...drawing } = next; socket.emit('map.drawing.preview', { boardId, id, seq: ++previewSequence.current, csrfToken: csrf.current, drawing }); }
  };
  const start = (event, kind = tool, shortcut = false) => {
    if (!(shortcut ? shortcutsAllowed : allowed) || busy || !kind || event.button !== 0 || kind === 'eraser') return;
    event.preventDefault(); event.stopPropagation(); setError('');
    const point = coordinate(event);
    if (kind === 'ping') { ping.mutate(point); return; }
    if (kind === 'text') { if (text.trim()) save.mutate({ id: crypto.randomUUID(), kind, color, width, opacity, points: [point], text: text.trim() }); else { setExpanded(true); setError('Digite o texto antes de colocá-lo no mapa.'); } return; }
    event.currentTarget.setPointerCapture(event.pointerId);
    const next = { id: crypto.randomUUID(), kind, color, width, opacity, points: [point, point] };
    gesture.current = { pointerId: event.pointerId, element: event.currentTarget, bounds: imageRef.current.getBoundingClientRect(), drawing: next, shortcut };
    setDraft(next);
  };
  const move = event => {
    const active = gesture.current; if (!active || active.pointerId !== event.pointerId) return;
    const point = coordinate(event, active.bounds), points = active.drawing.points;
    if (active.drawing.kind === 'pencil') {
      const previous = points.at(-1); if (points.length >= 2000 || Math.hypot((point.x - previous.x) * size.width, (point.y - previous.y) * size.height) < 1) return;
      active.drawing = { ...active.drawing, points: [...points, point] };
    } else active.drawing = { ...active.drawing, points: [points[0], point] };
    setDraft(active.drawing); publish(active.drawing);
  };
  const finish = event => {
    const active = gesture.current; if (!active || active.pointerId !== event.pointerId) return;
    move(event); const drawing = active.drawing; cancel();
    if (drawing.points.some(p => Math.hypot((p.x - drawing.points[0].x) * size.width, (p.y - drawing.points[0].y) * size.height) >= 2)) save.mutate(drawing);
  };
  useEffect(() => {
    const root = imageRef.current.closest('.image-map');
    const mapTarget = target => !toolbarRef.current?.contains(target) && !target.closest('[role="dialog"], [role="menu"], .map-route-popup, input, select, textarea, a, button:not(.image-map-pin):not(.image-map-travel-marker)');
    const stop = event => { event.preventDefault(); event.stopPropagation(); };
    const down = event => {
      if (event.button !== 0 || !mapTarget(event.target)) return;
      suppressClick.current = false;
      if (!event.altKey && !event.ctrlKey) { shortcutHistory.current = false; return; }
      if (!shortcutsAllowed) return;
      stop(event); suppressClick.current = true;
      if (event.altKey) { shortcutHistory.current = true; setError(''); ping.mutate(coordinate(event)); }
      else if (!busy && !gesture.current) { shortcutHistory.current = true; start(event, 'pencil', true); }
    };
    const routeGesture = handler => event => { if (gesture.current?.shortcut && gesture.current.pointerId === event.pointerId) { stop(event); handler(event); } };
    const moving = routeGesture(move), up = routeGesture(finish), canceled = routeGesture(cancel);
    const click = event => { if (suppressClick.current && mapTarget(event.target)) { stop(event); suppressClick.current = false; } };
    const listeners = { pointerdown: down, pointermove: moving, pointerup: up, pointercancel: canceled, lostpointercapture: canceled, click };
    for (const [name, handler] of Object.entries(listeners)) root.addEventListener(name, handler, true);
    return () => { for (const [name, handler] of Object.entries(listeners)) root.removeEventListener(name, handler, true); };
  });
  const items = drawings.data?.items ?? [], canErase = drawing => isGm || drawing.authorUserId === drawings.data?.userId;
  const chooseTool = id => { cancel(); setTool(id); if (id !== 'text' && window.matchMedia('(max-width: 600px)').matches) setExpanded(false); };
  return <>
    {!disabled && <div ref={toolbarRef} className="map-drawing-toolbar" onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()} aria-label="Desenhos e pings">
      <div className="map-drawing-summary"><button type="button" aria-expanded={expanded} disabled={!allowed} onClick={() => setExpanded(current => !current)}>✎ {tool ? tools.find(([id]) => id === tool)?.[1] : 'Desenhos e pings'}</button>{tool && <button type="button" aria-label="Concluir desenho" onClick={() => { cancel(); setTool(null); setExpanded(false); }}>✓</button>}<button type="button" aria-label="Desfazer desenho ou ping" title={history.undoLabel ? `Desfazer: ${history.undoLabel} (Ctrl+Z)` : 'Desfazer (Ctrl+Z)'} disabled={!allowed || busy || !history.canUndo} onClick={() => history.step('undo')}>↶</button><button type="button" aria-label="Refazer desenho ou ping" title="Refazer (Ctrl+Shift+Z ou Ctrl+Y)" disabled={!allowed || busy || !history.canRedo} onClick={() => history.step('redo')}>↷</button></div>
      {expanded && <div className="map-drawing-options"><div className="map-drawing-tools">{tools.map(([id, name]) => <button type="button" key={id} aria-pressed={tool === id} disabled={busy} onClick={() => chooseTool(id)}>{name}</button>)}</div><div className="map-drawing-colors">{colors.map(value => <button type="button" key={value} aria-label={`Cor ${value}`} aria-pressed={color === value} style={{ background: value }} onClick={() => setColor(value)} />)}<input type="color" aria-label="Cor personalizada do desenho" value={color} onChange={event => setColor(event.target.value)} /></div><label>Espessura<input aria-label="Espessura do desenho" type="range" min="1" max="16" value={width} onChange={event => setWidth(Number(event.target.value))} /><span>{width}px</span></label><label>Opacidade<input aria-label="Opacidade do desenho" type="range" min=".1" max="1" step=".1" value={opacity} onChange={event => setOpacity(Number(event.target.value))} /><span>{Math.round(opacity * 100)}%</span></label>{tool === 'text' && <><input aria-label="Texto do desenho" placeholder="Texto para colocar no mapa" maxLength={160} value={text} onChange={event => setText(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && text.trim()) { event.preventDefault(); setExpanded(false); event.target.blur(); } }} /><button type="button" disabled={!text.trim()} onClick={() => setExpanded(false)}>Posicionar texto</button></>}<div className="map-drawing-clear"><button type="button" disabled={busy || !items.some(row => row.authorUserId === drawings.data?.userId)} onClick={() => clear.mutate('mine')}>Limpar meus desenhos</button>{isGm && <button type="button" disabled={busy || !items.length} onClick={() => clear.mutate('all')}>Limpar todos</button>}</div><small>{connected ? 'Ao vivo' : 'Reconectando…'} · Alt+clique: ping (3s) · Ctrl+arrastar: lápis · Ctrl+Z: desfazer</small></div>}
      {(error || history.error || drawings.error) && <p role="alert">{error || history.error || drawings.error.message}</p>}
    </div>}
    <svg className={`map-drawing-layer ${allowed && tool ? 'drawing-active' : ''}`} viewBox={`0 0 ${size.width} ${size.height}`} preserveAspectRatio="none" aria-label="Desenhos compartilhados do mapa" onPointerDown={start} onPointerMove={move} onPointerUp={finish} onPointerCancel={cancel} onLostPointerCapture={() => { if (gesture.current) cancel(); }} onClick={event => { if (tool) event.stopPropagation(); }}>
      {allowed && tool && <rect className="map-drawing-capture" width="100%" height="100%" fill="transparent" />}
      {items.map(drawing => <Drawing key={drawing.id} drawing={drawing} size={size} editable={canErase(drawing)} onErase={allowed && tool === 'eraser' && !busy ? erase.mutate : null} />)}
      {Object.values(previews).filter(p => p.drawing && !items.some(row => row.id === p.id)).map(p => <Drawing key={p.id} drawing={{ ...p.drawing, id: p.id, authorName: p.authorName }} size={size} />)}
      {draft && <Drawing drawing={draft} size={size} />}
    </svg>
    <div className="map-ping-layer" aria-live="polite">{pings.filter(p => p.expiresAt > Date.now()).map(p => <div key={p.id} className="map-ping" style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%`, '--ping-color': p.color }}><span /><strong>{p.authorName}</strong></div>)}</div>
  </>;
});
