import React, { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useOutletContext, useParams, useSearchParams } from 'react-router';
import { api } from '../lib/api.js';

const labels = { npc: 'Personagens', location: 'Locais', item: 'Itens', monster: 'Monstros', quest: 'Missões' };
const plural = (type) => (type === 'location' ? 'locations' : `${type}s`);

function starter(type) {
  const base = { id: '', name: '', active: true, tags: [], fields: [], references: [] };
  if (type === 'npc') return { ...base, factions: [], services: [] };
  if (type === 'location') return { ...base, type: 'region', services: [], connections: [] };
  if (type === 'item') return { ...base, category: 'misc', rarity: 'common', stats: [] };
  if (type === 'monster') return { ...base, sheet: {}, movements: [], attacks: [], abilities: [], skills: [], traits: [] };
  return { ...base, type: 'side', state: 'available', objectiveMode: 'free', requirementLogic: 'all', objectives: [], rewards: [], prerequisites: [], nextQuests: [] };
}

function cleanForEditor(entity) {
  if (!entity) return null;
  const { entityType: _entityType, version: _version, _technical: _technical, ...data } = entity;
  return data;
}

function VisibilityBadge({ visibility }) {
  if (!visibility) return null;
  return <span className={`visibility ${visibility}`}>{visibility}</span>;
}

function ReferenceList({ references = [] }) {
  if (!references.length) return <span className="muted">Sem referências.</span>;
  return <div className="reference-list">{references.map((ref) => <span key={`${ref.type}:${ref.id}:${ref.role}`} className={ref.broken ? 'broken-ref' : ''}>{ref.name ?? ref.id}<small>{ref.role}</small></span>)}</div>;
}

function MonsterDetails({ entity }) {
  const tabs = ['Resumo', 'Deslocamentos', 'Ataques', 'Habilidades', 'Traits', 'Perícias', 'Itens', 'Referências'];
  const [tab, setTab] = useState('Resumo');
  const map = {
    Deslocamentos: entity.movements,
    Ataques: entity.attacks,
    Habilidades: entity.abilities,
    Traits: entity.traits,
    Perícias: entity.skills
  };
  return <>
    <div className="tabs">{tabs.map((item) => <button className={tab === item ? 'active' : ''} key={item} onClick={() => setTab(item)}>{item}</button>)}</div>
    {tab === 'Resumo' && <pre className="data-block">{JSON.stringify(entity.sheet ?? {}, null, 2)}</pre>}
    {map[tab] && <div className="stack">{map[tab].map((entry) => <div className="card compact" key={entry.id}><strong>{entry.id}</strong><pre>{JSON.stringify(entry.data, null, 2)}</pre></div>)}</div>}
    {tab === 'Itens' && <ReferenceList references={(entity.references ?? []).filter((ref) => ref.type === 'item')} />}
    {tab === 'Referências' && <ReferenceList references={entity.references} />}
  </>;
}

function QuestDetails({ entity }) {
  return <div className="stack">
    <div className="card compact"><strong>Objetivos</strong>{entity.objectives?.length ? entity.objectives.map((objective) => <div className="objective-row" key={objective.objectiveId}><span>{objective.order}. {objective.text}</span><small>{objective.type} · {objective.requiredQuantity}x</small></div>) : <span className="muted">Sem objetivos visíveis.</span>}</div>
    <div className="card compact"><strong>Referências</strong><ReferenceList references={entity.references} /></div>
  </div>;
}

function LocationHierarchy({ items, onSelect }) {
  const byId = new Map(items.map((item) => [item.id, { ...item, children: [] }]));
  const roots = [];
  for (const item of byId.values()) {
    if (item.parentId && byId.has(item.parentId) && item.parentId !== item.id) byId.get(item.parentId).children.push(item);
    else roots.push(item);
  }
  const seen = new Set();
  const render = (item, depth = 0) => {
    if (seen.has(item.id)) return <div key={`${item.id}-cycle`} className="tree-cycle">↻ {item.name}</div>;
    seen.add(item.id);
    const node = <div key={item.id}>
      <button className="tree-node" style={{ paddingLeft: `${10 + depth * 16}px` }} onClick={() => onSelect(item.id)}>{item.name}</button>
      {item.children.map((child) => render(child, depth + 1))}
    </div>;
    seen.delete(item.id);
    return node;
  };
  return <div className="tree">{roots.sort((a, b) => a.name.localeCompare(b.name)).map((item) => render(item))}</div>;
}

function EntityDetail({ entity, type, isGm, onEdit, onDelete }) {
  if (!entity) return <div className="empty-detail">Selecione um registro.</div>;
  return <article className="detail-card">
    <div className="detail-heading">
      <div><small>{labels[type]}</small><h2>{entity.name}</h2></div>
      {isGm && <div className="actions"><button onClick={onEdit}>Editar</button><button className="danger" onClick={onDelete}>Excluir</button></div>}
    </div>
    {(entity.imageUrl || entity.portraitUrl || entity.mapUrl) && <img className="hero-image" src={entity.imageUrl ?? entity.portraitUrl ?? entity.mapUrl} alt="" />}
    <div className="chips">{entity.tags?.map((tag) => <span key={tag}>{tag}</span>)}</div>
    <div className="field-grid">{entity.fields?.map((field) => <section key={field.key}><div><strong>{field.key}</strong><VisibilityBadge visibility={field.visibility} /></div><p>{field.value}</p></section>)}</div>
    {type === 'monster' ? <MonsterDetails entity={entity} /> : type === 'quest' ? <QuestDetails entity={entity} /> : <div className="card compact"><strong>Referências</strong><ReferenceList references={entity.references} /></div>}
    {type === 'location' && entity.connections?.length > 0 && <div className="card compact"><strong>Conexões</strong>{entity.connections.map((connection) => <div className="connection-row" key={connection.connectionId}><span>{connection.direction || '→'} {connection.targetId}</span><small>{connection.distanceKm ?? '—'} km · {connection.travelMinutes ?? '—'} min</small></div>)}</div>}
    {isGm && <details className="technical"><summary>Dados técnicos</summary><div className="technical-row"><code>{entity.id}</code><button onClick={() => navigator.clipboard.writeText(entity.id)}>Copiar ID</button></div><pre>{JSON.stringify(entity._technical ?? {}, null, 2)}</pre></details>}
  </article>;
}

