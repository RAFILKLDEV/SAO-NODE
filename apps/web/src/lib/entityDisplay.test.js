import { describe, expect, it } from 'vitest';
import { entitySubtitle, formatEntityName } from './entityDisplay.js';

describe('entity display names', () => {
  it.each([
    [{ name: 'Aria', title: 'Guia da cidade' }, 'Aria - (Guia da cidade)'],
    [{ name: 'Espada solar', subtitle: 'Lâmina ancestral' }, 'Espada solar - (Lâmina ancestral)'],
    [{ name: 'Guardião', subtitle: 'Protetor do portão' }, 'Guardião - (Protetor do portão)'],
    [{ name: 'Aincrad', subtitle: 'Cidade flutuante' }, 'Aincrad - (Cidade flutuante)'],
    [{ name: 'A primeira chave', subtitle: 'Capítulo um' }, 'A primeira chave - (Capítulo um)']
  ])('formats %s with its subtitle', (entity, expected) => {
    expect(formatEntityName(entity)).toBe(expected);
  });

  it('uses an existing character title and leaves names without subtitles unchanged', () => {
    expect(entitySubtitle({ title: 'Mercador' })).toBe('Mercador');
    expect(formatEntityName({ name: 'Poção' })).toBe('Poção');
    expect(formatEntityName(null, 'Indisponível')).toBe('Indisponível');
  });
});