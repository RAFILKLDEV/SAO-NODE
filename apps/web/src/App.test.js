import { categorizedDiscoveryTargets, categorizedDiscoveryTypes } from './lib/discoveryTargets.js';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { resolveCampaignLinks } from './lib/campaignLinks.js';
import { hasRenderableContent } from './lib/entityContent.js';
import {
  ReferenceCombobox,
  buildBulkEntityDiscoveryRequest,
  buildDiscoveryGrantBatch,
  canOpenReference,
  canConfirmDiscoveryGrant,
  chunkDiscoveryGrants,
  isDropReference,
  monsterComponentTargets,
  monsterNdLabel
} from './pages/EntityPage.jsx';
import {
  collectPermissionChangeEntities,
  getEntityChangeState,
  readEntityActivityAt,
  setEntityActivityAt
} from './lib/notifications.js';
import {
  resolveLocationBulkEntities,
  resolveLocationMenuClick,
  resolveLocationMenuEntries,
  resolveLocationMenuRegions,
  resolveLocationMenuState,
  shouldShowLocationList
} from './lib/locationMenu.js';
import { locationBranchEntries, locationDiscoveryRows } from './lib/locationDiscovery.js';

describe('reference list rendering', () => {
  const renderCombobox = (props) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return renderToStaticMarkup(
      React.createElement(
        QueryClientProvider,
        { client },
        React.createElement(
          MemoryRouter,
          null,
          React.createElement(ReferenceCombobox, props)
        )
      )
    );
  };

  it('renders related references as a list instead of a combobox', () => {
    const markup = renderCombobox({
      campaignId: 'camp-1',
      label: 'Registro relacionado',
      references: [
        { type: 'location', id: 'loc.a', name: 'Cidade A', available: true },
        { type: 'monster', id: 'monster.b', name: 'Goblin', available: true }
      ]
    });

    expect(markup).toContain('<ul');
    expect(markup).not.toContain('<select');
  });

  it('exposes the monster ND in the list metadata', () => {
    expect(monsterNdLabel({ sheet: { nd: '3' } })).toBe('ND 3');
    expect(monsterNdLabel({ t20: { nd: '5' } })).toBe('ND 5');
    expect(monsterNdLabel({})).toBe('');
  });

  it('renders drop references with the drop label and chance percentage', () => {
    const markup = renderCombobox({
      campaignId: 'camp-1',
      label: 'Drop possível',
      references: [{ type: 'item', id: 'item.potion', name: 'Poção', role: 'drops', chance: 25, available: true }]
    });

    expect(markup).toContain('Drop');
    expect(markup).toContain('25%');
  });

  it('renders material drop quantity ranges when configured', () => {
    const markup = renderCombobox({
      campaignId: 'camp-1',
      label: 'Drop possível',
      references: [{
        type: 'item',
        id: 'item.ore',
        name: 'Minério',
        category: 'material',
        role: 'drops',
        chance: 50,
        quantityMin: 30,
        quantityMax: 60,
        available: true
      }]
    });

    expect(markup).toContain('30');
    expect(markup).toContain('60');
  });

  it('keeps drops separate from generic references', () => {
    expect(isDropReference({ role: 'drops' })).toBe(true);
    expect(isDropReference({ role: 'drop' })).toBe(true);
    expect(isDropReference({ role: 'referenciado por · drops' })).toBe(true);
    expect(isDropReference({ role: 'related' })).toBe(false);
  });
});

