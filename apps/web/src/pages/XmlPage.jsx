import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router';
import { api } from '../lib/api.js';

export function XmlPage() {
  const { campaignId } = useParams();
  const queryClient = useQueryClient();
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const previewMutation = useMutation({
    mutationFn: async () => {
      const form = new FormData();
      form.append('file', file);
      return api(`/api/v1/campaigns/${campaignId}/import/preview`, { method: 'POST', body: form });
    },
    onSuccess: (data) => {
      setPreview(data);
      setSelected(new Set(data.diff.filter((entry) => entry.selected).map((entry) => entry.key)));
    }
  });
  const applyMutation = useMutation({
    mutationFn: () => api(`/api/v1/campaigns/${campaignId}/import/apply`, { method: 'POST', body: { previewId: preview.previewId, selectedKeys: [...selected] } }),
    onSuccess: async () => {
      setPreview(null);
      setFile(null);
      await queryClient.invalidateQueries();
    }
  });
  const toggle = (key) => setSelected((current) => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  return <><div className="page-heading"><div><h1>Importar/Exportar XML</h1><p>saoData v1 · preview, diff seletivo e merge transacional.</p></div><a className="button-link" href={`/api/v1/campaigns/${campaignId}/export.xml`}>Exportar XML</a></div><div className="card upload-card"><input type="file" accept=".xml,application/xml,text/xml" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setPreview(null); }} /><button className="primary" disabled={!file || previewMutation.isPending} onClick={() => previewMutation.mutate()}>{previewMutation.isPending ? 'Validando…' : 'Gerar preview'}</button>{previewMutation.error && <div className="alert error">{previewMutation.error.message}</div>}</div>{preview && <><div className="card"><strong>{preview.pack.name}</strong><p>{preview.pack.packId} · schema {preview.pack.schemaVersion}</p>{preview.warnings.length > 0 && <div className="alert warning">{preview.warnings.length} referências não resolvidas serão preservadas com warning.</div>}</div><div className="table-wrap"><table><thead><tr><th>Usar XML</th><th>Status</th><th>Tipo</th><th>ID</th></tr></thead><tbody>{preview.diff.map((entry) => <tr key={entry.key}><td><input type="checkbox" checked={selected.has(entry.key)} onChange={() => toggle(entry.key)} /></td><td><span className={`diff ${entry.status}`}>{entry.status}</span></td><td>{entry.type}</td><td><code>{entry.id}</code></td></tr>)}</tbody></table></div><div className="sticky-actions"><span>{selected.size} alterações selecionadas</span><button className="primary" disabled={applyMutation.isPending} onClick={() => applyMutation.mutate()}>{applyMutation.isPending ? 'Aplicando…' : 'Aplicar seleção'}</button></div>{applyMutation.error && <div className="alert error">{applyMutation.error.message}</div>}</>}</>;
}
