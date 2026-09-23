import React from 'react';
import { useOutletContext } from 'react-router';

export function SettingsPage() {
  const { campaign } = useOutletContext();
  return <><div className="page-heading"><div><h1>Configurações</h1><p>Informações atuais da campanha.</p></div></div><div className="card"><dl className="definition-list"><dt>Nome</dt><dd>{campaign.name}</dd><dt>Papel atual</dt><dd>{campaign.role}</dd></dl></div><div className="card"><strong>Integração T20</strong><p>Compatibilidade habilitada para fichas atuais e legadas.</p></div></>;
}
