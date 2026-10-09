import { describe, expect, it } from 'vitest';
import { formatMonsterSheet, formatMonsterSheets } from './monsterSheet.js';

describe('monster sheet export', () => {
  it('keeps multiline original text and complete component descriptions', () => {
    const original = 'Linha 1\nAção: Bola de Fogo (6d6)\nFórmula: 1d20+12';
    const entity = { name: 'Golem', sheet: { nd: '8', attributes: { For: 20 } }, fields: { originalSheet: original }, abilities: [{ id: 'a', data: { name: 'Resistência', description: 'Descrição longa\ncom duas linhas.' } }] };
    const text = formatMonsterSheet(entity);
    expect(text).toContain(original);
    expect(text).toContain('Descrição longa\ncom duas linhas.');
    expect(formatMonsterSheet(entity, { format: 'md' })).toContain('## Texto original');
  });

  it('exports multiple monsters with an explicit separator', () => {
    const text = formatMonsterSheets([{ name: 'A' }, { name: 'B' }]);
    expect(text).toContain('A');
    expect(text).toContain('====================');
    expect(text).toContain('B');
  });

  it('accepts legacy object fields without coercing text into characters', () => {
    expect(formatMonsterSheet({ name: 'Lobo', fields: { originalSheet: 'Linha única' } })).toContain('Linha única');
  });
});