function EntityEditor({ type, initial, version, onClose, onSaved, campaignId }) {
  const [text, setText] = useState(JSON.stringify(initial, null, 2));
  const [error, setError] = useState('');
  const save = useMutation({
    mutationFn: async () => {
      const data = JSON.parse(text);
      if (!data.id || !data.name) throw new Error('id e name são obrigatórios.');
      const endpoint = `/api/v1/campaigns/${campaignId}/${plural(type)}${version ? `/${encodeURIComponent(initial.id)}` : ''}`;
      return api(endpoint, { method: version ? 'PUT' : 'POST', headers: version ? { 'if-match': String(version) } : {}, body: data });
    },
    onSuccess: onSaved,
    onError: (err) => setError(err.message)
  });
  return <div className="modal-backdrop" role="presentation"><div className="modal" role="dialog" aria-modal="true"><div className="modal-head"><h2>{version ? 'Editar' : 'Nova entidade'}</h2><button onClick={onClose}>×</button></div><p className="muted">Editor estrutural completo. IDs são permanentes e não são regenerados.</p><textarea className="json-editor" value={text} onChange={(event) => setText(event.target.value)} spellCheck="false" />{error && <div className="alert error">{error}</div>}<div className="modal-actions"><button onClick={onClose}>Cancelar</button><button className="primary" onClick={() => save.mutate()} disabled={save.isPending}>{save.isPending ? 'Salvando…' : 'Salvar'}</button></div></div></div>;
}

export function EntityPage({ type }) {
  const { campaignId } = useParams();
  const { isGm } = useOutletContext();
  const [params, setParams] = useSearchParams();
  const selectedId = params.get('selected');
  const [editor, setEditor] = useState(null);
  const [hierarchy, setHierarchy] = useState(false);
  const queryClient = useQueryClient();
  const list = useQuery({ queryKey: ['entities', campaignId, type], queryFn: () => api(`/api/v1/campaigns/${campaignId}/${plural(type)}?pageSize=100`) });
  const detail = useQuery({ queryKey: ['entity', campaignId, type, selectedId], queryFn: () => api(`/api/v1/campaigns/${campaignId}/${plural(type)}/${encodeURIComponent(selectedId)}`), enabled: Boolean(selectedId) });

  useEffect(() => {
    if (!selectedId && list.data?.items?.length) setParams({ selected: list.data.items[0].id }, { replace: true });
  }, [selectedId, list.data, setParams]);

  const remove = useMutation({
    mutationFn: () => api(`/api/v1/campaigns/${campaignId}/${plural(type)}/${encodeURIComponent(selectedId)}`, { method: 'DELETE' }),
    onSuccess: async () => {
      setParams({});
      await queryClient.invalidateQueries({ queryKey: ['entities', campaignId, type] });
    }
  });

  const itemMap = useMemo(() => new Map((list.data?.items ?? []).map((item) => [item.id, item])), [list.data]);
  if (list.isLoading) return <div className="state-card">Carregando {labels[type].toLowerCase()}…</div>;
  if (list.isError) return <div className="state-card error">{list.error.message}</div>;

  const current = detail.data ?? itemMap.get(selectedId);
  return <>
    <div className="page-heading"><div><h1>{labels[type]}</h1><p>{list.data.returned} registros visíveis</p></div><div className="actions">{type === 'location' && <button onClick={() => setHierarchy((value) => !value)}>{hierarchy ? 'Lista' : 'Hierarquia'}</button>}{isGm && <button className="primary" onClick={() => setEditor({ data: starter(type) })}>Novo</button>}</div></div>
    <div className="split-view">
      <aside className="entity-list">
        {hierarchy && type === 'location' ? <LocationHierarchy items={list.data.items} onSelect={(id) => setParams({ selected: id })} /> : list.data.items.map((item) => <button key={item.id} className={selectedId === item.id ? 'selected' : ''} onClick={() => setParams({ selected: item.id })}><strong>{item.name}</strong><small>{item.id}</small></button>)}
        {!list.data.items.length && <div className="empty-list">Nenhum registro visível.</div>}
      </aside>
      <section className="detail-pane">{detail.isLoading ? <div className="state-card">Carregando detalhes…</div> : <EntityDetail entity={current} type={type} isGm={isGm} onEdit={() => setEditor({ data: cleanForEditor(detail.data), version: detail.data.version })} onDelete={() => { if (window.confirm(`Excluir ${current?.name}?`)) remove.mutate(); }} />}</section>
    </div>
    {editor && <EntityEditor type={type} initial={editor.data} version={editor.version} campaignId={campaignId} onClose={() => setEditor(null)} onSaved={async (saved) => { setEditor(null); await queryClient.invalidateQueries({ queryKey: ['entities', campaignId, type] }); if (saved?.id) setParams({ selected: saved.id }); }} />}
  </>;
}