describe('location menu hierarchy', () => {
  it('includes root cities among the possible regions of a floor', () => {
    const items = [
      { id: 'loc.andar-1.cidade-do-inicio', type: 'city', placement: { floor: '1' }, name: 'Cidade do Inicio' },
      { id: 'loc.andar-1.planicies-verdejantes', type: 'region', placement: { floor: '1' }, name: 'Planicies Verdejantes' },
      {
        id: 'loc.andar-1.cidade-do-inicio.banco',
        type: 'building',
        name: 'Banco',
        parentId: 'loc.andar-1.cidade-do-inicio'
      }
    ];

    expect(resolveLocationMenuRegions({ items })).toMatchObject([
      { id: 'loc.andar-1.cidade-do-inicio', type: 'city' },
      { id: 'loc.andar-1.planicies-verdejantes', type: 'region' }
    ]);
  });

  it('uses a root city as the navigation region for its locations', () => {
    const items = [
      { id: 'loc.andar-1.cidade-do-inicio', type: 'city', placement: { floor: '1' }, name: 'Cidade do Inicio' },
      {
        id: 'loc.andar-1.cidade-do-inicio.banco',
        type: 'building',
        name: 'Banco',
        parentId: 'loc.andar-1.cidade-do-inicio'
      }
    ];

    expect(resolveLocationMenuState({ items, selectedId: 'loc.andar-1.cidade-do-inicio.banco' })).toMatchObject({
      floor: '1',
      region: 'loc.andar-1.cidade-do-inicio',
      city: 'loc.andar-1.cidade-do-inicio'
    });
    expect(resolveLocationMenuEntries({ items, selectedRegion: 'loc.andar-1.cidade-do-inicio' })).toMatchObject([
      { id: 'loc.andar-1.cidade-do-inicio.banco', type: 'building' }
    ]);
  });
});

