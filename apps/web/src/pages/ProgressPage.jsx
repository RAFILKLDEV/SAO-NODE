import React, { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useOutletContext, useParams } from 'react-router';
import { api } from '../lib/api.js';
import { formatEntityName } from '../lib/entityDisplay.js';

const progressStateLabels = { active: 'Em andamento', completed: 'ConcluÃƒÂ­da', failed: 'Falhou' };

export function ProgressPage() {
  const { campaignId } = useParams();
  const { isGm } = useOutletContext();
  const queryClient = useQueryClient();
  const [selectedCharacterId, setSelectedCharacterId] = useState('');
  const progress = useQuery({ queryKey: ['progress', campaignId], queryFn: () => api(`/api/v1/campaigns/${campaignId}/progress`) });
  const quests = useQuery({ queryKey: ['entities', campaignId, 'quest'], queryFn: () => api(`/api/v1/campaigns/${campaignId}/quests?pageSize=100`) });
  const memberships = useQuery({ queryKey: ['memberships', campaignId], queryFn: () => api(`/api/v1/campaigns/${campaignId}/memberships`), enabled: isGm });
  const groups = useQuery({ queryKey: ['groups', campaignId], queryFn: () => api(`/api/v1/campaigns/${campaignId}/groups`), enabled: isGm });
  const updateObjective = useMutation({
    mutationFn: ({ progressId, objectiveId, value, version }) => api(`/api/v1/campaigns/${campaignId}/progress/${progressId}/objectives/${encodeURIComponent(objectiveId)}`, { method: 'PATCH', body: { value, version } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['progress', campaignId] })
  });
  const complete = useMutation({
    mutationFn: (progressId) => api(`/api/v1/campaigns/${campaignId}/progress/${progressId}/complete`, { method: 'POST', body: {} }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['progress', campaignId] })
  });
  const missionGroups = useMemo(() => {
    const questMap = new Map((quests.data?.items ?? []).map((quest) => [quest.id, quest]));
    const owners = new Map();
    (progress.data ?? []).forEach((entry) => {
      const ownerKey = `${entry.ownerType}:${entry.ownerId}`;
      if (!owners.has(ownerKey)) {
        const owner = entry.ownerType === 'group'
          ? (groups.data ?? []).find((group) => group.id === entry.ownerId)
          : (memberships.data ?? []).find((membership) => membership.user.login === entry.ownerId)?.user;
        owners.set(ownerKey, { character: { id: ownerKey, name: owner?.name ?? entry.ownerId }, missions: [], entries: [] });
      }
      const group = owners.get(ownerKey);
      const quest = questMap.get(entry.questId);
      if (quest && !group.missions.some((mission) => mission.id === quest.id)) group.missions.push(quest);
      group.entries.push(entry);
    });
    return [...owners.values()];
  }, [progress.data, quests.data, memberships.data, groups.data]);
  useEffect(() => {
    if (!selectedCharacterId && missionGroups.length) setSelectedCharacterId(missionGroups[0].character.id);
    if (selectedCharacterId && !missionGroups.some((group) => group.character.id === selectedCharacterId)) setSelectedCharacterId(missionGroups[0]?.character.id ?? '');
  }, [missionGroups, selectedCharacterId]);
  const selected = missionGroups.find((group) => group.character.id === selectedCharacterId);
  const ownerName = (entry) => !isGm ? (entry.ownerType === 'group' ? 'Seu grupo' : 'VocÃƒÂª') : entry.ownerType === 'group' ? (groups.data ?? []).find((group) => group.id === entry.ownerId)?.name ?? 'Grupo indisponÃƒÂ­vel' : (memberships.data ?? []).find((membership) => membership.user.login === entry.ownerId)?.user.name ?? 'Jogador indisponÃƒÂ­vel';

  return <>
    <div className="page-heading"><div><small className="eyebrow">RUNTIME DA CAMPANHA</small><h1>Progresso</h1><p>Selecione um personagem para consultar as missÃƒÂµes ligadas a ele.</p></div></div>
    {missionGroups.length > 0 && <section className="progress-characters" aria-label="Personagens com missÃƒÂµes">{missionGroups.map(({ character, missions }) => <button type="button" className={`progress-character-card ${character.id === selectedCharacterId ? 'selected' : ''}`} key={character.id} onClick={() => setSelectedCharacterId(character.id)}><strong>{formatEntityName(character)}</strong><span>{missions.length} {missions.length === 1 ? 'missÃƒÂ£o' : 'missÃƒÂµes'}</span></button>)}</section>}
    {progress.isLoading && <div className="state-card">Carregando progressoÃ¢â‚¬Â¦</div>}
    {selected && <div className="stack">{selected.missions.map((quest) => { const questEntries = selected.entries.filter((entry) => entry.questId === quest.id); const currentObjectiveIds = new Set((quest.objectives ?? []).map((objective) => objective.objectiveId)); return <article className="module-card campaign-panel" key={quest.id}><header><div><h3 title={formatEntityName(quest)}>{formatEntityName(quest)}</h3><small>{questEntries.length ? `${questEntries.length} progresso(s)` : 'Sem progresso iniciado'}</small></div></header>{questEntries.map((entry) => <div className="module-content progress-mission-entry" key={entry.id}><div className="progress-entry-heading"><span>{entry.ownerType === 'group' ? 'Grupo' : 'Jogador'}: {ownerName(entry)}</span><span className={`status ${entry.state}`}>{progressStateLabels[entry.state] ?? entry.state}</span></div><div className="progress-summary"><strong>Progresso</strong><span>{entry.percentage ?? 0}%</span></div><div className="progress-track" role="progressbar" aria-valuenow={entry.percentage ?? 0} aria-valuemin="0" aria-valuemax="100"><span style={{ width: `${Math.max(0, Math.min(100, entry.percentage ?? 0))}%` }} /></div><div className="objective-list">{entry.objectives.filter((objective) => currentObjectiveIds.has(objective.objectiveId) && objective.text !== 'Objetivo removido').map((objective) => <ObjectiveProgress key={objective.objectiveId} entry={entry} objective={objective} onSave={(value) => updateObjective.mutate({ progressId: entry.id, objectiveId: objective.objectiveId, value, version: entry.version })} />)}</div>{entry.authoritativeStatusHidden && <p className="muted">A conclusÃƒÂ£o autoritativa inclui objetivos nÃƒÂ£o revelados.</p>}{isGm && entry.readyToComplete && entry.state === 'active' && <button className="primary" onClick={() => complete.mutate(entry.id)}>Concluir missÃƒÂ£o</button>}</div>)}</article>; })}</div>}
    {!missionGroups.length && !progress.isLoading && <div className="state-card">Nenhum personagem possui missÃƒÂ£o.</div>}
  </>;
}

function ObjectiveProgress({ entry, objective, onSave }) {
  const [value, setValue] = useState(objective.value ?? 0);
  useEffect(() => setValue(objective.value ?? 0), [objective.value]);
  const editable = objective.editable !== false && entry.state === 'active';
  const requiredQuantity = objective.requiredQuantity ?? 1;
  return <div className="objective-progress"><span>{objective.text ?? 'Objetivo'}</span><strong>{value} / {requiredQuantity}</strong><input aria-label={`Progresso de ${objective.text ?? 'objetivo'}`} type="number" min="0" max={requiredQuantity} value={value} disabled={!editable} onChange={(e) => setValue(Math.max(0, Math.min(requiredQuantity, Number(e.target.value))))} /><button disabled={!editable || value === objective.value} onClick={() => onSave(value)}>Salvar</button>{objective.optional && <small>Opcional</small>}{objective.orphaned && <span className="warning-pill">ÃƒÂ³rfÃƒÂ£o</span>}</div>;
}
