import React, { useEffect, useId, useRef, useState } from 'react';
import { locationImageAccept, locationImageFileError, locationImageUrlError } from '../lib/locationImage.js';

function ImagePreview({ src }) {
  const [failed, setFailed] = useState(false);
  return failed
    ? <p role="status" className="muted">Não foi possível carregar a prévia. Confira o link ou escolha outra imagem.</p>
    : <img className="location-image-preview" src={src} alt="Prévia da imagem do local" onError={() => setFailed(true)} />;
}

export function LocationImagePicker({ selection, onChange }) {
  const id = useId();
  const [objectUrl, setObjectUrl] = useState('');
  const [fileError, setFileError] = useState('');
  const urlError = locationImageUrlError(selection.url);
  useEffect(() => {
    if (!selection.file) { setObjectUrl(''); return; }
    const url = URL.createObjectURL(selection.file);
    setObjectUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [selection.file]);
  const preview = selection.file ? objectUrl : urlError ? '' : selection.url.trim();

  return (
    <section className="location-image-picker" aria-labelledby={`${id}-title`}>
      <strong id={`${id}-title`}>Imagem do local <span className="muted">(opcional)</span></strong>
      <label>Arquivo da imagem
        <input type="file" accept={locationImageAccept} aria-describedby={fileError ? `${id}-file-error` : undefined} onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (!file) return;
          const error = locationImageFileError(file);
          setFileError(error);
          if (!error) onChange({ file, url: '' });
        }} />
      </label>
      {fileError && <span id={`${id}-file-error`} className="alert error" role="alert">{fileError}</span>}
      {selection.file && <small className="location-image-filename">Selecionado: {selection.file.name}</small>}
      <label>Ou cole o link da imagem
        <input type="url" value={selection.url} placeholder="https://…" aria-invalid={Boolean(urlError)} aria-describedby={urlError ? `${id}-url-error` : undefined} onChange={(event) => {
          setFileError('');
          onChange({ file: null, url: event.target.value });
        }} />
      </label>
      {urlError && <span id={`${id}-url-error`} className="alert error" role="alert">{urlError}</span>}
      {preview && <ImagePreview key={preview} src={preview} />}
      {(selection.file || selection.url) && <div className="actions"><button type="button" onClick={() => { setFileError(''); onChange({ file: null, url: '' }); }}>Remover imagem</button></div>}
      <small className="muted">Escolha um arquivo ou informe um link. A imagem será atualizada ao salvar o local.</small>
    </section>
  );
}

export function LocationImage({ src, name, onEdit, variant = 'location' }) {
  const dialogRef = useRef(null);
  const triggerRef = useRef(null);
  const closeRef = useRef(null);
  const [failed, setFailed] = useState(false);
  const hasImage = Boolean(src) && !failed;
  const placeholder = <span className="location-image-placeholder">
    <span aria-hidden="true">▧</span>
    <strong>{variant === 'npc' ? (failed ? 'Foto indisponível' : 'Sem foto do personagem') : (failed ? 'Imagem do local indisponível.' : 'Sem imagem do local')}</strong>
    {onEdit && <small>Clique para {src ? 'editar' : 'adicionar'} a imagem</small>}
  </span>;
  const content = hasImage ? <img src={src} alt={name} onError={() => setFailed(true)} /> : placeholder;
  return (
    <>
      <div className="location-image-frame">
        {onEdit || hasImage ? <button ref={onEdit ? undefined : triggerRef} type="button" className="location-image-expand" aria-label={onEdit ? `${src ? 'Editar' : 'Adicionar'} imagem de ${name}` : `Ampliar imagem de ${name}`} onClick={onEdit || (() => dialogRef.current.showModal())}>
          {content}
          {hasImage && <span>{onEdit ? 'Clique para editar a imagem' : 'Ampliar imagem'}</span>}
        </button> : <div className="location-image-expand">{content}</div>}
        {onEdit && hasImage && <button ref={triggerRef} type="button" className="location-image-enlarge-action" aria-label={`Ampliar imagem de ${name}`} onClick={() => dialogRef.current.showModal()}>Ampliar imagem</button>}
      </div>
      {hasImage && <dialog ref={dialogRef} className="location-image-dialog" aria-label={`Imagem de ${name}`} onClose={() => triggerRef.current?.focus()} onKeyDown={(event) => {
        if (event.key === 'Tab') { event.preventDefault(); closeRef.current?.focus(); }
      }}>
        <button ref={closeRef} type="button" className="location-image-close" onClick={() => dialogRef.current.close()} autoFocus>Fechar imagem</button>
        <img src={src} alt={name} />
      </dialog>}
    </>
  );
}
