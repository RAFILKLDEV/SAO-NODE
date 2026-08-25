import React from 'react';
import { useOutletContext } from 'react-router';

export function SettingsPage() {
  const { campaign } = useOutletContext();
  return <><div className="page-heading"><div><h1>Configurações</h1><p>Metadados atuais da campanha.</p></div></div><div className="card"><dl className="definition-list"><dt>Nome</dt><dd>{campaign.name}</dd><dt>Slug</dt><dd><code>{campaign.slug}</code></dd><dt>Campaign ID</dt><dd><code>{campaign.id}</code></dd><dt>Papel atual</dt><dd>{campaign.role}</dd></dl></div><div className="card"><strong>Compatibilidade</strong><p>moduleId: <code>br.sao.rpg.firecast.database</code></p><p>dataType: <code>br.sao.rpg.database</code></p><p>T20: <code>Ambesek.T20</code> · legado aceito: <code>Ambesek.Tormenta20</code></p></div></>;
}
