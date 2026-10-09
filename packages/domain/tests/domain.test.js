import { describe, expect, it } from 'vitest';
import {
  assertNamespacedId,
  buildLocationTree,
  calculateTravelMinutes,
  canPlayerUpdateObjective,
  evaluateGrant,
  evaluateQuestProgress,
  normalizeEntity,
  rollDrops,
  summarizeGroupVisibility
} from '../src/index.js';

describe('domain invariants', () => {
  it('permits updates to non-secret objectives independently of the legacy editing flag', () => {
    const quest = { objectives: [{ objectiveId: 'legacy', playerEditable: false }, { objectiveId: 'hidden', playerEditable: true, secret: true }] };
    expect(canPlayerUpdateObjective(quest, 'legacy')).toBe(true);
    expect(canPlayerUpdateObjective(quest, 'hidden')).toBe(false);
    expect(canPlayerUpdateObjective(quest, 'missing')).toBe(false);
  });
  it('validates namespaced ids', () => {
    expect(assertNamespacedId('npc', 'npc.f1.greenfields.ragnar')).toBe(true);
    expect(() => assertNamespacedId('npc', 'item.f1.bad')).toThrow();
    let invalidIdError;
    try {
      assertNamespacedId('monster', 'goblin');
    } catch (error) {
      invalidIdError = error;
    }
    expect(invalidIdError).toMatchObject({ code: 'INVALID_ENTITY_ID' });
    expect(invalidIdError.message).toContain('monster.');
  });

  it('calculates travel using 90m/min', () => {
    expect(calculateTravelMinutes(9)).toBe(100);
  });

  it('keeps orphan and cycle locations as roots with warnings', () => {
    const tree = buildLocationTree([
      { id: 'loc.a', name: 'A', parentId: 'loc.b' },
      { id: 'loc.b', name: 'B', parentId: 'loc.a' },
      { id: 'loc.c', name: 'C', parentId: 'loc.missing' }
    ]);
    expect(tree).toHaveLength(3);
    expect(tree.flatMap((node) => node.warnings)).toEqual(
      expect.arrayContaining(['cycle', 'orphan-parent'])
    );
  });

  it('rolls each drop independently', () => {
    const refs = [
      { type: 'item', id: 'item.a', role: 'drops', chance: 100 },
      { type: 'item', id: 'item.b', role: 'drops', chance: 1 }
    ];
    expect(rollDrops(refs, () => 0)).toHaveLength(2);
    expect(rollDrops(refs, () => 0.99)).toHaveLength(1);
  });

  it('adds a material quantity range for valid drops', () => {
    const refs = [{ type: 'item', id: 'item.material', role: 'drops', chance: 100, quantityMin: 30, quantityMax: 60 }];
    const rolled = rollDrops(refs, () => 0.1);

    expect(rolled).toHaveLength(1);
    expect(rolled[0].quantity).toBeGreaterThanOrEqual(30);
    expect(rolled[0].quantity).toBeLessThanOrEqual(60);
  });

  it('rolls a monster-specific quantity formula for drops', () => {
    const rolled = rollDrops([{ type: 'item', id: 'item.meat', role: 'drops', chance: 100, quantityFormula: '1d40' }], () => 0);
    expect(rolled[0].quantity).toBe(1);
    expect(rolled[0].quantityFormula).toBe('1d40');
  });

  it('respects an explicit quantity range over a formula', () => {
    const rolled = rollDrops([{ type: 'item', id: 'item.meat', role: 'drops', chance: 100, quantityMin: 7, quantityMax: 9, quantityFormula: '1d40' }], () => 0);
    expect(rolled[0].quantity).toBe(7);
  });

  it('preserves an item-level default quantity formula', () => {
    const item = normalizeEntity('item', { id: 'item.meat', name: 'Carne', quantityFormula: '1d20' }, { format: '2.0' });
    expect(item.quantityFormula).toBe('1d20');
  });

  it('preserves item-level quantity ranges', () => {
    const item = normalizeEntity('item', { id: 'item.meat', name: 'Carne', quantityMin: 2, quantityMax: 5 }, { format: '2.0' });
    expect(item.quantityMin).toBe(2);
    expect(item.quantityMax).toBe(5);
  });

  it('rolls a cash value formula for loot drops', () => {
    const rolled = rollDrops([{ type: 'item', id: 'item.gem', role: 'drops', chance: 100, valueFormula: '2d4+2' }], () => 0);
    expect(rolled[0].cashValue).toBe(4);
  });

  it('supports ordered quest blocking and optional objectives', () => {
    const quest = {
      objectiveMode: 'ordered',
      objectives: [
        { objectiveId: 'a', order: 1, requiredQuantity: 2, optional: false },
        { objectiveId: 'b', order: 2, requiredQuantity: 1, optional: false },
        { objectiveId: 'c', order: 3, requiredQuantity: 1, optional: true }
      ]
    };
    const state = evaluateQuestProgress(quest, { a: 1, b: 1 });
    expect(state.objectives.b.blocked).toBe(true);
    expect(state.readyToComplete).toBe(false);
  });

  it('reports partial progress from objective quantities', () => {
    const quest = {
      objectiveMode: 'free',
      objectives: [
        { objectiveId: 'boars', order: 1, requiredQuantity: 5, optional: false },
        { objectiveId: 'talk', order: 2, requiredQuantity: 1, optional: false }
      ]
    };

    expect(evaluateQuestProgress(quest, { boars: 2, talk: 0 }).percentage).toBe(33);
    expect(evaluateQuestProgress(quest, { boars: 5, talk: 1 }).percentage).toBe(100);
  });

  it('evaluates individual and group grants', () => {
    expect(
      evaluateGrant({
        baseVisibility: 'discoverable',
        isGm: false,
        userId: 'u1',
        groups: ['g1'],
        grants: [{ subjectType: 'group', subjectId: 'g1', allowance: 'allow' }]
      }).allowed
    ).toBe(true);
    expect(summarizeGroupVisibility([true, false])).toBe('partial');
    expect(summarizeGroupVisibility([])).toBe('empty');
  });
});

it('rejects invalid drop chances', () => {
  expect(() => rollDrops([{ type: 'item', id: 'item.a', role: 'drops', chance: 0 }])).toThrow();
  expect(() => rollDrops([{ type: 'item', id: 'item.a', role: 'drops', chance: 101 }])).toThrow();
});

it('does not require optional quest objectives for completion', () => {
  const quest = {
    objectiveMode: 'free',
    objectives: [
      { objectiveId: 'required', order: 1, requiredQuantity: 1, optional: false },
      { objectiveId: 'optional', order: 2, requiredQuantity: 99, optional: true }
    ]
  };
  expect(evaluateQuestProgress(quest, { required: 1 }).readyToComplete).toBe(true);
});
