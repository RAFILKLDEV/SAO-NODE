import React, { useEffect, useRef } from 'react';
import { useOutsideDismiss } from '../lib/useOutsideDismiss.js';

export function MapNetworkDialog({ review, pending, error, draft, current, onSave, onDiscard, onClose }) {
  const dialog = useRef(null);
  useOutsideDismiss(dialog, onClose, !pending);
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} className="map-image-dialog" aria-label={review ? 'Revisar rede alterada' : 'Caminhos não salvos'} onCancel={(event) => { event.preventDefault(); if (!pending) onClose(); }}>
    <div className="map-delete-dialog-content">
      <h2>{review ? 'Revisar rede alterada' : 'Caminhos não salvos'}</h2>
      <p>{review ? 'O mapa mudou desde o início da edição. Seu rascunho foi preservado. Confira a rede atual antes de substituir seus caminhos.' : 'Salve ou descarte o rascunho antes de sair da edição.'}</p>
      {review && <><p>Rede atual: {current?.roadNetwork?.edges.length ?? 0} trechos · versão {current?.version}. Seu rascunho: {draft?.edges.length ?? 0} trechos.</p><div className="map-network-comparison">{[['Rede atual', current?.roadNetwork], ['Seu rascunho', draft]].map(([label, network]) => { const nodes = new Map((network?.nodes ?? []).map((node) => [node.id, node])); return <figure key={label}><figcaption>{label}</figcaption><svg viewBox={`0 0 200 ${200 * (network?.imageHeight ?? 1) / (network?.imageWidth ?? 1)}`} aria-label={label}>{network?.edges.map((edge) => <line key={edge.id} x1={nodes.get(edge.from).x * 200} y1={nodes.get(edge.from).y * 200 * network.imageHeight / network.imageWidth} x2={nodes.get(edge.to).x * 200} y2={nodes.get(edge.to).y * 200 * network.imageHeight / network.imageWidth} />)}</svg></figure>; })}</div></>}
      {error && <p className="alert error" role="alert">{error.message}</p>}
      <div className="actions"><button type="button" disabled={pending} onClick={onClose}>Continuar editando</button><button type="button" disabled={pending} onClick={onDiscard}>{review ? 'Usar rede atual' : 'Descartar rascunho'}</button><button type="button" className="primary" disabled={pending || (review && !current)} onClick={onSave}>{pending ? 'Salvando…' : review ? 'Manter meu rascunho' : 'Salvar caminhos'}</button></div>
    </div>
  </dialog>;
}
