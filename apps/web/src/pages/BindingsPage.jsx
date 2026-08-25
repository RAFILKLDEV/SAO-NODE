import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router';
import { api } from '../lib/api.js';

export function BindingsPage() {
  const { campaignId } = useParams();
  const queryClient = useQueryClient();
  const [form, setForm] = useState({ userId: '', mode: 'manual', providerId: 'Ambesek.T20', externalId: '', snapshotText: '{}' });
  const bindings = useQuery({ queryKey: ['bindings', campaignId], queryFn: () => api(`/api/v1/campaigns/${campaignId}/bindings`) });
  const save = useMutation({
    mutationFn: () => api(`/api/v1/campaigns/${campaignId}/bindings`, { method: 'PUT', body: { userId: form.userId, mode: form.mode, providerId: form.providerId, externalId: form.externalId, snapshot: JSON.parse(form.snapshotText) } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['bindings', campaignId] })
  });
  return <><div className="page-heading"><div><h1>Vínculos T20</h1><p>Snapshots informativos; a ficha externa continua como fonte de verdade.</p></div></div><div className="card form-grid"><label>User ID<input value={form.userId} onChange={(e) => setForm({ ...form, userId: e.target.value })} /></label><label>Modo<select value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value })}><option value="manual">manual</option><option value="auto">auto</option></select></label><label>Provider<input value={form.providerId} onChange={(e) => setForm({ ...form, providerId: e.target.value })} /></label><label>External ID<input value={form.externalId} onChange={(e) => setForm({ ...form, externalId: e.target.value })} /></label><label className="wide">Snapshot JSON<textarea value={form.snapshotText} onChange={(e) => setForm({ ...form, snapshotText: e.target.value })} /></label><button className="primary" onClick={() => save.mutate()}>Salvar vínculo</button>{save.error && <div className="alert error">{save.error.message}</div>}</div><div className="stack">{bindings.data?.map((binding) => <article className="card compact" key={binding.id}><div className="card-head"><div><strong>{binding.externalId}</strong><small>{binding.providerId} · {binding.mode}</small></div><code>{binding.userId}</code></div><pre className="data-block">{JSON.stringify(binding.snapshot ?? {}, null, 2)}</pre></article>)}</div></>;
}
