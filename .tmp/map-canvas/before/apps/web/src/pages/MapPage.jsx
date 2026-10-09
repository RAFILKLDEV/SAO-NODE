import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useBeforeUnload, useBlocker, useOutletContext, useParams, useSearchParams } from 'react-router';
import { api } from '../lib/api.js';
import { useOutsideDismiss } from '../lib/useOutsideDismiss.js';
import { beginPointerDrag, finishPointerDrag, updatePointerDrag } from '../lib/mapDrag.js';
import { calibrateScale, pinColor, scaleBar, simplifyBoundary } from '../lib/mapGeometry.js';
import { MapPinPicker } from '../components/MapPinPicker.jsx';
import { MapPinPopup } from '../components/MapPinPopup.jsx';
import { MapScaleDialog } from '../components/MapScaleDialog.jsx';
import { emptyRoadNetwork, findRoadConnectionSuggestions, joinRoadConnection, prepareRoadNetwork } from '@sao/domain';
import { MapNetworkLayer } from '../components/MapNetworkLayer.jsx';
import { MapNetworkDialog } from '../components/MapNetworkDialog.jsx';
import { MapConnectionsPanel } from '../components/MapConnectionsPanel.jsx';
import { MapMarkerPicker } from '../components/MapMarkerPicker.jsx';
import { MapRegionsPanel } from '../components/MapRegionsPanel.jsx';
import { MapRoutePopup } from '../components/MapRoutePopup.jsx';
import './MapPage.css';

const clamp = (value) => Math.max(0, Math.min(1, value));
const IMAGE_TYPES = 'image/png,image/jpeg,image/gif,image/webp,image/avif,image/bmp';

function MapToolbarMenu({ label, name, icon, open, disabled, onToggle, onClose, children }) {
  const id = useId();
  const containerRef = useRef(null);
  useOutsideDismiss(containerRef, onClose, open);
  const buttonRef = useRef(null);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    const positionMenu = () => {
      const menu = menuRef.current;
      if (!menu) return;
      menu.style.transform = '';
      const bounds = menu.getBoundingClientRect();
      const offset = Math.max(8 - bounds.left, Math.min(0, window.innerWidth - bounds.right - 8));
      menu.style.transform = `translateX(${offset}px)`;
      menu.style.maxHeight = `${Math.max(80, Math.min(320, window.innerHeight - bounds.top - 8))}px`;
    };
    positionMenu();
    menuRef.current?.querySelector('button:not(:disabled)')?.focus({ preventScroll: true });
    window.addEventListener('resize', positionMenu);
    window.addEventListener('scroll', positionMenu);
    return () => { window.removeEventListener('resize', positionMenu); window.removeEventListener('scroll', positionMenu); };
  }, [open]);

  const handleKey = (event) => {
    if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); onClose(); buttonRef.current?.focus(); return; }
    if (event.key === 'Tab') { onClose(); return; }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    if (!open) { onToggle(); return; }
    const items = [...menuRef.current.querySelectorAll('button:not(:disabled)')];
    const index = items.indexOf(document.activeElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length;
    items[next]?.focus();
  };

  return <div className="map-toolbar-menu" ref={containerRef} onKeyDown={handleKey}>
    <button ref={buttonRef} type="button" className="map-menu-trigger" aria-label={name} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined} disabled={disabled} onClick={onToggle}>{icon}<span>{label}</span><span aria-hidden="true">▾</span></button>
    {open && <div id={id} ref={menuRef} className="map-board-menu" role="menu" aria-label={name}>{children}</div>}
  </div>;
}

function MapImageForm({ board, creating, regions = [], pending, error, onSave, onClose }) {
  const [name, setName] = useState(board.name ?? 'Mapa da campanha');
  const [imageUrl, setImageUrl] = useState(board.imageUrl ?? '');
  const [file, setFile] = useState(null);
  const [regionId, setRegionId] = useState('');
  const region = regions.find((entry) => entry.id === regionId);
  const dialogRef = useRef(null);
  useOutsideDismiss(dialogRef, onClose, !pending);

  useEffect(() => { dialogRef.current?.showModal(); }, []);

  return (
    <dialog ref={dialogRef} className="map-image-dialog" aria-label={creating ? 'Novo mapa de região' : 'Alterar mapa'} onCancel={(event) => { event.preventDefault(); if (!pending) onClose(); }}>
      <form onSubmit={(event) => { event.preventDefault(); onSave({ name, imageUrl: imageUrl || region?.imageUrl, file, ...(creating ? { regionId } : {}) }); }}>
        <div className="section-heading"><h2>{creating ? 'Novo mapa de região' : board.imageUrl ? 'Alterar mapa' : 'Adicionar mapa'}</h2><button type="button" aria-label="Fechar" disabled={pending} onClick={onClose}>×</button></div>
        {creating && <label>Região do mapa<select value={regionId} required disabled={pending} onChange={(event) => { const selected = regions.find((entry) => entry.id === event.target.value); setRegionId(event.target.value); setName(selected?.name ?? ''); setImageUrl(selected?.imageUrl ?? ''); }}><option value="">Escolha uma região</option>{regions.filter((entry) => !entry.boardId).map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}</select></label>}
        <label>Nome do mapa<input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} required disabled={pending} /></label>
        <label>Imagem do mapa<input type="file" accept={IMAGE_TYPES} onChange={(event) => setFile(event.target.files?.[0] ?? null)} disabled={pending} /></label>
        <label>Ou use o link da imagem<input type="url" placeholder="https://…" value={imageUrl} onChange={(event) => { setImageUrl(event.target.value); setFile(null); }} disabled={pending} /></label>
        {file && <small className="muted">Imagem selecionada: {file.name}</small>}
        {error && <p className="alert error" role="alert">{error.message}</p>}
        <div className="actions"><button type="button" disabled={pending} onClick={onClose}>Cancelar</button><button type="submit" className="primary" disabled={pending || !name.trim() || (creating && !regionId) || (!file && !imageUrl.trim() && !region?.imageUrl)}>{pending ? 'Salvando…' : 'Salvar mapa'}</button></div>
      </form>
    </dialog>
  );
}

function MapDeleteDialog({ board, pending, error, onDelete, onClose }) {
  const dialogRef = useRef(null);
  useOutsideDismiss(dialogRef, onClose, !pending);
  useEffect(() => { dialogRef.current?.showModal(); }, []);

  return <dialog ref={dialogRef} className="map-image-dialog" aria-label="Deletar mapa" onCancel={(event) => { event.preventDefault(); if (!pending) onClose(); }}>
    <div className="map-delete-dialog-content">
      <h2>Deletar mapa</h2>
      <p>Deletar <strong>{board.name}</strong> e seus pins, caminhos e limites?</p>
      <p className="muted">Os locais e as entidades cadastradas continuam disponíveis.</p>
      {!board.regionId && <p className="muted">Você poderá adicionar uma nova imagem ao mapa geral.</p>}
      {error && <p className="alert error" role="alert">{['VERSION_CONFLICT', 'MAP_VERSION_CONFLICT'].includes(error.code) ? 'O mapa foi alterado. Feche esta janela e revise o mapa antes de tentar novamente.' : error.message}</p>}
      <div className="actions"><button type="button" disabled={pending} onClick={onClose}>Cancelar</button><button type="button" className="danger" disabled={pending} onClick={onDelete}>{pending ? 'Deletando…' : 'Deletar mapa'}</button></div>
    </div>
  </dialog>;
}

function formatDistance(value) {
  if (value == null) return 'Distância não informada';
  return `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: value < 1 ? 6 : 2 }).format(value)} km`;
}

function formatCoordinate(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function imageDimensions(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const timeout = setTimeout(() => { image.onload = image.onerror = null; reject(new Error('Não foi possível medir a imagem. Confira o link ou envie o arquivo.')); }, 15000);
    image.onload = () => { clearTimeout(timeout); resolve({ imageWidth: image.naturalWidth, imageHeight: image.naturalHeight }); };
    image.onerror = () => { clearTimeout(timeout); reject(new Error('Não foi possível abrir a imagem. Confira o link ou envie o arquivo.')); };
    image.src = url;
  });
}

