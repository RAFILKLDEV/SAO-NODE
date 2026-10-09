import { describe, expect, it } from 'vitest';
import { normalizeEntity, normalizeLegacyDropFormulas, referenceGrantKey, rollDiceFormula, toLegacyEntity } from '../src/index.js';
import { parseSaoDataJson, exportSaoDataJson, saoDataJsonSchema } from '@sao/json';

const item = (valueFormula) => ({ type: 'item', data: normalizeEntity('item', { id: 'item.a', name: 'Material', category: 'material', valueFormula, visibility: {} }) });
const monster = (id, valueFormula) => ({ type: 'monster', data: normalizeEntity('monster', { id, name: id, links: [{ type: 'item', id: 'item.a', role: 'drops', valueFormula, visibility: 'discoverable' }] }) });
describe('item value formulas', () => {
  it.each([['1d4', 1, 4], ['2d6', 2, 12], ['3d4+3', 6, 15], ['1d20-2', -1, 18]])('validates and rolls %s with the existing dice engine', (formula, min, max) => {
    expect(item(formula).data.valueFormula).toBe(formula);
    expect(rollDiceFormula(formula, () => 0)).toBe(min);
    expect(rollDiceFormula(formula, () => 0.999)).toBe(max);
  });
  it('accepts a fixed numeric value without rolling dice', () => {
    expect(item('10').data.valueFormula).toBe('10');
    expect(rollDiceFormula('10')).toBe(10);
  });
  it.each(['invalid', '0d4', '1d0', '101d6', '2d10001', ''])('rejects invalid formula %s', formula => {
    expect(() => item(formula)).toThrow();
  });
  it('migrates agreeing legacy formulas without deleting fallback or overwriting the item', () => {
    const entries = [item(), monster('monster.a', '2D6'), monster('monster.b', '2d6')];
    normalizeLegacyDropFormulas(entries);
    expect(entries[0].data.valueFormula).toBe('2d6');
    expect(entries[1].data.links[0].valueFormula).toBe('2D6');
    entries[0].data.valueFormula = '3d4+3';
    normalizeLegacyDropFormulas(entries);
    expect(entries[0].data.valueFormula).toBe('3d4+3');
  });
  it('reports conflicting formulas including existing campaign references', () => {
    const entries = [item(), monster('monster.a', '2d6')], diagnostics = [];
    normalizeLegacyDropFormulas(entries, diagnostics, [monster('monster.b', '1d4')]);
    expect(entries[0].data.valueFormula).toBeUndefined();
    expect(diagnostics).toEqual([{ code: 'LEGACY_VALUE_FORMULA_CONFLICT', itemId: 'item.a', formulas: ['1d4', '2d6'] }]);
  });
  it('round-trips canonical and legacy item formulas and relation visibility through JSON', () => {
    const pack = { schemaVersion: '2.0', packId: 'test', name: 'Test', entities: [item('3d4+3'), monster('monster.a', '2d6')] };
    const first = parseSaoDataJson(pack).pack;
    const second = parseSaoDataJson(exportSaoDataJson(first)).pack;
    expect(second.entities).toEqual(first.entities);
    expect(toLegacyEntity('item', first.entities[0].data).valueFormula).toBe('3d4+3');
    const legacy = parseSaoDataJson({ ...pack, schemaVersion: '1.0', entities: first.entities.map(e => ({ type: e.type, data: toLegacyEntity(e.type, e.data) })) });
    expect(legacy.pack.entities[0].data.valueFormula).toBe('3d4+3');
    expect(legacy.pack.entities[1].data.links[0].visibility).toBe('discoverable');
  });
  it('publishes both additions in the JSON schema', () => {
    const variants = saoDataJsonSchema().properties.entities.items.oneOf;
    const fields = variants.find(e => e.properties.type.const === 'item').properties.data.properties;
    expect(fields.valueFormula.type).toBe('string');
    expect(fields.links.items.properties.visibility.enum).toEqual(expect.arrayContaining(['public', 'discoverable', 'gm']));
  });
  it('uses stable relation keys across alias normalization and child row recreation', () => {
    const link = { type: 'item', id: 'item.a', role: 'drop' };
    expect(referenceGrantKey('monster', 'monster.a', link)).toBe(referenceGrantKey('monster', 'monster.a', { ...link, role: 'drops', chance: 20, visibility: 'gm' }));
  });
});
