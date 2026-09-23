import { describe, expect, it } from 'vitest';
import { normalizeInput } from '../../../api/src/services/content.js';
import { prepareEntityPayload } from './entityForm.js';

const base = (id, name) => ({
  id,
  name,
  active: true,
  discoveryRevision: 0,
  tags: ['teste'],
  source: { kind: 'local', modifiedLocally: true },
  sectionVisibility: { basic: 'discoverable', references: 'discoverable' },
  fields: {
    shortDescription: { value: 'Resumo', visibility: 'discoverable' },
    description: { value: '', visibility: 'discoverable' }
  },
  references: [{ type: 'item', id: 'item.teste', role: 'related' }, { type: 'npc', id: '', role: 'related' }]
});

const cases = {
  npc: {
    ...base('npc.teste', 'Personagem'),
    level: '2', title: 'Guia', imageURL: '',
    identity: { race: 'Humano', gender: 'Outro', age: '20', profession: 'Guia' },
    mainLocationId: 'loc.teste', currentLocationId: '',
    services: ['Hospedagem', ''],
    locations: [{ type: 'location', id: 'loc.teste', role: 'visited' }, { type: 'location', id: '', role: 'visited' }],
    relations: [{ type: 'location', id: 'loc.teste', role: 'related' }, { type: 'npc', id: '', role: 'related' }],
    t20: { mode: 'linked', dataType: 'Ambesek.T20', characterId: '42', firecastUri: 'firecast://character/42' }
  },
  location: {
    ...base('loc.teste', 'Local'), type: 'city', state: 'safe', parentId: '',
    environment: 'Urbano', levelRecommended: '2', imageURL: '', services: ['Loja', ''],
    connections: [
      { connectionId: 'loc.teste.connection.1', targetId: 'loc.destino', direction: 'norte', distanceKm: 1, travelMinutes: 10, access: 'public', visibility: 'discoverable' },
      { connectionId: 'loc.teste.connection.2', targetId: '', access: 'public', visibility: 'discoverable' }
    ]
  },
  item: {
    ...base('item.teste', 'Item'), category: 'weapon', rarity: 'rare', imageURL: '',
    value: { amount: 50, currency: 'T$' },
    stats: [{ key: 'dano', value: '1d8', operation: 'set' }, { key: '', value: '', operation: 'set' }]
  },
  monster: {
    ...base('monster.teste', 'Monstro'), group: 'feras', imageURL: '',
    sheet: { nd: '2', type: 'animal', subtype: 'none', size: 'medium', combat: { defense: '18' }, resources: { hp: '30' }, resistances: {}, attributes: { strength: '+4' }, statsVisibility: {} },
    movements: [{ id: 'walk', visibility: 'discoverable', data: { name: 'Caminhar', meters: '9' } }, { id: 'entry-2', visibility: 'discoverable', data: { name: '' } }],
    attacks: [{ id: 'bite', visibility: 'discoverable', data: { name: 'Mordida', damage: '1d6' } }], abilities: [], skills: [], traits: []
  },
  quest: {
    ...base('quest.teste', 'Missão'), imageURL: '', subtitle: 'Teste', type: 'side', state: 'available', levelRecommended: '2',
    requirementLogic: 'all', requirements: [{ type: 'item', id: 'item.teste' }], objectiveMode: 'free',
    objectives: [
      { objectiveId: 'quest.teste.objective.1', type: 'talk', text: 'Fale com o guia', order: 1, requiredQuantity: 1, optional: false, secret: false, visibility: 'discoverable', dependsOn: [], playerEditable: false },
      { objectiveId: 'quest.teste.objective.2', type: 'talk', text: '', order: 2, requiredQuantity: 1, optional: false, secret: false, visibility: 'discoverable', dependsOn: [], playerEditable: false }
    ],
    rewards: [{ type: 'item', id: 'item.teste', quantity: 1, target: { type: 'item', id: 'item.teste', role: 'reward' } }]
  }
};

