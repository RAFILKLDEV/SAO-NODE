import React, { useEffect, useMemo, useState } from 'react';
import { locationTypeOptions } from '@sao/domain';
import { locationFloor, locationMenuRows } from '../lib/locationMenu.js';

const floorLabel = (floor) => floor === 'sem-andar' ? 'Sem andar' : `Andar ${floor}`;

export function LocationMenu({ items, selectedId, onSelect, canBulkGrant, onBulkGrant }) {
  const selected = items.find((item) => item.id === selectedId);
  const floors = [...new Set(items.map((item) => locationFloor(item, items)))].sort(
    (a, b) => a.localeCompare(b, 'pt-BR', { numeric: true })
  );
  const [floor, setFloor] = useState(selected ? locationFloor(selected, items) : floors[0] ?? '');
  const [search, setSearch] = useState('');
  useEffect(() => {
    if (selected) setFloor(locationFloor(selected, items));
  }, [items, selectedId]);
  const activeFloor = floors.includes(floor) ? floor : floors[0] ?? '';
  const rows = useMemo(() => locationMenuRows({ items, floor: activeFloor, search }), [items, activeFloor, search]);

  return <div className="location-menu">
    {canBulkGrant && <button type="button" className="location-menu-bulk-action" onClick={() => onBulkGrant(items)}>◇ Liberar locais</button>}
    <div className="location-menu-controls">
      <label>Andar<select aria-label="Andar dos locais" value={activeFloor} onChange={(event) => setFloor(event.target.value)}>
        {floors.map((value) => <option key={value} value={value}>{floorLabel(value)}</option>)}
      </select></label>
      <input type="search" aria-label="Buscar locais neste andar" placeholder="Buscar local neste andar…" value={search} onChange={(event) => setSearch(event.target.value)} />
      <small>{rows.length} {rows.length === 1 ? 'local' : 'locais'} · região → cidade → local</small>
    </div>
    <ul className="location-hierarchy" aria-label="Locais por hierarquia">
      {rows.map(({ item, depth }) => <li key={item.id}>
        <button type="button" className={`location-menu-item ${item.id === selectedId ? 'selected' : ''}`} aria-current={item.id === selectedId ? 'true' : undefined} style={{ paddingLeft: `${14 + Math.min(depth, 5) * 16}px` }} onClick={() => onSelect(item.id)}>
          <span className="tree-marker" aria-hidden="true">{item.type === 'region' ? '⌖' : item.type === 'city' ? '⌂' : '•'}</span>
          <span className="location-label-wrap"><strong>{item.name}</strong><small>{locationTypeOptions.find((option) => option.value === item.type)?.label ?? item.type}</small></span>
        </button>
      </li>)}
    </ul>
    {!rows.length && <div className="empty-list">{search ? 'Nenhum local encontrado neste andar.' : 'Nenhum local neste andar.'}</div>}
  </div>;
}
