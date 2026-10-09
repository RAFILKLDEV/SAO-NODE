import React from 'react';

export function MapMarkerPicker({ kind, onKind, ownerId, onOwner, name, onName, candidates = [], disabled }) {
  const owners = candidates.filter((entry) => entry.ownerType === kind);
  return <div className="map-marker-picker">
    <label>Tipo do pin<select value={kind} disabled={disabled} onChange={(event) => onKind(event.target.value)}><option value="entity">Entidade cadastrada</option><option value="player">Jogador</option><option value="group">Grupo</option><option value="carriage">Carroça</option><option value="custom">Marcador livre</option></select></label>
    {['player', 'group'].includes(kind) && <label>{kind === 'player' ? 'Jogador do pin' : 'Grupo do pin'}<select value={ownerId} disabled={disabled} onChange={(event) => onOwner(event.target.value)}><option value="">Escolha {kind === 'player' ? 'um jogador' : 'um grupo'}</option>{kind === 'group' && <option value="@campaign">Grupo da campanha</option>}{owners.map((entry) => <option value={entry.ownerId} key={entry.ownerId}>{entry.name}</option>)}</select></label>}
    {['custom', 'carriage'].includes(kind) && <label>Nome do marcador<input value={name} maxLength={120} required disabled={disabled} onChange={(event) => onName(event.target.value)} /></label>}
  </div>;
}
