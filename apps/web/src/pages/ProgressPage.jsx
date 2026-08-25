import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useOutletContext, useParams } from 'react-router';
import { api } from '../lib/api.js';

export function ProgressPage() {
  const { campaignId } = useParams();
  const { isGm } = useOutletContext();
  const queryClient = useQueryClient();
  const [start, setStart] = useState({ questId: '', ownerType: 'player', ownerId: '' });
  const progress = useQuery({ queryKey: ['progress', campaignId], queryFn: () => api(`/api/v1/campaigns/${campaignId}/progress`) });
  const startMutation = useMutation({
    mutationFn: () => api(`/api/v1/campaigns/${campaignId}/progress`, { method: 'POST', body: start }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['progress', campaignId] })
  });
  const updateObjective = useMutation({
    mutationFn: ({ progressId, objectiveId, value, version }) => api(`/api/v1/campaigns/${campaignId}/progress/${progressId}/objectives/${encodeURIComponent(objectiveId)}`, { method: 'PATCH', body: { value, version } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['progress', campaignId] })
  });
  const complete = useMutation({
    mutationFn: (progressId) => api(`/api/v1/campaigns/${campaignId}/progress/${progressId}/complete`, { method: 'POST', body: {} }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['progress', campaignId] })
  });

  return <>
    <div className="page-heading"><div><h1>Progresso</h1><p>Runtime separado da definição das Missões.</p></div></div>
    {isGm && <div className="card form-grid"><label>Quest ID<input value={start.questId} onChange={(e) => setStart({ ...start, questId: e.target.value })} /></label><label>Dono<select value={start.ownerType} onChange={(e) => setStart({ ...start, ownerType: e.target.value })}><option value="player">Jogador</option><option value="group">Grupo</option></select></label><label>Owner ID<input value={start.ownerId} onChange={(e) => setStart({ ...start, ownerId: e.target.value })} /></label><button className="primary" onClick={() => startMutation.mutate()} disabled={startMutation.isPending}>Iniciar missão</button>{startMutation.error && <div className="alert error">{startMutation.error.message}</div>}</div>}
    {progress.isLoading && <div className="state-card">Carregando progresso…</div>}
    <div className="stack">{progress.data?.map((entry) => <article className="card" key={entry.id}><div className="card-head"><div><strong>{entry.questId}</strong><small>{entry.ownerType}: {entry.ownerId}</small></div><span className={`status ${entry.state}`}>{entry.state}</span></div><div className="progress-track"><span style={{ width: `${entry.percentage ?? 0}%` }} /></div><div className="objective-list">{entry.objectives.map((objective) => <ObjectiveProgress key={objective.objectiveId} entry={entry} objective={objective} onSave={(value) => updateObjective.mutate({ progressId: entry.id, objectiveId: objective.objectiveId, value, version: entry.version })} />)}</div>{entry.authoritativeStatusHidden && <p className="muted">A conclusão autoritativa inclui objetivos não revelados.</p>}{isGm && entry.readyToComplete && entry.state === 'active' && <button className="primary" onClick={() => complete.mutate(entry.id)}>Concluir missão</button>}</article>)}</div>
    {progress.data?.length === 0 && <div className="state-card">Nenhum progresso relacionado.</div>}
  </>;
}

function ObjectiveProgress({ entry, objective, onSave }) {
  const [value, setValue] = useState(objective.value);
  const editable = objective.editable !== false && entry.state === 'active';
  return <div className="objective-progress"><code>{objective.objectiveId}</code><input type="number" min="0" value={value} disabled={!editable} onChange={(e) => setValue(Number(e.target.value))} /><button disabled={!editable || value === objective.value} onClick={() => onSave(value)}>Salvar</button>{objective.orphaned && <span className="warning-pill">órfão</span>}</div>;
}
