import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { NavLink, useParams } from 'react-router';
import { api } from '../lib/api.js';

const entityCategories = [['npc', 'Personagens'], ['location', 'Locais'], ['item', 'Itens'], ['monster', 'Monstros'], ['quest', 'Missões']];

export function JsonPage({ view = 'prepare' }) {
  const { campaignId } = useParams();
  const queryClient = useQueryClient();
  const [text, setText] = useState('');
  const [file, setFile] = useState(null);
  const [page, setPage] = useState(1);
  const [preview, setPreview] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [details, setDetails] = useState({});
  const [copied, setCopied] = useState(false);
  const [templateTypes, setTemplateTypes] = useState(['npc', 'location', 'item', 'monster', 'quest']);
  const [templateSections, setTemplateSections] = useState(['fields', 'links']);
  const [exportTypes, setExportTypes] = useState(entityCategories.map(([value]) => value));
  const [monsterIds, setMonsterIds] = useState('');
  const previewMutation = useMutation({
    mutationFn: async () => {
      const source = file ? await file.text() : text;
      if (!source.trim()) throw new Error('Escolha um arquivo ou cole um JSON.');
      const query = new URLSearchParams({ page: '1', pageSize: '50' });
      return api(`/api/v1/campaigns/${campaignId}/import/preview?${query}`, {
        method: 'POST',
        headers: { 'content-type': 'application/sao-data+json', ...(file?.name ? { 'x-file-name': file.name } : {}) },
        body: source
      });
    },
    onSuccess: (data) => { setPage(1); setPreview(data); setDetails({}); setSelected(new Set(data.diff.filter((entry) => entry.selected && !['EQUAL', 'REMOVED_FROM_JSON'].includes(entry.status)).map((entry) => entry.key))); }
  });
  const applyMutation = useMutation({
    mutationFn: () => api(`/api/v1/campaigns/${campaignId}/import/apply`, { method: 'POST', body: { previewId: preview.previewId, selectedKeys: [...selected] } }),
    onSuccess: async () => { setPreview(null); setText(''); setFile(null); setDetails({}); await queryClient.invalidateQueries(); }
  });
  const copyTemplate = async () => {
    const template = await api(`/api/v1/campaigns/${campaignId}/export.json?types=${encodeURIComponent(templateTypes.join(','))}`);
    const always = ['id', 'name', 'active', 'media', 'visibility', 'extensions', 'identity', 'placement', 'statBlocks', 'stats', 'components', 'type', 'state', 'category', 'rarity', 'sheet', 'movements', 'attacks', 'abilities', 'skills', 'traits'];
    const sectionKeys = { fields: ['fields'], links: ['links'], references: ['links'], objectives: ['objectives'], rewards: ['rewards'], requirements: ['requirements'], flow: ['startSource', 'completionReceiver', 'nextQuests'], connections: ['connections'], services: ['services'] };
    const selectedKeys = new Set(always.concat(templateSections.flatMap((section) => sectionKeys[section] ?? [])));
    const filtered = { ...template, containers: templateTypes, entities: template.entities.filter((entity) => templateTypes.includes(entity.type)).map((entity) => ({ ...entity, data: Object.fromEntries(Object.entries(entity.data).filter(([key]) => selectedKeys.has(key))) })) };
    const instructions = `CONTEXTO ATUAL DA CAMPANHA PARA IA\n- Este arquivo contém dados atuais do catálogo saoData 2.0 nas categorias e campos escolhidos; use-o como contexto de leitura e mantenha os IDs.\n- Retorne somente JSON válido, sem markdown. Para uma alteração pequena, prefira operations; não devolva entidades completas sem necessidade.\n- Formato compacto válido: {"schemaVersion":"2.0","packId":"alteracoes-campanha","name":"Alterações da campanha","operations":[{"type":"monster","id":"monster.lobo","set":{"group":"matilha"},"add":{"links":[{"type":"item","id":"item.carne","role":"drops"}]},"remove":{}}]}.\n- Cada operação exige type e id de uma entidade existente. set define caminhos, add acrescenta valores a listas e remove retira valores de listas; caminhos aceitam ponto ou barra. Os campos omitidos são preservados.\n- operations não cria entidades. Para criar, remova ou atualizar um pacote inteiro, use saoData 2.0 com containers e entities.\n- A prévia mostra cada inclusão, atualização e remoção. Revise as remoções antes de selecioná-las; nada é aplicado até confirmar.\n- Nunca invente IDs. Referências devem apontar para IDs do pacote ou da campanha. Visibilidades válidas: public, discoverable ou gm. Objetivos precisam de objectiveId, type, text e order.\n- Conexões usam connections com target {"type":"location","id":"loc.id"}; parentId é somente hierarquia. Não crie campos fora do schema.`
    await navigator.clipboard.writeText(`${instructions}\n\n${JSON.stringify(filtered, null, 2)}`);
    setCopied(true); window.setTimeout(() => setCopied(false), 2200);
  };
  const loadFile = (nextFile) => { if (!nextFile) return; setFile(nextFile); setText(''); setPreview(null); setDetails({}); previewMutation.reset(); };
  const loadPreviewPage = async (nextPage) => {
    if (!preview?.previewId || nextPage < 1) return;
    const query = new URLSearchParams({ page: String(nextPage), pageSize: String(preview.pageSize ?? 50) });
    const data = await api(`/api/v1/campaigns/${campaignId}/import/preview/${encodeURIComponent(preview.previewId)}?${query}`);
    setPreview((current) => ({ ...current, ...data, diff: data.items ?? [] }));
    setPage(nextPage);
  };
  const loadDetails = async (key) => {
    if (details[key] || !preview?.previewId) return;
    const data = await api(`/api/v1/campaigns/${campaignId}/import/preview/${encodeURIComponent(preview.previewId)}/details?key=${encodeURIComponent(key)}`);
    setDetails((current) => ({ ...current, [key]: data }));
  };
  const toggle = (key) => setSelected((current) => { const next = new Set(current); next.has(key) ? next.delete(key) : next.add(key); return next; });
  const toggleExportType = (type) => setExportTypes((current) => current.includes(type) ? (current.length > 1 ? current.filter((value) => value !== type) : current) : [...current, type]);
  const exportHref = `/api/v1/campaigns/${campaignId}/export.json?types=${encodeURIComponent(exportTypes.join(','))}`;
  const pages = [['prepare', 'Preparar para IA', 'json'], ['import', 'Importar JSON', 'json/import'], ['export', 'Exportar saoData', 'json/export']];
  const titles = { prepare: 'Preparar contexto para IA', import: 'Importar JSON', export: 'Exportar saoData' };

  return <>
    <div className="page-heading"><div><small className="eyebrow">ADMINISTRAÇÃO</small><h1>{titles[view] ?? titles.prepare}</h1></div></div>
    <nav className="admin-tabs" aria-label="Operações saoData">{pages.map(([key, label, path]) => <NavLink key={key} end to={`/campaigns/${campaignId}/${path}`}>{label}</NavLink>)}<NavLink to={`/campaigns/${campaignId}/json/history`}>Histórico</NavLink></nav>
    {view === 'export' && <section className="card json-export-card"><div><strong>Exportar catálogo da campanha</strong><small>Baixe todas as categorias ou escolha somente as necessárias. O arquivo contém o catálogo saoData.</small></div><div className="structure-options"><label><input type="checkbox" checked={exportTypes.length === entityCategories.length} onChange={(event) => setExportTypes(event.target.checked ? entityCategories.map(([value]) => value) : [entityCategories[0][0]])} />Todas as categorias</label>{entityCategories.map(([value, label]) => <label key={value}><input type="checkbox" checked={exportTypes.includes(value)} onChange={() => toggleExportType(value)} />{label}</label>)}</div><div className="export-actions"><label className="monster-export-selection">Monstros específicos (IDs separados por vírgula)<input value={monsterIds} onChange={(event) => setMonsterIds(event.target.value)} placeholder="monster.lobo, monster.dragão" /></label>{['txt', 'md'].map((format) => <a key={format} className="button-link" href={`/api/v1/campaigns/${campaignId}/export.monsters?format=${format}${monsterIds.trim() ? `&ids=${encodeURIComponent(monsterIds)}` : ''}`}>Baixar monstros .{format}</a>)}<a className="button-link" href={exportHref}>Baixar saoData JSON</a></div></section>}
    {view !== 'export' && <div className="card json-import-card">
      {view === 'prepare' && <div className="json-structure-picker"><div className="picker-heading"><div><strong>Contexto atualizado da campanha</strong><small>O pacote é gerado a partir dos dados atuais e as seleções reduzem o conteúdo enviado.</small></div><button className="primary" disabled={!templateTypes.length} onClick={copyTemplate}>{copied ? 'Contexto copiado ✓' : 'Copiar contexto para IA'}</button></div><fieldset><legend>Categorias</legend><div className="structure-options">{entityCategories.map(([value, label]) => <label key={value}><input type="checkbox" checked={templateTypes.includes(value)} onChange={() => setTemplateTypes((current) => current.includes(value) ? current.filter((item) => item !== value) : [...current, value])} />{label}</label>)}</div></fieldset><fieldset><legend>Campos incluídos</legend><div className="structure-options">{[['fields', 'Descrições'], ['links', 'Referências'], ['objectives', 'Objetivos'], ['rewards', 'Recompensas'], ['requirements', 'Requisitos'], ['flow', 'Fluxo da missão'], ['connections', 'Conexões'], ['services', 'Serviços']].map(([value, label]) => <label key={value}><input type="checkbox" checked={templateSections.includes(value)} onChange={() => setTemplateSections((current) => current.includes(value) ? current.filter((item) => item !== value) : [...current, value])} />{label}</label>)}</div></fieldset><details className="json-operations-help"><summary>Formato compacto de operações</summary><p>Para mudanças pequenas, retorne <code>operations</code> com <code>type</code>, <code>id</code> e mapas <code>set</code>, <code>add</code> e <code>remove</code>. Use somente os caminhos alterados; operações preservam campos omitidos. Exemplo: <code>{'{"type":"monster","id":"monster.lobo","set":{"group":"matilha"},"add":{"links":[{"type":"item","id":"item.carne","role":"drops"}]},"remove":{}}'}</code>.</p></details></div>}
      {view === 'import' && <div className="json-import-toolbar"><label className="file-button">Carregar arquivo .json<input type="file" accept=".json,application/json" onChange={(event) => loadFile(event.target.files?.[0])} /></label>{file && <small>{file.name} · {(file.size / 1024 / 1024).toFixed(1)} MB</small>}<small>Revise inclusões, atualizações e remoções antes de aplicar.</small></div>}
      {view === 'import' && <>
      <textarea className="json-import-editor" value={text} onChange={(event) => { setText(event.target.value); setFile(null); setPreview(null); setDetails({}); previewMutation.reset(); }} placeholder="Cole aqui o JSON devolvido pela IA" spellCheck="false" />
      <button className="primary" disabled={(!text.trim() && !file) || previewMutation.isPending} onClick={() => previewMutation.mutate()}>{previewMutation.isPending ? 'Validando arquivo…' : 'Gerar prévia'}</button>{previewMutation.error && <div className="alert error">{previewMutation.error.message}</div>}
      </>}
    </div>}
    {view === 'import' && preview && <><div className="card"><strong>{preview.pack.name}</strong><p>saoData {preview.pack.schemaVersion} · {preview.total ?? preview.diff.length} alterações · página {page}</p>{preview.warnings?.length > 0 && <div className="alert warning">{preview.warnings.length} referência(s) ainda não encontrada(s) na campanha.</div>}<div className="association-toolbar"><button type="button" onClick={() => setSelected((current) => new Set([...current, ...preview.diff.filter((entry) => !['EQUAL', 'REMOVED_FROM_JSON'].includes(entry.status)).map((entry) => entry.key)]))}>Selecionar inclusões desta página</button><button type="button" onClick={() => setSelected((current) => new Set([...current, ...preview.diff.filter((entry) => entry.status === 'REMOVED_FROM_JSON').map((entry) => entry.key)]))}>Selecionar remoções desta página</button><button type="button" onClick={() => setSelected(new Set())}>Limpar seleção</button></div></div><div className="table-wrap"><table><thead><tr><th>Aplicar</th><th>Status</th><th>Tipo</th><th>Identificador</th><th>Alterações</th></tr></thead><tbody>{preview.diff.map((entry) => <tr key={entry.key}><td><input type="checkbox" checked={selected.has(entry.key)} disabled={entry.status === 'EQUAL'} onChange={() => toggle(entry.key)} /></td><td><span className={`diff ${entry.status}`}>{entry.status === 'REMOVED_FROM_JSON' ? 'Remover' : entry.status === 'NEW' ? 'Criar' : entry.status === 'UPDATED' ? 'Atualizar' : 'Sem alteração'}</span></td><td>{entityCategories.find(([type]) => type === entry.type)?.[1] ?? entry.type}</td><td>{entry.id}</td><td>{entry.visibilityChange && <small>Visibilidade: {entry.visibilityChange.before ?? 'novo'} → {entry.visibilityChange.after}</small>}<details onToggle={(event) => event.currentTarget.open && loadDetails(entry.key)}><summary>Ver antes/depois</summary>{details[entry.key] ? <pre>{JSON.stringify({ antes: details[entry.key].before, depois: details[entry.key].after }, null, 2)}</pre> : <p className="muted">Carregando detalhes…</p>}</details></td></tr>)}</tbody></table></div><div className="association-toolbar import-pagination"><button type="button" disabled={page <= 1} onClick={() => loadPreviewPage(page - 1)}>Anterior</button><span>Página {page} de {Math.max(1, Math.ceil((preview.total ?? 0) / (preview.pageSize ?? 50)))}</span><button type="button" disabled={!preview.hasMore} onClick={() => loadPreviewPage(page + 1)}>Próxima</button></div><div className="sticky-actions"><span>{selected.size} ações selecionadas</span><button className="primary" disabled={applyMutation.isPending || !selected.size} onClick={() => applyMutation.mutate()}>{applyMutation.isPending ? 'Aplicando…' : 'Aplicar seleção'}</button></div>{applyMutation.error && <div className="alert error">{applyMutation.error.message}</div>}</>}
  </>;
}
