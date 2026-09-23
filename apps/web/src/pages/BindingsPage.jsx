import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams } from 'react-router';
import { api } from '../lib/api.js';

export function BindingsPage() {
  const { campaignId } = useParams();
  const queryClient = useQueryClient();
  const bindings = useQuery({ queryKey: ['bindings', campaignId], queryFn: () => api(`/api/v1/campaigns/${campaignId}/bindings`) });
  const memberships = useQuery({ queryKey: ['memberships', campaignId], queryFn: () => api(`/api/v1/campaigns/${campaignId}/memberships`) });
  const [form, setForm] = useState({ userId: '', mode: 'manual', providerId: 'Ambesek.T20', externalId: '', snapshotText: '{}' });
  const save = useMutation({
    mutationFn: () => api(`/api/v1/campaigns/${campaignId}/bindings`, { method: 'PUT', body: { userId: form.userId, mode: form.mode, providerId: form.providerId, externalId: form.externalId, snapshot: JSON.parse(form.snapshotText) } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['bindings', campaignId] })
  });
  const userName = (userId) => memberships.data?.find((entry) => entry.user.id === userId)?.user.name ?? 'Jogador indisponível';
  return <><div className="page-heading"><div><h1>Vínculos T20</h1><p>Snapshots informativos; a ficha externa continua como fonte de verdade.</p></div></div><div className="card form-grid"><label>Jogador<select value={form.userId} onChange={(e) => setForm({ ...form, userId: e.target.value })}><option value="">Selecione um jogador</option>{memberships.data?.map((entry) => <option key={entry.user.id} value={entry.user.id}>{entry.user.name}</option>)}</select></label><label>Modo<select value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value })}><option value="manual">Manual</option><option value="auto">Automático</option></select></label><label>Nome da ficha<input value={form.externalId} onChange={(e) => setForm({ ...form, externalId: e.target.value })} /></label><label className="wide">Dados da ficha<textarea value={form.snapshotText} onChange={(e) => setForm({ ...form, snapshotText: e.target.value })} /></label><button className="primary" disabled={!form.userId || !form.externalId || save.isPending} onClick={() => save.mutate()}>Salvar vínculo</button>{save.error && <div className="alert error">{save.error.message}</div>}</div><div className="stack">{bindings.data?.map((binding) => <article className="card compact" key={binding.id}><div className="card-head"><div><strong>{binding.snapshot?.name || 'Ficha T20'}</strong><small>{userName(binding.userId)} · {binding.mode === 'auto' ? 'Automático' : 'Manual'}</small></div></div>{binding.snapshot?.player && <p>Jogador: {binding.snapshot.player}</p>}{binding.snapshot?.level != null && <p>Nível: {binding.snapshot.level}</p>}</article>)}</div></>;
}
