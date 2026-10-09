import React, { useState } from 'react';

const distanceLabel = (value) => value == null ? 'Escala não definida' : `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: value < 1 ? 6 : 2 }).format(value)} km`;
const travelLabel = (value) => value == null ? null : value < 60 ? `${value} min` : `${Math.floor(value / 60)}h${value % 60 ? ` ${value % 60}min` : ''}`;

export function MapConnectionsPanel({ distances = [], consulting, selectedPins = [], destinations = [], alternatives = [], selectedPathId, noPathMessage, truncated, loading, error, onChoosePath, onChooseDestination }) {
  const [query, setQuery] = useState('');
  const normalized = query.trim().toLocaleLowerCase('pt-BR');
  const from = selectedPins[0], to = selectedPins[1];
  const rows = consulting ? to ? alternatives : from ? destinations.filter((entry) => entry.status !== 'no_path') : [] : distances;
  const visible = consulting && to ? rows : rows.filter((entry) => !normalized || `${entry.fromName ?? from?.name ?? ''} ${entry.toName ?? to?.name ?? entry.name ?? ''}`.toLocaleLowerCase('pt-BR').includes(normalized));
  return <section className="map-distances" aria-labelledby="map-distances-title">
    <div className="section-heading"><div><small className="eyebrow">CONEXÕES DO CATÁLOGO</small><h2 id="map-distances-title">{consulting && from ? to ? `${from.name} → ${to.name}` : `Partindo de ${from.name}` : 'Distâncias entre locais'}</h2></div>{rows.length > 0 && <span className="muted">{rows.length} {to && consulting ? 'percursos' : 'conexões'}</span>}</div>
    {consulting && !from && <p className="muted">Selecione a origem no mapa para ver os destinos e os percursos disponíveis.</p>}
    {rows.length > 0 && !(consulting && to) && <label className="map-distance-filter">Filtrar locais<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Ex.: Área comercial" /></label>}
    {loading ? <p className="muted" aria-live="polite">Calculando percursos…</p> : error ? <p className="alert error" role="alert">{error.message}</p> : visible.length > 0 ? <div className="map-distance-list">{visible.map((entry, index) => {
      const destinationName = entry.toName ?? entry.name;
      const content = <><div><strong>{consulting ? from.name : entry.fromName}</strong><span aria-hidden="true">→</span><strong>{consulting && to ? to.name : destinationName}</strong><small>{consulting && to ? `Percurso ${index + 1}${entry.requiresReturn ? ' · inclui retorno' : index === 0 ? ' · menor distância' : ''}` : consulting ? 'Percurso pela rede do mapa' : entry.distanceSource === 'network' ? 'Medido pela rede do mapa' : 'Distância cadastrada'}</small></div><div className="map-distance-values"><strong>{entry.networkStatus === 'no_path' ? entry.networkReason === 'network_too_large' ? 'Rede excede o limite' : 'Sem caminho conectado' : distanceLabel(entry.distanceKm)}</strong>{entry.distanceSource !== 'network' && travelLabel(entry.travelMinutes) && <small>{travelLabel(entry.travelMinutes)}</small>}{entry.distanceSource === 'network' && entry.catalogDistanceKm != null && <small>Cadastro: {distanceLabel(entry.catalogDistanceKm)}</small>}</div></>;
      return consulting ? <button type="button" className={`map-distance-row map-route-choice ${to && selectedPathId === entry.id ? 'selected' : ''}`} key={entry.id ?? entry.toPinId} aria-label={to ? `Percurso ${index + 1}: ${from.name} para ${to.name}, ${distanceLabel(entry.distanceKm)}` : undefined} aria-pressed={to ? selectedPathId === entry.id : undefined} onClick={() => to ? onChoosePath(entry.id) : onChooseDestination(entry.toPinId)}>{content}</button> : <div className="map-distance-row" key={entry.id}>{content}</div>;
    })}</div> : (!consulting || from) && <p className="muted">{consulting ? noPathMessage ?? (to ? 'Não existe caminho conectado entre esses locais.' : 'Nenhum destino conectado à origem selecionada.') : rows.length ? 'Nenhuma conexão corresponde ao filtro.' : 'Os locais marcados ainda não possuem conexões cadastradas.'}</p>}
    {consulting && to && alternatives.length > 1 && <p className="muted">Escolha um percurso acima ou toque em outro trecho amarelo no mapa para experimentar uma passagem diferente.</p>}
    {consulting && to && truncated && <p className="muted">Há mais percursos possíveis. Toque em um trecho amarelo para explorar outras passagens.</p>}
  </section>;
}
