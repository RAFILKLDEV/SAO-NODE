import React, { useEffect, useRef, useState } from 'react';

export function MapScaleDialog({ distanceKm, editing, pending, error, onSave, onClose }) {
  const dialogRef = useRef(null);
  const [value, setValue] = useState(String(distanceKm ?? ''));
  const parsed = Number(value.trim().replace(',', '.'));
  useEffect(() => { dialogRef.current?.showModal(); }, []);
  return <dialog ref={dialogRef} className="map-image-dialog" aria-label={editing ? 'Editar escala' : 'Definir escala'} onCancel={(event) => { event.preventDefault(); if (!pending) onClose(); }}>
    <form onSubmit={(event) => { event.preventDefault(); if (Number.isFinite(parsed) && parsed > 0) onSave(parsed); }}>
      <div className="section-heading"><h2>{editing ? 'Editar escala' : 'Definir escala'}</h2><button type="button" aria-label="Fechar escala" disabled={pending} onClick={onClose}>×</button></div>
      <p className="muted">Informe a distância real do trecho usado na calibração. As distâncias dos caminhos serão recalculadas automaticamente.</p>
      <label>Distância do trecho (km)<input autoFocus inputMode="decimal" value={value} placeholder="Ex.: 2,5" onChange={(event) => setValue(event.target.value)} required disabled={pending} /></label>
      {error && <p className="alert error" role="alert">{error.message}</p>}
      <div className="actions"><button type="button" disabled={pending} onClick={onClose}>Cancelar</button><button type="submit" className="primary" disabled={pending || !Number.isFinite(parsed) || parsed <= 0}>{pending ? 'Salvando…' : 'Salvar escala'}</button></div>
    </form>
  </dialog>;
}
