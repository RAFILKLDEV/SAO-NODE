import { describe, expect, it } from 'vitest';
import { normalizeEntity, toLegacyEntity } from '@sao/domain';
import { JSON_IMPORT_TEMPLATE } from '@sao/json';
import {
  createEntityDraft,
  draftControls,
  prepareCanonicalPayload,
  updateEntityDraft
} from './entityDraft.js';

describe('edição canônica', () => {
  it.each(JSON_IMPORT_TEMPLATE.entities.map((e) => [e.type, e.data]))(
    'abre e salva %s sem perder conteúdo',
    (type, data) => {
      const draft = createEntityDraft(type, { schemaVersion: '2.0', data });
      const edited = updateEntityDraft(type, {
        ...draftControls(type, draft),
        name: 'Nome editado'
      });
      expect(prepareCanonicalPayload(type, edited)).toEqual({ ...data, name: 'Nome editado' });
    }
  );

  it('preserva recompensas personalizadas e seus IDs após reordenar e editar', () => {
    const data = normalizeEntity('quest', {
      id: 'quest.custom',
      name: 'Missão',
      visibility: {},
      rewards: [
        { rewardId: 'permission', type: 'custom', data: { unlock: { area: 'porto' } } },
        { rewardId: 'coins', type: 'currency', currency: 'Col', amount: 12 }
      ]
    });
    const controls = draftControls('quest', data);
    controls.rewards.reverse();
    expect(prepareCanonicalPayload('quest', updateEntityDraft('quest', controls))).toEqual(data);
  });

  it('lê respostas v1 e preserva snapshots, links e sistemas de regras extras', () => {
    const data = normalizeEntity('monster', {
      id: 'monster.multi',
      name: 'Monstro',
      visibility: { entity: 'gm' },
      statBlocks: { 'Ambesek.T20': { nd: 3 }, custom: { resources: { hp: 12 } } },
      components: [{ id: 'a', kind: 'ability', data: { formula: { dice: '1d6' } } }]
    });
    const legacy = {
      ...toLegacyEntity('monster', data),
      entityType: 'monster',
      version: 4,
      backlinks: [],
      _technical: { baseVisibility: 'gm' }
    };
    expect(prepareCanonicalPayload('monster', createEntityDraft('monster', legacy))).toEqual(data);
  });
});