describe('resolveCampaignLinks', () => {
  it('allows a player to open a reference when its target is known', () => {
    expect(
      canOpenReference({ type: 'item', id: 'item.known', name: 'Item conhecido', available: true })
    ).toBe(true);
    expect(canOpenReference({ type: 'item', id: 'item.hidden', available: false })).toBe(false);
  });

  it('oculta categorias sem registros visíveis para jogador', () => {
    const result = resolveCampaignLinks({
      isGm: false,
      visibleEntityTypes: new Set(['npcs', 'quests'])
    });

    expect(result.map(([path]) => path)).toEqual(['npcs', 'quests', 'progress', 'groups']);
  });

  it('mantém todas as categorias para mestre', () => {
    const result = resolveCampaignLinks({ isGm: true, visibleEntityTypes: new Set() });

    expect(result.map(([path]) => path)).toEqual(['npcs', 'locations', 'items', 'monsters', 'quests', 'progress', 'groups']);
  });

  it('oculta seções sem conteúdo visível no detalhe da entidade', () => {
    expect(hasRenderableContent({ race: '', gender: '', age: '', profession: '' })).toBe(false);
    expect(hasRenderableContent({ race: 'Humano', age: '' })).toBe(true);
    expect(hasRenderableContent([{ type: 'location', id: 'loc.1', available: false }])).toBe(false);
    expect(hasRenderableContent({ value: { type: 'location', id: 'loc.1' } })).toBe(false);
    expect(hasRenderableContent([{ value: { type: 'location', id: 'loc.1' } }])).toBe(false);
  });

  it('marca conteúdo recém-criado como novo até ser visualizado', () => {
    const state = getEntityChangeState(
      { id: 'npc.alpha', createdAt: '2026-08-31T10:00:00.000Z', updatedAt: '2026-08-31T10:00:00.000Z' },
      '2026-08-30T12:00:00.000Z'
    );

    expect(state).toMatchObject({ kind: 'new' });
  });

  it('marca conteúdo atualizado como editado quando houve alteração após a última visualização', () => {
    const state = getEntityChangeState(
      { id: 'npc.alpha', createdAt: '2026-08-30T10:00:00.000Z', updatedAt: '2026-08-31T11:15:00.000Z' },
      '2026-08-31T10:00:00.000Z'
    );

    expect(state).toMatchObject({ kind: 'edited' });
  });

  it('marca qualquer conteúdo novo ou editado quando ainda não existe marca de visualização', () => {
    const now = Date.now();
    const freshEntity = {
      id: 'npc.alpha',
      createdAt: new Date(now - 60 * 60 * 1000).toISOString(),
      updatedAt: new Date(now - 30 * 60 * 1000).toISOString()
    };
    const oldEntity = {
      id: 'npc.old',
      createdAt: new Date(now - 10 * 24 * 60 * 60 * 1000).toISOString(),
      updatedAt: new Date(now - 9 * 24 * 60 * 60 * 1000).toISOString()
    };

    expect(getEntityChangeState(freshEntity, 0)).toMatchObject({ kind: 'edited' });
    expect(getEntityChangeState({ ...freshEntity, createdAt: freshEntity.updatedAt }, 0)).toMatchObject({ kind: 'new' });
    expect(getEntityChangeState(oldEntity, 0)).toMatchObject({ kind: 'edited' });
  });

  it('marca como editado quando a liberação de acesso cria uma atividade nova para o jogador', () => {
    const entity = {
      id: 'loc.city',
      createdAt: '2026-08-20T00:00:00.000Z',
      updatedAt: '2026-08-20T00:00:00.000Z'
    };

    expect(getEntityChangeState(entity, '2026-08-20T00:00:00.000Z', '2026-08-30T12:00:00.000Z')).toMatchObject({ kind: 'edited' });
    expect(getEntityChangeState(entity, '2026-08-30T12:00:00.000Z', '2026-08-30T12:00:00.000Z')).toBeNull();
  });

  it('extrai entidades afetadas de eventos de permissão em lote', () => {
    const payload = {
      reason: 'batch',
      count: 2,
      entities: [
        { entityType: 'monster', entityId: 'monster.golem' },
        { entityType: 'item', entityId: 'item.espada' }
      ]
    };

    expect(collectPermissionChangeEntities(payload)).toEqual([
      { entityType: 'monster', entityId: 'monster.golem' },
      { entityType: 'item', entityId: 'item.espada' }
    ]);
  });

  it('aceita payloads de permissão em lote vindos do backend com entityDomainId', () => {
    const payload = {
      reason: 'batch',
      count: 2,
      entities: [
        { entityType: 'monster', entityDomainId: 'monster.golem' },
        { entityType: 'item', entityDomainId: 'item.espada' }
      ]
    };

    expect(collectPermissionChangeEntities(payload)).toEqual([
      { entityType: 'monster', entityId: 'monster.golem' },
      { entityType: 'item', entityId: 'item.espada' }
    ]);
  });

  it('mantém a última atividade de permissão e lê o valor legado gravado anteriormente', () => {
    const campaignId = 'camp-1';
    const type = 'item';
    const entityId = 'item.espada';
    const legacyKey = `sao-entity-granted:${campaignId}:${type}:${entityId}`;
    const key = `sao-entity-activity:${campaignId}:${type}:${entityId}`;
    const storage = new Map();
    const previousWindow = globalThis.window;
    globalThis.window = { localStorage: { getItem: (name) => storage.get(name) ?? null, setItem: (name, value) => storage.set(name, String(value)), removeItem: (name) => storage.delete(name) } };

    try {
      storage.set(legacyKey, '1700000000000');
      expect(readEntityActivityAt({ campaignId, type, entityId })).toBe(1700000000000);

      setEntityActivityAt({ campaignId, type, entityId, at: 1800000000000, reason: 'permission' });
      expect(JSON.parse(storage.get(key)).activityAt).toBe(1800000000000);
    } finally {
      globalThis.window = previousWindow;
    }
  });

  it('mantém a cidade de início selecionada quando a rota já aponta para um local dentro da região', () => {
    const items = [
      { id: 'loc.andar-1', type: 'region', placement: { floor: '1' }, name: 'Cidade do Início', parentId: null },
      { id: 'loc.andar-1.cidade-do-inicio', type: 'city', placement: { floor: '1' }, name: 'Cidade do Início', parentId: 'loc.andar-1' },
      { id: 'loc.andar-1.cidade-do-inicio.banco', type: 'bank', name: 'Banco', parentId: 'loc.andar-1.cidade-do-inicio' }
    ];

    expect(resolveLocationMenuState({ items, selectedId: 'loc.andar-1.cidade-do-inicio.banco' })).toMatchObject({
      floor: '1',
      region: 'loc.andar-1',
      city: 'loc.andar-1.cidade-do-inicio'
    });
  });

  it('inclui locais aninhados dentro da cidade de início ao montar o submenu da região', () => {
    const items = [
      { id: 'loc.andar-1', type: 'region', placement: { floor: '1' }, name: 'Cidade do Início', parentId: null },
      { id: 'loc.andar-1.cidade-do-inicio', type: 'city', placement: { floor: '1' }, name: 'Cidade do Início', parentId: 'loc.andar-1' },
      { id: 'loc.andar-1.cidade-do-inicio.banco', type: 'bank', name: 'Banco', parentId: 'loc.andar-1.cidade-do-inicio' },
      { id: 'loc.andar-1.cidade-do-inicio.taverna', type: 'tavern', name: 'Taverna', parentId: 'loc.andar-1.cidade-do-inicio' }
    ];

    expect(resolveLocationMenuEntries({ items, selectedRegion: 'loc.andar-1' })).toMatchObject([
      { id: 'loc.andar-1.cidade-do-inicio', type: 'city' },
      { id: 'loc.andar-1.cidade-do-inicio.banco', type: 'bank' },
      { id: 'loc.andar-1.cidade-do-inicio.taverna', type: 'tavern' }
    ]);
  });

  it('limita a liberação em lote aos locais da região selecionada', () => {
    const items = [
      { id: 'loc.andar-1.cidade', type: 'city', placement: { floor: '1' }, name: 'Cidade' },
      { id: 'loc.andar-1.cidade.banco', type: 'bank', name: 'Banco', parentId: 'loc.andar-1.cidade' },
      { id: 'loc.andar-1.planicies', type: 'region', placement: { floor: '1' }, name: 'Planícies' },
      { id: 'loc.andar-1.planicies.bosque', type: 'grove', name: 'Bosque', parentId: 'loc.andar-1.planicies' }
    ];

    expect(resolveLocationBulkEntities({ items, selectedRegion: 'loc.andar-1.cidade' }).map((item) => item.id)).toEqual([
      'loc.andar-1.cidade',
      'loc.andar-1.cidade.banco'
    ]);
    expect(resolveLocationBulkEntities({ items, selectedRegion: 'loc.andar-1.planicies' }).map((item) => item.id)).toEqual([
      'loc.andar-1.planicies',
      'loc.andar-1.planicies.bosque'
    ]);
  });

  it('inclui todas as cidades e locais de uma região quando ela tem múltiplos subgrupos', () => {
    const items = [
      { id: 'loc.andar-1', type: 'region', placement: { floor: '1' }, name: 'Região' },
      { id: 'loc.andar-1.cidade-a', type: 'city', placement: { floor: '1' }, name: 'Cidade A', parentId: 'loc.andar-1' },
      { id: 'loc.andar-1.cidade-a.banco', type: 'bank', name: 'Banco', parentId: 'loc.andar-1.cidade-a' },
      { id: 'loc.andar-1.cidade-b', type: 'city', placement: { floor: '1' }, name: 'Cidade B', parentId: 'loc.andar-1' },
      { id: 'loc.andar-1.cidade-b.taverna', type: 'tavern', name: 'Taverna', parentId: 'loc.andar-1.cidade-b' }
    ];

    expect(resolveLocationBulkEntities({ items, selectedRegion: 'loc.andar-1' }).map((item) => item.id)).toEqual([
      'loc.andar-1',
      'loc.andar-1.cidade-a',
      'loc.andar-1.cidade-a.banco',
      'loc.andar-1.cidade-b',
      'loc.andar-1.cidade-b.taverna'
    ]);
  });

  it('organiza locais no modal por andar, região e local sem repetir o caminho no nome', () => {
    const rows = locationDiscoveryRows([
      { id: 'floor.1', type: 'floor', name: 'Andar 1', placement: { floor: '1' } },
      { id: 'region.a', type: 'region', name: 'Costa', placement: { floor: '1' } },
      { id: 'location.a', type: 'city', name: 'Vila', parentId: 'region.a' }
    ]);

    expect(rows.map(({ kind, label }) => [kind, label])).toEqual([
      ['floor', 'Andar 1'],
      ['region', 'Costa'],
      ['location', 'Vila']
    ]);
  });

  it('usa o nome próprio quando a entidade também carrega um breadcrumb', () => {
    const region = { id: 'region.a', type: 'region', name: 'Andar 1 - Costa', treeName: 'Costa', placement: { floor: '1' } };
    const location = { id: 'location.a', type: 'city', name: 'Andar 1 - Costa - Vila', treeName: 'Vila', parentId: 'region.a' };

    expect(locationDiscoveryRows([region, location]).map(({ label }) => label)).toEqual(['Andar 1', 'Costa', 'Vila']);
  });

  it('seleciona a região e todos os locais descendentes', () => {
    const items = [
      { entityId: 'region.a', type: 'region' },
      { entityId: 'location.a', type: 'city', parentId: 'region.a' },
      { entityId: 'location.b', type: 'building', parentId: 'location.a' },
      { entityId: 'region.b', type: 'region' }
    ];

    expect(locationBranchEntries(items, items[0]).map((entry) => entry.entityId)).toEqual(['region.a', 'location.a', 'location.b']);
  });

  it('mantém a região ativa e ainda seleciona a cidade do início quando ela é aberta', () => {
    const result = resolveLocationMenuClick({ id: 'loc.andar-1.cidade-do-inicio', type: 'city', parentId: 'loc.andar-1' });

    expect(result).toMatchObject({
      selectedRegion: 'loc.andar-1',
      itemId: 'loc.andar-1.cidade-do-inicio'
    });
  });

  it('mostra a lista de locais assim que uma região é selecionada', () => {
    expect(shouldShowLocationList({ regions: [{ id: 'loc.andar-1' }], selectedRegion: null })).toBe(false);
    expect(shouldShowLocationList({ regions: [{ id: 'loc.andar-1' }], selectedRegion: 'loc.andar-1' })).toBe(true);
  });

  it('monta os alvos de liberação em lote para os itens de um monstro', () => {
    const entity = {
      movements: [
        { id: 'move-1', data: { name: 'Andar rápido' } },
        { id: 'move-2', data: { name: 'Escalar' } }
      ],
      attacks: [
        { id: 'atk-1', data: { name: 'Garra' } }
      ],
      abilities: [],
      skills: [],
      traits: []
    };

    expect(monsterComponentTargets(entity, 'movement')).toEqual([
      { kind: 'monster_movement', key: 'move-1', label: 'Andar rápido' },
      { kind: 'monster_movement', key: 'move-2', label: 'Escalar' }
    ]);
    expect(monsterComponentTargets(entity, 'attack')).toEqual([
      { kind: 'monster_attack', key: 'atk-1', label: 'Garra' }
    ]);
  });

  it('preserva os blocos de categoria quando o request é espalhado', () => {
    const request = { ...buildBulkEntityDiscoveryRequest({ type: 'location', items: [{ id: 'location.regiao', name: 'Região', type: 'region', placement: { floor: '1' } }] }) };

    expect(request.categories).toBeTruthy();
    expect(request.categories.map((group) => group.label)).toContain('Identidade');
  });

  it.each([
    ['npc', 'Liberar personagens'],
    ['location', 'Liberar locais'],
    ['item', 'Liberar itens'],
    ['monster', 'Liberar monstros'],
    ['quest', 'Liberar missões']
  ])('builds the bulk visibility request for %s', (type, label) => {
    const items = type === 'location'
      ? [
        { id: 'location.um', name: 'Um', type: 'city', placement: { floor: 'f1' }, parentId: 'location.regiao' },
        { id: 'location.dois', name: 'Dois', type: 'city', placement: { floor: 'f1' }, parentId: 'location.regiao' },
        { id: 'location.regiao', name: 'Região', type: 'region', placement: { floor: 'f1' } }
      ]
      : [
        { id: `${type}.um`, name: 'Um' },
        { id: `${type}.dois`, name: 'Dois' }
      ];
    expect(buildBulkEntityDiscoveryRequest({
      type,
      items
    })).toEqual({
      label,
      targets: categorizedDiscoveryTypes.includes(type) ? categorizedDiscoveryTargets(type, items) : [{ kind: 'entity', key: 'existence', label: 'Existência do registro' }],
      bulk: true,
      categories: categorizedDiscoveryTypes.includes(type) ? categorizedDiscoveryTargets(type, items) : undefined,
      entities: type === 'location'
        ? [
          { entityType: type, entityId: 'location.regiao', name: 'Andar 1 - Região', imageURL: '' },
          { entityType: type, entityId: 'location.dois', name: 'Andar 1 - Região - Dois', imageURL: '' },
          { entityType: type, entityId: 'location.um', name: 'Andar 1 - Região - Um', imageURL: '' }
        ]
        : [
          { entityType: type, entityId: `${type}.um`, name: 'Um', imageURL: '' },
          { entityType: type, entityId: `${type}.dois`, name: 'Dois', imageURL: '' }
        ]
    });
  });

  it('constrói o lote de permissões selecionadas para monstros e valida o botão de confirmação', () => {
    const request = {
      targets: [{ kind: 'entity', key: 'existence', label: 'Existência do registro' }],
      entities: [
        { entityType: 'monster', entityId: 'monster.capivara', name: 'Capivara' },
        { entityType: 'monster', entityId: 'monster.carcaju', name: 'Carcaju' }
      ]
    };


    const selectedPlayers = new Set(['user-1', 'user-2']);
    const selectedEntities = new Set(['monster:monster.capivara', 'monster:monster.carcaju']);
    const selectedTargets = new Set(['entity:existence']);

    expect(canConfirmDiscoveryGrant({ selected: selectedPlayers, selectedTargets, selectedEntities })).toBe(true);
    expect(buildDiscoveryGrantBatch({
      request,
      selected: selectedPlayers,
      selectedEntities,
      selectedTargets,
      allowance: 'deny'
    })).toEqual([
      {
        subjectType: 'user',
        subjectId: 'user-1',
        entityType: 'monster',
        entityId: 'monster.capivara',
        targetKind: 'entity',
        targetKey: 'existence',
        allowance: 'deny'
      },
      {
        subjectType: 'user',
        subjectId: 'user-1',
        entityType: 'monster',
        entityId: 'monster.carcaju',
        targetKind: 'entity',
        targetKey: 'existence',
        allowance: 'deny'
      },
      {
        subjectType: 'user',
        subjectId: 'user-2',
        entityType: 'monster',
        entityId: 'monster.capivara',
        targetKind: 'entity',
        targetKey: 'existence',
        allowance: 'deny'
      },
      {
        subjectType: 'user',
        subjectId: 'user-2',
        entityType: 'monster',
        entityId: 'monster.carcaju',
        targetKind: 'entity',
        targetKey: 'existence',
        allowance: 'deny'
      }
    ]);
  });

  it('divide confirmações grandes em lotes aceitos pela API', () => {
    const batches = chunkDiscoveryGrants(Array.from({ length: 1001 }, (_, index) => index));
    expect(batches.map((batch) => batch.length)).toEqual([500, 500, 1]);
  });

  it('permite confirmar a liberação individual de itens e locais', () => {
    const selectedPlayers = new Set(['user-1']);
    const selectedTargets = new Set(['entity:existence']);

    expect(canConfirmDiscoveryGrant({
      selected: selectedPlayers,
      selectedTargets,
      selectedEntities: new Set(),
      requireSelectedEntities: false
    })).toBe(true);

    expect(buildDiscoveryGrantBatch({
      request: { targets: [{ kind: 'entity', key: 'existence' }] },
      selected: selectedPlayers,
      selectedTargets,
      selectedEntities: new Set(),
      allowance: 'allow',
      entityType: 'item',
      entityId: 'item.espada'
    })).toEqual([{
      subjectType: 'user',
      subjectId: 'user-1',
      entityType: 'item',
      entityId: 'item.espada',
      targetKind: 'entity',
      targetKey: 'existence',
      allowance: 'allow'
    }]);
  });
});
