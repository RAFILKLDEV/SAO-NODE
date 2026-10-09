import React from 'react';

export function MapRegionsPanel({ boundaries, candidates, selectedBoundary, regionId, name, points, mode, formOpen, pending, onNew, onEdit, onRegion, onName, onRedraw, onMode, onUndo, onSave, onDelete, onCancel }) {
  return <section className="map-regions-panel" aria-label="Gerenciar limites">
    <div className="section-heading"><strong>Limites desenhados</strong><button type="button" disabled={pending} onClick={onNew}>＋ Novo limite</button></div>
    {boundaries.length > 0 ? <div className="map-region-list">{boundaries.map(boundary => <button type="button" key={boundary.id} disabled={pending} aria-label={`Editar limite ${boundary.name}`} aria-pressed={selectedBoundary?.id === boundary.id} onClick={() => onEdit(boundary)}><strong>{boundary.name}</strong><small>{boundary.locationName ?? candidates.find(entry => entry.id === boundary.regionId)?.name}{boundary.updatedBy?.name && ` · Última edição por ${boundary.updatedBy.name}`}</small></button>)}</div> : <p className="muted">Este mapa ainda não possui limites desenhados.</p>}
    {formOpen && <div className="map-boundary-tools">
      <label>Local ou região do limite<select value={regionId} disabled={pending} onChange={event => onRegion(event.target.value)}><option value="">Escolha um local ou região</option>{candidates.map(candidate => <option value={candidate.id} key={candidate.id}>{candidate.name}</option>)}</select></label>
      <label>Nome do limite<input value={name} maxLength={120} placeholder={candidates.find(entry => entry.id === regionId)?.name ?? 'Nome opcional'} disabled={pending} onChange={event => onName(event.target.value)} /></label>
      {selectedBoundary?.updatedBy?.name && <small>Última edição por {selectedBoundary.updatedBy.name}{selectedBoundary.updatedAt && ` · ${new Date(selectedBoundary.updatedAt).toLocaleString('pt-BR')}`}</small>}
      <button type="button" disabled={pending} onClick={onRedraw}>Refazer desenho</button>
      {mode && <><button type="button" disabled={pending} aria-pressed={mode === 'vertices'} onClick={() => onMode('vertices')}>Por pontos</button><button type="button" disabled={pending} aria-pressed={mode === 'freehand'} onClick={() => onMode('freehand')}>Mão livre</button><button type="button" disabled={pending || !points.length} onClick={onUndo}>Desfazer ponto</button></>}
      <button type="button" className="primary" disabled={pending || !regionId || points.length < 3} onClick={onSave}>Salvar limite</button>
      {selectedBoundary && <button type="button" className="danger" disabled={pending} onClick={onDelete}>Apagar limite</button>}
      <button type="button" disabled={pending} onClick={onCancel}>Cancelar limite</button>
      <small>{mode === 'freehand' ? 'Arraste no mapa para desenhar o limite. Depois, salve as alterações.' : mode === 'vertices' ? 'Clique nos vértices do limite. Ao salvar, o polígono será fechado.' : 'Altere o nome ou o local associado; para mudar a área, refaça o desenho.'}</small>
    </div>}
  </section>;
}
