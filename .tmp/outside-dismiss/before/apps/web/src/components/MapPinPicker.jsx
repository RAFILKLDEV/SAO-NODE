import React, { useEffect, useId, useMemo, useRef, useState } from 'react';
import { mapPinCandidateKey, mapPinCandidateLabel, mapPinCandidateRows, mapPinTypes } from '../lib/mapPinCandidates.js';
import './MapPinPicker.css';

export function MapPinPicker({ candidates = [], selectedId, onSelect, disabled = false, loading = false }) {
  const [type, setType] = useState('location');
  const [open, setOpen] = useState(null);
  const [search, setSearch] = useState('');
  const rootRef = useRef(null);
  const typeButtonRef = useRef(null);
  const entityButtonRef = useRef(null);
  const typeMenuRef = useRef(null);
  const searchRef = useRef(null);
  const id = useId();
  const selected = candidates.find((candidate) => mapPinCandidateKey(candidate) === selectedId && candidate.type === type && !candidate.pinned);
  const rows = useMemo(() => mapPinCandidateRows(candidates, type, search), [candidates, type, search]);
  const typeLabel = mapPinTypes.find((option) => option.value === type)?.label;
  const close = (restoreFocus = false) => {
    if (restoreFocus) (open === 'type' ? typeButtonRef : entityButtonRef).current?.focus();
    setOpen(null);
  };

  useEffect(() => {
    if (!open) return;
    const outside = (event) => { if (!rootRef.current?.contains(event.target)) setOpen(null); };
    document.addEventListener('pointerdown', outside);
    if (open === 'type') typeMenuRef.current?.querySelector('[aria-checked="true"]')?.focus();
    else searchRef.current?.focus();
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);
  useEffect(() => { if (disabled) setOpen(null); }, [disabled]);

  const handleKeys = (event) => {
    if (event.key === 'Escape' && open) { event.preventDefault(); event.stopPropagation(); close(true); return; }
    if (event.key === 'Tab') { setOpen(null); return; }
    const panel = rootRef.current?.querySelector('[data-picker-panel]');
    if (!panel || !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    if (event.target === searchRef.current && ['Home', 'End'].includes(event.key)) return;
    const buttons = [...panel.querySelectorAll('[data-picker-option]')];
    if (!buttons.length) return;
    event.preventDefault();
    const current = buttons.indexOf(document.activeElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : current < 0 ? (event.key === 'ArrowUp' ? buttons.length - 1 : 0) : (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next].focus();
  };
  const openFromKeyboard = (event, menu) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setOpen(menu); }
  };

  return <div className="map-pin-picker" ref={rootRef} onKeyDown={handleKeys} onBlur={(event) => { if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) setOpen(null); }}>
    <div className="map-pin-picker-control">
      <span id={`${id}-type-label`}>Tipo de entidade</span>
      <button ref={typeButtonRef} type="button" className="map-pin-picker-trigger" aria-labelledby={`${id}-type-label ${id}-type-value`} aria-haspopup="menu" aria-expanded={open === 'type'} aria-controls={open === 'type' ? `${id}-type-menu` : undefined} disabled={disabled} onClick={() => setOpen(open === 'type' ? null : 'type')} onKeyDown={(event) => openFromKeyboard(event, 'type')}>
        <strong id={`${id}-type-value`}>{typeLabel}</strong><span aria-hidden="true">▾</span>
      </button>
      {open === 'type' && <div ref={typeMenuRef} id={`${id}-type-menu`} className="map-pin-picker-popover map-pin-type-menu" role="menu" aria-label="Tipos de entidade" data-picker-panel>
        {mapPinTypes.map((option) => <button type="button" role="menuitemradio" aria-checked={type === option.value} data-picker-option key={option.value} onClick={() => { setType(option.value); onSelect(''); setSearch(''); setOpen('entity'); }}>
          <span className={`map-pin-type-dot pin-type-${option.value}`} aria-hidden="true" />{option.label}<span className="map-pin-picker-check" aria-hidden="true">{type === option.value ? '✓' : ''}</span>
        </button>)}
      </div>}
    </div>
    <div className="map-pin-picker-control map-pin-entity-control">
      <span id={`${id}-entity-label`}>Entidade existente</span>
      <button ref={entityButtonRef} type="button" className="map-pin-picker-trigger" aria-labelledby={`${id}-entity-label ${id}-entity-value`} aria-haspopup="dialog" aria-expanded={open === 'entity'} aria-controls={open === 'entity' ? `${id}-entity-menu` : undefined} disabled={disabled || loading} onClick={() => setOpen(open === 'entity' ? null : 'entity')} onKeyDown={(event) => openFromKeyboard(event, 'entity')}>
        <strong id={`${id}-entity-value`}>{loading ? 'Carregando entidades…' : selected ? mapPinCandidateLabel(selected) : `Selecionar ${typeLabel.toLocaleLowerCase('pt-BR')}`}</strong><span aria-hidden="true">▾</span>
      </button>
      {open === 'entity' && <div id={`${id}-entity-menu`} className="map-pin-picker-popover" role="dialog" aria-label={`Selecionar ${typeLabel.toLocaleLowerCase('pt-BR')}`} data-picker-panel>
        <input ref={searchRef} type="search" aria-label={`Buscar ${typeLabel.toLocaleLowerCase('pt-BR')}`} placeholder="Buscar por nome ou categoria…" value={search} onChange={(event) => setSearch(event.target.value)} />
        <div className="map-pin-picker-options">
          {rows.map((candidate) => <button type="button" key={candidate.key} data-picker-option aria-pressed={selectedId === candidate.key} onClick={() => { onSelect(candidate.key); close(true); }}>
            <span>{candidate.label}</span><span className="map-pin-picker-check" aria-hidden="true">{selectedId === candidate.key ? '✓' : ''}</span>
          </button>)}
          {!rows.length && <p role="status">{search ? 'Nenhuma entidade corresponde à busca.' : `Nenhum registro de ${typeLabel.toLocaleLowerCase('pt-BR')} disponível para marcar.`}</p>}
        </div>
      </div>}
    </div>
  </div>;
}