describe('payload completo do editor de entidades', () => {
  for (const [type, input] of Object.entries(cases)) {
    it(`aceita todos os inputs de ${type} e remove linhas vazias`, () => {
      const payload = prepareEntityPayload(type, input);
      expect(() => normalizeInput(type, payload)).not.toThrow();
      expect(payload.references).toHaveLength(1);
      if (type === 'npc') expect(payload.relations).toContainEqual({ type: 'location', id: 'loc.teste', role: 'related' });
    });
  }

  it('preserva uma linha parcialmente preenchida para mostrar o erro correto', () => {
    const payload = prepareEntityPayload('item', {
      ...cases.item,
      stats: [{ key: '', value: '1d8', operation: 'set' }]
    });
    expect(() => normalizeInput('item', payload)).toThrow(/expected string/i);
  });

  it('não descarta um objetivo alterado que ainda precisa de correção', () => {
    const payload = prepareEntityPayload('quest', {
      ...cases.quest,
      objectives: [{
        objectiveId: 'objetivo-customizado', type: '', text: '', order: 1,
        requiredQuantity: 1, optional: false, secret: false, visibility: 'discoverable',
        dependsOn: [], playerEditable: false
      }]
    });
    expect(payload.objectives).toHaveLength(1);
    expect(() => normalizeInput('quest', payload)).toThrow();
  });

  it('remove objetivos vazios mesmo quando o nome da missão mudou depois de adicioná-los', () => {
    const payload = prepareEntityPayload('quest', {
      ...cases.quest,
      id: 'quest.nome-novo',
      objectives: [1, 2, 3].map((order) => ({
        objectiveId: `quest.nome-antigo.objective.${order}`,
        type: 'talk',
        text: '',
        order,
        requiredQuantity: 1,
        optional: false,
        secret: false,
        visibility: 'discoverable',
        dependsOn: [],
        playerEditable: false
      }))
    });

    expect(payload.objectives).toEqual([]);
    expect(() => normalizeInput('quest', payload)).not.toThrow();
  });

  it('aceita objetivo sem descrição quando há dados do objetivo', () => {
    const payload = prepareEntityPayload('quest', {
      ...cases.quest,
      objectives: [{
        objectiveId: 'quest.teste.objective.alvo', type: 'talk', text: '', order: 1,
        target: { type: 'npc', id: 'npc.guia' }, requiredQuantity: 1,
        optional: false, secret: false, visibility: 'discoverable', dependsOn: [], playerEditable: false
      }]
    });
    expect(() => normalizeInput('quest', payload)).not.toThrow();
  });

  it('mantém regiões na raiz da árvore de locais', () => {
    const payload = prepareEntityPayload('location', {
      ...cases.location,
      type: 'region',
      parentId: 'loc.andar-1.cidade-do-inicio'
    });

    expect(payload.parentId).toBe('loc.andar-1.cidade-do-inicio');
    expect(() => normalizeInput('location', payload)).not.toThrow();
  });

  it('remove referências incompletas de fluxo e dependências de objetivos removidos', () => {
    const payload = prepareEntityPayload('quest', {
      ...cases.quest,
      startSource: { type: 'npc', id: '', role: 'start' },
      completionReceiver: { type: '', id: 'npc.guia', role: 'completion' },
      nextQuests: ['quest.proxima', '', null],
      objectives: [{
        ...cases.quest.objectives[0],
        target: { type: 'npc', id: '' },
        dependsOn: ['quest.removida.objective.1', 'quest.teste.objective.1']
      }]
    });

    expect(payload.startSource).toBeUndefined();
    expect(payload.completionReceiver).toBeUndefined();
    expect(payload.nextQuests).toEqual(['quest.proxima']);
    expect(payload.objectives[0]).toMatchObject({ dependsOn: [] });
    expect(payload.objectives[0].target).toBeUndefined();
    expect(() => normalizeInput('quest', payload)).not.toThrow();
  });
});
