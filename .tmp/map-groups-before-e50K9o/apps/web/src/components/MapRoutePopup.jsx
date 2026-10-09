import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { beginPointerDrag, finishPointerDrag, updatePointerDrag } from '../lib/mapDrag.js';

const distanceLabel = value => value == null ? 'Sem escala' : `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 }).format(value)} km`;

export function MapRoutePopup({ from, to, alternatives, selectedPath, truncated, loading, error, message, viaEdgeId, onChoosePath, onClearPassage, onClose }) {
  const panelRef = useRef(null);
  const dragRef = useRef(null);
  const [position, setPosition] = useState(null);
  const index = alternatives.findIndex(path => path.id === selectedPath?.id);
  const boundPosition = (next, bounds) => ({
    left: Math.max(8, Math.min(next.left, window.innerWidth - bounds.width - 8)),
    top: Math.max(8, Math.min(next.top, window.innerHeight - bounds.height - 8))
  });
  useEffect(() => {
    const resize = () => setPosition(current => current && panelRef.current ? boundPosition(current, panelRef.current.getBoundingClientRect()) : current);
    const observer = new ResizeObserver(resize);
    observer.observe(panelRef.current);
    window.addEventListener('resize', resize);
    return () => { observer.disconnect(); window.removeEventListener('resize', resize); };
  }, []);
  const startDrag = event => {
    event.stopPropagation();
    if (event.button !== 0 || event.target.closest('button')) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = beginPointerDrag({ pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, bounds });
  };
  const moveDrag = event => {
    const active = dragRef.current;
    if (!active) return;
    const next = boundPosition({ left: active.bounds.left + event.clientX - active.startClientX, top: active.bounds.top + event.clientY - active.startClientY }, active.bounds);
    const updated = updatePointerDrag(active, event, next);
    dragRef.current = updated.state;
    if (updated.changed) setPosition(next);
  };
  const endDrag = event => {
    dragRef.current = finishPointerDrag(dragRef.current, event.pointerId).state;
  };
  const moveWithKeyboard = event => {
    const delta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
    if (!delta) return;
    event.preventDefault();
    const bounds = panelRef.current.getBoundingClientRect(), step = event.shiftKey ? 32 : 12;
    setPosition(boundPosition({ left: bounds.left + delta[0] * step, top: bounds.top + delta[1] * step }, bounds));
  };
  return createPortal(<aside ref={panelRef} className="map-route-popup" style={position ? { ...position, right: 'auto', bottom: 'auto' } : undefined} aria-label="Percursos possíveis" onClick={event => event.stopPropagation()} onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag} onLostPointerCapture={endDrag}>
    <div className="map-route-popup-heading">
      <div className="map-route-popup-title" tabIndex={0} aria-label="Mover painel de percursos" title="Arraste para mover ou use as setas do teclado" onKeyDown={moveWithKeyboard}>
        <strong aria-live="polite" title={truncated ? 'Há mais percursos. Clique em um trecho do mapa para consultar uma passagem por ele.' : undefined}>{index >= 0 ? `Percurso ${index + 1} de ${alternatives.length}${truncated ? '+' : ''}` : 'Percursos possíveis'}{selectedPath && <span> · {distanceLabel(selectedPath.distanceKm)}</span>}</strong>
        <small title={`${from.name} → ${to.name}`}>{from.name} → {to.name}</small>
      </div>
      {viaEdgeId && <button type="button" aria-label="Limpar passagem escolhida" title="Limpar passagem escolhida" onClick={onClearPassage}>↺</button>}
      <button type="button" aria-label="Encerrar consulta" title="Encerrar consulta" onClick={onClose}>×</button>
    </div>
    {loading ? <p aria-live="polite">Calculando…</p> : error ? <p role="alert">{error.message}</p> : message ? <p aria-live="polite">{message}</p> : <>
      {selectedPath?.requiresReturn && <small className="map-route-return">Com retorno</small>}
      <div className="map-route-popup-navigation"><button type="button" disabled={index <= 0} onClick={() => onChoosePath(alternatives[index - 1].id)}>← Anterior</button><button type="button" disabled={index < 0 || index >= alternatives.length - 1} onClick={() => onChoosePath(alternatives[index + 1].id)}>Próximo →</button></div>
    </>}
  </aside>, document.body);
}
