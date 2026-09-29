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
  it('round-trips supported fields and components semantically', () => {
    const source = {
      name: 'Guardião',
      sheet: {
        nd: 4, type: 'construct', subtype: 'none', size: 'large',
        combat: { initiative: 7, perception: 12, senses: 'visão no escuro', defense: 19, fortitude: 10, reflex: 8, will: 11, movement: '9m' },
        resources: { hp: 60, mp: 12 }, attributes: { strength: 5, dexterity: 2 }, resistances: { fire: 10 }
      },
      attacks: [{ data: { name: 'Espada', bonus: 8, damage: '1d8+5' } }],
      abilities: [{ data: { name: 'Sentinela', description: 'Protege a sala' } }]
    };
    const parsed = parseT20StatBlock(formatT20StatBlock(source));
    const sheet = parsed.statBlocks['Ambesek.T20'];
    expect(sheet.nd).toBe(4);
    expect(sheet.combat).toMatchObject({ initiative: 7, defense: 19, fortitude: 10, reflex: 8, will: 11, movement: '9m' });
    expect(sheet.resources).toEqual({ hp: 60, mp: 12 });
    expect(sheet.attributes).toMatchObject({ strength: 5, dexterity: 2 });
    expect(sheet.resistances.fire).toBe(10);
    expect(parsed.components.map((component) => component.kind)).toEqual(['attack', 'ability']);
    expect(parsed.extensions.t20Unparsed).toBeUndefined();
  });
  it('preserves the complete canonical sheet and all component kinds', () => {
    const statBlocks = { 'Ambesek.T20': {
      nd: '1/2', type: 'humanoid', subtype: 'goblinoid', size: 'small',
      combat: { initiative: 5, perception: 6, senses: ['faro', 'visão no escuro'], defense: 16, fortitude: 7, reflex: 8, will: 9 },
      resources: { hp: 20, hpMax: 20, mp: 0 },
      attributes: { strength: 1, dexterity: 2, constitution: 3, intelligence: -1, wisdom: 0, charisma: 4 },
      resistances: { fogo: 10, imunidades: ['medo', 'veneno'] }
    } };
    const components = [
      { kind: 'movement', data: { name: 'Terrestre', meters: 9 } },
      { kind: 'attack', data: { name: 'Lança', bonus: 8, damage: '1d8+3', critical: '19/x3', range: 'curto' } },
      { kind: 'ability', data: { name: 'Uivo', mpCost: 2, dc: 15, description: 'Medo; Vontade: anula.\n\nSegunda linha.' } },
      { kind: 'skill', data: { name: 'Furtividade', bonus: 5 } },
      { kind: 'trait', data: { name: 'Equipamento', items: ['Lança', 'Escudo'] } }
    ];
    const text = formatT20StatBlock({ name: 'Guardião goblin', statBlocks, components });
    const parsed = parseT20StatBlock(text);
    expect(parsed.name).toBe('Guardião goblin');
    expect(parsed.statBlocks).toEqual(statBlocks);
    expect(parsed.components.map(({ kind, data }) => ({ kind, data }))).toEqual(components);
    expect(parsed.extensions).toEqual({});
    expect(text).toContain('Humanoide');
    expect(text).not.toContain('[object Object]');
    expect(text).not.toContain('{');
    expect(formatT20StatBlock(parsed)).toBe(text);
  });
  it('handles missing fields and unknown fragments without retaining the complete text', () => {
    expect(parseT20StatBlock(formatT20StatBlock({ name: 'Sem ficha' }))).toEqual({ name: 'Sem ficha', statBlocks: { 'Ambesek.T20': {} }, components: [], extensions: {} });
    const parsed = parseT20StatBlock('Nome: Lobo\nCombate\nDefesa: 15\nRegra especial: Uivo\nLinha desconhecida');
    expect(parsed.extensions.t20Unparsed).toEqual(['Regra especial: Uivo', 'Linha desconhecida']);
    expect(parseT20StatBlock(formatT20StatBlock(parsed))).toEqual(parsed);
  });
  it('uses canonical components even when the list is empty', () => {
    const text = formatT20StatBlock({ name: 'Visível', statBlocks: { 'Ambesek.T20': { combat: { defense: 15 } } }, components: [], sheet: { combat: { defense: 99 } }, attacks: [{ data: { name: 'Segredo' } }] });
    expect(text).toContain('Defesa: 15');
    expect(text).not.toContain('99');
    expect(text).not.toContain('Segredo');
  });
});
