import React, { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useOutletContext, useParams } from 'react-router';
import { api } from '../lib/api.js';

const stateLabels = { active: 'Em andamento', completed: 'Concluída', failed: 'Falhou' };
export function groupPlayerMissions(entries, players, groups) {
  const owners = new Map(players.map((player) => [`player:${player.login}`, {
    character: { ...player, id: `player:${player.login}` }, entries: []
  }]));
  for (const entry of entries) {
    const key = `${entry.ownerType}:${entry.ownerId}`;
    if (!owners.has(key)) {
      const group = groups.find((item) => item.id === entry.ownerId);
      owners.set(key, { character: { id: key, name: entry.ownerType === 'group' ? group?.name ?? 'Seu grupo' : entry.ownerId }, entries: [] });
    }
    owners.get(key).entries.push(entry);
  }
  return [...owners.values()];
}

export function ProgressPage() {
  const { campaignId } = useParams();
  const { isGm } = useOutletContext();
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState('');
  const progress = useQuery({ queryKey: ['progress', campaignId], queryFn: () => api(`/api/v1/campaigns/${campaignId}/progress`) });
  const players = useQuery({ queryKey: ['progress-players', campaignId], queryFn: () => api(`/api/v1/campaigns/${campaignId}/progress/players`) });
  const groups = useQuery({ queryKey: ['groups', campaignId], queryFn: () => api(`/api/v1/campaigns/${campaignId}/groups`) });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['progress', campaignId] });
  const update = useMutation({
    mutationFn: ({ progressId, objectiveId, value, version }) => api(`/api/v1/campaigns/${campaignId}/progress/${progressId}/objectives/${encodeURIComponent(objectiveId)}`, { method: 'PATCH', body: { value, version } }),
    onSuccess: refresh,
    onError: (error) => { if (error.code === 'VERSION_CONFLICT') refresh(); }
  });
  const complete = useMutation({
    mutationFn: (id) => api(`/api/v1/campaigns/${campaignId}/progress/${id}/complete`, { method: 'POST', body: {} }),
    onSuccess: refresh
  });
  const missionGroups = useMemo(() => groupPlayerMissions(progress.data ?? [], players.data ?? [], groups.data ?? []), [progress.data, players.data, groups.data]);
  useEffect(() => {
    if (!missionGroups.some((group) => group.character.id === selectedId)) setSelectedId(missionGroups[0]?.character.id ?? '');
  }, [missionGroups, selectedId]);
  const selected = missionGroups.find((group) => group.character.id === selectedId);
  const error = progress.error || players.error || groups.error || update.error || complete.error;
  return <>
    <div className="page-heading"><div><small className="eyebrow">CAMPANHA</small><h1>Progresso e decisões</h1><p>Selecione um jogador para acompanhar suas missões e atualizar os objetivos liberados para edição.</p></div></div>
    {error && <div className="alert error" role="alert">{error.message}</div>}
    {(progress.isLoading || players.isLoading) && <div className="state-card">Carregando progresso…</div>}
    <section className="progress-characters" aria-label="Jogadores e missões">
      {missionGroups.map(({ character, entries }) => <button type="button" className={`progress-character-card ${character.id === selectedId ? 'selected' : ''}`} aria-pressed={character.id === selectedId} key={character.id} onClick={() => setSelectedId(character.id)}>
        <PlayerPhoto character={character} /><strong>{character.name}</strong>
        <span>{entries.length} {entries.length === 1 ? 'missão' : 'missões'}</span>
        <small>{entries.filter((entry) => entry.state === 'active').length} em andamento</small>
      </button>)}
    </section>
    {selected && <div className="stack">{selected.entries.map((entry) => <article className="module-card campaign-panel" key={entry.id}>
      <header><h3>{entry.questName ?? entry.questId}</h3><span className={`status ${entry.state}`}>{stateLabels[entry.state] ?? entry.state}</span></header>
      <div className="module-content progress-mission-entry">
        <div className="progress-entry-heading"><span>{selected.character.name}</span></div>
        <div className="progress-summary"><strong>Progresso</strong><span>{entry.percentage ?? 0}%</span></div>
        <div className="progress-track" role="progressbar" aria-label={`Progresso de ${entry.questName ?? 'missão'}`} aria-valuenow={entry.percentage ?? 0} aria-valuemin="0" aria-valuemax="100"><span style={{ width: `${Math.max(0, Math.min(100, entry.percentage ?? 0))}%` }} /></div>
        <div className="objective-list">{entry.objectives.map((objective) => <ObjectiveProgress key={`${entry.id}:${objective.objectiveId}`} entry={entry} objective={objective} pending={update.isPending} onSave={(value) => update.mutate({ progressId: entry.id, objectiveId: objective.objectiveId, value, version: entry.version })} />)}</div>
        {!entry.objectives.length && <p className="muted">Nenhum objetivo disponível.</p>}
        {entry.authoritativeStatusHidden && <p className="muted">A conclusão depende também de objetivos ainda não revelados.</p>}
        {isGm && entry.readyToComplete && entry.state === 'active' && <button className="primary" disabled={complete.isPending} onClick={() => complete.mutate(entry.id)}>Concluir missão</button>}
      </div>
    </article>)}</div>}
    {selected && !selected.entries.length && <div className="state-card">Este jogador ainda não possui missões.</div>}
    {!missionGroups.length && !progress.isLoading && !players.isLoading && !error && <div className="state-card">Nenhum jogador ou missão disponível.</div>}
  </>;
}
function PlayerPhoto({ character }) {
  const [failedUrl, setFailedUrl] = useState(null);
  return character.characterImageUrl && failedUrl !== character.characterImageUrl
    ? <img className="progress-player-photo" src={character.characterImageUrl} alt={`Personagem de ${character.name}`} onError={() => setFailedUrl(character.characterImageUrl)} />
    : <span className="progress-player-photo progress-player-placeholder" aria-hidden="true">{character.name?.slice(0, 1).toUpperCase() ?? '◇'}</span>;
}
export function ObjectiveProgress({ entry, objective, onSave, pending = false }) {
  const [value, setValue] = useState(objective.value ?? 0);
  useEffect(() => setValue(objective.value ?? 0), [objective.value, entry.version]);
  const editable = objective.editable !== false && entry.state === 'active';
  const requiredQuantity = objective.requiredQuantity ?? 1;
  return <div className="objective-progress">
    <span>{objective.text ?? 'Objetivo'}</span><strong>{value} / {requiredQuantity}</strong>
    <input aria-label={`Progresso de ${objective.text ?? 'objetivo'}`} type="number" min="0" max={requiredQuantity} step="1" value={value} disabled={!editable || pending} onChange={(event) => setValue(Math.max(0, Math.min(requiredQuantity, Math.trunc(Number(event.target.value)))))} />
    <button disabled={!editable || pending || value === objective.value} onClick={() => onSave(value)}>{pending ? 'Salvando…' : 'Salvar'}</button>
    {objective.optional && <small>Opcional</small>}
    {!editable && entry.state === 'active' && <small>Edição indisponível: objetivo bloqueado ou reservado ao mestre.</small>}
  </div>;
}
