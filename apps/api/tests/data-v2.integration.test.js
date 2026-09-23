import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { prisma } from '../src/lib/prisma.js';
import { buildApp } from '../src/app.js';
import { hashToken } from '../src/lib/security.js';
import { normalizeEntity } from '@sao/domain';
import { parseSaoDataJson } from '@sao/json';
import {
  contentInclude,
  planDataMigration,
  applyDataMigration
} from '../src/services/dataMigration.js';

describe.runIf(Boolean(process.env.TEST_DATABASE_URL))('v2 com PostgreSQL real', () => {
  let app, campaign, gm, player;
  const gmToken = randomUUID(),
    playerToken = randomUUID(),
    csrf = randomUUID();
  const headers = { cookie: `sao_session=${gmToken}`, 'x-csrf-token': csrf };
  const playerHeaders = { cookie: `sao_session=${playerToken}`, 'x-csrf-token': csrf };
  const entities = [
    ['location', { id: 'loc.root', name: 'Raiz', placement: { floor: '1' } }],
    [
      'location',
      {
        id: 'loc.child',
        name: 'Cidade',
        type: 'city',
        parentId: 'loc.root',
        connections: [
          {
            id: 'road',
            target: { type: 'location', id: 'loc.root' },
            type: 'road',
            distanceKm: 0.45
          }
        ]
      }
    ],
    [
      'npc',
      {
        id: 'npc.guide',
        name: 'Guia',
        identity: { profession: 'Guia' },
        visibility: { entity: 'gm', sections: { locations: 'gm' } },
        links: [{ type: 'location', id: 'loc.child', role: 'main', slot: 'locations' }],
        character: { mode: 'embedded', snapshot: { hp: 20 } }
      }
    ],
    ['item', { id: 'item.hide', name: 'Couro' }],
    [
      'monster',
      {
        id: 'monster.boar',
        name: 'Javali',
        links: [
          {
            type: 'item',
            id: 'item.hide',
            role: 'drops',
            chance: 100,
            quantityMin: 2,
            quantityMax: 4
          }
        ],
        statBlocks: {
          'Ambesek.T20': { combat: { defense: 18 }, statsVisibility: { combat: 'gm' } }
        },
        components: [
          { id: 'rage', kind: 'ability', visibility: 'gm', data: { name: 'Fúria' } },
          {
            id: 'bite',
            kind: 'attack',
            visibility: 'public',
            data: { name: 'Mordida', damage: '1d6' }
          }
        ]
      }
    ],
    [
      'quest',
      {
        id: 'quest.hunt',
        name: 'Caçada',
        objectives: [
          {
            objectiveId: 'kill',
            type: 'kill',
            order: 1,
            text: 'Derrote javalis',
            requiredQuantity: 5,
            target: { type: 'monster', id: 'monster.boar' },
            playerEditable: true
          }
        ],
        rewards: [
          { rewardId: 'hide', type: 'item', target: { type: 'item', id: 'item.hide' }, quantity: 2 }
        ]
      }
    ]
  ].map(([type, data]) => ({
    type,
    data: normalizeEntity(
      type,
      { visibility: { entity: 'public', sections: {} }, ...data },
      { format: '2.0' }
    )
  }));
  const pack = {
    schemaVersion: '2.0',
    packId: 'test.v2',
    name: 'Teste v2',
    containers: ['npc', 'location', 'item', 'monster', 'quest'],
    entities
  };
  const url = (path) => `/api/v1/campaigns/${campaign.id}/${path}`;
  const call = (method, path, payload, extraHeaders = headers) =>
    app.inject({ method, url: url(path), headers: extraHeaders, ...(payload ? { payload } : {}) });
  async function preview(document = pack) {
    const response = await call('POST', 'import/preview', document);
    expect(response.statusCode, response.body).toBe(200);
    return response.json();
  }
  async function apply(document = pack) {
    const p = await preview(document);
    const response = await call('POST', 'import/apply', {
      previewId: p.previewId,
      selectedKeys: p.diff.filter((e) => e.selected).map((e) => e.key)
    });
    expect(response.statusCode, response.body).toBe(200);
    return response.json();
  }
  beforeAll(async () => {
    app = await buildApp();
    gm = await prisma.user.create({
      data: { login: `v2-gm-${randomUUID()}`, name: 'GM', passwordHash: 'unused' }
    });
    player = await prisma.user.create({
      data: { login: `v2-player-${randomUUID()}`, name: 'Jogador', passwordHash: 'unused' }
    });
    campaign = await prisma.campaign.create({
      data: { slug: `v2-${randomUUID()}`, name: 'Integração' }
    });
    for (const [user, role, token] of [
      [gm, 'owner', gmToken],
      [player, 'player', playerToken]
    ]) {
      await prisma.membership.create({ data: { campaignId: campaign.id, userId: user.id, role } });
      await prisma.session.create({
        data: {
          userId: user.id,
          tokenHash: hashToken(token),
          csrfToken: csrf,
          expiresAt: new Date(Date.now() + 3600000)
        }
      });
    }
  });
  afterAll(async () => {
    if (campaign) await prisma.campaign.delete({ where: { id: campaign.id } });
    for (const user of [gm, player].filter(Boolean))
      await prisma.user.delete({ where: { id: user.id } });
    await app?.close();
  });
  it('importa as cinco entidades e exporta sem perdas ou diff falso', async () => {
    await apply();
    const exported = await call('GET', 'export.json');
    expect(exported.statusCode, exported.body).toBe(200);
    const parsed = parseSaoDataJson(exported.json());
    expect(parsed.pack.entities).toEqual(
      [...entities].sort((a, b) => `${a.type}:${a.data.id}`.localeCompare(`${b.type}:${b.data.id}`))
    );
    const p = await preview(exported.json());
    expect(p.diff.every((e) => e.status === 'EQUAL')).toBe(true);
    const legacy = await call('GET', 'export.json?format=1');
    expect(legacy.json().schemaVersion).toBe('1.0');
    expect(parseSaoDataJson(legacy.json()).pack.entities).toEqual(parsed.pack.entities);
  });
  it('aplica operações compactas sem marcar entidades ausentes como removidas', async () => {
    const image = 'https://example.test/boar.gif';
    const document = {
      schemaVersion: '2.0',
      packId: 'test.monster-images',
      name: 'Atualizar imagens de monstros',
      operations: [
        { type: 'monster', id: 'monster.boar', set: { '/media/image': image } }
      ]
    };

    const p = await preview(document);
    expect(p.pack.operationCount).toBe(1);
    expect(p.diff).toHaveLength(1);
    expect(p.diff[0]).toMatchObject({ key: 'monster:monster.boar', status: 'ALTERED' });
    expect(p.diff.some((entry) => entry.status === 'REMOVED_FROM_JSON')).toBe(false);
    const result = await call('POST', 'import/apply', {
      previewId: p.previewId,
      selectedKeys: ['monster:monster.boar']
    });
    expect(result.statusCode, result.body).toBe(200);
    expect(result.json()).toMatchObject({ updated: 1, removed: 0 });
    const monster = (await call('GET', 'monsters/monster.boar?format=2')).json();
    expect(monster.data.media.image).toBe(image);
    expect(monster.data.components).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'bite' }),
      expect.objectContaining({ id: 'rage' })
    ]));
  });
  it('mantém visibilidade, slots, habilidades e tipos de conexão', async () => {
    const gmNpc = (await call('GET', 'npcs/npc.guide?format=2')).json();
    expect(gmNpc.data.links[0]).toMatchObject({ slot: 'locations', id: 'loc.child' });
    expect((await call('GET', 'npcs/npc.guide', null, playerHeaders)).statusCode).toBe(404);
    const monster = (
      await call('GET', 'monsters/monster.boar?format=2', null, playerHeaders)
    ).json();
    expect(monster.data.components.map((c) => c.id)).toEqual(['bite']);
    expect(monster.data.statBlocks['Ambesek.T20'].combat).toEqual({});
    const location = (await call('GET', 'locations/loc.child?format=2')).json();
    expect(location.data.connections[0]).toMatchObject({
      id: 'road',
      type: 'road',
      travelMinutes: 5,
      target: { type: 'location', id: 'loc.root' }
    });
  });
  it('impede ciclos via CRUD e conserva visibilidade omitida na edição', async () => {
    const root = (await call('GET', 'locations/loc.root?format=2')).json();
    const cycle = await call(
      'PUT',
      'locations/loc.root',
      { ...root.data, parentId: 'loc.child' },
      { ...headers, 'if-match': String(root.version) }
    );
    expect(cycle.statusCode, cycle.body).toBe(400);
    const npc = (await call('GET', 'npcs/npc.guide?format=2')).json();
    delete npc.data.visibility.entity;
    const saved = await call('PUT', 'npcs/npc.guide', npc.data, {
      ...headers,
      'if-match': String(npc.version)
    });
    expect(saved.statusCode, saved.body).toBe(200);
    expect((await call('GET', 'npcs/npc.guide?format=2')).json().data.visibility.entity).toBe('gm');
  });
  it('bloqueia prévias antigas e preserva progresso e grants ao reimportar', async () => {
    const started = await call('POST', 'progress', {
      questId: 'quest.hunt',
      ownerType: 'player',
      ownerId: player.login
    });
    expect(started.statusCode, started.body).toBe(201);
    const progress = started.json();
    const updated = await call(
      'PATCH',
      `progress/${progress.id}/objectives/kill`,
      { value: 2, version: progress.version },
      playerHeaders
    );
    expect(updated.statusCode, updated.body).toBe(200);
    await call('PUT', 'discoveries', {
      subjectType: 'user',
      subjectId: player.id,
      entityType: 'npc',
      entityId: 'npc.guide',
      targetKind: 'entity',
      targetKey: 'existence',
      allowance: 'allow'
    });
    const p = await preview();
    const old = (await call('GET', 'quests/quest.hunt?format=2')).json();
    const saved = await call(
      'PUT',
      'quests/quest.hunt',
      { ...old.data, name: 'Caçada alterada' },
      { ...headers, 'if-match': String(old.version) }
    );
    expect(saved.statusCode, saved.body).toBe(200);
    const stale = await call('POST', 'import/apply', {
      previewId: p.previewId,
      selectedKeys: ['quest:quest.hunt']
    });
    expect(stale.statusCode).toBe(409);
    await apply();
    expect((await call('GET', 'npcs/npc.guide', null, playerHeaders)).statusCode).toBe(200);
    const playerLocation = (await call('GET', 'locations/loc.child', null, playerHeaders)).json();
    expect(playerLocation.backlinks.some((link) => link.id === 'npc.guide')).toBe(false);
    expect((await call('GET', 'progress', null, playerHeaders)).json()[0].objectives[0].value).toBe(
      2
    );
    const removed = structuredClone(pack);
    removed.entities.find((e) => e.type === 'quest').data.objectives = [];
    await apply(removed);
    const runtime = await prisma.questObjectiveProgress.findFirst({
      where: { progressId: progress.id, objectiveId: 'kill' }
    });
    expect(runtime).toMatchObject({ value: 2, orphaned: true, questObjectiveId: null });
  });
  it('libera campos vazios e ausentes antes do preenchimento sem expor conteúdo não autorizado', async () => {
    const domainId = 'npc.future-fields';
    const created = await call('POST', 'npcs', {
      id: domainId, name: 'Personagem futuro',
      visibility: { entity: 'public', sections: { identity: 'gm' } },
      fields: [{ key: 'description', value: '', visibility: 'gm' }]
    });
    expect(created.statusCode, created.body).toBe(201);
    const grants = ['description', 'history', 'section.identity'].map((targetKey) => ({
      subjectType: 'user', subjectId: player.id, entityType: 'npc', entityId: domainId,
      targetKind: 'field', targetKey, allowance: 'allow'
    }));
    const granted = await call('POST', 'discoveries/batch', { grants });
    expect(granted.statusCode, granted.body).toBe(200);
    expect(granted.json().count).toBe(3);
    const before = (await call('GET', `npcs/${domainId}`, null, playerHeaders)).json();
    expect(before.fields.every((field) => !field.value)).toBe(true);
    const current = (await call('GET', `npcs/${domainId}?format=2`)).json();
    const saved = await call('PUT', `npcs/${domainId}`, {
      ...current.data,
      identity: { profession: 'Ferreiro' },
      fields: [
        { key: 'description', value: 'Descrição preenchida depois', visibility: 'gm' },
        { key: 'history', value: 'História preenchida depois', visibility: 'gm' },
        { key: 'gmNotes', value: 'Segredo do mestre', visibility: 'gm' }
      ]
    }, { ...headers, 'if-match': String(current.version) });
    expect(saved.statusCode, saved.body).toBe(200);
    const visible = (await call('GET', `npcs/${domainId}`, null, playerHeaders)).json();
    expect(visible.fields).toEqual(expect.arrayContaining([
      { key: 'description', value: 'Descrição preenchida depois' },
      { key: 'history', value: 'História preenchida depois' }
    ]));
    expect(visible.identity.profession).toBe('Ferreiro');
    expect(JSON.stringify(visible)).not.toContain('Segredo do mestre');
    const outsider = await prisma.user.create({ data: { login: `outsider-${randomUUID()}`, name: 'Outro jogador', passwordHash: 'unused' } });
    try {
      await prisma.membership.create({ data: { campaignId: campaign.id, userId: outsider.id, role: 'player' } });
      const hidden = await call('GET', `npcs/${domainId}?viewAsUserId=${outsider.id}`);
      expect(hidden.statusCode, hidden.body).toBe(200);
      expect(hidden.json().fields).toEqual([]);
      expect(hidden.json().identity).toBeUndefined();
      expect(hidden.body).not.toContain('Segredo do mestre');
    } finally {
      await prisma.membership.deleteMany({ where: { userId: outsider.id } });
      await prisma.user.delete({ where: { id: outsider.id } });
    }
  });
  it('migra registros v1 sem modificar IDs ou timestamps e é idempotente', async () => {
    const row = await prisma.entity.create({
      data: {
        campaignId: campaign.id,
        type: 'monster',
        domainId: 'monster.legacy',
        name: 'Legado',
        baseVisibility: 'gm',
        schemaVersion: 1,
        deletedAt: new Date(),
        data: { sheet: { nd: '2', attributes: { strength: 4 } } },
        monsterComponents: {
          create: { componentId: 'a', kind: 'ability', visibility: 'gm', data: { name: 'Ataque' } }
        }
      },
      include: contentInclude
    });
    const plan = planDataMigration([row]);
    expect(plan.errors).toEqual([]);
    await prisma.$transaction((tx) => applyDataMigration(tx, plan));
    const migrated = await prisma.entity.findUnique({
      where: { id: row.id },
      include: contentInclude
    });
    expect(migrated).toMatchObject({
      id: row.id,
      version: row.version,
      updatedAt: row.updatedAt,
      schemaVersion: 2
    });
    expect(migrated.deletedAt).toEqual(row.deletedAt);
    expect(migrated.monsterComponents[0].id).toBe(row.monsterComponents[0].id);
    expect(planDataMigration([migrated]).changes).toHaveLength(0);
  });
});
