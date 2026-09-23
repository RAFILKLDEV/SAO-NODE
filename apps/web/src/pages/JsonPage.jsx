import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router';
import { api } from '../lib/api.js';

const entityCategories = [['npc', 'Personagens'], ['location', 'Locais'], ['item', 'Itens'], ['monster', 'Monstros'], ['quest', 'Missões']];

export function JsonPage() {
  const { campaignId } = useParams();
  const queryClient = useQueryClient();
  const [text, setText] = useState('');
  const [preview, setPreview] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [copied, setCopied] = useState(false);
  const [templateTypes, setTemplateTypes] = useState(['npc', 'location', 'item', 'monster', 'quest']);
  const [templateSections, setTemplateSections] = useState(['fields', 'links']);
  const [exportTypes, setExportTypes] = useState(entityCategories.map(([value]) => value));
  const previewMutation = useMutation({
    mutationFn: () => {
      let document;
      try { document = JSON.parse(text); } catch (error) { throw new Error(`JSON inválido: ${error.message}`); }
      return api(`/api/v1/campaigns/${campaignId}/import/preview`, { method: 'POST', body: document });
    },
    onSuccess: (data) => { setPreview(data); setSelected(new Set(data.diff.filter((entry) => entry.selected).map((entry) => entry.key))); }
  });
  const applyMutation = useMutation({
    mutationFn: () => api(`/api/v1/campaigns/${campaignId}/import/apply`, { method: 'POST', body: { previewId: preview.previewId, selectedKeys: [...selected] } }),
    onSuccess: async () => { setPreview(null); setText(''); await queryClient.invalidateQueries(); }
  });
  const copyTemplate = async () => {
    const template = await api(`/api/v1/campaigns/${campaignId}/import/template`);
    const always = ['id', 'name', 'active', 'media', 'visibility', 'extensions', 'identity', 'placement', 'statBlocks', 'stats', 'components', 'type', 'state', 'category', 'rarity', 'sheet', 'movements', 'attacks', 'abilities', 'skills', 'traits'];
    const sectionKeys = { fields: ['fields'], links: ['links'], references: ['links'], objectives: ['objectives'], rewards: ['rewards'], requirements: ['requirements'], flow: ['startSource', 'completionReceiver', 'nextQuests'], connections: ['connections'], services: ['services'] };
    const selectedKeys = new Set(always.concat(templateSections.flatMap((section) => sectionKeys[section] ?? [])));
    const filtered = { ...template, containers: templateTypes, entities: template.entities.filter((entity) => templateTypes.includes(entity.type)).map((entity) => ({ ...entity, data: Object.fromEntries(Object.entries(entity.data).filter(([key]) => selectedKeys.has(key))) })) };
    const instructions = `INSTRUÇÕES PARA A IA\n- Retorne somente JSON válido, sem markdown.\n- Mantenha schemaVersion exatamente "2.0".\n- Use IDs canônicos com prefixos npc., loc., item., monster. ou quest.\n- Não invente referências: cada referência deve apontar para um ID criado no mesmo JSON ou já existente na campanha.\n- Use arrays para referências, objetivos e recompensas, mesmo quando houver apenas um item.\n- Objetivos usam type talk, kill, collect, explore, deliver, interact, survive ou custom.\n- Cada objetivo precisa de objectiveId, type, text e order.\n- Visibilidades válidas: public, discoverable ou gm.\n- Preserve os nomes dos campos e não crie campos alternativos.\n\nOPERAÇÕES E IMPORTAÇÃO\n- O JSON é um pacote saoData 2.0. Cada entidade deve estar em {"type":"npc|location|item|monster|quest","data":{...}}.\n- A importação primeiro gera uma prévia (diff); somente as alterações selecionadas são aplicadas. Entidades novas são criadas e entidades com o mesmo ID são atualizadas.\n- Use containers para declarar os tipos que o pacote controla. Tipos declarados em containers que não estiverem no pacote podem aparecer como remoções na prévia.\n- Em item.stats, operation define como o valor deve ser interpretado: set (define/substitui), add (soma), subtract (subtrai) ou multiply (multiplica). Exemplo: {"key":"forca","value":2,"operation":"add"}.\n- Para imagens, use media com image, portrait, token, map ou source e informe links HTTP/HTTPS diretos.\n- Conexões usam connections com target {"type":"location","id":"loc.id"}; não use parentId para criar conexões.\n- Para preservar dados extras, use extensions. Não crie campos fora do modelo.`
    await navigator.clipboard.writeText(`${instructions}\n\n${JSON.stringify(filtered, null, 2)}`);
    setCopied(true); window.setTimeout(() => setCopied(false), 2200);
  };
  const loadFile = async (file) => { if (!file) return; setText(await file.text()); setPreview(null); };
  const toggle = (key) => setSelected((current) => { const next = new Set(current); next.has(key) ? next.delete(key) : next.add(key); return next; });
  const toggleExportType = (type) => setExportTypes((current) => current.includes(type) ? (current.length > 1 ? current.filter((value) => value !== type) : current) : [...current, type]);
  const exportHref = `/api/v1/campaigns/${campaignId}/export.json?types=${encodeURIComponent(exportTypes.join(','))}`;

  return <>
    <div className="page-heading"><div><h1>Importar/Exportar JSON</h1><p>Cole conteúdo gerado por IA, valide as alterações e aplique somente o que desejar.</p></div><div className="actions"><button onClick={copyTemplate}>{copied ? 'Estrutura copiada ✓' : 'Copiar estrutura para IA'}</button></div></div>
    <section className="card json-export-card"><div><strong>Exportar banco de dados</strong><small>Escolha o banco completo ou somente as categorias necessárias.</small></div><div className="structure-options"><label><input type="checkbox" checked={exportTypes.length === entityCategories.length} onChange={(event) => setExportTypes(event.target.checked ? entityCategories.map(([value]) => value) : [entityCategories[0][0]])} />Banco completo</label>{entityCategories.map(([value, label]) => <label key={value}><input type="checkbox" checked={exportTypes.includes(value)} onChange={() => toggleExportType(value)} />{label}</label>)}</div><a className="button-link" href={exportHref}>Exportar JSON</a></section>
    <div className="card json-import-card">
      <div className="json-structure-picker"><div className="picker-heading"><div><strong>Preparar pacote para a IA</strong><small>Escolha o que a IA deve criar. Isso altera apenas o guia e o exemplo copiado.</small></div><button className="primary" onClick={copyTemplate}>{copied ? 'Guia copiado ✓' : 'Copiar guia para IA'}</button></div><fieldset><legend>Tipos de conteúdo</legend><div className="structure-options">{entityCategories.map(([value, label]) => <label key={value}><input type="checkbox" checked={templateTypes.includes(value)} onChange={() => setTemplateTypes((current) => current.includes(value) ? current.filter((item) => item !== value) : [...current, value])} />{label}</label>)}</div></fieldset><fieldset><legend>Informações a preencher</legend><div className="structure-options">{[['fields', 'Descrições'], ['references', 'Referências'], ['objectives', 'Objetivos'], ['rewards', 'Recompensas'], ['requirements', 'Requisitos'], ['flow', 'Fluxo da missão'], ['connections', 'Conexões'], ['services', 'Serviços']].map(([value, label]) => <label key={value}><input type="checkbox" checked={templateSections.includes(value)} onChange={() => setTemplateSections((current) => current.includes(value) ? current.filter((item) => item !== value) : [...current, value])} />{label}</label>)}</div></fieldset><details className="json-operations-help"><summary>Operações do JSON</summary><p>Em <code>item.stats</code>, use <code>set</code> para definir, <code>add</code> para somar, <code>subtract</code> para subtrair ou <code>multiply</code> para multiplicar o valor. A IA deve devolver o pacote completo em <code>saoData 2.0</code>; a prévia mostra o diff e só a seleção confirmada é aplicada.</p></details></div>
      <div className="json-import-toolbar"><label className="file-button">Carregar arquivo .json<input type="file" accept=".json,application/json" onChange={(event) => loadFile(event.target.files?.[0])} /></label><small>O modelo copiado contém personagens, locais, itens, monstros e missões com imagens e referências.</small></div>
      <textarea className="json-import-editor" value={text} onChange={(event) => { setText(event.target.value); setPreview(null); previewMutation.reset(); }} placeholder="Cole aqui o JSON devolvido pela IA" spellCheck="false" />
      <button className="primary" disabled={!text.trim() || previewMutation.isPending} onClick={() => previewMutation.mutate()}>{previewMutation.isPending ? 'Validando' : 'Gerar prévia'}</button>{previewMutation.error && <div className="alert error">{previewMutation.error.message}</div>}
    </div>
    {preview && <><div className="card"><strong>{preview.pack.name}</strong><p>Versão {preview.pack.schemaVersion}</p>{preview.warnings.length > 0 && <div className="alert warning">{preview.warnings.length} referência(s) ainda não encontrada(s) na campanha.</div>}</div><div className="table-wrap"><table><thead><tr><th>Aplicar</th><th>Status</th><th>Tipo</th><th>Nome</th><th>Alterações</th></tr></thead><tbody>{preview.diff.map((entry) => <tr key={entry.key}><td><input type="checkbox" checked={selected.has(entry.key)} onChange={() => toggle(entry.key)} /></td><td><span className={`diff ${entry.status}`}>{entry.status}</span></td><td>{entry.type}</td><td>{entry.after?.name ?? entry.before?.name ?? 'Registro sem nome'}</td><td>{entry.visibilityChange && <small>Visibilidade: {entry.visibilityChange.before ?? 'novo'} → {entry.visibilityChange.after}</small>}<details><summary>Ver dados</summary><pre>{JSON.stringify({ antes: entry.before, depois: entry.after }, null, 2)}</pre></details></td></tr>)}</tbody></table></div><div className="sticky-actions"><span>{selected.size} alterações selecionadas</span><button className="primary" disabled={applyMutation.isPending} onClick={() => applyMutation.mutate()}>{applyMutation.isPending ? 'Aplicando alterações…' : 'Aplicar seleção'}</button></div>{applyMutation.error && <div className="alert error">{applyMutation.error.message}</div>}</>}
  </>;
}
