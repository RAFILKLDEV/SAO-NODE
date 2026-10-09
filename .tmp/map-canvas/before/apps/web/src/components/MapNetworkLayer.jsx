import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import { addRoadStroke, snapRoadPoint, normalizeRoadNetwork, roadNetworkSchema } from '@sao/domain';

const clamp = (value) => Math.max(0, Math.min(1, value));

export const MapNetworkLayer = memo(function MapNetworkLayer({ imageRef, network, editing, consulting, pending, path, connectionSuggestion, selectedEdgeId, onSelectEdge, onChooseEdge, onChange, onError }) {
  const gesture = useRef(null);
  const [preview, setPreview] = useState(null);
  const [size, setSize] = useState({ width: 1, height: 1 });
  const dimensions = { imageWidth: size.width, imageHeight: size.height };

  const cancel = () => {
    const active = gesture.current;
    gesture.current = null;
    if (active?.element.hasPointerCapture(active.pointerId)) active.element.releasePointerCapture(active.pointerId);
    setPreview(null);
  };

  useEffect(() => {
    const image = imageRef.current;
    const measure = () => { const bounds = image.getBoundingClientRect(); setSize(current => current.width === bounds.width && current.height === bounds.height ? current : { width: bounds.width, height: bounds.height }); };
    measure();
    const observer = new ResizeObserver(measure); observer.observe(image);
    const key = (event) => { if (event.key === 'Escape') cancel(); };
    window.addEventListener('blur', cancel); window.addEventListener('keydown', key);
    return () => { observer.disconnect(); window.removeEventListener('blur', cancel); window.removeEventListener('keydown', key); };
  }, [imageRef]);
  useEffect(() => { if (!editing || pending) cancel(); }, [editing, pending]);

  const commit = (next) => {
    if (!roadNetworkSchema.safeParse(next).success) { onError('A rede tem pontos ou trechos demais. Use um mapa regional para continuar.'); return; }
    onError(''); onChange(next);
  };
  const moveNode = (id, point) => {
    const otherRoads = { ...network, edges: network.edges.filter((edge) => edge.from !== id && edge.to !== id) };
    const snapped = snapRoadPoint(otherRoads, point, dimensions);
    commit(normalizeRoadNetwork({ ...network, nodes: network.nodes.map((node) => node.id === id ? { ...node, ...snapped } : node) }));
  };
  const coordinate = (event, bounds) => ({ x: clamp((event.clientX - bounds.left) / bounds.width), y: clamp((event.clientY - bounds.top) / bounds.height) });
  const start = (event) => {
    if (!editing || pending || event.button !== 0 || gesture.current) return;
    event.preventDefault(); event.stopPropagation();
    const bounds = imageRef.current.getBoundingClientRect();
    const point = coordinate(event, bounds);
    event.currentTarget.setPointerCapture(event.pointerId);
    gesture.current = { pointerId: event.pointerId, element: event.currentTarget, bounds, nodeId: event.target.dataset.nodeId, edgeId: event.target.dataset.edgeId, startX: event.clientX, startY: event.clientY, points: [point], moved: false };
    onSelectEdge(null);
  };
  const move = (event) => {
    const active = gesture.current;
    if (!active || active.pointerId !== event.pointerId) return;
    event.stopPropagation();
    const point = coordinate(event, active.bounds);
    active.moved ||= Math.hypot(event.clientX - active.startX, event.clientY - active.startY) >= 3;
    if (active.nodeId) { active.point = point; setPreview({ nodeId: active.nodeId, point }); }
    else if (active.points.length < 8000) {
      const last = active.points.at(-1);
      if (Math.hypot((point.x - last.x) * size.width, (point.y - last.y) * size.height) >= 1) active.points.push(point);
      setPreview({ points: [...active.points] });
    }
  };
  const finish = (event) => {
    const active = gesture.current;
    if (!active || active.pointerId !== event.pointerId) return;
    move(event); cancel(); event.stopPropagation();
    if (!active.moved) { onSelectEdge(active.edgeId ?? null); return; }
    if (active.nodeId) moveNode(active.nodeId, active.point);
    else commit(addRoadStroke(network, active.points, dimensions));
  };

  const nodes = useMemo(() => network.nodes.map((node) => preview?.nodeId === node.id ? { ...node, ...preview.point } : node), [network.nodes, preview]);
  const nodeMap = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
  const points = (values) => values.map((p) => `${p.x * size.width},${p.y * size.height}`).join(' ');
  const lines = useMemo(() => network.edges.map((edge) => ({ ...edge, points: [nodeMap.get(edge.from), nodeMap.get(edge.to)].map(p => `${p.x * size.width},${p.y * size.height}`).join(' ') })), [network.edges, nodeMap, size]);
  return <svg className={`map-network-layer ${editing ? 'editing-network' : ''} ${consulting ? 'consulting-network' : ''}`} viewBox={`0 0 ${size.width} ${size.height}`} preserveAspectRatio="none" aria-label={editing ? 'Editar rede de caminhos' : 'Rede de caminhos'} onPointerDown={editing ? start : undefined} onPointerMove={editing ? move : undefined} onPointerUp={editing ? finish : undefined} onPointerCancel={cancel} onLostPointerCapture={() => { if (gesture.current) cancel(); }} onClick={(event) => { event.stopPropagation(); if (consulting && !pending && event.target.dataset.edgeId) onChooseEdge(event.target.dataset.edgeId); }}>
    {editing && <rect width="100%" height="100%" fill="transparent" />}
    {lines.map((edge) => <polyline key={edge.id} className="image-map-route-outline" points={edge.points} aria-hidden="true" />)}
    {lines.map((edge, index) => <g key={edge.id}><polyline className={`map-network-road ${selectedEdgeId === edge.id ? 'selected' : ''}`} points={edge.points} />{(editing || consulting) && <polyline className="map-network-hit" data-edge-id={edge.id} points={edge.points} role={consulting ? 'button' : undefined} tabIndex={consulting && !pending ? 0 : undefined} aria-label={consulting ? `Experimentar trecho ${index + 1}` : undefined} onKeyDown={(event) => { if (consulting && !pending && ['Enter', ' '].includes(event.key)) { event.preventDefault(); onChooseEdge(edge.id); } }} />}</g>)}
    {path?.status === 'found' && <g className="map-network-result"><polyline className="map-network-path-outline" points={points(path.points)} /><polyline className="map-network-path" points={points(path.points)} /><polyline className="map-network-access" points={points(path.accessFrom)} /><polyline className="map-network-access" points={points(path.accessTo)} /></g>}
    {preview?.points?.length > 1 && <><polyline className="image-map-route-outline" points={points(preview.points)} /><polyline className="map-network-road draft" points={points(preview.points)} /></>}
    {editing && nodes.map((node, index) => <circle key={node.id} data-node-id={node.id} className="map-network-node" cx={node.x * size.width} cy={node.y * size.height} r="7" tabIndex={pending ? -1 : 0} role="button" aria-label={`Ponto do caminho ${index + 1}`} onKeyDown={(event) => {
      if (pending || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault(); event.stopPropagation();
      moveNode(node.id, { x: clamp(node.x + (event.key === 'ArrowRight' ? 3 : event.key === 'ArrowLeft' ? -3 : 0) / size.width), y: clamp(node.y + (event.key === 'ArrowDown' ? 3 : event.key === 'ArrowUp' ? -3 : 0) / size.height) });
    }} />)}
    {editing && connectionSuggestion && <g className="map-network-connection-hint" role="img" aria-label="Ligação sugerida"><polyline className="map-network-connection-suggestion" points={points([connectionSuggestion.from, connectionSuggestion.to])} />{[connectionSuggestion.from, connectionSuggestion.to].map((point, index) => <circle key={index} cx={point.x * size.width} cy={point.y * size.height} r="10" />)}</g>}
  </svg>;
});
