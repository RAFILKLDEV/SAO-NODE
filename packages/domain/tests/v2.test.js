import { describe, expect, it } from 'vitest';
import {
  entitySchemas,
  migrateV1Entity,
  normalizeEntity,
  toLegacyEntity,
  validateEntityCatalog
} from '../src/index.js';

describe('contrato saoData v2', () => {
  it('rejeita campos v2 desconhecidos e arquiva dados legados não representáveis', () => {
    expect(() =>
      normalizeEntity('npc', { id: 'npc.x', name: 'X', visibility: {}, race: 'humano' })
    ).toThrow();
    const data = normalizeEntity(
      'npc',
      {
        id: 'npc.x',
        name: 'X',
        custom: { nested: [1, 2] },
        identity: { race: 'humano', origin: 'porto' },
        fields: [{ key: 'bio', value: 'Texto', author: 'GM' }],
        value: 12
      },
      { format: '1.0' }
    );
    expect(data.extensions.legacy).toEqual({ custom: { nested: [1, 2] }, value: 12 });
    expect(data.extensions.legacyNested).toEqual({
      identity: { origin: 'porto' },
      'fields.0': { author: 'GM' }
    });
  });

  it('bloqueia aliases conflitantes e permite resolução explícita com preservação', () => {
    const raw = { id: 'npc.x', name: 'X', subtitle: 'Prefeito', title: 'Veterano' };
    expect(() => normalizeEntity('npc', raw)).toThrow(/aliases/);
    const data = normalizeEntity('npc', raw, { conflicts: 'preserve' });
    expect(data.subtitle).toBe('Prefeito');
    expect(data.extensions.legacyConflicts[0]).toMatchObject({
      path: 'subtitle',
      values: ['Prefeito', 'Veterano']
    });
    expect(() =>
      normalizeEntity('location', {
        id: 'loc.x',
        name: 'X',
        connections: [{ connectionId: 'a', targetId: 'loc.a', to: 'loc.b' }]
      })
    ).toThrow(/aliases/);
  });

  it('converte aliases de missão, mídia, identidade, serviços e conexão', () => {
    const quest = normalizeEntity('quest', {
      id: 'quest.x',
      name: 'X',
      imageUrl: 'https://example.com/a.png',
      levelRecommended: 2,
      requirementsLogic: 'any',
      objectivesMode: 'free',
      objectives: [
        { id: 'a', type: 'custom', order: 1, quantity: 2 },
        {
          id: 'b',
          type: 'kill',
          order: 2,
          targetType: 'monster',
          targetId: 'monster.x',
          dependsOnObjectiveIds: ['a']
        }
      ],
      rewards: [{ type: 'item', id: 'item.x', quantity: 2 }]
    });
    expect(quest).toMatchObject({
      recommendedLevel: 2,
      requirementLogic: 'any',
      media: { image: 'https://example.com/a.png' }
    });
    expect(quest.objectives[1]).toMatchObject({
      objectiveId: 'b',
      dependsOn: ['a'],
      target: { type: 'monster', id: 'monster.x' }
    });
    expect(normalizeEntity('quest', toLegacyEntity('quest', quest))).toEqual(quest);
    const npc = normalizeEntity('npc', {
      id: 'npc.x',
      name: 'X',
      age: 30,
      profession: 'Ferreiro',
      services: [{ type: 'Forja' }],
      mainLocationId: 'loc.a',
      t20: { dataType: 'Ambesek.T20', snapshot: { custom: { spell: 'Fogo' } } }
    });
    expect(npc).toMatchObject({
      identity: { age: 30, profession: 'Ferreiro' },
      services: [{ name: 'Forja' }],
      character: { snapshot: { custom: { spell: 'Fogo' } } }
    });
    expect(npc.links[0]).toMatchObject({ id: 'loc.a', slot: 'locations' });
  });

  it('valida destinos e ciclos sem proibir referências de pacotes parciais', () => {
    expect(() =>
      normalizeEntity('quest', {
        id: 'quest.x',
        name: 'X',
        visibility: {},
        rewards: [{ rewardId: 'a', type: 'item', target: { type: 'item', id: 'npc.x' } }]
      })
    ).toThrow(/Namespace/);
    const location = (id, parentId) => ({
      type: 'location',
      data: normalizeEntity('location', { id, name: id, parentId, visibility: {} })
    });
    expect(() =>
      validateEntityCatalog([location('loc.a', 'loc.b'), location('loc.b', 'loc.a')])
    ).toThrow(/Ciclo/);
    expect(validateEntityCatalog([location('loc.a', 'loc.b')])[0].code).toBe(
      'UNRESOLVED_REFERENCE'
    );
    expect(() =>
      normalizeEntity('quest', {
        id: 'quest.x',
        name: 'X',
        visibility: {},
        objectives: [
          { objectiveId: 'a', type: 'custom', order: 1, dependsOn: ['b'] },
          { objectiveId: 'b', type: 'custom', order: 2, dependsOn: ['a'] }
        ]
      })
    ).toThrow(/Ciclo/);
  });
  it('converte aliases v1 para uma forma idempotente', () => {
    const input = {
      id: 'npc.f1.guia',
      name: 'Guia',
      imageURL: '',
      discoveryVisibility: 'discoverable',
      fields: [],
      references: [],
      services: ['Forja']
    };
    const first = normalizeEntity('npc', input, { format: '1.0' });
    const second = normalizeEntity('npc', first, { format: '2.0' });
    expect(second).toEqual(first);
    expect(first.media.image).toBe('');
    expect(first.services[0]).toEqual({ name: 'Forja', description: '' });
  });

  it('exige IDs estáveis e impede duplicação de componentes e objetivos', () => {
    expect(() =>
      entitySchemas.item.parse({
        id: 'item.x',
        name: 'x',
        fields: [
          { key: 'a', value: '' },
          { key: 'a', value: '' }
        ]
      })
    ).toThrow(/duplicada/i);
    expect(() =>
      entitySchemas.monster.parse({
        id: 'monster.x',
        name: 'x',
        components: [
          { id: 'bite', kind: 'attack', data: {} },
          { id: 'bite', kind: 'attack', data: {} }
        ]
      })
    ).toThrow(/duplicada/i);
  });

  it('preserva a projeção legada apenas na fronteira de compatibilidade', () => {
    const v2 = migrateV1Entity('monster', {
      id: 'monster.x',
      name: 'Javali',
      t20: { nd: '1', attributes: { strength: '+3' } },
      attacks: [{ id: 'bite', name: 'Mordida' }]
    });
    const legacy = toLegacyEntity('monster', v2);
    expect(v2.statBlocks['Ambesek.T20'].attributes.strength).toBe('+3');
    expect(legacy.attacks[0].data.name).toBe('Mordida');
  });
});
