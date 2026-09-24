import React, { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useOutletContext, useParams } from 'react-router';
import { associationRoles, associationRoleAllowed, entityTypeLabels, entityTypes, isAssociationDrop, normalizeAssociation } from '@sao/domain';
import { api } from '../lib/api.js';
import { associationDiff, associationKey, entityIdentity, filterAssociations, hasAssociation } from '../lib/associations.js';

const roleLabel = (role) => associationRoles.find((entry) => entry.value === role)?.label ?? (role === 'drop' ? 'Drop' : role);
const entityPath = (campaignId, entity) => `/campaigns/${campaignId}/${entity.type === 'location' ? 'locations' : `${entity.type}s`}?selected=${encodeURIComponent(entity.id)}`;
function TypeSelect({ label, value, onChange }) {
  return <label>{label}<select value={value} onChange={(event) => onChange(event.target.value)}><option value="">Todos os tipos</option>{entityTypes.map((type) => <option key={type} value={type}>{entityTypeLabels[type]}</option>)}</select></label>;
}
function RoleFields({ value, onChange, sourceType, targetType }) {
  const selected = associationRoles.some((role) => role.value === value.role) ? value.role : 'custom';
  const setRole = (role) => onChange({ role, ...(isAssociationDrop(role) ? { chance: 100, quantityMin: 1, quantityMax: 1 } : {}) });
  return <div className="association-role-fields">
    <label>Papel<select value={selected} onChange={(event) => setRole(event.target.value === 'custom' ? '' : event.target.value)}>
      {associationRoles.filter((role) => (!role.sourceType || role.sourceType === sourceType) && (!targetType || associationRoleAllowed(role.value, sourceType, targetType))).map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}
      <option value="custom">Personalizado</option>
    </select></label>
    {selected === 'custom' && <label>Nome do papel<input maxLength="100" value={value.role} onChange={(event) => setRole(event.target.value)} placeholder="Ex.: protege" /></label>}
    {isAssociationDrop(value.role) && <>
      <label>Chance (%)<input type="number" min="1" max="100" value={value.chance ?? 100} onChange={(event) => onChange({ ...value, chance: Number(event.target.value) })} /></label>
      <label>Quantidade mínima<input type="number" min="1" value={value.quantityMin ?? 1} onChange={(event) => onChange({ ...value, quantityMin: Number(event.target.value) })} /></label>
      <label>Quantidade máxima<input type="number" min="1" value={value.quantityMax ?? 1} onChange={(event) => onChange({ ...value, quantityMax: Number(event.target.value) })} /></label>
    </>}
  </div>;
}
function QueryState({ query, empty }) {
  if (query.isPending) return <p role="status">Carregando…</p>;
  if (query.isError) return <div className="alert error" role="alert">{query.error.message} <button type="button" onClick={() => query.refetch()}>Tentar novamente</button></div>;
  return empty ? <p className="muted">Nenhuma entidade encontrada.</p> : null;
}
function EntityPicker({ title, base, campaignId, source, role, links = [], backlinks = [], onChoose, multiple = false, selected, onSelect, disabled }) {
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [type, setType] = useState('');
  const [page, setPage] = useState(1);
  useEffect(() => { const timer = setTimeout(() => setDebounced(search), 250); return () => clearTimeout(timer); }, [search]);
  const query = useQuery({
    queryKey: ['association-catalog', campaignId, debounced, type, page],
    queryFn: () => api(`${base}/entities?q=${encodeURIComponent(debounced)}&page=${page}${type ? `&type=${type}` : ''}`)
  });
  const changeFilter = (setter, value) => { setter(value); setPage(1); if (multiple) onSelect([]); };
  const items = query.data?.items ?? [];
  const reason = (item) => {
    if (source && entityIdentity(item) === entityIdentity(source)) return 'Entidade de origem';
    if (!associationRoleAllowed(role, source?.type, item.type)) return 'Papel incompatível';
    if (hasAssociation(links, backlinks, item, role)) return 'Já associado';
    return '';
  };
  const eligible = items.filter((item) => !reason(item));
  return <section className="association-picker" aria-label={title}>
    <h3>{title}</h3>
    <label>Buscar {multiple ? 'destino' : 'origem'}<input type="search" placeholder="Nome ou ID" value={search} onChange={(event) => changeFilter(setSearch, event.target.value)} /></label>
    <TypeSelect label={multiple ? 'Tipo de destino' : 'Tipo de origem'} value={type} onChange={(value) => changeFilter(setType, value)} />
    <QueryState query={query} empty={!items.length} />
    {multiple && <div className="association-toolbar"><span>{selected.length} selecionado(s)</span><button type="button" disabled={disabled || !eligible.length} onClick={() => onSelect(eligible)}>Selecionar página</button><button type="button" disabled={disabled || !selected.length} onClick={() => onSelect([])}>Limpar</button></div>}
    <div className="association-entity-list">{items.map((item) => {
      const key = entityIdentity(item);
      const content = <span><strong>{item.name}</strong><small>{entityTypeLabels[item.type]} · {item.id}</small></span>;
      return multiple ? <label key={key} className={selected.some((entry) => entityIdentity(entry) === key) ? 'selected' : ''}>
        <input type="checkbox" checked={selected.some((entry) => entityIdentity(entry) === key)} disabled={disabled || Boolean(reason(item))} onChange={(event) => onSelect(event.target.checked ? [...selected, item] : selected.filter((entry) => entityIdentity(entry) !== key))} />{content}{reason(item) && <small>{reason(item)}</small>}
      </label> : <button type="button" key={key} className={source && entityIdentity(source) === key ? 'selected' : ''} onClick={() => onChoose(item)} disabled={disabled}>{content}</button>;
    })}</div>
    <div className="association-pagination"><button type="button" disabled={disabled || page === 1} onClick={() => changeFilterPage(page - 1)}>Anterior</button><small>Página {page} · {query.data?.total ?? 0} registros</small><button type="button" disabled={disabled || !query.data || page * query.data.pageSize >= query.data.total} onClick={() => changeFilterPage(page + 1)}>Próxima</button></div>
  </section>;
  function changeFilterPage(next) { setPage(next); if (multiple) onSelect([]); }
}

