import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useOutsideDismiss } from '../lib/useOutsideDismiss.js';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { api } from '../lib/api.js';

const categories = [['informacoes', 'Informações'], ['servicos', 'Serviços'], ['monstros', 'Monstros'], ['missoes', 'Missões'], ['npcs', 'NPCs'], ['itens', 'Itens'], ['referencias', 'Referências']];
const entityPath = (type) => type === 'location' ? 'locations' : `${type}s`;
const reference = (campaignId, entry) => `/campaigns/${campaignId}/${entityPath(entry.entityType ?? entry.type)}?selected=${encodeURIComponent(entry.entityId ?? entry.locationId ?? entry.id)}`;

export function MapPinPopup({ pin, boardId, campaignId, viewAsUserId = '', imageRef, editing, pending, onRemove, onClose }) {
  const [category, setCategory] = useState(null);
  const [position, setPosition] = useState(null);
  const popupRef = useRef(null);
  useOutsideDismiss(popupRef, onClose);
  const isGroup = pin.ownerType === 'group';
  const detail = useQuery({
    queryKey: [isGroup ? 'map-group-members' : 'map-pin-content', campaignId, boardId, pin.id, category, viewAsUserId],
    queryFn: () => api(`/api/v1/campaigns/${campaignId}/map/${isGroup ? `markers/${encodeURIComponent(pin.id)}/members` : `pins/${encodeURIComponent(pin.id)}/content`}?${new URLSearchParams({ ...(!isGroup ? { category } : {}), ...(boardId ? { boardId } : {}), ...(viewAsUserId ? { viewAsUserId } : {}) })}`),
    enabled: isGroup || Boolean(category)
  });
  useLayoutEffect(() => {
    const update = () => {
      const image = imageRef.current?.getBoundingClientRect(); const popup = popupRef.current;
      if (!image || !popup) return;
      const anchorX = image.left + pin.x * image.width; const anchorY = image.top + pin.y * image.height;
      const width = popup.offsetWidth; const height = popup.offsetHeight;
      const left = Math.max(8, Math.min(window.innerWidth - width - 8, anchorX - width / 2));
      const below = anchorY + height + 16 < window.innerHeight;
      const top = Math.max(8, Math.min(window.innerHeight - height - 8, below ? anchorY + 14 : anchorY - height - 44));
      const visibility = anchorY < 0 || anchorY > window.innerHeight ? 'hidden' : 'visible';
      setPosition(current => current?.left === left && current?.top === top && current?.visibility === visibility ? current : { left, top, visibility });
    };
    update();
    const observer = new ResizeObserver(update);
    if (popupRef.current) observer.observe(popupRef.current);
    if (imageRef.current) observer.observe(imageRef.current);
    window.addEventListener('scroll', update, true); window.addEventListener('resize', update);
    return () => { observer.disconnect(); window.removeEventListener('scroll', update, true); window.removeEventListener('resize', update); };
  }, [pin.x, pin.y, imageRef]);
  useEffect(() => {
    const escape = (event) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('keydown', escape); };
  }, [onClose]);
  const information = detail.data?.information;
  return createPortal(<div ref={popupRef} className={`image-map-popup map-content-popup ${isGroup ? 'map-group-popup' : ''}`} role="dialog" aria-label={pin.name} style={position ?? { visibility: 'hidden' }} onClick={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
    <button type="button" className="image-map-popup-close" aria-label="Fechar popup" onClick={onClose}>×</button>
    <strong>{pin.name}</strong>
    {isGroup ? <div className="map-popup-content"><small className="muted">Integrantes do grupo</small>{detail.isLoading ? <p className="muted">Carregando…</p> : detail.isError ? <p role="alert" className="alert error">Não foi possível carregar os integrantes.</p> : <><ul className="map-group-member-list">{(detail.data?.members ?? []).map(member => <li key={`${member.type}:${member.id}`}><span>{member.type === 'npc' ? <Link to={reference(campaignId, { ...member, type: 'npc' })}>{member.name}</Link> : member.name}</span><small>{member.type === 'player' ? 'Jogador' : 'Personagem'}</small></li>)}</ul>{!detail.data?.members?.length && <p className="muted">Nenhum integrante visível.</p>}</>}</div> : !category ? <nav className="map-popup-menu" aria-label="Conteúdo do pin">{categories.map(([id, label]) => <button type="button" key={id} onClick={() => setCategory(id)}>{label}<span aria-hidden="true">›</span></button>)}</nav> : <>
      <button type="button" className="map-popup-back" onClick={() => setCategory(null)}>← Voltar · {categories.find(([id]) => id === category)?.[1]}</button>
      <div className="map-popup-content">
        {detail.isLoading ? <p className="muted">Carregando…</p> : detail.isError ? <p className="alert error" role="alert">Não foi possível carregar este conteúdo.</p> : <>
          {category === 'informacoes' && information && <div className="map-detail-content">{information.description && <p>{information.description}</p>}{(information.fields ?? []).map((field, index) => <div className="map-detail-item" key={index}><strong>{field.label ?? field.name}</strong><span>{String(field.value ?? field.description ?? '')}</span></div>)}</div>}
          <div className="map-detail-list">{(detail.data?.items ?? []).map((entry) => {
            const contents = <>{entry.imageUrl ? <img src={entry.imageUrl} alt="" loading="lazy" /> : <span className="map-detail-thumbnail" aria-hidden="true">◇</span>}<span><strong>{entry.name}</strong>{entry.subtitle && <small>{entry.subtitle}</small>}</span></>;
            return entry.type === 'service' ? <div key={entry.id} className="map-detail-link">{contents}</div> : <Link key={`${entry.type}:${entry.id}`} to={reference(campaignId, entry)} className="map-detail-link">{contents}<span aria-hidden="true">↗</span></Link>;
          })}</div>
          {!detail.data?.items?.length && !information?.description && !information?.fields?.length && <p className="muted">Nenhum conteúdo autorizado nesta categoria.</p>}
        </>}
      </div>
    </>}
    <Link className="map-detail-reference" to={isGroup ? `/campaigns/${campaignId}/groups` : reference(campaignId, pin)}>{isGroup ? 'Abrir grupos ↗' : 'Abrir referência completa ↗'}</Link>
    {editing && <button type="button" className="image-map-remove" disabled={pending} onClick={() => onRemove(pin)}>Remover pin</button>}
  </div>, document.body);
}
