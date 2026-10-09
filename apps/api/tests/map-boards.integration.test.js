import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import { buildApp } from '../src/app.js';
import { hashToken } from '../src/lib/security.js';
import { createEntity } from '../src/services/content.js';
import { normalizeRoadNetwork } from '@sao/domain';

describe.runIf(Boolean(process.env.TEST_DATABASE_URL))('regional maps with PostgreSQL', () => {
  let app, campaign, general, regional, gm, player;
  const csrf = randomUUID();
  const gmToken = randomUUID(), playerToken = randomUUID();
  const gmHeaders = { cookie: `sao_session=${gmToken}`, 'x-csrf-token': csrf };
  const playerHeaders = { cookie: `sao_session=${playerToken}`, 'x-csrf-token': csrf };
  const polygon = [{ x: 0.1, y: 0.1 }, { x: 0.8, y: 0.1 }, { x: 0.7, y: 0.8 }];
  const call = (method, path, payload, headers = gmHeaders) => app.inject({
    method, url: `/api/v1/campaigns/${campaign.id}/map/${path}`, headers,
    ...(payload !== undefined ? { payload } : {})
  });

  beforeAll(async () => {
    app = await buildApp();
    campaign = await prisma.campaign.create({ data: { slug: `maps-${randomUUID()}`, name: 'Integração mapas' } });
    for (const [role, token] of [['owner', gmToken], ['player', playerToken]]) {
      const user = await prisma.user.create({ data: { login: `maps-${role}-${randomUUID()}`, name: role, passwordHash: 'unused' } });
      if (role === 'owner') gm = user; else player = user;
      await prisma.membership.create({ data: { campaignId: campaign.id, userId: user.id, role } });
      await prisma.session.create({ data: { userId: user.id, tokenHash: hashToken(token), csrfToken: csrf, expiresAt: new Date(Date.now() + 3600000) } });
    }
    for (const input of [
      { id: 'loc.region', name: 'Planícies', type: 'region', media: { map: 'https://example.test/region.png' }, visibility: { entity: 'public' } },
      { id: 'loc.city', name: 'Cidade', type: 'city', parentId: 'loc.region', visibility: { entity: 'public' } },
      { id: 'loc.town', name: 'Moinho', type: 'farm', parentId: 'loc.region', visibility: { entity: 'public' }, connections: [{ id: 'road-town-city', target: { type: 'location', id: 'loc.city' }, type: 'road', distanceKm: 1, travelMinutes: 90 }] },
      { id: 'loc.known-secret-info', name: 'Existência conhecida', type: 'farm', parentId: 'loc.region', visibility: { entity: 'public', sections: { basic: 'gm' } } },
      { id: 'loc.secret-region', name: 'Região secreta', type: 'region', visibility: { entity: 'gm' } }
    ]) await createEntity({ campaignId: campaign.id, type: 'location', input, actorUserId: gm.id });
    general = await prisma.mapBoard.create({ data: { campaignId: campaign.id, name: 'Geral preservado', imageUrl: 'https://example.test/general.png', scaleKm: 100, createdByUserId: gm.id } });
    await prisma.mapLocationPin.create({ data: { boardId: general.id, entityType: 'location', entityId: 'loc.town', locationId: 'loc.town', x: 0.25, y: 0.75, placementSource: 'manual', updatedByUserId: gm.id } });
  });

  afterAll(async () => {
    if (campaign) await prisma.campaign.delete({ where: { id: campaign.id } });
    for (const user of [gm, player].filter(Boolean)) await prisma.user.delete({ where: { id: user.id } });
    await app?.close();
    await prisma.$disconnect();
  });

  it('persists boundary labels, association and author while duplicate retargeting rolls back', async () => {
    const created = await call('POST', 'boundaries', { regionId: 'loc.city', name: 'Limite da cidade', points: polygon });
    expect(created.statusCode).toBe(201);
    const boundary = created.json().boundaries.find(entry => entry.regionId === 'loc.city');
    expect(boundary).toMatchObject({ name: 'Limite da cidade', label: 'Limite da cidade', updatedBy: { id: gm.id, name: gm.name } });
    const edited = await call('PATCH', `boundaries/${boundary.id}`, { regionId: 'loc.town', name: 'Campos do moinho' }, { ...gmHeaders, 'if-match': String(boundary.version) });
    expect(edited.statusCode).toBe(200);
    const saved = await prisma.mapRegionBoundary.findUnique({ where: { id: boundary.id } });
    expect(saved).toMatchObject({ regionId: 'loc.town', name: 'Campos do moinho', points: polygon, updatedByUserId: gm.id, version: 2 });
    const occupied = await call('POST', 'boundaries', { regionId: 'loc.city', points: polygon });
    const before = occupied.json().version;
    expect((await call('PATCH', `boundaries/${boundary.id}`, { regionId: 'loc.city' }, { ...gmHeaders, 'if-match': '2' })).statusCode).toBe(409);
    expect((await call('GET', 'board')).json().version).toBe(before);
    expect((await prisma.mapRegionBoundary.findUnique({ where: { id: boundary.id } })).regionId).toBe('loc.town');
    await call('DELETE', `boundaries/${boundary.id}`, undefined, { ...gmHeaders, 'if-match': '2' });
    const city = occupied.json().boundaries.find(entry => entry.regionId === 'loc.city');
    await call('DELETE', `boundaries/${city.id}`, undefined, { ...gmHeaders, 'if-match': String(city.version) });
  });

  it('preserves the general image, pin and compatibility scale and creates a distinct region map', async () => {
    const existing = await call('GET', 'board');
    expect(existing.statusCode, existing.body).toBe(200);
    expect(existing.json()).toMatchObject({ id: general.id, regionId: null, imageUrl: general.imageUrl, scaleKm: 100, pins: [{ entityId: 'loc.town', x: 0.25, y: 0.75 }] });
    const created = await call('POST', 'boards', { regionId: 'loc.region' });
    expect(created.statusCode, created.body).toBe(201);
    regional = created.json();
    expect(regional).toMatchObject({ regionId: 'loc.region', imageUrl: 'https://example.test/region.png', pins: [], routes: [], scale: null });
    expect(regional.id).not.toBe(general.id);
    expect((await call('POST', 'boards', { regionId: 'loc.region' })).statusCode).toBe(409);
    expect(await prisma.mapBoard.count({ where: { campaignId: campaign.id } })).toBe(2);
  });

  it('persists pins and scale separately when selecting a regional map', async () => {
    const pin = await call('POST', `pins?boardId=${regional.id}`, { entityType: 'location', entityId: 'loc.town', x: 0.7, y: 0.2 });
    expect(pin.statusCode, pin.body).toBe(201);
    const scale = await call('PATCH', `board/scale?boardId=${regional.id}`, { startX: 0.1, startY: 0.2, endX: 0.5, endY: 0.2, distanceKm: 20, imageWidth: 1000, imageHeight: 600 }, { ...gmHeaders, 'if-match': String(regional.version) });
    expect(scale.statusCode, scale.body).toBe(200);
    expect(scale.json().scale.kmPerPixel).toBeCloseTo(0.05);
    const edit = await call('PATCH', `board/scale?boardId=${regional.id}`, { distanceKm: 40 }, { ...gmHeaders, 'if-match': String(scale.json().version) });
    expect(edit.statusCode, edit.body).toBe(200);
    expect(edit.json().scale.kmPerPixel).toBeCloseTo(0.1);
    const preserved = (await call('GET', 'board')).json();
    expect(preserved).toMatchObject({ id: general.id, scaleKm: 100, pins: [{ x: 0.25, y: 0.75 }] });
    expect((await call('GET', `board?boardId=${regional.id}`)).json().pins).toMatchObject([{ x: 0.7, y: 0.2 }]);
  });

  it('stores boundaries on the general map with version conflicts and filters secrets', async () => {
    const initialVersion = (await call('GET', 'board')).json().version;
    const created = await call('POST', 'boundaries', { regionId: 'loc.region', points: polygon });
    expect(created.statusCode).toBe(201);
    expect(created.json().version).toBe(initialVersion + 1);
    const secret = await call('POST', 'boundaries', { regionId: 'loc.secret-region', points: polygon });
    expect(secret.statusCode).toBe(201);
    expect(secret.json().version).toBe(initialVersion + 2);
    const visible = await call('GET', 'board', undefined, playerHeaders);
    expect(visible.json().boundaries).toHaveLength(1);
    expect(visible.body).not.toContain('Região secreta');
    const boundary = visible.json().boundaries[0];
    const moved = polygon.map((point) => ({ ...point, x: point.x + 0.05 }));
    const edited = await call('PATCH', `boundaries/${boundary.id}`, { points: moved }, { ...gmHeaders, 'if-match': '1' });
    expect(edited.statusCode).toBe(200);
    expect(edited.json().version).toBe(initialVersion + 3);
    expect((await call('PATCH', `boundaries/${boundary.id}`, { points: polygon }, { ...gmHeaders, 'if-match': '1' })).statusCode).toBe(409);
    expect((await call('GET', 'board')).json().version).toBe(initialVersion + 3);
    const stored = (await prisma.mapRegionBoundary.findUnique({ where: { id: boundary.id } })).points;
    expect(stored).toHaveLength(moved.length);
    stored.forEach((point, index) => { expect(point.x).toBeCloseTo(moved[index].x); expect(point.y).toBeCloseTo(moved[index].y); });
    expect((await call('DELETE', `boundaries/${boundary.id}`, undefined, { ...playerHeaders, 'if-match': '2' })).statusCode).toBe(403);
    expect((await call('DELETE', `boundaries/${boundary.id}`, undefined, { ...gmHeaders, 'if-match': '2' })).statusCode).toBe(204);
    expect((await call('GET', 'board')).json().version).toBe(initialVersion + 4);
  });

  it('recalculates the selected map routes and only updates existing catalog connections', async () => {
    const added = await call('POST', `pins?boardId=${regional.id}`, { entityType: 'location', entityId: 'loc.city', x: 0.3, y: 0.2 });
    expect(added.statusCode, added.body).toBe(201);
    const pins = added.json().pins;
    const created = await call('POST', `routes?boardId=${regional.id}`, { fromPinId: pins.find((pin) => pin.entityId === 'loc.town').id, toPinId: pins.find((pin) => pin.entityId === 'loc.city').id });
    expect(created.statusCode, created.body).toBe(201);
    const path = created.json().routes[0];
    expect(path.distanceKm).toBeCloseTo(40);
    expect(path.points).toMatchObject([{ x: 0.5, y: 0.2, order: 0 }]);
    const connectionsBefore = await prisma.locationConnection.count({ where: { entity: { campaignId: campaign.id } } });
    const scaled = await call('PATCH', `board/scale?boardId=${regional.id}`, { distanceKm: 80 }, { ...gmHeaders, 'if-match': String(added.json().version) });
    expect(scaled.statusCode, scaled.body).toBe(200);
    expect(scaled.json().routes[0].distanceKm).toBeCloseTo(80);
    const catalog = await prisma.locationConnection.findFirst({ where: { entity: { campaignId: campaign.id }, connectionId: 'road-town-city' } });
    expect(catalog.distanceKm).toBeCloseTo(80);
    expect(catalog.travelMinutes).toBe(90);
    expect(await prisma.locationConnection.count({ where: { entity: { campaignId: campaign.id } } })).toBe(connectionsBefore);
    expect((await call('GET', 'board')).json().scaleKm).toBe(100);
  });

  it('persists a shared network atomically without changing legacy routes, pins or catalog connections', async () => {
    const before = (await call('GET', `board?boardId=${regional.id}`)).json();
    expect(before.roadNetwork).toBeNull();
    const catalogBefore = await prisma.locationConnection.findMany({ where: { entity: { campaignId: campaign.id } } });
    const network = { imageWidth: 1000, imageHeight: 600, nodes: [{ id: 'a', x: .1, y: .5 }, { id: 'b', x: .9, y: .5 }, { id: 'c', x: .5, y: .1 }, { id: 'd', x: .5, y: .9 }], edges: [{ id: 'road', from: 'a', to: 'b' }, { id: 'branch', from: 'c', to: 'd' }] };
    const saveHeaders = { ...gmHeaders, 'if-match': String(before.version) };
    expect((await call('PUT', `network?boardId=${regional.id}`, network, playerHeaders)).statusCode).toBe(403);
    expect((await call('PUT', `network?boardId=${regional.id}`, network, { cookie: gmHeaders.cookie, 'if-match': String(before.version) })).statusCode).toBe(403);
    const concurrent = await Promise.all([call('PUT', `network?boardId=${regional.id}`, network, saveHeaders), call('PUT', `network?boardId=${regional.id}`, network, saveHeaders)]);
    expect(concurrent.map((response) => response.statusCode).sort()).toEqual([200, 409]);
    const saved = concurrent.find((response) => response.statusCode === 200).json();
    expect(saved.version).toBe(before.version + 1);
    expect(saved.roadNetwork).toEqual(normalizeRoadNetwork(network));
    expect(saved.routes).toEqual(before.routes); expect(saved.pins).toEqual(before.pins);
    expect((await prisma.mapBoard.findUnique({ where: { id: regional.id } })).roadNetwork).toEqual(saved.roadNetwork);
    expect((await call('GET', 'board')).json().roadNetwork).toBeNull();
    const from = saved.pins.find((pin) => pin.entityId === 'loc.town'), to = saved.pins.find((pin) => pin.entityId === 'loc.city');
    const path = `network/path?boardId=${regional.id}&fromPinId=${from.id}&toPinId=${to.id}`;
    const queried = await call('GET', path, undefined, playerHeaders);
    expect(queried.statusCode, queried.body).toBe(200);
    expect(queried.json()).toMatchObject({ status: 'found', version: saved.version });
    expect(queried.json().distanceKm).toBeCloseTo(152);
    expect(queried.json().accessFrom).toHaveLength(2);
    expect((await prisma.mapBoard.findUnique({ where: { id: regional.id } })).updatedAt.toISOString()).toBe(saved.updatedAt);
    expect(await prisma.locationConnection.findMany({ where: { entity: { campaignId: campaign.id } } })).toEqual(catalogBefore);
    const hidden = await call('POST', `pins?boardId=${regional.id}`, { entityType: 'location', entityId: 'loc.secret-region', x: .5, y: .5 });
    const secret = hidden.json().pins.find((pin) => pin.entityId === 'loc.secret-region');
    expect((await call('GET', `network/path?boardId=${regional.id}&fromPinId=${from.id}&toPinId=${secret.id}`, undefined, playerHeaders)).statusCode).toBe(404);
    const visible = await call('GET', `board?boardId=${regional.id}`, undefined, playerHeaders);
    expect(visible.body).not.toContain('loc.secret-region'); expect(visible.json().roadNetwork).toEqual(saved.roadNetwork);
    const replaced = await call('PATCH', `board?boardId=${regional.id}`, { imageUrl: 'https://example.test/replacement.png', imageWidth: 2000, imageHeight: 1200 }, { ...gmHeaders, 'if-match': String(saved.version) });
    expect(replaced.statusCode, replaced.body).toBe(200);
    expect(replaced.json().roadNetwork).toEqual({ ...saved.roadNetwork, imageWidth: 2000, imageHeight: 1200 });
    expect(replaced.json().scale).toBeNull();
    expect((await call('GET', path, undefined, playerHeaders)).json().distanceKm).toBeNull();
    expect(replaced.json().routes).toEqual(before.routes);
  });

  it('never lists hidden region maps or opens a map from another campaign', async () => {
    const secret = await call('POST', 'boards', { regionId: 'loc.secret-region' });
    expect(secret.statusCode, secret.body).toBe(201);
    const maps = await call('GET', 'boards', undefined, playerHeaders);
    expect(maps.json().items.map((board) => board.id)).toEqual(expect.arrayContaining([general.id, regional.id]));
    expect(maps.body).not.toContain('loc.secret-region');
    expect((await call('GET', `board?boardId=${secret.json().id}`, undefined, playerHeaders)).statusCode).toBe(404);
    const other = await prisma.campaign.create({ data: { slug: `maps-other-${randomUUID()}`, name: 'Outra campanha' } });
    try {
      const foreign = await prisma.mapBoard.create({ data: { campaignId: other.id, name: 'Outro mapa', createdByUserId: gm.id } });
      expect((await call('GET', `board?boardId=${foreign.id}`)).statusCode).toBe(404);
      expect((await call('POST', `pins?boardId=${foreign.id}`, { entityType: 'location', entityId: 'loc.town', x: 0.5, y: 0.5 })).statusCode).toBe(404);
    } finally { await prisma.campaign.delete({ where: { id: other.id } }); }
  });

  it('filters general information in player preview and shares a farm territory on a regional map', async () => {
    const added = await call('POST', `pins?boardId=${regional.id}`, { entityType: 'location', entityId: 'loc.known-secret-info', x: .5, y: .6 });
    expect(added.statusCode, added.body).toBe(201);
    const pin = added.json().pins.find((entry) => entry.entityId === 'loc.known-secret-info');
    const viewerQuery = `boardId=${regional.id}&viewAsUserId=${player.id}`;
    for (const headers of [gmHeaders, playerHeaders]) {
      const board = await call('GET', `board?${viewerQuery}`, undefined, headers);
      expect(board.statusCode, board.body).toBe(200);
      expect(board.body).not.toContain('loc.known-secret-info');
      expect(board.body).not.toContain('Existência conhecida');
      expect(board.json().boundaryCandidates).toEqual([]);
      expect((await call('GET', `pins/${pin.id}/content?${viewerQuery}`, undefined, headers)).statusCode).toBe(404);
    }
    const territory = await call('POST', `boundaries?boardId=${regional.id}`, { regionId: 'loc.town', points: polygon });
    expect(territory.statusCode, territory.body).toBe(201);
    expect(territory.json().boundaries).toEqual([expect.objectContaining({ regionId: 'loc.town', name: 'Moinho' })]);
    const visible = await call('GET', `board?boardId=${regional.id}`, undefined, playerHeaders);
    expect(visible.json().boundaries).toEqual([expect.objectContaining({ regionId: 'loc.town' })]);
    expect((await call('POST', `markers?${viewerQuery}`, { ownerType: 'custom', x: .5, y: .5 })).statusCode).toBe(403);
  });

  it('persists road-snapped travel markers with independent ownership and atomic versions', async () => {
    const catalogBefore = await prisma.locationConnection.findMany({ where: { entity: { campaignId: campaign.id } } });
    const wagon = await call('POST', `markers?boardId=${regional.id}`, { ownerType: 'custom', name: 'Carroça', x: .4, y: .2 });
    expect(wagon.statusCode, wagon.body).toBe(201);
    const custom = wagon.json().travelMarkers.find((entry) => entry.ownerType === 'custom');
    // The vertical branch is 200 px away; the horizontal road is 360 px away.
    expect(custom).toMatchObject({ name: 'Carroça', x: .5, y: .2, version: 1, canMove: true });
    const own = await call('POST', `markers?boardId=${regional.id}`, { ownerType: 'player', x: .7, y: .8 }, playerHeaders);
    expect(own.statusCode, own.body).toBe(201);
    const marker = own.json().travelMarkers.find((entry) => entry.ownerType === 'player');
    expect(marker).toMatchObject({ ownerId: player.id, x: .7, y: .5, canMove: true });
    expect(own.json().travelMarkers.find((entry) => entry.id === custom.id).canMove).toBe(false);
    const duplicate = await call('POST', `markers?boardId=${regional.id}`, { ownerType: 'player', x: .1, y: .3 }, playerHeaders);
    expect(duplicate.statusCode).toBe(409);
    expect((await call('PATCH', `markers/${custom.id}?boardId=${regional.id}`, { x: .2, y: .2 }, { ...playerHeaders, 'if-match': '1' })).statusCode).toBe(403);
    const concurrent = await Promise.all([.2, .8].map((x) => call('PATCH', `markers/${marker.id}?boardId=${regional.id}`, { x, y: .3 }, { ...playerHeaders, 'if-match': '1' })));
    expect(concurrent.map((response) => response.statusCode).sort()).toEqual([200, 409]);
    const stored = await prisma.mapTravelMarker.findUnique({ where: { id: marker.id } });
    expect(stored.version).toBe(2);
    expect(stored.y).toBe(.5);
    const destinations = await call('GET', `network/destinations?boardId=${regional.id}&fromPinId=${custom.id}`, undefined, playerHeaders);
    expect(destinations.statusCode, destinations.body).toBe(200);
    expect(destinations.json().items.some((entry) => entry.toPinId === marker.id)).toBe(true);
    expect(destinations.body).not.toContain('loc.known-secret-info');
    const consulted = await call('GET', `network/path?boardId=${regional.id}&fromPinId=${custom.id}&toPinId=${marker.id}`, undefined, playerHeaders);
    expect(consulted.json()).toMatchObject({ status: 'found', version: destinations.json().version, distanceKm: null });
    expect((await call('DELETE', `markers/${custom.id}?boardId=${general.id}`, undefined, { ...gmHeaders, 'if-match': '1' })).statusCode).toBe(404);
    expect((await call('DELETE', `markers/${custom.id}?boardId=${regional.id}`, undefined, { ...gmHeaders, 'if-match': '1' })).statusCode).toBe(204);
    expect(await prisma.mapTravelMarker.findUnique({ where: { id: custom.id } })).toBeNull();
    expect(await prisma.locationConnection.findMany({ where: { entity: { campaignId: campaign.id } } })).toEqual(catalogBefore);
    expect(await prisma.mapPosition.count({ where: { session: { campaignId: campaign.id } } })).toBe(0);
  });
});
