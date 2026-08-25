import { describe, expect, it } from 'vitest';
import { normalizeInput } from '../src/services/content.js';

const base = {
  active: true,
  discoveryVisibility: 'discoverable',
  discoveryRevision: 1,
  fields: { shortDescription: { value: 'Resumo', visibility: 'discoverable' } },
  tags: ['andar-1'],
  references: []
};

describe('complete specification models', () => {
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
    expect(quest.objectives[0]).toMatchObject({ objectiveId: 'kill-boars', requiredQuantity: 5 });
  });
});
