import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
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

  it('keeps originalSheet whitespace, Unicode and mixed line endings intact', () => {
    const original = '  Defesa 18\r\n\tAção: Ímpeto  \r\n\r\nFim da ficha  ';
    const output = formatMonsterSheet({ name: 'Lobo', fields: { originalSheet: original } });
    const recovered = output.slice(output.indexOf('TEXTO ORIGINAL\n\n') + 'TEXTO ORIGINAL\n\n'.length, -1);
    expect(recovered).toBe(original);
    expect(createHash('sha256').update(recovered, 'utf8').digest('hex'))
      .toBe(createHash('sha256').update(original, 'utf8').digest('hex'));
  });

  it('renders drops and references as readable sections', () => {
    const text = formatMonsterSheet({
      id: 'monster.lobo',
      name: 'Lobo',
      links: [
        { type: 'item', id: 'item.presa', role: 'drops', chance: 50, quantityFormula: '1d4' },
        { type: 'location', id: 'loc.floresta', role: 'found-in' }
      ],
      fields: [{ key: 'customNote', value: 'Texto adicional' }]
    });
    expect(text).toContain('DROPS');
    expect(text).toContain('REFERÊNCIAS');
    expect(text).toContain('customNote: Texto adicional');
    expect(text).not.toContain('"quantityFormula"');
  });
});
