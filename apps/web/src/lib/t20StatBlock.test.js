import { describe, expect, it } from 'vitest';
import { formatT20StatBlock, parseT20StatBlock } from './t20StatBlock.js';

describe('T20 stat blocks', () => {
  it('formats known fields and components without JSON', () => {
    const text = formatT20StatBlock({ name: 'Lobo', sheet: { nd: 2, combat: { defense: 15 }, attributes: { strength: 3 } }, attacks: [{ id: 'bite', data: { name: 'Mordida', damage: '1d6' } }] });
    expect(text).toContain('Lobo');
    expect(text).toContain('Defesa: 15');
    expect(text).toContain('Força: 3');
  });
  it('preserves unknown lines while parsing known values', () => {
    const parsed = parseT20StatBlock('Defesa: 15\nRegra especial: Uivo');
    expect(parsed.statBlocks['Ambesek.T20'].combat.defense).toBe(15);
    expect(parsed.extensions.t20Unparsed).toEqual(['Regra especial: Uivo']);
  });
});