export function AssociationsPage() {
  const { isGm } = useOutletContext();
  return isGm ? <AssociationWorkspace /> : <div className="state-card">Apenas mestres podem gerenciar associações.</div>;
}
function AssociationWorkspace() {
  const { campaignId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const base = `/api/v1/campaigns/${campaignId}/associations`;
  const [source, setSource] = useState(null);
  const [selected, setSelected] = useState([]);
  const [fields, setFields] = useState({ role: 'related' });
  const [draft, setDraft] = useState(null);
  const [removeSelected, setRemoveSelected] = useState([]);
  const [filters, setFilters] = useState({ type: '', role: '', search: '' });
  const [editing, setEditing] = useState(null);
  const [review, setReview] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const detail = useQuery({
    queryKey: ['association-detail', campaignId, source?.type, source?.id],
    queryFn: () => api(`${base}/${source.type}/${encodeURIComponent(source.id)}`),
    enabled: Boolean(source)
  });
  const snapshot = draft?.base ?? detail.data;
  const links = draft?.links ?? snapshot?.links ?? [];
  const backlinks = snapshot?.backlinks ?? [];
  const diff = associationDiff(snapshot?.links ?? [], links);
  const dirty = Boolean(diff.add.length || diff.remove.length);
  const stale = dirty && detail.data && snapshot.source.version !== detail.data.source.version;
  useEffect(() => {
    if (!dirty) return;
    const warn = (event) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);
  const save = useMutation({
    mutationFn: () => api(base, { method: 'PUT', body: { changes: [{ sourceType: source.type, sourceId: source.id, version: snapshot.source.version, ...diff }] } }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ predicate: (query) => query.queryKey.includes(campaignId) });
      setDraft(null); setReview(false); setRemoveSelected([]); setSelected([]); setEditing(null);
      setSuccess('Associações salvas.'); setError('');
    }
  });
  const reset = () => { setDraft(null); setEditing(null); setReview(false); setSelected([]); setRemoveSelected([]); setError(''); save.reset(); };
  const leave = () => !dirty || window.confirm('Há alterações não salvas. Deseja descartá-las?');
  const chooseSource = (item) => {
    if (source && entityIdentity(item) === entityIdentity(source)) return;
    if (!leave()) return;
    reset(); setSource(item); setFields({ role: 'related' }); setSuccess(''); setFilters({ type: '', role: '', search: '' });
  };
  const updateLinks = (next) => { setDraft({ base: snapshot, links: next }); setReview(false); setError(''); setSuccess(''); save.reset(); };
  const normalized = (target, values) => normalizeAssociation(source, { type: target.type, id: target.id, slot: target.slot ?? 'references', ...values });
  const addSelected = () => {
    try {
      const additions = selected.filter((target) => !hasAssociation(links, backlinks, target, fields.role)).map((target) => ({ ...normalized(target, fields), name: target.name, available: true }));
      if (links.length + additions.length > 10000) throw new Error('Seleção muito grande.');
      updateLinks([...links, ...additions]); setSelected([]);
    } catch (failure) { setError(failure.issues?.[0]?.message ?? failure.message); }
  };
  const applyEdit = () => {
    try {
      const next = { ...normalized(editing.original, editing.fields), name: editing.original.name, available: editing.original.available };
      const others = links.filter((link) => associationKey(link) !== associationKey(editing.original));
      if (hasAssociation(others, backlinks, next, next.role)) throw new Error('Essa associação já existe.');
      updateLinks([...others, next]); setEditing(null);
    } catch (failure) { setError(failure.issues?.[0]?.message ?? failure.message); }
  };
  const removeLinks = (keys) => { updateLinks(links.filter((link) => !keys.includes(associationKey(link)))); setRemoveSelected([]); setEditing(null); };
  const direct = filterAssociations(links, filters);
  const incoming = filterAssociations(backlinks, filters);
  const pendingLimit = diff.add.length > 100 || diff.remove.length > 100;
  return <div className="associations-page">
    <div className="page-heading"><div><small className="eyebrow">ORGANIZAÇÃO DA CAMPANHA</small><h1>Associações</h1><p>Conecte personagens, locais, itens, monstros e missões.</p></div></div>
    <fieldset disabled={save.isPending} className="association-workspace">
      <div className="associations-layout">
        <EntityPicker title="1. Entidade de origem" base={base} campaignId={campaignId} source={source} onChoose={chooseSource} />
        <section className="association-main">
          {!source ? <div className="state-card"><h2>Por onde começar?</h2><p>Selecione qualquer entidade no catálogo. Depois escolha destinos e o papel de cada relação.</p></div> : <>
            <header className="association-source-head"><div><small>{entityTypeLabels[source.type]}</small><h2>{snapshot?.source.name ?? source.name}</h2><span className="muted">{source.id}</span></div><button type="button" onClick={() => { if (leave()) navigate(entityPath(campaignId, source)); }}>Abrir ficha</button></header>
            <p className="association-hint">Cada vínculo é salvo uma vez e aparece também no destino como “Referenciado por”. Associar não libera conteúdo para jogadores. Objetivos de missão, hierarquia e caminhos continuam nos editores das fichas.</p>
            <QueryState query={detail} />
            {detail.data && !detail.isError && <>
              <section className="association-add-panel" aria-label="Adicionar associações"><h3>2. Escolha o papel e os destinos</h3>
                <RoleFields value={fields} sourceType={source.type} onChange={(value) => { setFields(value); setSelected([]); }} />
                <EntityPicker key={entityIdentity(source)} title="Destinos" base={base} campaignId={campaignId} source={source} role={fields.role} links={links} backlinks={backlinks} multiple selected={selected} onSelect={setSelected} disabled={review} />
                <button type="button" onClick={addSelected} disabled={review || !selected.length || !fields.role.trim()}>Adicionar selecionados à revisão</button>
              </section>
              <section aria-label="Vínculos existentes"><h3>3. Vínculos existentes</h3>
                <div className="association-filters">
                  <label>Buscar vínculo<input type="search" value={filters.search} onChange={(event) => { setFilters({ ...filters, search: event.target.value }); setRemoveSelected([]); }} /></label>
                  <TypeSelect label="Tipo relacionado" value={filters.type} onChange={(value) => { setFilters({ ...filters, type: value }); setRemoveSelected([]); }} />
                  <label>Filtrar papel<select value={filters.role} onChange={(event) => { setFilters({ ...filters, role: event.target.value }); setRemoveSelected([]); }}><option value="">Todos os papéis</option>{[...new Set([...links, ...backlinks].map((link) => link.role))].map((role) => <option value={role} key={role}>{roleLabel(role)}</option>)}</select></label>
                </div>
                <div className="association-toolbar"><h4>Vínculos diretos ({direct.length})</h4><button type="button" disabled={review || !direct.length} onClick={() => setRemoveSelected(direct.map(associationKey))}>Selecionar vínculos visíveis</button><button type="button" disabled={review || !removeSelected.length} onClick={() => removeLinks(removeSelected)}>Remover selecionados ({removeSelected.length})</button></div>
                <div className="association-list">{direct.map((link) => <article className="association-row" key={associationKey(link)}>
                  <input type="checkbox" aria-label={`Selecionar vínculo com ${link.name}`} disabled={review} checked={removeSelected.includes(associationKey(link))} onChange={(event) => setRemoveSelected(event.target.checked ? [...removeSelected, associationKey(link)] : removeSelected.filter((key) => key !== associationKey(link)))} />
                  <div className="association-row-name"><strong>{link.name}</strong><small>{entityTypeLabels[link.type]} · {roleLabel(link.role)}{link.slot !== 'references' ? ` · ${link.slot === 'locations' ? 'Locais do personagem' : 'Relações do personagem'}` : ''}</small><small>{link.id}</small>{isAssociationDrop(link.role) && <small>{link.chance ?? 100}% · Quantidade {link.quantityMin ?? 1}–{link.quantityMax ?? link.quantityMin ?? 1}</small>}{!link.available && <span className="association-warning">Destino removido ou indisponível</span>}</div>
                  <div className="association-row-actions"><button type="button" disabled={!link.available} onClick={() => { if (leave()) navigate(entityPath(campaignId, link)); }}>Abrir ficha</button><button type="button" disabled={review || !link.available} onClick={() => { setEditing({ original: link, fields: { role: link.role, ...(isAssociationDrop(link.role) ? { chance: link.chance ?? 100, quantityMin: link.quantityMin ?? 1, quantityMax: link.quantityMax ?? 1 } : {}) } }); setError(''); }}>Editar</button><button type="button" className="danger" disabled={review} onClick={() => removeLinks([associationKey(link)])}>Remover</button></div>
                </article>)}{!direct.length && <p className="muted">Nenhum vínculo direto neste filtro.</p>}</div>
                {editing && <section className="association-edit-panel" aria-label="Editar associação"><h4>Editar vínculo com {editing.original.name}</h4><RoleFields value={editing.fields} sourceType={source.type} targetType={editing.original.type} onChange={(fields) => setEditing({ ...editing, fields })} /><button type="button" onClick={applyEdit}>Aplicar à revisão</button><button type="button" onClick={() => setEditing(null)}>Cancelar edição</button></section>}
                <h4>Referenciado por ({incoming.length})</h4><div className="association-list">{incoming.map((link) => <article className="association-row" key={`${entityIdentity(link.source)}:${associationKey(link)}`}><div className="association-row-name"><strong>{link.source.name}</strong><small>{entityTypeLabels[link.source.type]} · {roleLabel(link.role)}</small><small>{link.source.id}</small></div><button type="button" onClick={() => chooseSource(link.source)}>Gerenciar na origem</button><button type="button" onClick={() => { if (leave()) navigate(entityPath(campaignId, link.source)); }}>Abrir ficha</button></article>)}{!incoming.length && <p className="muted">Nenhum vínculo recebido neste filtro.</p>}</div>
              </section>
            </>}
          </>}
        </section>
      </div>
      {error && <div className="alert error" role="alert">{error}</div>}
      {save.error && <div className="alert error" role="alert">{save.error.message}{save.error.code === 'VERSION_CONFLICT' && <button type="button" onClick={() => { if (leave()) { reset(); detail.refetch(); } }}>Descartar rascunho e recarregar</button>}</div>}
      {stale && <p className="association-warning" role="alert">A origem foi alterada por outra sessão. Descarte o rascunho e recarregue para revisar os novos dados.</p>}
      {success && <p role="status" className="association-success">{success}</p>}
      {dirty && <section className="association-review" aria-label="Revisão das alterações">
        {review && <><h3>Confira antes de salvar</h3><p>{source.name} → destinos abaixo. Nenhuma alteração foi salva ainda.</p><ul>{diff.remove.map((link) => <li key={`remove:${associationKey(link)}`}>Remover: {snapshot.links.find((entry) => associationKey(entry) === associationKey(link))?.name ?? link.id} · {roleLabel(link.role)}</li>)}{diff.add.map((link) => <li key={`add:${associationKey(link)}`}>Adicionar: {links.find((entry) => associationKey(entry) === associationKey(link))?.name ?? link.id} · {roleLabel(link.role)}{isAssociationDrop(link.role) ? ` · ${link.chance}% · ${link.quantityMin}–${link.quantityMax} unidade(s)` : ''}</li>)}</ul></>}
        <div className="association-toolbar"><strong>{diff.add.length} inclusão(ões) · {diff.remove.length} remoção(ões)</strong>{review ? <><button type="button" className="primary" disabled={stale || pendingLimit || detail.isError} onClick={() => save.mutate()}>{save.isPending ? 'Salvando…' : 'Confirmar e salvar'}</button><button type="button" onClick={() => setReview(false)}>Voltar à edição</button></> : <button type="button" className="primary" disabled={Boolean(editing) || stale || pendingLimit || detail.isError} onClick={() => setReview(true)}>Revisar alterações</button>}<button type="button" onClick={() => { if (leave()) reset(); }}>Descartar alterações</button></div>
        {pendingLimit && <p role="alert">Salve no máximo 100 inclusões e 100 remoções por vez.</p>}
      </section>}
    </fieldset>
  </div>;
}