export function ImageMap({ board, campaignId, viewAsUserId, editing, canMovePin, pending, placingLocation, placingMarker, calibrating, calibrationPoints, selectedIds = [], popupPinId, network, editingNetwork, networkPath, consultingNetwork, connectionSuggestion, onChooseEdge, selectedEdgeId, onSelectEdge, onNetworkChange, onNetworkError, boundaryMode, boundaryPoints = [], boundaryRegion, onBoundaryPoint, onBoundaryStroke, onSelectBoundary, selectedBoundaryId, routePopup, onSelectPin, onClosePin, onPlace, onCalibrationPoint, onMovePin, onRemovePin, onImageMetrics }) {
  const imageRef = useRef(null);
  const dragRef = useRef(null);
  const savingRef = useRef(false);
  const suppressClickRef = useRef(false);
  const [preview, setPreview] = useState(null);
  const [imageError, setImageError] = useState(false);
  const [imageReady, setImageReady] = useState(false);
  const boundaryDragRef = useRef(null);
  const selected = board.pins.find((pin) => pin.id === popupPinId) ?? (board.travelMarkers ?? []).find(marker => marker.id === popupPinId && marker.ownerType === 'group');
  const cancelDrag = () => {
    const active = dragRef.current;
    dragRef.current = null;
    if (active?.element.hasPointerCapture?.(active.pointerId)) active.element.releasePointerCapture(active.pointerId);
    setPreview(null);
  };

  useEffect(() => {
    const cancel = () => cancelDrag();
    const key = (event) => { if (event.key === 'Escape') cancelDrag(); };
    window.addEventListener('blur', cancel);
    window.addEventListener('keydown', key);
    return () => { window.removeEventListener('blur', cancel); window.removeEventListener('keydown', key); };
  }, []);
  useEffect(() => { cancelDrag(); setImageError(false); setImageReady(false); }, [board.imageUrl]);
  useEffect(() => { if (!editing || pending) cancelDrag(); }, [editing, pending]);

  const startDrag = (event, pin) => {
    event.stopPropagation();
    if (!editing || !canMovePin(pin) || pending || savingRef.current || dragRef.current || event.button !== 0 || !imageReady) return;
    suppressClickRef.current = false;
    const bounds = imageRef.current.getBoundingClientRect();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = beginPointerDrag({ pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, pin, bounds, element: event.currentTarget });
  };

  const moveDrag = (event) => {
    const boundary = boundaryDragRef.current;
    if (boundary?.pointerId === event.pointerId) {
      const point = { x: clamp((event.clientX - boundary.bounds.left) / boundary.bounds.width), y: clamp((event.clientY - boundary.bounds.top) / boundary.bounds.height) };
      if (Math.hypot(point.x - boundary.points.at(-1).x, point.y - boundary.points.at(-1).y) > 0.002 && boundary.points.length < 500) { boundary.points.push(point); onBoundaryStroke(boundary.points.slice()); }
      return;
    }
    const active = dragRef.current;
    if (!active || active.pointerId !== event.pointerId) return;
    const coordinates = {
      x: clamp(active.pin.x + (event.clientX - active.startClientX) / active.bounds.width),
      y: clamp(active.pin.y + (event.clientY - active.startClientY) / active.bounds.height)
    };
    const updated = updatePointerDrag(active, event, coordinates);
    if (!updated.changed) return;
    dragRef.current = updated.state;
    suppressClickRef.current = true;
    setPreview({ id: active.pin.id, entityId: active.pin.entityId, ...coordinates });
  };

  const endDrag = async (event) => {
    const boundary = boundaryDragRef.current;
    if (boundary?.pointerId === event.pointerId) { moveDrag(event); boundaryDragRef.current = null; onBoundaryStroke(simplifyBoundary(boundary.points)); return; }
    const active = dragRef.current;
    if (!active || active.pointerId !== event.pointerId) return;
    moveDrag(event);
    const { commit } = finishPointerDrag(dragRef.current, event.pointerId);
    cancelDrag();
    if (!commit || pending || savingRef.current || (commit.x === active.pin.x && commit.y === active.pin.y)) return;
    savingRef.current = true;
    try { await onMovePin(active.pin, commit); } finally { savingRef.current = false; }
  };

  const imageClick = async (event) => {
    if (event.target !== imageRef.current) return;
    suppressClickRef.current = false;
    if ((!placingLocation && !placingMarker && !calibrating && !boundaryMode) || !imageReady || pending || savingRef.current) return;
    const bounds = imageRef.current.getBoundingClientRect();
    const coordinates = { x: clamp((event.clientX - bounds.left) / bounds.width), y: clamp((event.clientY - bounds.top) / bounds.height) };
    savingRef.current = true;
    try { if (boundaryMode === 'vertices') onBoundaryPoint(coordinates); else if (boundaryMode === 'freehand') return; else if (calibrating) onCalibrationPoint(coordinates); else await onPlace(coordinates); } finally { savingRef.current = false; }
  };

  const rulerPoints = calibrating ? calibrationPoints ?? [] : [];
  const bar = scaleBar(board.scale);
  return (
    <div className={`image-map ${placingLocation || placingMarker || calibrating || boundaryMode ? 'placing-pin' : ''} ${editing ? 'editing-pins' : ''} ${consultingNetwork ? 'consulting-path' : ''}`} onClick={imageClick} onPointerMove={editing || boundaryMode === 'freehand' ? moveDrag : undefined} onPointerUp={editing || boundaryMode === 'freehand' ? endDrag : undefined} onPointerCancel={(event) => { if (boundaryDragRef.current?.pointerId === event.pointerId) { boundaryDragRef.current = null; onBoundaryStroke([]); } if (dragRef.current?.pointerId === event.pointerId) cancelDrag(); }}>
      <img ref={imageRef} className="image-map-art" src={board.imageUrl} alt={board.name} draggable={false} onPointerDown={(event) => { if (boundaryMode !== 'freehand' || pending || event.button !== 0 || !imageReady) return; const bounds = event.currentTarget.getBoundingClientRect(); const point = { x: clamp((event.clientX - bounds.left) / bounds.width), y: clamp((event.clientY - bounds.top) / bounds.height) }; event.currentTarget.setPointerCapture(event.pointerId); boundaryDragRef.current = { pointerId: event.pointerId, bounds, points: [point] }; onBoundaryStroke([point]); }} onLoad={(event) => { setImageReady(true); setImageError(false); onImageMetrics?.({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight }); }} onError={() => { setImageReady(false); setImageError(true); }} />
      {imageReady && bar && <div className="image-map-scale-bar" style={{ width: `${bar.widthPercent}%` }} aria-label={`Escala ${formatDistance(bar.distanceKm)}`}><span /><small>{formatDistance(bar.distanceKm)}</small></div>}
      {imageError && <p className="alert error">Não foi possível abrir a imagem do mapa. Confira o arquivo ou o link.</p>}
      {imageReady && <svg className={`image-map-routes ${onSelectBoundary && !boundaryMode ? 'editing-boundaries' : ''}`} viewBox="0 0 100 100" preserveAspectRatio="none" aria-label="Limites e régua do mapa">
        {(board.boundaries ?? []).filter(boundary => !(boundary.id === selectedBoundaryId && boundaryMode && boundaryPoints.length > 0)).map((boundary) => <g key={boundary.id} className={`image-map-boundary ${boundary.id === selectedBoundaryId ? 'selected' : ''}`} role={onSelectBoundary && !boundaryMode ? 'button' : undefined} tabIndex={onSelectBoundary && !boundaryMode && !pending ? 0 : undefined} aria-label={onSelectBoundary && !boundaryMode ? `Selecionar limite ${boundary.name}` : undefined} onClick={event => { if (onSelectBoundary && !boundaryMode && !pending) { event.stopPropagation(); onSelectBoundary(boundary); } }} onKeyDown={event => { if (onSelectBoundary && !boundaryMode && !pending && ['Enter', ' '].includes(event.key)) { event.preventDefault(); onSelectBoundary(boundary); } }}><polygon points={boundary.points.map((point) => `${point.x * 100},${point.y * 100}`).join(' ')} /><text x={boundary.points.reduce((sum, point) => sum + point.x, 0) / boundary.points.length * 100} y={boundary.points.reduce((sum, point) => sum + point.y, 0) / boundary.points.length * 100}>{boundary.name}</text></g>)}
        {boundaryPoints.length > 0 && <g className="image-map-boundary draft"><polyline points={boundaryPoints.map((point) => `${point.x * 100},${point.y * 100}`).join(' ')} />{boundaryPoints.map((point, index) => <circle key={index} cx={point.x * 100} cy={point.y * 100} r=".35" />)}{boundaryRegion && <title>{boundaryRegion.name}</title>}</g>}
        {rulerPoints.length > 0 && <line className="image-map-ruler" x1={rulerPoints[0].x * 100} y1={rulerPoints[0].y * 100} x2={(rulerPoints[1] ?? rulerPoints[0]).x * 100} y2={(rulerPoints[1] ?? rulerPoints[0]).y * 100} />}
      </svg>}
      {imageReady && network && <MapNetworkLayer imageRef={imageRef} network={network} editing={editingNetwork} consulting={consultingNetwork} connectionSuggestion={connectionSuggestion} onChooseEdge={onChooseEdge} pending={pending} path={networkPath} selectedEdgeId={selectedEdgeId} onSelectEdge={onSelectEdge} onChange={onNetworkChange} onError={onNetworkError} />}
      {imageReady && board.pins.map((pin) => {
        const shown = preview?.id === pin.id ? preview : pin;
        return (
          <button type="button" key={pin.id} className={`image-map-pin pin-${pin.pinType ?? pin.type} ${selectedIds.includes(pin.id) ? 'selected' : ''}`} style={{ left: `${shown.x * 100}%`, top: `${shown.y * 100}%`, '--pin-color': pin.color ?? pinColor(pin) }} aria-label={pin.name} aria-pressed={selectedIds.includes(pin.id)} title={pin.name} onPointerDown={(event) => startDrag(event, pin)} onLostPointerCapture={(event) => { if (dragRef.current?.pointerId === event.pointerId) cancelDrag(); }} onClick={(event) => { event.stopPropagation(); if (!suppressClickRef.current) onSelectPin(pin); suppressClickRef.current = false; }}>
            <svg viewBox="0 0 24 32" aria-hidden="true"><path d="M12 1a11 11 0 0 0-11 11c0 8 11 19 11 19s11-11 11-19A11 11 0 0 0 12 1Z" /><circle cx="12" cy="12" r="4" /></svg>
          </button>
        );
      })}
      {imageReady && (board.travelMarkers ?? []).map((marker) => {
        const shown = preview?.id === marker.id ? preview : marker;
        return <button type="button" key={marker.id} className={`image-map-travel-marker ${selectedIds.includes(marker.id) ? 'selected' : ''}`} style={{ left: `${shown.x * 100}%`, top: `${shown.y * 100}%`, '--marker-color': marker.ownerType === 'player' ? '#36e9ff' : marker.ownerType === 'group' ? '#c4b5fd' : '#fb923c' }} aria-label={`Marcador ${marker.name}`} aria-pressed={selectedIds.includes(marker.id)} title={marker.name} onPointerDown={(event) => startDrag(event, marker)} onLostPointerCapture={(event) => { if (dragRef.current?.pointerId === event.pointerId) cancelDrag(); }} onClick={(event) => { event.stopPropagation(); if (!suppressClickRef.current) onSelectPin(marker); suppressClickRef.current = false; }}>
          <svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="14" />{marker.ownerType === 'player' ? <><circle className="marker-icon" cx="16" cy="12" r="4" /><path className="marker-icon" d="M9 24v-3a7 7 0 0 1 14 0v3" /></> : marker.ownerType === 'group' ? <><circle className="marker-icon" cx="12" cy="12" r="3" /><circle className="marker-icon" cx="21" cy="13" r="3" /><path className="marker-icon" d="M6 23v-2a6 6 0 0 1 12 0v2 M18 18a5 5 0 0 1 9 3v2" /></> : <><path className="marker-icon" d="M6 10h4l2 10h12l3-8H11" /><circle className="marker-icon" cx="14" cy="25" r="2" /><circle className="marker-icon" cx="23" cy="25" r="2" /></>}</svg><span>{marker.name}</span>
        </button>;
      })}
      {imageReady && selected && !editing && <MapPinPopup key={selected.id} pin={selected} boardId={board.id} campaignId={campaignId} viewAsUserId={viewAsUserId} imageRef={imageRef} editing={false} pending={pending} onRemove={onRemovePin} onClose={onClosePin} />}
      {imageReady && routePopup}
    </div>
  );
}

