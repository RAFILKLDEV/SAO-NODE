import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router';
import { api } from '../lib/api.js';

export function PlayersPage() {
  const { campaignId } = useParams();
  const players = useQuery({ queryKey: ['memberships', campaignId], queryFn: () => api(`/api/v1/campaigns/${campaignId}/memberships`) });
  return <><div className="page-heading"><div><h1>Jogadores</h1><p>Memberships e IDs usados por vínculos e grupos.</p></div></div><div className="stack">{players.data?.map((entry) => <article className="card compact" key={entry.id}><div className="card-head"><div><strong>{entry.user.name}</strong><small>{entry.user.login}</small></div><span className="role-pill">{entry.role}</span></div><code>{entry.user.id}</code></article>)}</div></>;
}
