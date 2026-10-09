import React from 'react';
import { formatT20Ally, t20AllyBenefit, t20AllyOptions } from '@sao/domain';
import './T20Allies.css';

export function T20AlliesEditor({ value = [], onChange }) {
  const update = (index, choice) => {
    const next = [...value];
    if (choice) { const [type, rank] = choice.split(':'); next[index] = { type, rank }; }
    else next.splice(index, 1);
    onChange(next.filter(Boolean));
  };
  return <fieldset className="t20-allies-editor">
    <legend>Aliado · Tormenta20</legend>
    <p className="muted">Até dois tipos diferentes. Escolha os benefícios que este personagem oferece como aliado.</p>
    <div className="t20-allies-choices">{[0, 1].map(index => {
      const ally = value[index];
      const other = value[1 - index];
      return <label key={index}>Tipo de aliado {index + 1}{index === 1 ? ' (opcional)' : ''}
        <select aria-label={`Tipo de aliado ${index + 1}`} disabled={index === 1 && !value[0]} value={ally ? `${ally.type}:${ally.rank}` : ''} onChange={event => update(index, event.target.value)}>
          <option value="">Nenhum</option>
          {t20AllyOptions.filter(option => option.type !== other?.type).map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>
        {ally && <small>{t20AllyBenefit(ally)}</small>}
      </label>;
    })}</div>
  </fieldset>;
}

export function T20Allies({ value = [] }) {
  if (!value.length) return null;
  return <section className="t20-allies" aria-label="Aliado Tormenta20">
    <h4>Aliado · Tormenta20</h4>
    <ul>{[...value].sort((first, second) => formatT20Ally(first).localeCompare(formatT20Ally(second), 'pt-BR')).map(ally => <li key={ally.type}>
      <strong>{formatT20Ally(ally)}</strong><p>{t20AllyBenefit(ally)}</p>
    </li>)}</ul>
  </section>;
}
