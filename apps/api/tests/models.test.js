import { describe, expect, it } from 'vitest';
import {
  collectOutboundReferences,
  filterKnownReferences,
  filterMonsterSheet,
  monsterOutputKeys,
  normalizeInput
  ,applyEntityChangeDocument
} from '../src/services/content.js';

const base = {
  active: true,
  discoveryVisibility: 'discoverable',
  discoveryRevision: 1,
  fields: { shortDescription: { value: 'Resumo', visibility: 'discoverable' } },
  tags: ['andar-1'],
  references: []
};

describe('complete specification models', () => {
  it('applies set/add/remove changes without replacing unrelated data', () => {
    const before = { id: 'monster.test', level: 2, hp: 15, locations: [{ type: 'location', id: 'loc.a' }] };
    const after = applyEntityChangeDocument(before, {
      set: { level: 4 },
      add: { locations: [{ type: 'location', id: 'loc.b' }] },
      remove: { locations: [{ type: 'location', id: 'loc.a' }] }
    });
    expect(after).toEqual({ id: 'monster.test', level: 4, hp: 15, locations: [{ type: 'location', id: 'loc.b' }] });
    expect(before.level).toBe(2);
  });
  it('shows a reference to a player only when the target entity is also known', () => {
    const references = [
      { type: 'npc', id: 'npc.known', name: 'Conhecido', available: true },
      { type: 'npc', id: 'npc.hidden', available: false }
    ];

    expect(filterKnownReferences(references, { gm: false })).toEqual([references[0]]);
    expect(filterKnownReferences(references, { gm: true })).toEqual(references);
  });

  it('uses the correct persisted collection name for monster abilities', () => {
    expect(monsterOutputKeys.ability).toBe('abilities');
  });

  it('inherits a granted monster module visibility in all of its fields', () => {
    const sheet = {
      nd: '2',
      type: 'animal',
      combat: { defense: '15', fortitude: '12', reflex: '5', will: '11' },
      statsVisibility: { basic: 'discoverable', combat: 'discoverable' }
    };
    const grants = [
      {
        subjectType: 'user',
        subjectId: 'player-1',
        targetKind: 'monster_stat',
        targetKey: 'basic',
        allowance: 'allow'
      },
      {
        subjectType: 'user',
        subjectId: 'player-1',
        targetKind: 'monster_stat',
        targetKey: 'combat',
        allowance: 'allow'
      }
    ];

    expect(
      filterMonsterSheet({
        sheet,
        request: {},
        context: { gm: false, userId: 'player-1', groups: [] },
        grants
      })
    ).toMatchObject({
      nd: '2',
      type: 'animal',
      combat: { defense: '15', fortitude: '12', reflex: '5', will: '11' }
    });
  });
  it('collects semantic links so every reference can be shown in both directions', () => {
    const references = collectOutboundReferences('monster', {
      id: 'monster.floor.boar',
      references: [{ type: 'location', id: 'loc.floor.field', role: 'found-in' }],
      rewards: [{ type: 'item', id: 'item.floor.hide' }]
    });

    expect(references).toEqual([
      { type: 'location', id: 'loc.floor.field', role: 'found-in' },
      { type: 'item', id: 'item.floor.hide', role: 'reward' }
    ]);
  });

  it('round-trips references whose optional chance comes back as null', () => {
    const npc = normalizeInput('npc', {
      ...base,
      id: 'npc.floor.blacksmith',
      name: 'Ferreiro',
      references: [{ type: 'item', id: 'item.floor.hammer', role: 'uses', chance: null }]
    });

    expect(npc.references[0]).toEqual({
      type: 'item',
      id: 'item.floor.hammer',
      role: 'uses',
      chance: undefined
    });
  });

  it('accepts the complete NPC shape', () => {
    const npc = normalizeInput('npc', {
      ...base,
      id: 'npc.floor.blacksmith',
      name: 'Ferreiro',
      level: '4',
      title: 'Mestre da Forja',
      imageURL: '',
      identity: { race: 'Humano', gender: 'Masculino', age: '44', profession: 'Ferreiro' },
      mainLocationId: 'loc.floor.town',
      currentLocationId: 'loc.floor.town',
      locations: [{ type: 'location', id: 'loc.floor.town' }],
      relations: [{ type: 'npc', id: 'npc.floor.guard', role: 'friend' }],
      services: [{ type: 'craft', name: 'Forja' }],
      t20: {
        mode: 'linked',
        dataType: 'Ambesek.T20',
        characterId: '42',
        firecastUri: 'firecast://character/42'
      }
    });
    expect(npc.identity.profession).toBe('Ferreiro');
    expect(npc.services[0]).toEqual({ name: 'Forja', description: '' });
    expect(npc.fields[0].key).toBe('shortDescription');
    expect(npc.baseVisibility).toBe('discoverable');
  });

  it('accepts Location, Item, Monster and Quest specification shapes', () => {
    const location = normalizeInput('location', {
      ...base,
      id: 'loc.floor.town',
      name: 'Cidade Inicial',
      type: 'city',
      parentId: '',
      levelRecommended: '1',
      state: 'safe',
      imageURL: '',
      services: [{ type: 'shop' }],
      connections: [
        {
          to: 'loc.floor.field',
          type: 'road',
          direction: 'norte',
          distanceKm: 1.8,
          travelMinutes: 20,
          visibility: 'discoverable'
        }
      ]
    });
    expect(location.connections[0]).toMatchObject({
      targetId: 'loc.floor.field',
      travelMinutes: 20
    });

    const item = normalizeInput('item', {
      ...base,
      id: 'item.floor.potion',
      name: 'Poção',
      category: 'consumable',
      rarity: 'common',
      imageURL: '',
      value: { amount: '50', currency: 'T$' },
      stats: [{ key: 'healing', value: '2d8+2', operation: 'restore' }]
    });
    expect(item.value.amount).toBe('50');

    const monster = normalizeInput('monster', {
      ...base,
      id: 'monster.floor.boar',
      name: 'Javali',
      group: 'beast',
      imageURL: '',
      t20: {
        nd: '1',
        creatureType: 'animal',
        subtype: 'javali',
        size: 'medium',
        initiative: '+5',
        perception: '+3',
        senses: 'far-reaching',
        defense: '16',
        fortitude: '+6',
        reflex: '+3',
        will: '+1',
        hp: '20',
        hpMax: '20',
        mp: '0',
        mpMax: '0',
        attributes: { strength: '+3', dexterity: '+1' },
        statVisibility: { attributes: 'discoverable' }
      },
      movements: [{ id: 'walk', type: 'walk', meters: '9', notes: '', visibility: 'discoverable' }],
      attacks: [
        {
          id: 'tusk',
          name: 'Presa',
          type: 'melee',
          bonus: '+7',
          damage: '1d8+3',
          critical: 'x2',
          damageType: 'piercing',
          range: '',
          quantity: '1',
          notes: '',
          visibility: 'discoverable'
        }
      ],
      abilities: [],
      skills: [
        { id: 'athletics', name: 'Atletismo', bonus: '+6', notes: '', visibility: 'discoverable' }
      ],
      traits: []
    });
    expect(monster.sheet.attributes.strength).toBe('+3');
    expect(monster.attacks[0].data.damage).toBe('1d8+3');

    const quest = normalizeInput('quest', {
      ...base,
      id: 'quest.floor.boars',
      name: 'Caça aos Javalis',
      imageURL: '/api/v1/campaigns/campaign-demo/media/00000000-0000-0000-0000-000000000000.gif',
      subtitle: 'Primeira missão',
      type: 'side',
      state: 'available',
      levelRecommended: '1',
      requirementsLogic: 'all',
      requirements: [{ type: 'level', minimum: '1' }],
      objectivesMode: 'ordered',
      objectives: [
        {
          id: 'kill-boars',
          type: 'kill',
          text: 'Derrote javalis',
          order: 1,
          quantity: 5,
          optional: false,
          secret: false,
          visibility: 'discoverable',
          targetType: 'monster',
          targetId: 'monster.floor.boar',
          dependsOnObjectiveIds: []
        }
      ],
      rewards: [{ type: 'item', id: 'item.floor.potion', quantity: '2' }]
    });
    expect(quest.objectiveMode).toBe('ordered');
    expect(quest.imageURL).toMatch(/\.gif$/);
    expect(quest.objectives[0]).toMatchObject({ objectiveId: 'kill-boars', requiredQuantity: 5 });
  });
});