export function MapPage() {
  const { campaignId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const boardId = searchParams.get('map') ?? '';
  const { isGm: canManageMap } = useOutletContext();
  const [viewAsUserId, setViewAsUserId] = useState('');
  const isGm = canManageMap && !viewAsUserId;
  const queryClient = useQueryClient();
  const [imageFormOpen, setImageFormOpen] = useState(false);
  const [creatingMap, setCreatingMap] = useState(false);
  const [deletingMap, setDeletingMap] = useState(null);
  const [openMenu, setOpenMenu] = useState(null);
  const [popupPinId, setPopupPinId] = useState(null);
  const [editing, setEditing] = useState(false);
  const [editorMode, setEditorMode] = useState('view');
  const [addingPin, setAddingPin] = useState(false);
  const [locationId, setLocationId] = useState('');
  const [markerKind, setMarkerKind] = useState('entity');
  const [markerOwnerId, setMarkerOwnerId] = useState('');
  const [markerName, setMarkerName] = useState('');
  const [selectedPathId, setSelectedPathId] = useState(null);
  const [routePopupDismissed, setRoutePopupDismissed] = useState(false);
  const [viaEdgeId, setViaEdgeId] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);
  const [roadMode, setRoadMode] = useState(null);
  const [networkDraft, setNetworkDraft] = useState(null);
  const [networkDirty, setNetworkDirty] = useState(false);
  const [networkConflict, setNetworkConflict] = useState(false);
  const [networkDialog, setNetworkDialog] = useState(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState(null);
  const [networkError, setNetworkError] = useState('');
  const [reviewConnections, setReviewConnections] = useState(false);
  const [connectionIndex, setConnectionIndex] = useState(0);
  const [ignoredConnections, setIgnoredConnections] = useState(new Set());
  const networkBaseline = useRef('');
  const leaveAction = useRef(null);
  const allowNavigation = useRef(false);
  const [calibrating, setCalibrating] = useState(false);
  const [calibrationPoints, setCalibrationPoints] = useState([]);
  const [scaleDialog, setScaleDialog] = useState(null);
  const [boundaryMode, setBoundaryMode] = useState(null);
  const [boundaryRegionId, setBoundaryRegionId] = useState('');
  const [selectedBoundaryId, setSelectedBoundaryId] = useState(null);
  const [boundaryName, setBoundaryName] = useState('');
  const [boundaryPoints, setBoundaryPoints] = useState([]);
  const [imageMetrics, setImageMetrics] = useState({ width: 1, height: 1 });
  const mapApi = (path, options, query = {}) => {
    const parameters = new URLSearchParams({ ...(boardId ? { boardId } : {}), ...((!options?.method || options.method === 'GET') && viewAsUserId ? { viewAsUserId } : {}), ...query });
    return api(`/api/v1/campaigns/${campaignId}/map/${path}${parameters.size ? '?' + parameters : ''}`, options);
  };
  const boards = useQuery({ queryKey: ['map-boards', campaignId, viewAsUserId], queryFn: () => api(`/api/v1/campaigns/${campaignId}/map/boards${viewAsUserId ? '?viewAsUserId=' + encodeURIComponent(viewAsUserId) : ''}`) });
  const board = useQuery({ queryKey: ['map-board', campaignId, boardId, viewAsUserId], queryFn: () => mapApi('board') });
  const players = useQuery({ queryKey: ['memberships', campaignId], queryFn: () => api(`/api/v1/campaigns/${campaignId}/memberships`), enabled: canManageMap });
  const previewPlayers = (Array.isArray(players.data) ? players.data : players.data?.items ?? []).filter((entry) => !['owner', 'gm', 'assistant_gm'].includes(entry.role));
  const locations = useQuery({ queryKey: ['map-pin-candidates', campaignId, boardId], queryFn: () => mapApi('pin-candidates'), enabled: isGm && addingPin && markerKind === 'entity' });
  const chooseBoard = (id) => guardNetwork(() => { resetMode(false); setSearchParams(id ? { map: id } : {}); });

  useEffect(() => {
    setEditorMode('view'); setSelectedBoundaryId(null); setBoundaryName('');
    setSelectedIds([]); setSelectedPathId(null); setViaEdgeId(null); setPopupPinId(null); setRoadMode(null); setNetworkDraft(null); setNetworkDirty(false); setSelectedEdgeId(null); setEditing(false); setAddingPin(false); setLocationId(''); setCalibrating(false); setCalibrationPoints([]); setScaleDialog(null); setBoundaryMode(null); setBoundaryPoints([]); setBoundaryRegionId(''); setOpenMenu(null); setDeletingMap(null); setImageMetrics({ width: 1, height: 1 });
  }, [boardId]);

  useEffect(() => {
    if (boardId && !networkDirty && board.isError && board.error?.code === 'NOT_FOUND') setSearchParams({});
  }, [boardId, networkDirty, board.isError, board.error?.code, setSearchParams]);

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['map-board', campaignId] }),
      queryClient.invalidateQueries({ queryKey: ['map-boards', campaignId] }),
      queryClient.invalidateQueries({ queryKey: ['map-pin-content', campaignId] }),
      queryClient.invalidateQueries({ queryKey: ['map-pin-candidates', campaignId] }),
      queryClient.invalidateQueries({ queryKey: ['map-network-path', campaignId] }),
      queryClient.invalidateQueries({ queryKey: ['map-network-destinations', campaignId] })
    ]);
  };
  const refreshOnConflict = (error) => { if (['VERSION_CONFLICT', 'MAP_VERSION_CONFLICT'].includes(error.code)) refresh(); };
  const saveImage = useMutation({
    mutationFn: async ({ name, imageUrl, file, regionId }) => {
      if (file) {
        const data = new FormData();
        data.append('file', file);
        const upload = await api(`/api/v1/campaigns/${campaignId}/media`, { method: 'POST', body: data });
        imageUrl = upload.url;
      }
      const dimensions = await imageDimensions(imageUrl);
      if (creatingMap) return api(`/api/v1/campaigns/${campaignId}/map/boards`, { method: 'POST', body: { regionId, name, imageUrl, ...dimensions } });
      return mapApi('board', { method: 'PATCH', headers: { 'If-Match': String(board.data.version) }, body: { name, imageUrl, ...dimensions } });
    },
    onSuccess: async (saved) => { await refresh(); setImageFormOpen(false); if (creatingMap) chooseBoard(saved.id); setCreatingMap(false); },
    onError: refreshOnConflict
  });
  const removeBoard = useMutation({
    mutationFn: (selectedBoard) => api(`/api/v1/campaigns/${campaignId}/map/boards/${encodeURIComponent(selectedBoard.id)}`, { method: 'DELETE', headers: { 'If-Match': String(selectedBoard.version) } }),
    onSuccess: async (_result, selectedBoard) => {
      setDeletingMap(null); changeMode(false); chooseBoard('');
      queryClient.removeQueries({ queryKey: ['map-board', campaignId, selectedBoard.id], exact: true });
      await refresh();
    },
    onError: refreshOnConflict
  });
  const savePin = useMutation({
    mutationFn: ({ pin, entityType, entityId, version, x, y }) => mapApi(pin ? `pins/${encodeURIComponent(pin.id)}` : 'pins', { method: pin ? 'PATCH' : 'POST', headers: { 'If-Match': String(version ?? board.data.version) }, body: pin ? { x, y } : { entityType, entityId, x, y } }),
    onSuccess: async () => { await refresh(); setAddingPin(false); setLocationId(''); },
    onError: refreshOnConflict
  });
  const removePin = useMutation({
    mutationFn: (pin) => mapApi(`pins/${encodeURIComponent(pin.id)}`, { method: 'DELETE', headers: { 'If-Match': String(pin.version) } }),
    onSuccess: refresh,
    onError: refreshOnConflict
  });
  const saveMarker = useMutation({
    mutationFn: ({ marker, x, y, ...input }) => mapApi(marker ? `markers/${encodeURIComponent(marker.id)}` : 'markers', { method: marker ? 'PATCH' : 'POST', headers: { 'If-Match': String(marker?.version ?? board.data.version) }, body: marker ? { x, y } : { ...input, x, y } }),
    onSuccess: async () => { await refresh(); setAddingPin(false); setMarkerOwnerId(''); }, onError: refreshOnConflict
  });
  const removeMarker = useMutation({
    mutationFn: (marker) => mapApi(`markers/${encodeURIComponent(marker.id)}`, { method: 'DELETE', headers: { 'If-Match': String(marker.version) } }), onSuccess: refresh, onError: refreshOnConflict
  });
  const saveNetwork = useMutation({
    mutationFn: (draft) => api(`/api/v1/campaigns/${campaignId}/map/network?boardId=${encodeURIComponent(draft.boardId)}`, { method: 'PUT', headers: { 'If-Match': String(draft.version) }, body: draft.network }),
    onSuccess: async (saved) => {
      networkBaseline.current = JSON.stringify(saved.roadNetwork);
      setNetworkDraft({ network: saved.roadNetwork, version: saved.version, boardId: saved.id });
      setNetworkDirty(false); setNetworkConflict(false); setNetworkError(''); setSelectedEdgeId(null);
      queryClient.setQueryData(['map-board', campaignId, boardId, viewAsUserId], saved);
      await refresh();
      setNetworkDialog(null);
      const action = leaveAction.current; leaveAction.current = null;
      if (action) { allowNavigation.current = true; action(); }
    },
    onError: (error) => { if (error.code === 'VERSION_CONFLICT') { setNetworkConflict(true); refresh(); } }
  });
  const blocker = useBlocker(() => (networkDirty || saveNetwork.isPending) && !allowNavigation.current);
  useBeforeUnload((event) => { if (networkDirty || saveNetwork.isPending) { event.preventDefault(); event.returnValue = ''; } });
  useEffect(() => { if (blocker.state === 'blocked') { leaveAction.current = () => blocker.proceed(); setNetworkDialog('leave'); setOpenMenu(null); } }, [blocker]);
  useEffect(() => { allowNavigation.current = false; }, [boardId, roadMode, networkDirty]);

  const saveScale = useMutation({
    mutationFn: ({ points, distanceKm }) => {
      const ruler = points ?? (legacyScale ? [{ x: 0, y: 0 }, { x: 1, y: 0 }] : null);
      return mapApi('board/scale', { method: 'PATCH', headers: { 'If-Match': String(mapBoard.version) }, body: ruler ? { startX: ruler[0].x, startY: ruler[0].y, endX: ruler[1].x, endY: ruler[1].y, distanceKm, imageWidth: imageMetrics.width, imageHeight: imageMetrics.height } : { distanceKm } });
    },
    onSuccess: async () => { await refresh(); setCalibrating(false); setCalibrationPoints([]); setScaleDialog(null); },
    onError: refreshOnConflict
  });
  const saveBoundary = useMutation({
    mutationFn: ({ boundary, regionId, name, points }) => mapApi(boundary ? `boundaries/${encodeURIComponent(boundary.id)}` : 'boundaries', { method: boundary ? 'PATCH' : 'POST', headers: { 'If-Match': String(boundary?.version ?? board.data.version) }, body: { regionId, name: name.trim() || null, points } }),
    onSuccess: async () => { await refresh(); setBoundaryMode(null); setBoundaryPoints([]); setSelectedBoundaryId(null); setBoundaryRegionId(''); setBoundaryName(''); },
    onError: refreshOnConflict
  });
  const removeBoundary = useMutation({
    mutationFn: (boundary) => mapApi(`boundaries/${encodeURIComponent(boundary.id)}`, { method: 'DELETE', headers: { 'If-Match': String(boundary.version) } }),
    onSuccess: async () => { await refresh(); setBoundaryMode(null); setSelectedBoundaryId(null); setBoundaryRegionId(''); setBoundaryName(''); setBoundaryPoints([]); },
    onError: refreshOnConflict
  });
  const legacyScale = board.data?.scaleKm && (!board.data.scale || board.data.scale.imageWidth === 1);
  const effectiveScale = legacyScale ? calibrateScale({ x: 0, y: 0 }, { x: 1, y: 0 }, board.data.scaleKm, imageMetrics.width, imageMetrics.height) : board.data?.scale;
  const mapBoard = board.data ? { ...board.data, scale: effectiveScale } : null;
  const pending = saveImage.isPending || removeBoard.isPending || saveMarker.isPending || removeMarker.isPending || savePin.isPending || removePin.isPending || saveNetwork.isPending || saveScale.isPending || saveBoundary.isPending || removeBoundary.isPending;
  const availableLocations = (locations.data?.items ?? []).filter((entry) => !entry.pinned);
  const placingLocation = markerKind === 'entity' && availableLocations.find((entry) => `${entry.type}:${entry.id}` === locationId);
  const markerCandidate = markerKind === 'group' && markerOwnerId === '@campaign' ? { ownerType: 'group', name: 'Grupo' } : mapBoard?.markerCandidates?.find((entry) => entry.ownerType === markerKind && entry.ownerId === markerOwnerId);
  const placingMarker = addingPin && markerKind !== 'entity' && (markerCandidate || (['carriage', 'custom'].includes(markerKind) && markerName.trim())) ? { ownerType: markerCandidate?.ownerType ?? 'custom', ...(markerCandidate ? { ownerId: markerCandidate.ownerId } : {}), name: markerCandidate?.name ?? markerName.trim() } : null;
  const mapPins = [...(mapBoard?.pins ?? []), ...(mapBoard?.travelMarkers ?? [])];
  const ownMarkerCandidate = !canManageMap && !viewAsUserId ? mapBoard?.markerCandidates?.find((entry) => entry.ownerType === 'player') : null;
  const ownMarkerExists = ownMarkerCandidate && mapPins.some((pin) => pin.ownerType === 'player' && pin.ownerId === ownMarkerCandidate.ownerId);
  const canMovePin = (pin) => isGm || (!viewAsUserId && pin.ownerType && pin.canMove);
  const canEditPins = isGm || Boolean(ownMarkerCandidate) || (!viewAsUserId && mapPins.some((pin) => pin.ownerType && pin.canMove));
  const error = saveMarker.error ?? removeMarker.error ?? saveImage.error ?? savePin.error ?? removePin.error ?? saveBoundary.error ?? removeBoundary.error;
  const selectedPins = selectedIds.map((id) => mapPins.find((pin) => pin.id === id)).filter(Boolean);
  const network = networkDraft?.network ?? mapBoard?.roadNetwork ?? emptyRoadNetwork(imageMetrics.width, imageMetrics.height);
  const nearbyConnections = useMemo(() => roadMode === 'edit' && reviewConnections && imageMetrics.width > 1 ? findRoadConnectionSuggestions(network, { imageWidth: imageMetrics.width, imageHeight: imageMetrics.height }) : [], [network, roadMode, reviewConnections, imageMetrics.width, imageMetrics.height]);
  const connectionChoices = nearbyConnections.filter(entry => !ignoredConnections.has(entry.id));
  const activeConnectionIndex = Math.max(0, Math.min(connectionIndex, connectionChoices.length - 1));
  const connectionSuggestion = connectionChoices[activeConnectionIndex];
  const changeNetwork = useCallback(next => {
    setNetworkDraft(draft => ({ ...draft, network: next })); setNetworkDirty(JSON.stringify(next) !== networkBaseline.current); setSelectedEdgeId(null); setNetworkError('');
  }, []);
  const joinConnection = () => {
    try { changeNetwork(joinRoadConnection(network, connectionSuggestion, { imageWidth: imageMetrics.width, imageHeight: imageMetrics.height })); }
    catch (error) { setNetworkError(error.message); }
  };
  const pinSignature = mapPins.map((pin) => `${pin.id}:${pin.version}:${pin.x}:${pin.y}`).join('|');
  const territorySignature = JSON.stringify(mapBoard?.boundaries ?? []);
  const pathKey = ['map-network-path', campaignId, boardId, viewAsUserId, mapBoard?.version, pinSignature, territorySignature, selectedIds.join('|')];
  const pathQuery = useQuery({ queryKey: pathKey, queryFn: () => mapApi('network/path', undefined, { boardId: mapBoard.id, fromPinId: selectedIds[0], toPinId: selectedIds[1] }), enabled: roadMode === 'query' && selectedIds.length === 2 && !board.isFetching, retry: false });
  const viaQuery = useQuery({ queryKey: [...pathKey, viaEdgeId], queryFn: () => mapApi('network/path', undefined, { boardId: mapBoard.id, fromPinId: selectedIds[0], toPinId: selectedIds[1], viaEdgeId }), enabled: roadMode === 'query' && selectedIds.length === 2 && Boolean(viaEdgeId) && !board.isFetching, retry: false });
  const destinations = useQuery({ queryKey: ['map-network-destinations', campaignId, boardId, viewAsUserId, mapBoard?.version, pinSignature, territorySignature, selectedIds[0]], queryFn: () => mapApi('network/destinations', undefined, { boardId: mapBoard.id, fromPinId: selectedIds[0] }), enabled: roadMode === 'query' && selectedIds.length === 1 && !board.isFetching, retry: false });
  const currentPath = pathQuery.data?.version === mapBoard?.version ? pathQuery.data : null;
  const routeChoices = useMemo(() => currentPath?.status === 'found' ? (currentPath.alternatives ?? currentPath.paths ?? [currentPath]).map((path, index) => ({ ...path, id: path.id ?? `path-${index}`, status: 'found' })) : [], [currentPath]);
  const currentVia = viaEdgeId && viaQuery.data?.version === mapBoard?.version ? viaQuery.data : null;
  const viaChoices = useMemo(() => currentVia?.status === 'found' ? (currentVia.alternatives ?? currentVia.paths ?? [currentVia]).map((path, index) => ({ ...path, id: path.id ?? `via-${index}`, status: 'found' })) : [], [currentVia]);
  const allChoices = useMemo(() => [...routeChoices.map((path) => viaChoices.find((via) => via.id === path.id) ?? path), ...viaChoices.filter((path) => !routeChoices.some((existing) => existing.id === path.id))], [routeChoices, viaChoices]);
  const selectedPath = (selectedPathId ? allChoices.find((path) => path.id === selectedPathId) : null) ?? (viaEdgeId ? viaChoices[0] : routeChoices[0]);
  const networkPath = roadMode === 'query' ? selectedPath ?? (currentVia?.status === 'no_path' ? currentVia : currentPath) : null;
  const choosePath = (id) => { setRoutePopupDismissed(false); setSelectedPathId(id); if (routeChoices.some((path) => path.id === id)) setViaEdgeId(null); };
  const chooseEdge = useCallback((id) => { setRoutePopupDismissed(false); setSelectedPathId(null); setViaEdgeId(id); }, []);
  useEffect(() => {
    if (mapBoard) setSelectedIds((current) => current.filter((id) => [...mapBoard.pins, ...(mapBoard.travelMarkers ?? [])].some((pin) => pin.id === id)).slice(-2));
  }, [mapBoard?.pins, mapBoard?.travelMarkers]);
  const closePin = () => setPopupPinId(null);
  const selectPin = (pin) => {
    if (pending || addingPin || calibrating || boundaryMode || roadMode === 'edit') return;
    closePin(); setRoutePopupDismissed(false); setSelectedPathId(null); setViaEdgeId(null);
    if (roadMode === 'query') setSelectedIds((current) => current.length === 1 && current[0] !== pin.id ? [current[0], pin.id] : [pin.id]);
    else if (editorMode === 'regions') { const boundary = mapBoard.boundaries.find(entry => entry.regionId === (pin.entityId ?? pin.locationId)); if (boundary) editBoundary(boundary); }
    else if (editing) setSelectedIds([pin.id]);
    else setPopupPinId(pin.id);
  };
  const resetMode = (editPins) => {
    setRoutePopupDismissed(false);
    setReviewConnections(false); setConnectionIndex(0); setIgnoredConnections(new Set());
    setEditorMode(editPins ? 'pins' : 'view'); setSelectedBoundaryId(null); setBoundaryName(''); setBoundaryRegionId('');
    setEditing(editPins); setRoadMode(null); setSelectedPathId(null); setViaEdgeId(null); setMarkerKind('entity'); setMarkerOwnerId(''); setMarkerName(''); setNetworkDraft(null); setNetworkDirty(false); setNetworkConflict(false); setNetworkError(''); setSelectedEdgeId(null); setAddingPin(false); setLocationId(''); setCalibrating(false); setCalibrationPoints([]); setBoundaryMode(null); setBoundaryPoints([]); setSelectedIds([]); closePin(); setOpenMenu(null);
  };
  const guardNetwork = (action) => {
    if (networkDirty) { leaveAction.current = action; setNetworkDialog('leave'); setOpenMenu(null); return; }
    action();
  };
  const changeMode = (editPins) => guardNetwork(() => resetMode(editPins));
  const startRoadMode = (mode) => guardNetwork(() => {
    resetMode(false); setRoadMode(mode); saveNetwork.reset();
    if (mode === 'edit') {
      setEditorMode('network');
      const initial = { ...(mapBoard.roadNetwork ?? emptyRoadNetwork()), imageWidth: imageMetrics.width, imageHeight: imageMetrics.height };
      const repaired = prepareRoadNetwork(initial);
      networkBaseline.current = JSON.stringify(initial);
      setNetworkDraft({ network: repaired.network, version: mapBoard.version, boardId: mapBoard.id });
      setNetworkDirty(JSON.stringify(repaired.network) !== networkBaseline.current);
      if (repaired.tooLarge) setNetworkError('Os cruzamentos geram pontos ou trechos demais. Exclua trechos ou divida a rede em mapas regionais.');
    }
  });
  const closeNetworkDialog = () => { setNetworkDialog(null); leaveAction.current = null; if (blocker.state === 'blocked') blocker.reset(); };
  const discardNetwork = () => {
    if (networkDialog === 'review') {
      const current = mapBoard.roadNetwork ?? emptyRoadNetwork(imageMetrics.width, imageMetrics.height);
      networkBaseline.current = JSON.stringify(current); setNetworkDraft({ network: current, version: mapBoard.version, boardId: mapBoard.id }); setNetworkDirty(false); setNetworkConflict(false); saveNetwork.reset(); closeNetworkDialog(); return;
    }
    setNetworkDirty(false); setNetworkDraft(null); setNetworkDialog(null);
    const action = leaveAction.current; leaveAction.current = null;
    if (action) { allowNavigation.current = true; action(); }
  };
  const saveDraft = () => {
    if (networkConflict) { setNetworkDialog('review'); return; }
    saveNetwork.mutate(networkDraft);
  };
  const reviewDraft = () => {
    setNetworkDraft((draft) => ({ ...draft, version: mapBoard.version, network: { ...draft.network, imageWidth: imageMetrics.width, imageHeight: imageMetrics.height } }));
    setNetworkConflict(false); saveNetwork.reset(); closeNetworkDialog();
  };
  const toggleMenu = (menu) => setOpenMenu((current) => current === menu ? null : menu);
  const markCalibrationPoint = (point) => {
    if (calibrationPoints.length !== 1) { setCalibrationPoints([point]); return; }
    const next = [...calibrationPoints, point];
    if (Math.hypot(next[1].x - next[0].x, next[1].y - next[0].y) < 0.001) return;
    setCalibrationPoints(next); saveScale.reset(); setScaleDialog({ points: next, editing: false, distanceKm: mapBoard.scale?.distanceKm ?? mapBoard.scaleKm });
  };
  const boundaryCandidates = mapBoard?.boundaryCandidates ?? boards.data?.regions ?? [];
  const boundaryRegion = boundaryCandidates.find((region) => region.id === boundaryRegionId);
  const boundary = (mapBoard?.boundaries ?? []).find((entry) => entry.id === selectedBoundaryId);
  const regionTool = (action) => guardNetwork(() => { resetMode(false); setEditorMode('regions'); action(); });
  const editBoundary = (entry) => regionTool(() => { setSelectedBoundaryId(entry.id); setBoundaryRegionId(entry.regionId); setBoundaryName(entry.label ?? ''); setBoundaryPoints(entry.points.map(point => ({ ...point }))); saveBoundary.reset(); removeBoundary.reset(); });
  const newBoundary = () => regionTool(() => { setBoundaryMode('freehand'); setBoundaryRegionId(mapBoard.regionId ?? ''); saveBoundary.reset(); removeBoundary.reset(); });
  const cancelBoundary = () => { setBoundaryMode(null); setBoundaryRegionId(''); setSelectedBoundaryId(null); setBoundaryName(''); setBoundaryPoints([]); saveBoundary.reset(); removeBoundary.reset(); };
  const modes = isGm ? ['view', 'pins', 'network', 'regions'] : canEditPins ? ['view', 'pins'] : ['view'];
  const modeLabels = { view: 'Visualização', pins: 'Editar pins', network: 'Caminhos', regions: 'Regiões' };
  const nextMode = modes[(modes.indexOf(editorMode) + 1) % modes.length];
  const cycleMode = () => nextMode === 'network' ? startRoadMode('edit') : guardNetwork(() => { resetMode(nextMode === 'pins'); setEditorMode(nextMode); });

  if (board.isLoading) return <div className="state-card">Carregando mapa…</div>;
  if (board.isError && !mapBoard) return <div className="state-card error">Não foi possível carregar o mapa.</div>;

  return (
    <div className="map-page image-map-page">
      <div className="page-heading">
        <div><small className="eyebrow">{mapBoard.regionId ? 'MAPA DA REGIÃO' : 'MAPA GERAL'}</small><h1>{mapBoard.name}</h1><p>{mapBoard.pins.length} {mapBoard.pins.length === 1 ? 'pin marcado' : 'pins marcados'}</p></div>
        {canManageMap && <label className="player-preview-select"><span>Visualizar como</span><select value={viewAsUserId} disabled={pending} onChange={(event) => { const id = event.target.value; guardNetwork(() => { resetMode(false); setViewAsUserId(id); }); }}><option value="">Mestre</option>{previewPlayers.map((entry) => <option key={entry.user.id} value={entry.user.id}>{entry.user.name}</option>)}</select></label>}
      </div>
      <div className="map-toolbar">
        <div className="map-toolbar-actions">
          <MapToolbarMenu label="Mapas" name="Mapas" open={openMenu === 'maps'} disabled={pending} onToggle={() => toggleMenu('maps')} onClose={() => setOpenMenu(null)} icon={<svg className="map-pinecone-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M12 3c-3 0-7 6-7 11s3 7 7 7 7-2 7-7-4-11-7-11Z M12 3V1 M8 7l4 3 4-3 M6 11l6 4 6-4 M5 16l7 4 7-4 M12 10v10" /></svg>}>
            <div role="group" aria-label="Mapas salvos"><p className="map-menu-heading">Mapas salvos</p>{(boards.data?.items?.length ? boards.data.items : [mapBoard]).map((entry) => <button type="button" role="menuitemradio" aria-checked={mapBoard.id === entry.id} key={entry.id} disabled={pending} onClick={() => chooseBoard(entry.id)}><span>{entry.name}</span><small>{entry.floor != null && entry.floor !== '' ? `Andar ${entry.floor} · ` : ''}{entry.regionName ?? (entry.regionId ? 'Região' : 'Mapa geral')}</small></button>)}</div>
            {boards.isError && <p className="error">Não foi possível carregar a lista de mapas.</p>}
            {isGm && <><div role="separator" className="map-menu-separator" /><button type="button" role="menuitem" disabled={pending || !(boards.data?.regions ?? []).some((region) => !region.boardId)} onClick={() => guardNetwork(() => { resetMode(false); setCreatingMap(true); saveImage.reset(); setImageFormOpen(true); })}>Novo mapa de região</button><button type="button" role="menuitem" disabled={pending} onClick={() => guardNetwork(() => { resetMode(false); setCreatingMap(false); saveImage.reset(); setImageFormOpen(true); })}>{mapBoard.imageUrl ? 'Alterar mapa' : 'Adicionar mapa'}</button><div role="separator" className="map-menu-separator" /><button type="button" role="menuitem" className="map-menu-delete" disabled={pending} onClick={() => guardNetwork(() => { resetMode(false); removeBoard.reset(); setDeletingMap({ id: mapBoard.id, name: mapBoard.name, regionId: mapBoard.regionId, version: mapBoard.version }); })}>Deletar mapa</button></>}
          </MapToolbarMenu>
          {mapBoard.imageUrl && <>
            {modes.length > 1 ? <button type="button" className="map-editor-cycle" aria-label="Modo de edição" data-mode={editorMode} title={`Alternar para ${modeLabels[nextMode]}`} disabled={pending || (nextMode === 'network' && imageMetrics.width <= 1)} onClick={cycleMode}><span aria-hidden="true">✎</span><span>{modeLabels[editorMode]}</span><small>{modes.indexOf(editorMode) + 1}/{modes.length}</small><span aria-hidden="true">↻</span></button> : <span className="map-mode-label">Visualização</span>}
            {editorMode === 'view' && <button type="button" className={`map-path-toggle ${roadMode === 'query' ? 'active' : ''}`} aria-label="Consultar percurso" aria-pressed={roadMode === 'query'} disabled={pending} onClick={() => roadMode === 'query' ? changeMode(false) : startRoadMode('query')}>⌁ Consultar percurso</button>}
            {isGm && editing && <button type="button" className="primary" disabled={pending || addingPin} onClick={() => { setAddingPin(true); setLocationId(''); setMarkerKind('entity'); setMarkerOwnerId(''); setMarkerName(''); setSelectedIds([]); closePin(); }}>＋ Adicionar pin</button>}
            {ownMarkerCandidate && !ownMarkerExists && editing && <button type="button" className="primary" disabled={pending || addingPin} onClick={() => { setAddingPin(true); setMarkerKind('player'); setMarkerOwnerId(ownMarkerCandidate.ownerId); setSelectedIds([]); closePin(); }}>＋ Colocar meu pin</button>}
            {isGm && editorMode === 'regions' && <MapToolbarMenu label="Regiões" name="Regiões" open={openMenu === 'tools'} disabled={pending} onToggle={() => toggleMenu('tools')} onClose={() => setOpenMenu(null)}>
              <button type="button" role="menuitem" disabled={pending} onClick={() => regionTool(() => setCalibrating(!calibrating))}>{calibrating ? 'Cancelar régua' : 'Calibrar escala'}</button>
              <button type="button" role="menuitem" disabled={pending || !mapBoard.scale || calibrating} onClick={() => regionTool(() => { saveScale.reset(); setScaleDialog({ editing: true, distanceKm: mapBoard.scale.distanceKm, points: board.data.scale ? null : [{ x: 0, y: 0 }, { x: 1, y: 0 }] }); })}>Editar escala</button>
              <div role="separator" className="map-menu-separator" /><button type="button" role="menuitem" disabled={pending || !boundaryCandidates.length} onClick={newBoundary}>Delimitar regiões</button>
              <button type="button" role="menuitem" disabled={pending} onClick={() => regionTool(() => {})}>Gerenciar limites</button>
            </MapToolbarMenu>}
          </>}
        </div>
        <div className="map-toolbar-meta"><span><strong>Escala:</strong> {mapBoard.scale ? `${formatDistance(mapBoard.scale.distanceKm)} no trecho calibrado` : 'não definida'}</span>{selectedPins.length === 0 && <span className="muted">{roadMode === 'edit' ? 'Arraste para desenhar; mova os pontos ou toque em um trecho para excluí-lo.' : roadMode === 'query' ? 'Selecione o pin de origem e depois o de destino.' : editing ? 'Arraste ou selecione um pin para editá-lo.' : calibrating || boundaryMode || addingPin ? 'Ferramenta do mapa ativa.' : 'Clique em um pin para visualizar seu conteúdo.'}</span>}{selectedPins.map((pin, index) => <span className="map-selection-chip" key={pin.id}><strong>{index + 1}. {pin.name}</strong> · X {formatCoordinate(pin.x)} · Y {formatCoordinate(pin.y)}{editing && canMovePin(pin) && <button type="button" className="map-selection-remove" aria-label={`Remover pin ${pin.name}`} title="Remover pin do mapa" disabled={pending} onClick={() => pin.ownerType ? removeMarker.mutate(pin) : removePin.mutate(pin)}>×</button>}</span>)}</div>
        {calibrating && <p className="map-route-hint">Clique no início e no fim de uma distância conhecida no mapa.</p>}
      </div>
      {error && <div className="alert error" role="alert">{error.message}</div>}
      {isGm && editorMode === 'regions' && !calibrating && !scaleDialog && <MapRegionsPanel boundaries={mapBoard.boundaries ?? []} candidates={boundaryCandidates} selectedBoundary={boundary} regionId={boundaryRegionId} name={boundaryName} points={boundaryPoints} mode={boundaryMode} formOpen={Boolean(boundaryMode || selectedBoundaryId)} pending={pending} onNew={newBoundary} onEdit={editBoundary} onRegion={setBoundaryRegionId} onName={setBoundaryName} onRedraw={() => { setBoundaryPoints([]); setBoundaryMode('freehand'); }} onMode={setBoundaryMode} onUndo={() => setBoundaryPoints(points => points.slice(0, -1))} onSave={() => saveBoundary.mutate({ boundary, regionId: boundaryRegionId, name: boundaryName, points: boundaryPoints })} onDelete={() => removeBoundary.mutate(boundary)} onCancel={cancelBoundary} />}
      {addingPin && <div className="image-map-pin-tools">
        {isGm && <MapMarkerPicker kind={markerKind} onKind={(kind) => { setMarkerKind(kind); setLocationId(''); setMarkerOwnerId(''); setMarkerName(kind === 'carriage' ? 'Carroça' : kind === 'custom' ? 'Marcador' : ''); }} ownerId={markerOwnerId} onOwner={setMarkerOwnerId} name={markerName} onName={setMarkerName} candidates={mapBoard.markerCandidates ?? []} disabled={pending} />}
        {markerKind === 'entity' && <MapPinPicker candidates={locations.data?.items ?? []} selectedId={locationId} onSelect={setLocationId} disabled={pending || locations.isError} loading={locations.isLoading} />}
        <span>{placingMarker ? `Clique no mapa para posicionar ${placingMarker.name}. O pin encaixa no caminho mais próximo.` : placingLocation ? `Clique no mapa para marcar ${placingLocation.name}.` : markerKind === 'entity' ? locations.isLoading ? 'Carregando entidades…' : 'Escolha o tipo e a entidade para colocar o pin.' : 'Escolha quem será marcado no mapa.'}</span>
        <button type="button" disabled={pending} onClick={() => { setAddingPin(false); setLocationId(''); }}>Cancelar</button>
        {markerKind === 'entity' && locations.isError && <p className="error">Não foi possível carregar as entidades.</p>}
        {markerKind === 'entity' && !locations.isLoading && !locations.isError && !availableLocations.length && <small>Todas as entidades cadastradas já estão no mapa.</small>}
      </div>}
      {editing && !addingPin && <p className="image-map-hint">Arraste os pins para ajustar a posição. Selecione um pin para removê-lo.</p>}
      {canEditPins && editing && <div className="map-edit-finish"><span>Edição de pins ativa</span><button type="button" className="primary" disabled={pending} onClick={() => changeMode(false)}><span aria-hidden="true">✓</span> {pending ? 'Salvando…' : 'Concluir edição'}</button></div>}
      {roadMode === 'edit' && <div className={`map-edit-finish map-network-finish ${reviewConnections ? 'reviewing-connections' : ''}`}>
        <span>{networkDirty ? 'Caminhos não salvos' : 'Edição da rede ativa'} · {network.edges.length} trechos</span>
        {selectedEdgeId && <button type="button" className="danger" disabled={pending} onClick={() => { const repaired = prepareRoadNetwork({ ...network, edges: network.edges.filter((edge) => edge.id !== selectedEdgeId) }); changeNetwork(repaired.network); if (repaired.tooLarge) setNetworkError('Os cruzamentos ainda geram pontos ou trechos demais. Exclua outros trechos.'); }}>Excluir trecho</button>}
        <button type="button" disabled={pending || imageMetrics.width <= 1} aria-expanded={reviewConnections} onClick={() => setReviewConnections(current => !current)}>Revisar ligações</button>
        {reviewConnections && <div className="map-network-connections" role="group" aria-label="Revisar ligações próximas">
          <span aria-live="polite">{connectionSuggestion ? `Ligação ${activeConnectionIndex + 1} de ${connectionChoices.length}` : 'Nenhuma ligação próxima para revisar.'}</span>
          {connectionSuggestion && <><small>Una os pontos indicados se fizerem parte da mesma estrada.</small><div className="actions"><button type="button" disabled={pending || activeConnectionIndex === 0} onClick={() => setConnectionIndex(activeConnectionIndex - 1)}>← Anterior</button><button type="button" disabled={pending || activeConnectionIndex >= connectionChoices.length - 1} onClick={() => setConnectionIndex(activeConnectionIndex + 1)}>Próximo →</button></div><div className="actions"><button type="button" className="primary" disabled={pending} onClick={joinConnection}>Unir</button><button type="button" disabled={pending} onClick={() => setIgnoredConnections(current => new Set([...current, connectionSuggestion.id]))}>Ignorar</button></div></>}
        </div>}
        {networkError && <small role="alert">{networkError}</small>}
        {(saveNetwork.error || networkConflict) && <small className="error" role="alert">{networkConflict ? 'O mapa foi alterado. Revise a rede atual antes de salvar novamente.' : saveNetwork.error.message}</small>}
        {networkConflict && <button type="button" disabled={pending || board.isFetching} onClick={() => setNetworkDialog('review')}>Revisar alterações</button>}
        <div className="actions"><button type="button" disabled={pending} onClick={() => changeMode(false)}>Cancelar</button><button type="button" className="primary" disabled={pending || !networkDirty || networkConflict} onClick={saveDraft}>{saveNetwork.isPending ? 'Salvando…' : 'Salvar caminhos'}</button></div>
      </div>}
      {roadMode === 'query' && selectedPins.length < 2 && <div className="map-network-consultation" aria-live="polite"><span>{selectedPins.length ? 'Agora selecione o destino.' : 'Selecione a origem e o destino no mapa.'}</span><button type="button" onClick={() => changeMode(false)}>Encerrar consulta</button></div>}
      {mapBoard.imageUrl ? (
        <ImageMap
          key={mapBoard.id}
          board={mapBoard}
          campaignId={campaignId}
          viewAsUserId={viewAsUserId}
          editing={editing && !addingPin}
          canMovePin={canMovePin}
          pending={pending}
          placingLocation={isGm ? placingLocation : null}
           placingMarker={isGm || ownMarkerCandidate ? placingMarker : null}
          calibrating={isGm && calibrating}
          calibrationPoints={calibrationPoints}
          selectedIds={selectedIds}
          popupPinId={popupPinId}
          network={network}
          editingNetwork={isGm && roadMode === 'edit'}
          networkPath={networkPath}
          consultingNetwork={roadMode === 'query' && selectedIds.length === 2}
          onChooseEdge={chooseEdge}
          selectedEdgeId={selectedEdgeId}
          connectionSuggestion={connectionSuggestion}
          onSelectEdge={setSelectedEdgeId}
          onNetworkError={setNetworkError}
          onNetworkChange={changeNetwork}
          boundaryMode={isGm && boundaryRegionId ? boundaryMode : null}
          boundaryPoints={boundaryPoints}
          boundaryRegion={boundaryRegion}
          selectedBoundaryId={selectedBoundaryId}
          onSelectBoundary={isGm && editorMode === 'regions' && !calibrating ? editBoundary : null}
          routePopup={roadMode === 'query' && selectedPins.length === 2 && !routePopupDismissed ? <MapRoutePopup from={selectedPins[0]} to={selectedPins[1]} alternatives={allChoices} selectedPath={selectedPath} truncated={currentPath?.truncated || currentVia?.truncated} loading={board.isFetching || pathQuery.isFetching || viaQuery.isFetching} error={pathQuery.error ?? (viaEdgeId ? viaQuery.error : null)} message={networkPath?.status === 'no_path' ? networkPath.message ?? 'Não existe caminho conectado entre esses locais' : null} viaEdgeId={viaEdgeId} onChoosePath={choosePath} onClearPassage={() => { setViaEdgeId(null); setSelectedPathId(null); }} onClose={() => changeMode(false)} onDismiss={() => setRoutePopupDismissed(true)} /> : null}
          onBoundaryPoint={(point) => setBoundaryPoints((points) => [...points, point].slice(0, 200))}
          onBoundaryStroke={(points) => setBoundaryPoints(points)}
          onSelectPin={selectPin}
          onClosePin={closePin}
          onImageMetrics={setImageMetrics}
          onCalibrationPoint={markCalibrationPoint}
          onPlace={async (coordinates) => {
            try { if (placingMarker) await saveMarker.mutateAsync({ ...placingMarker, ...coordinates }); else await savePin.mutateAsync({ entityType: placingLocation.type, entityId: placingLocation.id, version: mapBoard.version, ...coordinates }); }
            catch { /* The mutation displays the error without moving the saved pin. */ }
          }}
          onMovePin={async (pin, coordinates) => {
            try { if (pin.ownerType) await saveMarker.mutateAsync({ marker: pin, ...coordinates }); else await savePin.mutateAsync({ pin, version: pin.version, ...coordinates }); }
            catch { /* Keep the server position on errors. */ }
          }}
          onRemovePin={(pin) => removePin.mutate(pin)}
        />
      ) : (
        <div className="image-map-empty">
          <span aria-hidden="true">⌖</span>
          <h2>Adicione a imagem do seu mapa</h2>
          <p>{isGm ? 'Envie uma imagem ou cole o link. Depois, marque as entidades que já estão cadastradas.' : 'O mestre ainda não adicionou um mapa.'}</p>
          {isGm && <button type="button" className="primary" onClick={() => { setCreatingMap(false); setImageFormOpen(true); }}>Adicionar mapa</button>}
        </div>
      )}
      <MapConnectionsPanel distances={mapBoard.distances} consulting={roadMode === 'query'} selectedPins={selectedPins} destinations={destinations.data?.items ?? []} alternatives={allChoices} selectedPathId={selectedPath?.id} noPathMessage={selectedIds.length === 1 ? destinations.data?.message : networkPath?.status === 'no_path' ? networkPath.message : null} truncated={currentPath?.truncated || currentVia?.truncated} loading={roadMode === 'query' && (board.isFetching || (selectedIds.length === 1 ? destinations.isFetching : selectedIds.length === 2 && (pathQuery.isFetching || viaQuery.isFetching)))} error={roadMode === 'query' ? selectedIds.length === 1 ? destinations.error : pathQuery.error ?? viaQuery.error : null} onChoosePath={choosePath} onChooseDestination={(id) => { setSelectedIds([selectedIds[0], id]); setSelectedPathId(null); setViaEdgeId(null); }} />
      {imageFormOpen && <MapImageForm board={creatingMap ? { name: '', imageUrl: '' } : mapBoard} creating={creatingMap} regions={boards.data?.regions ?? []} pending={saveImage.isPending} error={saveImage.error} onSave={(input) => saveImage.mutate(input)} onClose={() => setImageFormOpen(false)} />}
      {scaleDialog && <MapScaleDialog distanceKm={scaleDialog.distanceKm} editing={scaleDialog.editing} pending={saveScale.isPending} error={saveScale.error} onSave={(distanceKm) => saveScale.mutate({ points: scaleDialog.points, distanceKm })} onClose={() => { setScaleDialog(null); setCalibrating(false); setCalibrationPoints([]); }} />}
      {networkDialog && <MapNetworkDialog key={networkDialog} review={networkDialog === 'review'} draft={networkDraft?.network} current={board.isFetching ? null : mapBoard} pending={saveNetwork.isPending || board.isFetching} error={networkConflict ? null : saveNetwork.error} onClose={closeNetworkDialog} onDiscard={discardNetwork} onSave={networkDialog === 'review' ? reviewDraft : saveDraft} />}
      {deletingMap && <MapDeleteDialog board={deletingMap} pending={removeBoard.isPending} error={removeBoard.error} onDelete={() => removeBoard.mutate(deletingMap)} onClose={() => setDeletingMap(null)} />}
    </div>
  );
}
