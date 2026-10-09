import React, { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { NavLink, useParams } from 'react-router';
import { api } from '../lib/api.js';
import { useOutsideDismiss } from '../lib/useOutsideDismiss.js';

const pageSize = 20;
const labels = { npc: 'Personagem', location: 'Local', item: 'Item', monster: 'Monstro', quest: 'Missão' };
const sourceLabels = { baseline: 'Marco inicial', 'json-v2': 'Importação JSON' };
const dateLabel = (value) => value ? new Date(value).toLocaleString() : 'Nunca';

export function ImportHistoryPage() {
  const { campaignId } = useParams();
  const queryClient = useQueryClient();
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState(null);
  const modalRef = useRef(null);
  useOutsideDismiss(modalRef, () => setSelectedId(null), Boolean(selectedId));
  const history = useQuery({ queryKey: ['import-history', campaignId, page], queryFn: () => api(`/api/v1/campaigns/${campaignId}/import/history?page=${page}&pageSize=${pageSize}`) });
  const selected = useQuery({ queryKey: ['import-history-detail', campaignId, selectedId], queryFn: () => api(`/api/v1/campaigns/${campaignId}/import/history/${selectedId}`), enabled: Boolean(selectedId) });
  const undo = useMutation({
    mutationFn: (id) => api(`/api/v1/campaigns/${campaignId}/import/history/${id}/undo`, { method: 'POST', body: {} }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['import-history', campaignId] });
      await queryClient.invalidateQueries({ predicate: (query) => query.queryKey.includes(campaignId) });
      setSelectedId(null);
    }
  });
  const totalPages = Math.max(1, Math.ceil((history.data?.total ?? 0) / pageSize));
  const confirmUndo = (entry) => {
    const summary = entry.summary ?? {};
    if (!window.confirm(`Desfazer ${entry.fileName}? Isso reverte ${summary.created ?? 0} criação(ões), ${summary.updated ?? 0} atualização(ões) e ${summary.removed ?? 0} remoção(ões). Se algum conteúdo mudou depois, a operação será recusada.`)) return;
    undo.mutate(entry.id);
  };
  return <>
    <div className="page-heading"><div><small className="eyebrow">ADMINISTRAÇÃO</small><h1>Histórico de importações</h1><p>Importações são desfeitas somente quando os registros ainda correspondem à versão aplicada.</p></div></div>
    <nav className="admin-tabs" aria-label="Operações saoData">
      <NavLink end to={`/campaigns/${campaignId}/json`}>Preparar para IA</NavLink>
      <NavLink end to={`/campaigns/${campaignId}/json/import`}>Importar JSON</NavLink>
      <NavLink end to={`/campaigns/${campaignId}/json/export`}>Exportar saoData</NavLink>
      <span className="active">Histórico</span>
    </nav>
    {history.isError && <div className="alert error" role="alert">{history.error.message}</div>}
    {undo.error && <div className="alert error" role="alert">{undo.error.message}</div>}
    {history.isPending ? <div className="state-card">Carregando histórico…</div> : <>
      <section className="import-history-grid" aria-label="Importações da campanha">
        {history.data?.items?.map((entry) => <article className="import-history-card" key={entry.id}>
          <header><div><small>{sourceLabels[entry.sourceKind] ?? entry.sourceKind}</small><h2>{entry.fileName}</h2></div><span className={`import-history-state ${entry.revertedAt ? 'reverted' : ''}`}>{entry.sourceKind === 'baseline' ? 'Ponto inicial' : entry.revertedAt ? 'Desfeita' : entry.reversible ? 'Reversível' : 'Sem snapshot'}</span></header>
          <p>{entry.sourceKind === 'baseline' ? 'Base atual preservada' : entry.importedBy?.name ?? entry.importedBy?.login ?? 'Ator indisponível'} · {dateLabel(entry.importedAt)}</p>
          {entry.sourceKind === 'baseline'
            ? <div className="import-history-counts"><span>{entry.summary?.entities ?? 0} registros preservados</span></div>
            : <div className="import-history-counts"><span>{entry.summary?.created ?? 0} criadas</span><span>{entry.summary?.updated ?? 0} atualizadas</span><span>{entry.summary?.removed ?? 0} removidas</span></div>}
          {entry.revertedAt && <small className="muted">Desfeita em {dateLabel(entry.revertedAt)}</small>}
          <div className="actions"><button type="button" onClick={() => setSelectedId(entry.id)}>Detalhes</button><button type="button" className="danger" disabled={!entry.reversible || Boolean(entry.revertedAt) || undo.isPending} onClick={() => confirmUndo(entry)}>{undo.isPending ? 'Desfazendo…' : 'Desfazer importação'}</button></div>
        </article>)}
      </section>
      {!history.data?.items?.length && <div className="state-card">Nenhuma importação registrada.</div>}
      <div className="import-history-pagination"><button type="button" disabled={page <= 1} onClick={() => setPage(1)}>Início</button><button type="button" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Anterior</button><span>Página {page} de {totalPages} · {history.data?.total ?? 0} importações</span><button type="button" disabled={page >= totalPages} onClick={() => setPage((value) => value + 1)}>Próxima</button><button type="button" disabled={page >= totalPages} onClick={() => setPage(totalPages)}>Fim</button></div>
    </>}
    {selectedId && <div className="modal-backdrop" role="presentation"><section ref={modalRef} className="modal import-history-detail" role="dialog" aria-modal="true" aria-labelledby="import-history-title"><header className="modal-head"><div><small>{sourceLabels[selected.data?.sourceKind] ?? 'IMPORTAÇÃO'}</small><h2 id="import-history-title">{selected.data?.sourceKind === 'baseline' ? 'Estado inicial da base' : 'Detalhes do pacote'}</h2></div><button type="button" aria-label="Fechar" onClick={() => setSelectedId(null)}>×</button></header><div className="modal-content">{selected.isPending && <p>Carregando detalhes…</p>}{selected.error && <p role="alert">{selected.error.message}</p>}{selected.data?.changes?.map((change) => <article className="import-change-card" key={`${change.type}:${change.id}`}><header><strong>{labels[change.type] ?? change.type}: {change.after?.data?.name ?? change.before?.data?.name ?? change.id}</strong><span>{change.status}</span></header><small>{change.id} · versão aplicada {change.resultVersion}</small><details><summary>{selected.data.sourceKind === 'baseline' ? 'Ver registro preservado' : 'Comparar antes e depois'}</summary><pre>{JSON.stringify(selected.data.sourceKind === 'baseline' ? change.after : { antes: change.before, depois: change.after }, null, 2)}</pre></details></article>)}</div><footer className="modal-actions"><button type="button" onClick={() => setSelectedId(null)}>Fechar</button></footer></section></div>}
  </>;
}
