import React, { useState } from 'react';
import { rollDiceFormula } from '@sao/domain';

export function MaterialValue({ formula }) {
  const [value, setValue] = useState(null);
  const [error, setError] = useState('');
  if (!formula) return null;
  const roll = () => {
    try { setValue(rollDiceFormula(formula)); setError(''); }
    catch { setValue(null); setError('Fórmula inválida. Use, por exemplo, 3d4+3.'); }
  };
  return <div className="material-value"><p>Valor variável: {formula} cash</p>
    <button type="button" onClick={roll}>{value == null ? 'Rolar valor' : 'Rerrolar'}</button>
    {value != null && <output aria-live="polite"> {value} cash</output>}
    {error && <p role="alert">{error}</p>}
  </div>;
}
