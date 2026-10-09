import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/prisma.js', () => ({ prisma: {
  mapSession: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
  mapPosition: { findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
  mapPositionHistory: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
  mapBoard: { findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), upsert: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn() },
  mapRegionBoundary: { create: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn() },
  mapTravelMarker: { create: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn() },
  mapBoardRegion: { findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn(), deleteMany: vi.fn() },
  mapLocationPin: { findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn(), delete: vi.fn(), deleteMany: vi.fn() },
  mapRoute: { findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn() },
  mapRoutePoint: { create: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn() },
  membership: { findUnique: vi.fn(), findMany: vi.fn() },
  group: { findUnique: vi.fn(), findMany: vi.fn() },
  entity: { findUnique: vi.fn(), findMany: vi.fn() },
  user: { findMany: vi.fn() },
  $transaction: vi.fn()
} }));
vi.mock('../src/lib/auth.js', () => ({
  authenticate: async (request) => { request.auth = { user: { id: request.headers['x-user'] ?? 'gm-1' } }; },
  requireCampaign: async (request) => { request.campaign = { id: request.params.campaignId }; request.membership = { role: request.headers['x-role'] ?? 'gm' }; },
  requireCsrf: async () => {},
  requireGm: async (request, reply) => { if (!['owner', 'gm', 'assistant_gm'].includes(request.membership.role)) return reply.code(403).send({ error: 'Forbidden' }); },
  isGm: (request) => ['owner', 'gm', 'assistant_gm'].includes(request.membership?.role)
}));
vi.mock('../src/services/content.js', () => ({ getEntityForRequest: vi.fn() }));
vi.mock('../src/lib/audit.js', () => ({ audit: vi.fn() }));

import { prisma } from '../src/lib/prisma.js';
import { getEntityForRequest } from '../src/services/content.js';
import { mapRoutes } from '../src/routes/map.js';
import { normalizeRoadNetwork } from '@sao/domain';

let app;
const road = { imageWidth: 1000, imageHeight: 500, nodes: [{ id: 'west', x: 0, y: .5 }, { id: 'east', x: 1, y: .5 }], edges: [{ id: 'main', from: 'west', to: 'east' }] };

describe('shared road network API', () => {
  let board;
  beforeEach(() => {
    board = { id: 'board-network', campaignId: 'campaign-1', name: 'Mapa', version: 4, regions: [], boundaries: [], routes: [], roadNetwork: road, pins: [
      { id: 'from', entityType: 'location', entityId: 'loc.town', x: .2, y: .3, version: 1 },
      { id: 'to', entityType: 'npc', entityId: 'npc.traveler', x: .8, y: .7, version: 1 }
    ] };
    prisma.mapBoard.findUnique.mockImplementation(() => Promise.resolve(board));
    getEntityForRequest.mockImplementation(({ domainId }) => Promise.resolve({ id: domainId, name: 'Visível' }));
  });

  it('starts empty without migrating or removing legacy routes', async () => {
    board.roadNetwork = null;
    board.routes = [{ id: 'legacy', fromPinId: 'from', toPinId: 'to', points: [], version: 1 }];
    const response = await request('GET', '/map/board?boardId=board-network');
    expect(response.json()).toMatchObject({ roadNetwork: null, routes: [{ id: 'legacy' }] });
    const path = await request('GET', '/map/network/path?boardId=board-network&fromPinId=from&toPinId=to');
    expect(path.json()).toMatchObject({ status: 'no_path', message: 'Não existe caminho conectado entre esses locais' });
    expect(prisma.mapRoute.deleteMany).not.toHaveBeenCalled();
  });

  it('queries old unsplit crossings, destinations and original passage IDs both ways without writing', async () => {
    board.roadNetwork = { ...road, nodes: [{ id: 'west', x: 0, y: .5 }, { id: 'east', x: 1, y: .5 }, { id: 'north', x: .5, y: 0 }, { id: 'south', x: .5, y: 1 }], edges: [{ id: 'horizontal', from: 'west', to: 'east' }, { id: 'vertical', from: 'north', to: 'south' }] };
    Object.assign(board.pins[0], { x: .1, y: .5 }); Object.assign(board.pins[1], { x: .5, y: .9, entityType: 'location', entityId: 'loc.region' });
    board.scaleKm = 10;
    getEntityForRequest.mockImplementation(({ domainId }) => Promise.resolve({ id: domainId, name: domainId, connections: domainId === 'loc.town' ? [{ connectionId: 'out', targetId: 'loc.region', target: { id: 'loc.region', name: 'Região', available: true }, distanceKm: 999 }] : [] }));
    const before = structuredClone(board.roadNetwork);
    const path = (await request('GET', '/map/network/path?boardId=board-network&fromPinId=from&toPinId=to&viaEdgeId=vertical')).json();
    const reverse = (await request('GET', '/map/network/path?boardId=board-network&fromPinId=to&toPinId=from')).json();
    expect(path.status).toBe('found'); expect(reverse.status).toBe('found');
    expect(reverse.distancePixels).toBeCloseTo(path.distancePixels);
    expect(new Set(path.edgeIds)).toEqual(new Set(['horizontal', 'vertical']));
    expect((await request('GET', '/map/network/destinations?boardId=board-network&fromPinId=from')).json().items).toEqual([expect.objectContaining({ toPinId: 'to' })]);
    const shown = (await request('GET', '/map/board?boardId=board-network')).json();
    expect(shown.roadNetwork).toEqual(before);
    expect(shown.distances).toEqual([expect.objectContaining({ networkStatus: 'found', distanceSource: 'network', distanceKm: 6, catalogDistanceKm: 999 })]);
    expect(board.roadNetwork).toEqual(before); expect(prisma.mapBoard.updateMany).not.toHaveBeenCalled();
  });

  it('omits every boundary detail when the player knows existence but lacks basic information, including preview', async () => {
    board.boundaries = [{ id: 'secret-boundary', regionId: 'loc.region', name: 'Reserva secreta', points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }], version: 1, updatedBy: { id: 'gm-1', name: 'Mestre' } }];
    getEntityForRequest.mockImplementation(({ domainId, request: req, options }) => Promise.resolve(domainId === 'loc.region' && options.requireSection === 'basic' && (req.membership.role === 'player' || req.query.viewAsUserId) ? null : { id: domainId, name: 'Existência conhecida' }));
    const master = await request('GET', '/map/board?boardId=board-network');
    expect(master.json().boundaries).toHaveLength(1);
    for (const response of [await request('GET', '/map/board?boardId=board-network', 'player-1', 'player'), await request('GET', '/map/board?boardId=board-network&viewAsUserId=player-1')]) {
      expect(response.statusCode).toBe(200); expect(response.json().boundaries).toEqual([]);
      for (const secret of ['Reserva secreta', 'secret-boundary', 'loc.region', 'updatedBy']) expect(response.body).not.toContain(secret);
    }
    expect(prisma.mapBoard.updateMany).not.toHaveBeenCalled();
  });

  it('does not use a marked intermediate region to connect separate roads', async () => {
    board.roadNetwork = { ...road, nodes: [{ id: 'a', x: .1, y: .3 }, { id: 'b', x: .4, y: .3 }, { id: 'c', x: .6, y: .7 }, { id: 'd', x: .9, y: .7 }], edges: [{ id: 'west', from: 'a', to: 'b' }, { id: 'east', from: 'c', to: 'd' }] };
    board.boundaries = [{ id: 'region-area', regionId: 'loc.region', points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }], version: 1 }];
    expect((await request('GET', '/map/board?boardId=board-network')).json().boundaries).toHaveLength(1);
    expect((await request('GET', '/map/network/path?boardId=board-network&fromPinId=from&toPinId=to')).json()).toMatchObject({ status: 'no_path', reason: 'disconnected' });
  });

  it('reports an oversized reconstructed network specifically and retains the original for editing', async () => {
    const nodes = [], edges = [];
    for (let index = 1; index <= 70; index += 1) {
      const first = nodes.length;
      nodes.push({ id: `n${first}`, x: 0, y: index / 71 }, { id: `n${first + 1}`, x: 1, y: index / 71 }, { id: `n${first + 2}`, x: index / 71, y: 0 }, { id: `n${first + 3}`, x: index / 71, y: 1 });
      edges.push({ id: `e${first}`, from: `n${first}`, to: `n${first + 1}` }, { id: `e${first + 2}`, from: `n${first + 2}`, to: `n${first + 3}` });
    }
    board.roadNetwork = { ...road, nodes, edges };
    const before = structuredClone(board.roadNetwork);
    const path = (await request('GET', '/map/network/path?boardId=board-network&fromPinId=from&toPinId=to')).json();
    expect(path).toMatchObject({ status: 'no_path', reason: 'network_too_large' });
    expect(path.message).toContain('pontos ou trechos demais'); expect(path.message).not.toContain('Não existe caminho conectado');
    expect((await request('GET', '/map/network/destinations?boardId=board-network&fromPinId=from')).json()).toMatchObject({ status: 'no_path', reason: 'network_too_large', items: [] });
    expect((await request('GET', '/map/board?boardId=board-network')).json().roadNetwork).toEqual(before);
    expect((await request('PUT', '/map/network?boardId=board-network', 'gm-1', 'gm', before, { 'if-match': '4' })).statusCode).toBe(400);
    expect(prisma.mapBoard.updateMany).not.toHaveBeenCalled(); expect(board.roadNetwork).toEqual(before);
  });

  it('atomically normalizes and persists a crossing with updated version and no catalog writes', async () => {
    const input = { ...road, nodes: [...road.nodes, { id: 'north', x: .5, y: 0 }, { id: 'south', x: .5, y: 1 }], edges: [...road.edges, { id: 'cross', from: 'north', to: 'south' }] };
    prisma.mapBoard.updateMany.mockImplementation(({ where, data }) => { expect(where).toEqual({ id: board.id, campaignId: 'campaign-1', version: 4 }); board = { ...board, roadNetwork: data.roadNetwork, version: 5 }; return Promise.resolve({ count: 1 }); });
    const response = await request('PUT', '/map/network?boardId=board-network', 'gm-1', 'gm', input, { 'if-match': '4' });
    expect(response.statusCode).toBe(200);
    expect(response.json().roadNetwork).toEqual(normalizeRoadNetwork(input));
    expect(response.json().version).toBe(5);
    expect(prisma.mapRoute.create).not.toHaveBeenCalled();
    expect(prisma.entity.findUnique).not.toHaveBeenCalled();
  });

  it('requires GM, If-Match and a valid graph and detects concurrent updates', async () => {
    expect((await request('PUT', '/map/network', 'player-1', 'player', road, { 'if-match': '4' })).statusCode).toBe(403);
    expect((await request('PUT', '/map/network', 'gm-1', 'gm', road)).statusCode).toBe(428);
    expect((await request('PUT', '/map/network', 'gm-1', 'gm', road, { 'if-match': '3' })).statusCode).toBe(409);
    expect((await request('PUT', '/map/network', 'gm-1', 'gm', { ...road, secret: 'name' }, { 'if-match': '4' })).statusCode).toBe(400);
    expect(prisma.mapBoard.updateMany).not.toHaveBeenCalled();
    prisma.mapBoard.updateMany.mockResolvedValue({ count: 0 });
    expect((await request('PUT', '/map/network', 'gm-1', 'gm', road, { 'if-match': '4' })).statusCode).toBe(409);
  });

  it('queries middle-of-edge accesses without scale or writes; calibration includes both accesses', async () => {
    const path = '/map/network/path?boardId=board-network&fromPinId=from&toPinId=to';
    const response = await request('GET', path, 'player-1', 'player');
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'found', distanceKm: null, version: 4, accessFrom: [{ x: .2, y: .3 }, { x: .2, y: .5 }] });
    expect(response.json().distancePixels).toBeCloseTo(800);
    Object.assign(board, { scaleStartX: 0, scaleStartY: .5, scaleEndX: 1, scaleEndY: .5, scaleImageWidth: 1000, scaleImageHeight: 500, scaleDistanceKm: 10 });
    expect((await request('GET', path, 'player-1', 'player')).json().distanceKm).toBeCloseTo(8);
    expect(prisma.mapBoard.updateMany).not.toHaveBeenCalled();
    expect(prisma.mapRoute.create).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('offers alternatives and consults a chosen physical edge without saving a route', async () => {
    board.pins[0].y = .5; board.pins[1].y = .5;
    board.roadNetwork = { ...road, nodes: [{ id: 'west', x: .2, y: .5 }, { id: 'east', x: .8, y: .5 }, { id: 'nw', x: .2, y: .2 }, { id: 'ne', x: .8, y: .2 }], edges: [...road.edges, { id: 'up-west', from: 'west', to: 'nw' }, { id: 'north', from: 'nw', to: 'ne' }, { id: 'up-east', from: 'ne', to: 'east' }] };
    const url = '/map/network/path?boardId=board-network&fromPinId=from&toPinId=to';
    const result = (await request('GET', url)).json();
    expect(result.alternatives).toHaveLength(2);
    expect(result.alternatives[0].distancePixels).toBeCloseTo(600);
    expect(result.alternatives[1].distancePixels).toBeCloseTo(900);
    const via = (await request('GET', `${url}&viaEdgeId=north`)).json();
    expect(via.edgeIds).toContain('north');
    expect(via.distancePixels).toBeCloseTo(900);
    expect((await request('GET', `${url}&viaEdgeId=other-board-edge`)).statusCode).toBe(400);
    expect(prisma.mapBoard.updateMany).not.toHaveBeenCalled();
    expect(prisma.mapRoute.create).not.toHaveBeenCalled();
  });

  it('lists a connected middle branch alongside existing alternatives and counts its return', async () => {
    board.pins[0].y = .5; board.pins[1].y = .5;
    board.roadNetwork = { ...road, nodes: [{ id: 'west', x: .2, y: .5 }, { id: 'east', x: .8, y: .5 }, { id: 'middle', x: .5, y: .5 }, { id: 'north', x: .5, y: .2 }, { id: 'branch-end', x: .5, y: .8 }], edges: [
      { id: 'main-west', from: 'west', to: 'middle' }, { id: 'main-east', from: 'middle', to: 'east' },
      { id: 'upper-west', from: 'west', to: 'north' }, { id: 'upper-east', from: 'north', to: 'east' },
      { id: 'middle-branch', from: 'middle', to: 'branch-end' }
    ] };
    const result = (await request('GET', '/map/network/path?boardId=board-network&fromPinId=from&toPinId=to')).json();
    expect(result.alternatives).toHaveLength(3);
    const branch = result.alternatives.find(path => path.edgeIds.includes('middle-branch'));
    expect(branch.requiresReturn).toBe(true);
    expect(branch.distancePixels).toBeCloseTo(900);
    expect(prisma.mapBoard.updateMany).not.toHaveBeenCalled();
    expect(prisma.mapRoute.create).not.toHaveBeenCalled();
  });

  it('automatically completes connected passage coverage beyond eight alternatives', async () => {
    board.pins[0].y = .5; board.pins[1].y = .5;
    const branches = Array.from({ length: 12 }, (_, index) => ({ id: `branch-${index}`, x: .32 + index * .04, y: .9 }));
    board.roadNetwork = { ...road, nodes: [{ id: 'west', x: .2, y: .5 }, { id: 'middle', x: .3, y: .5 }, { id: 'east', x: .8, y: .5 }, ...branches], edges: [
      { id: 'main-west', from: 'west', to: 'middle' }, { id: 'main-east', from: 'middle', to: 'east' },
      ...branches.map(branch => ({ id: `edge-${branch.id}`, from: 'middle', to: branch.id }))
    ] };
    const result = (await request('GET', '/map/network/path?boardId=board-network&fromPinId=from&toPinId=to')).json();
    expect(result.alternatives).toHaveLength(13);
    expect(new Set(result.alternatives.flatMap(path => path.edgeIds))).toEqual(new Set(board.roadNetwork.edges.map(edge => edge.id)));
    expect(result.truncated).toBeUndefined();
    expect(prisma.mapBoard.updateMany).not.toHaveBeenCalled();
  });

  it('returns only reachable authorized destinations starting from the selected origin', async () => {
    board.pins.push({ id: 'secret', entityType: 'location', entityId: 'loc.secret', x: .4, y: .5 });
    board.travelMarkers = [{ id: 'wagon', ownerType: 'custom', name: 'Carroça', x: .5, y: .5, version: 1 }];
    getEntityForRequest.mockImplementation(({ domainId }) => Promise.resolve(domainId === 'loc.secret' ? null : { id: domainId, name: domainId }));
    const response = await request('GET', '/map/network/destinations?boardId=board-network&fromPinId=wagon', 'player-1', 'player');
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ version: 4, fromPinId: 'wagon', items: [expect.objectContaining({ toPinId: 'from' }), expect.objectContaining({ toPinId: 'to' })] });
    expect(response.body).not.toContain('secret');
    expect((await request('GET', '/map/network/path?boardId=board-network&fromPinId=wagon&toPinId=to', 'player-1', 'player')).json().status).toBe('found');
    expect((await request('GET', '/map/network/destinations?boardId=board-network&fromPinId=secret', 'player-1', 'player')).statusCode).toBe(404);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('groups repeated territory accesses without dropping a selected interior passage or persisting changes', async () => {
    Object.assign(board.pins[0], { x: .2, y: .45 }); Object.assign(board.pins[1], { x: .9, y: .5 });
    board.boundaries = [{ id: 'town-land', regionId: board.pins[0].entityId, points: [{ x: .1, y: .35 }, { x: .7, y: .35 }, { x: .7, y: .65 }, { x: .1, y: .65 }] }];
    board.roadNetwork = { ...road, nodes: [{ id: 'west', x: .1, y: .5 }, { id: 'east', x: .9, y: .5 }, { id: 'inner-north', x: .5, y: .4 }, { id: 'inner-south', x: .5, y: .6 }], edges: [...road.edges, { id: 'inner', from: 'inner-north', to: 'inner-south' }] };
    const url = '/map/network/path?boardId=board-network&fromPinId=from&toPinId=to';
    const result = (await request('GET', url)).json();
    const reverse = (await request('GET', '/map/network/path?boardId=board-network&fromPinId=to&toPinId=from')).json();
    const via = (await request('GET', `${url}&viaEdgeId=inner`)).json();
    expect(result.alternatives).toHaveLength(1); expect(reverse.alternatives).toHaveLength(1); expect(via.alternatives).toHaveLength(1);
    expect(via.edgeIds).toContain('inner'); expect(via.id).toBe(result.id);
    expect(via.distancePixels).toBeGreaterThan(result.distancePixels);
    expect(reverse.distancePixels).toBeCloseTo(result.distancePixels);
    expect(prisma.mapBoard.updateMany).not.toHaveBeenCalled(); expect(prisma.mapRoute.create).not.toHaveBeenCalled();
  });

  it('uses a territory as access to a road inside it, even when its center pin is nearer a disconnected road', async () => {
    board.pins = [{ id: 'from', entityType: 'location', entityId: 'loc.town', x: .1, y: .5 }, { id: 'to', entityType: 'location', entityId: 'loc.farm', x: .75, y: .8 }];
    board.boundaries = [{ id: 'farm-land', regionId: 'loc.farm', points: [{ x: .6, y: .1 }, { x: .9, y: .1 }, { x: .9, y: .9 }, { x: .6, y: .9 }] }];
    board.roadNetwork = { ...road, nodes: [...road.nodes, { id: 'other1', x: .6, y: .8 }, { id: 'other2', x: .9, y: .8 }], edges: [...road.edges, { id: 'disconnected', from: 'other1', to: 'other2' }] };
    expect((await request('GET', '/map/network/path?boardId=board-network&fromPinId=from&toPinId=to')).json().status).toBe('found');
    board.boundaries = [];
    expect((await request('GET', '/map/network/path?boardId=board-network&fromPinId=from&toPinId=to')).json()).toMatchObject({ status: 'no_path', reason: 'disconnected' });
  });

  it('recomputes catalog kilometers from the current network while preserving the stored value and directions', async () => {
    board.pins[1].entityType = 'location'; board.pins[1].entityId = 'loc.region';
    Object.assign(board, { scaleStartX: 0, scaleStartY: .5, scaleEndX: 1, scaleEndY: .5, scaleImageWidth: 1000, scaleImageHeight: 500, scaleDistanceKm: 10 });
    getEntityForRequest.mockImplementation(({ domainId }) => Promise.resolve({ id: domainId, name: domainId, connections: domainId === 'loc.town' ? [{ connectionId: 'out', targetId: 'loc.region', distanceKm: 77, target: { id: 'loc.region', name: 'Região', available: true } }] : [] }));
    const response = await request('GET', '/map/board?boardId=board-network');
    expect(response.json().distances).toEqual([expect.objectContaining({ fromLocationId: 'loc.town', toLocationId: 'loc.region', catalogDistanceKm: 77, distanceSource: 'network', networkStatus: 'found' })]);
    expect(response.json().distances[0].distanceKm).toBeCloseTo(8);
    expect(prisma.mapBoard.updateMany).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('never presents a stale catalog number as a disconnected network distance', async () => {
    board.pins[1].entityType = 'location'; board.pins[1].entityId = 'loc.region';
    board.roadNetwork = { ...road, nodes: [{ id: 'west', x: 0, y: .5 }, { id: 'a', x: .4, y: .5 }, { id: 'b', x: .6, y: .5 }, { id: 'east', x: 1, y: .5 }], edges: [{ id: 'west-road', from: 'west', to: 'a' }, { id: 'east-road', from: 'b', to: 'east' }] };
    getEntityForRequest.mockImplementation(({ domainId }) => Promise.resolve({ id: domainId, name: domainId, connections: domainId === 'loc.town' ? [{ connectionId: 'out', targetId: 'loc.region', distanceKm: 77, target: { id: 'loc.region', available: true } }] : [] }));
    const response = await request('GET', '/map/board?boardId=board-network');
    expect(response.json().distances).toEqual([expect.objectContaining({ catalogDistanceKm: 77, distanceKm: null, networkStatus: 'no_path', networkReason: 'disconnected' })]);
  });

  it('does not expose a hidden general-information target through catalog connection names', async () => {
    getEntityForRequest.mockImplementation(({ domainId, options }) => Promise.resolve(domainId === 'loc.region' && options.requireSection === 'basic' ? null : { id: domainId, name: domainId, connections: domainId === 'loc.town' ? [{ connectionId: 'out', targetId: 'loc.region', target: { id: 'loc.region', name: 'Informações secretas', available: true } }] : [] }));
    const response = await request('GET', '/map/board?boardId=board-network&viewAsUserId=player-1');
    expect(response.json().distances).toEqual([]);
    expect(response.body).not.toContain('Informações secretas');
    expect(response.body).not.toContain('loc.region');
  });

  it('filters preview on the server, requires location general information and rejects edits in preview', async () => {
    getEntityForRequest.mockImplementation(({ domainId, request: req, options }) => Promise.resolve(domainId === 'loc.town' && req.query.viewAsUserId && options.requireSection === 'basic' ? null : { id: domainId, name: domainId }));
    const query = '?boardId=board-network&viewAsUserId=player-1';
    const boardResponse = await request('GET', `/map/board${query}`);
    expect(boardResponse.statusCode).toBe(200);
    expect(boardResponse.json().pins.map((pin) => pin.id)).toEqual(['to']);
    expect(boardResponse.json().markerCandidates).toEqual([]);
    expect((await request('GET', `/map/network/path${query}&fromPinId=from&toPinId=to`)).statusCode).toBe(404);
    expect((await request('GET', `/map/pins/from/content${query}`)).statusCode).toBe(404);
    expect((await request('PUT', `/map/network${query}`, 'gm-1', 'gm', road, { 'if-match': '4' })).statusCode).toBe(403);
    prisma.membership.findUnique.mockResolvedValueOnce(null);
    expect((await request('GET', `/map/board${query}`)).statusCode).toBe(400);
    expect(prisma.mapBoard.updateMany).not.toHaveBeenCalled();
  });

  it('rejects hidden and foreign pins without exposing references or names', async () => {
    getEntityForRequest.mockImplementation(({ domainId }) => Promise.resolve(domainId === 'npc.traveler' ? null : { id: domainId }));
    const response = await request('GET', '/map/network/path?fromPinId=from&toPinId=to', 'player-1', 'player');
    expect(response.statusCode).toBe(404);
    expect(response.body).not.toContain('npc.traveler');
    expect((await request('GET', '/map/network/path?fromPinId=from&toPinId=foreign')).statusCode).toBe(404);
    const visible = await request('GET', '/map/board', 'player-1', 'player');
    expect(visible.json().roadNetwork).toEqual(road);
    expect(visible.body).not.toContain('npc.traveler');
  });

  it('isolates reads and writes by board and campaign and checks regional permission', async () => {
    board.campaignId = 'other-campaign';
    expect((await request('GET', '/map/network/path?boardId=board-network&fromPinId=from&toPinId=to')).statusCode).toBe(404);
    expect((await request('PUT', '/map/network?boardId=board-network', 'gm-1', 'gm', road, { 'if-match': '4' })).statusCode).toBe(404);
    board.campaignId = 'campaign-1'; board.regionId = 'loc.secret-region';
    getEntityForRequest.mockResolvedValue(null);
    expect((await request('GET', '/map/network/path?boardId=board-network&fromPinId=from&toPinId=to', 'player-1', 'player')).statusCode).toBe(404);
    expect(prisma.mapBoard.updateMany).not.toHaveBeenCalled();
  });

  it('preserves normalized coordinates and legacy data when replacing the image and clears scale', async () => {
    const response = await request('PATCH', '/map/board', 'gm-1', 'gm', { imageUrl: 'https://example.test/new.png', imageWidth: 2000, imageHeight: 1500 }, { 'if-match': '4' });
    expect(response.statusCode).toBe(200);
    expect(prisma.mapBoard.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ roadNetwork: { ...road, imageWidth: 2000, imageHeight: 1500 }, scaleDistanceKm: null, scaleKm: null }) }));
    expect(prisma.mapRoute.deleteMany).not.toHaveBeenCalled();
    expect(prisma.mapLocationPin.deleteMany).not.toHaveBeenCalled();
  });
});
const session = { id: 'session-1', campaignId: 'campaign-1', label: 'Sessão', startedAt: new Date('2026-01-01'), endedAt: null, createdBy: { id: 'gm-1', name: 'Mestre', login: 'gm' } };

beforeEach(async () => {
  vi.clearAllMocks();
  app = Fastify();
  await app.register(mapRoutes);
  prisma.$transaction.mockImplementation((callback) => callback(prisma));
  prisma.mapSession.findFirst.mockResolvedValue(session);
  prisma.entity.findUnique.mockResolvedValue({ domainId: 'loc.town', deletedAt: null });
  prisma.entity.findMany.mockResolvedValue([
    { domainId: 'loc.region', name: 'Região', type: 'location', data: { type: 'region' }, deletedAt: null, locationConnections: [] },
    { domainId: 'loc.town', name: 'Cidade', type: 'location', data: { type: 'location', parentId: 'loc.region' }, deletedAt: null, locationConnections: [] }
  ]);
  prisma.membership.findUnique.mockResolvedValue({ userId: 'player-1', role: 'player' });
  prisma.membership.findMany.mockResolvedValue([]);
  prisma.group.findMany.mockResolvedValue([]);
  prisma.user.findMany.mockResolvedValue([]);
  prisma.mapBoard.updateMany.mockResolvedValue({ count: 1 });
  prisma.mapBoard.deleteMany.mockResolvedValue({ count: 1 });
  prisma.mapRegionBoundary.updateMany.mockResolvedValue({ count: 1 });
  prisma.mapRegionBoundary.deleteMany.mockResolvedValue({ count: 1 });
  prisma.mapLocationPin.updateMany.mockResolvedValue({ count: 1 });
  prisma.mapRoute.updateMany.mockResolvedValue({ count: 1 });
  prisma.mapRoutePoint.updateMany.mockResolvedValue({ count: 1 });
  getEntityForRequest.mockResolvedValue({ id: 'loc.town' });
});

describe('travel marker API', () => {
  let board;
  beforeEach(() => {
    board = { id: 'travel-board', campaignId: 'campaign-1', name: 'Mapa', version: 7, pins: [], regions: [], boundaries: [], routes: [], roadNetwork: road, travelMarkers: [] };
    prisma.mapBoard.findUnique.mockImplementation(() => Promise.resolve(board));
    prisma.mapBoard.updateMany.mockImplementation(({ where }) => {
      if (where.version !== board.version) return Promise.resolve({ count: 0 });
      board.version += 1;
      return Promise.resolve({ count: 1 });
    });
    prisma.mapTravelMarker.create.mockImplementation(({ data }) => { const marker = { id: `travel-${board.travelMarkers.length}`, ...data, version: 1 }; board.travelMarkers.push(marker); return Promise.resolve(marker); });
    prisma.mapTravelMarker.updateMany.mockImplementation(({ where, data }) => {
      const marker = board.travelMarkers.find((entry) => entry.id === where.id && entry.version === where.version);
      if (!marker) return Promise.resolve({ count: 0 });
      Object.assign(marker, data, { version: marker.version + 1 });
      return Promise.resolve({ count: 1 });
    });
    prisma.mapTravelMarker.deleteMany.mockImplementation(({ where }) => { const count = board.travelMarkers.length; board.travelMarkers = board.travelMarkers.filter((entry) => entry.id !== where.id || entry.version !== where.version); return Promise.resolve({ count: count - board.travelMarkers.length }); });
    prisma.membership.findUnique.mockResolvedValue({ role: 'player', user: { name: 'Messi' } });
    getEntityForRequest.mockResolvedValue(null);
  });

  it('stores a wagon snapped to the shared road and moves/removes it with versions', async () => {
    const created = await request('POST', '/map/markers?boardId=travel-board', 'gm-1', 'gm', { ownerType: 'custom', name: 'Carroça', x: .3, y: .8 });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ version: 8, travelMarkers: [{ id: 'travel-0', ownerType: 'custom', ownerId: null, name: 'Carroça', x: .3, y: .5, version: 1, canMove: true }] });
    const moved = await request('PATCH', '/map/markers/travel-0?boardId=travel-board', 'gm-1', 'gm', { x: .8, y: .2 }, { 'if-match': '1' });
    expect(moved.json()).toMatchObject({ version: 9, travelMarkers: [{ x: .8, y: .5, version: 2 }] });
    expect((await request('DELETE', '/map/markers/travel-0?boardId=travel-board', 'gm-1', 'gm', undefined, { 'if-match': '2' })).statusCode).toBe(204);
    expect(board.travelMarkers).toEqual([]);
    expect(prisma.mapPosition.create).not.toHaveBeenCalled();
    expect(prisma.mapRoute.create).not.toHaveBeenCalled();
  });

  it('lets a player position only their own marker and shows other shared markers without movement permission', async () => {
    const created = await request('POST', '/map/markers?boardId=travel-board', 'player-1', 'player', { ownerType: 'player', x: .5, y: .1 });
    expect(created.statusCode).toBe(201);
    expect(created.json().travelMarkers[0]).toMatchObject({ ownerId: 'player-1', name: 'Messi', y: .5, canMove: true });
    expect(created.json().markerCandidates).toEqual([{ ownerType: 'player', ownerId: 'player-1', name: 'Meu pin' }]);
    board.travelMarkers.push({ id: 'other', ownerType: 'player', ownerId: 'player-2', name: 'Outra pessoa', x: .8, y: .5, version: 1 });
    expect((await request('GET', '/map/board?boardId=travel-board', 'player-1', 'player')).json().travelMarkers[1].canMove).toBe(false);
    expect((await request('POST', '/map/markers', 'player-1', 'player', { ownerType: 'custom', x: .1, y: .2 })).statusCode).toBe(403);
    expect((await request('POST', '/map/markers', 'player-1', 'player', { ownerType: 'player', ownerId: 'player-2', x: .1, y: .2 })).statusCode).toBe(403);
    expect((await request('PATCH', '/map/markers/other', 'player-1', 'player', { x: .1, y: .2 }, { 'if-match': '1' })).statusCode).toBe(403);
    expect((await request('DELETE', '/map/markers/other', 'player-1', 'player', undefined, { 'if-match': '1' })).statusCode).toBe(403);
  });

  it('checks marker versions, isolation and campaign ownership before writing', async () => {
    board.travelMarkers.push({ id: 'marker', ownerType: 'custom', name: 'Carroça', x: .8, y: .5, version: 2 });
    const payload = { x: .1, y: .2 };
    expect((await request('PATCH', '/map/markers/marker', 'gm-1', 'gm', payload)).statusCode).toBe(428);
    expect((await request('PATCH', '/map/markers/marker', 'gm-1', 'gm', payload, { 'if-match': '1' })).statusCode).toBe(409);
    expect((await request('PATCH', '/map/markers/foreign-marker', 'gm-1', 'gm', payload, { 'if-match': '2' })).statusCode).toBe(404);
    expect(prisma.mapTravelMarker.updateMany).not.toHaveBeenCalled();
    prisma.membership.findUnique.mockResolvedValueOnce(null);
    expect((await request('POST', '/map/markers', 'gm-1', 'gm', { ownerType: 'player', ownerId: 'foreign-player', ...payload })).statusCode).toBe(404);
    prisma.group.findUnique.mockResolvedValueOnce(null);
    expect((await request('POST', '/map/markers', 'gm-1', 'gm', { ownerType: 'group', ownerId: 'foreign-group', ...payload })).statusCode).toBe(404);
    board.campaignId = 'another-campaign';
    expect((await request('POST', '/map/markers?boardId=travel-board', 'gm-1', 'gm', { ownerType: 'custom', ...payload })).statusCode).toBe(404);
    expect(prisma.mapTravelMarker.create).not.toHaveBeenCalled();
  });

  it('keeps uncalibrated coordinates without a road and prevents preview mutations', async () => {
    board.roadNetwork = null;
    const payload = { ownerType: 'custom', name: 'Carroça', x: .17, y: .83 };
    const result = await request('POST', '/map/markers?boardId=travel-board', 'gm-1', 'gm', payload);
    expect(result.json().travelMarkers[0]).toMatchObject({ x: .17, y: .83 });
    const preview = await request('GET', '/map/board?boardId=travel-board&viewAsUserId=player-1');
    expect(preview.json().travelMarkers[0].canMove).toBe(false);
    expect((await request('POST', '/map/markers?boardId=travel-board&viewAsUserId=player-1', 'gm-1', 'gm', payload)).statusCode).toBe(403);
    expect((await request('PATCH', '/map/markers/travel-0?boardId=travel-board&viewAsUserId=player-1', 'gm-1', 'gm', { x: .2, y: .7 }, { 'if-match': '1' })).statusCode).toBe(403);
  });

  it('rolls back an in-flight map conflict before creating a marker', async () => {
    prisma.mapBoard.updateMany.mockResolvedValueOnce({ count: 0 });
    expect((await request('POST', '/map/markers', 'gm-1', 'gm', { ownerType: 'custom', x: .3, y: .1 })).statusCode).toBe(409);
    expect(prisma.mapTravelMarker.create).not.toHaveBeenCalled();
  });
});

describe('separate regional maps and boundaries', () => {
  const board = { id: 'board-general', campaignId: 'campaign-1', name: 'Geral', imageUrl: 'https://example.test/general.png', version: 2, regions: [], pins: [], routes: [], boundaries: [] };
  const polygon = [{ x: 0.1, y: 0.1 }, { x: 0.8, y: 0.1 }, { x: 0.6, y: 0.8 }];

  beforeEach(() => {
    prisma.mapBoard.findUnique.mockResolvedValue(board);
    getEntityForRequest.mockImplementation(({ domainId }) => Promise.resolve({ id: domainId, name: domainId === 'loc.region' ? 'Planícies' : 'Cidade', type: domainId === 'loc.region' ? 'region' : 'city', mapUrl: 'https://example.test/region.png' }));
  });

  it('lists the preserved general map and authorized regional maps', async () => {
    prisma.mapBoard.findMany.mockResolvedValue([board, { ...board, id: 'board-region', regionId: 'loc.region', name: 'Regional' }, { ...board, id: 'board-hidden', regionId: 'loc.hidden-region', name: 'Segredo' }]);
    prisma.entity.findMany.mockResolvedValue([{ domainId: 'loc.region', data: { type: 'region' } }, { domainId: 'loc.hidden-region', data: { type: 'region' } }]);
    getEntityForRequest.mockImplementation(({ domainId }) => Promise.resolve(domainId === 'loc.hidden-region' ? null : { id: domainId, name: 'Planícies', type: 'region', placement: { floor: '1' }, mapUrl: 'https://example.test/region.png' }));
    const response = await request('GET', '/map/boards', 'player-1', 'player');
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ items: [{ id: 'board-general', regionId: null, floor: null }, { id: 'board-region', regionId: 'loc.region', regionName: 'Planícies', floor: '1' }], regions: [{ id: 'loc.region', boardId: 'board-region', floor: '1' }] });
    expect(response.body).not.toContain('loc.hidden-region');
    expect(prisma.mapBoard.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { campaignId_boardKey: { campaignId: 'campaign-1', boardKey: 'general' } } }));
  });

  it('inherits the floor only from authorized ancestors in the list and selected board', async () => {
    const regional = { ...board, id: 'board-region', regionId: 'loc.region', name: 'Regional' };
    prisma.mapBoard.findMany.mockResolvedValue([regional]);
    prisma.mapBoard.findUnique.mockResolvedValue(regional);
    prisma.entity.findMany.mockResolvedValue([{ domainId: 'loc.region', data: { type: 'region' } }, { domainId: 'loc.floor', data: { type: 'floor', placement: { floor: '2' } } }]);
    const region = { id: 'loc.region', name: 'Planícies', type: 'region', parentId: 'loc.floor' };
    getEntityForRequest.mockImplementation(({ domainId }) => Promise.resolve(domainId === region.id ? region : { id: domainId, name: 'Andar', type: 'floor', placement: { floor: '2' } }));
    expect((await request('GET', '/map/boards', 'player-1', 'player')).json().items[0].floor).toBe('2');
    expect((await request('GET', '/map/board?boardId=board-region', 'player-1', 'player')).json().floor).toBe('2');
    getEntityForRequest.mockImplementation(({ domainId }) => Promise.resolve(domainId === region.id ? region : null));
    expect((await request('GET', '/map/boards', 'player-1', 'player')).json().items[0].floor).toBeNull();
    expect((await request('GET', '/map/board?boardId=board-region', 'player-1', 'player')).json().floor).toBeNull();
  });

  it('validates player preview even when there are no regional maps or visible entities', async () => {
    prisma.membership.findUnique.mockResolvedValue(null);
    prisma.entity.findMany.mockResolvedValue([]);
    const response = await request('GET', '/map/boards?viewAsUserId=foreign-player');
    expect(response.statusCode).toBe(400);
    expect(prisma.mapBoard.findUnique).not.toHaveBeenCalled();
    expect(prisma.mapBoard.findMany).not.toHaveBeenCalled();
  });

  it('creates an independent regional map from the existing region image', async () => {
    prisma.mapBoard.create.mockImplementation(({ data }) => Promise.resolve({ ...board, ...data, id: 'board-region' }));
    const response = await request('POST', '/map/boards', 'gm-1', 'gm', { regionId: 'loc.region' });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({ id: 'board-region', regionId: 'loc.region', imageUrl: 'https://example.test/region.png', pins: [], routes: [] });
    expect(prisma.mapBoard.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ campaignId: 'campaign-1', boardKey: 'region:loc.region', regionId: 'loc.region' }) }));
    expect(prisma.mapLocationPin.create).not.toHaveBeenCalled();
  });

  it('rejects invalid regions, duplicates, foreign maps and hidden maps', async () => {
    expect((await request('POST', '/map/boards', 'gm-1', 'gm', { regionId: 'loc.town' })).statusCode).toBe(404);
    prisma.mapBoard.create.mockRejectedValueOnce({ code: 'P2002' });
    expect((await request('POST', '/map/boards', 'gm-1', 'gm', { regionId: 'loc.region' })).statusCode).toBe(409);
    prisma.mapBoard.findUnique.mockResolvedValueOnce({ ...board, campaignId: 'campaign-other' });
    expect((await request('GET', '/map/board?boardId=board-general')).statusCode).toBe(404);
    prisma.mapBoard.findUnique.mockResolvedValueOnce({ ...board, regionId: 'loc.hidden-region' });
    getEntityForRequest.mockResolvedValue(null);
    expect((await request('GET', '/map/board?boardId=board-general', 'player-1', 'player')).statusCode).toBe(404);
    expect(prisma.mapBoard.upsert).not.toHaveBeenCalled();
  });

  it.each([null, 'loc.region'])('deletes the selected board with campaign and version checks (region: %s)', async (regionId) => {
    prisma.mapBoard.findUnique.mockResolvedValue({ ...board, regionId });
    const emit = vi.fn(); app.decorate('realtime', { to: vi.fn(() => ({ emit })) });
    const response = await request('DELETE', '/map/boards/board-general?boardId=another-board', 'gm-1', 'gm', undefined, { 'if-match': '2' });
    expect(response.statusCode).toBe(204);
    expect(prisma.mapBoard.deleteMany).toHaveBeenCalledWith({ where: { id: 'board-general', campaignId: 'campaign-1', version: 2 } });
    expect(prisma.mapBoard.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'board-general' } }));
    expect(prisma.mapBoard.upsert).not.toHaveBeenCalled();
    expect(emit).toHaveBeenCalledWith('map.layout.changed', { boardId: 'board-general', reason: 'board-deleted' });
  });

  it('rejects deleting boards without a version or after concurrent changes', async () => {
    expect((await request('DELETE', '/map/boards/board-general')).statusCode).toBe(428);
    expect(prisma.mapBoard.deleteMany).not.toHaveBeenCalled();
    prisma.mapBoard.deleteMany.mockResolvedValueOnce({ count: 0 });
    const response = await request('DELETE', '/map/boards/board-general', 'gm-1', 'gm', undefined, { 'if-match': '1' });
    expect(response.statusCode).toBe(409);
    expect(response.json().error.code).toBe('VERSION_CONFLICT');
  });

  it('rejects board deletion by players and outside the current campaign', async () => {
    expect((await request('DELETE', '/map/boards/board-general', 'player-1', 'player', undefined, { 'if-match': '2' })).statusCode).toBe(403);
    expect(prisma.mapBoard.findUnique).not.toHaveBeenCalled();
    prisma.mapBoard.findUnique.mockResolvedValueOnce({ ...board, campaignId: 'campaign-other' });
    expect((await request('DELETE', '/map/boards/board-general', 'gm-1', 'gm', undefined, { 'if-match': '2' })).statusCode).toBe(404);
    prisma.mapBoard.findUnique.mockResolvedValueOnce(null);
    expect((await request('DELETE', '/map/boards/missing-board', 'gm-1', 'gm', undefined, { 'if-match': '2' })).statusCode).toBe(404);
    expect(prisma.mapBoard.deleteMany).not.toHaveBeenCalled();
    expect(prisma.mapBoard.upsert).not.toHaveBeenCalled();
  });

  it('creates the same entity pin independently on the selected board', async () => {
    prisma.mapBoard.findUnique.mockResolvedValue({ ...board, id: 'board-region', regionId: 'loc.region' });
    const response = await request('POST', '/map/pins?boardId=board-region', 'gm-1', 'gm', { entityType: 'location', entityId: 'loc.town', x: 0.2, y: 0.4 });
    expect(response.statusCode).toBe(201);
    expect(prisma.mapLocationPin.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ boardId: 'board-region', entityId: 'loc.town' }) }));
    expect(prisma.mapBoard.findUnique).not.toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ campaignId_boardKey: expect.anything() }) }));
  });

  it('edits only the distance of an existing ruler on its board', async () => {
    const scaled = { ...board, id: 'board-region', regionId: 'loc.region', scaleStartX: 0.1, scaleStartY: 0.2, scaleEndX: 0.5, scaleEndY: 0.2, scaleDistanceKm: 20, scaleImageWidth: 1000, scaleImageHeight: 600 };
    prisma.mapBoard.findUnique.mockResolvedValue(scaled);
    const response = await request('PATCH', '/map/board/scale?boardId=board-region', 'gm-1', 'gm', { distanceKm: 40 }, { 'if-match': '2' });
    expect(response.statusCode).toBe(200);
    expect(prisma.mapBoard.updateMany).toHaveBeenCalledWith({ where: { id: 'board-region', campaignId: 'campaign-1', version: 2 }, data: expect.objectContaining({ scaleDistanceKm: 40, scaleStartX: 0.1, scaleEndX: 0.5, scaleImageWidth: 1000, scaleImageHeight: 600 }) });
    expect(prisma.$transaction).toHaveBeenCalled();
    prisma.mapBoard.findUnique.mockResolvedValue(board);
    expect((await request('PATCH', '/map/board/scale', 'gm-1', 'gm', { distanceKm: 40 }, { 'if-match': '2' })).json().error.code).toBe('MAP_SCALE_REQUIRED');
  });

  it('persists normalized region boundaries and emits only identifiers', async () => {
    prisma.mapRegionBoundary.create.mockResolvedValue({ id: 'boundary-1' });
    const emit = vi.fn(); app.realtime = { to: vi.fn(() => ({ emit })) };
    const response = await request('POST', '/map/boundaries?boardId=board-general', 'gm-1', 'gm', { regionId: 'loc.region', points: polygon });
    expect(response.statusCode).toBe(201);
    expect(prisma.mapRegionBoundary.create).toHaveBeenCalledWith({ data: { boardId: 'board-general', regionId: 'loc.region', points: polygon, updatedByUserId: 'gm-1' } });
    expect(emit).toHaveBeenCalledWith('map.layout.changed', { boardId: 'board-general', boundaryId: 'boundary-1', reason: 'boundary-created' });
  });

  it('allows a farm territory inside a regional map', async () => {
    prisma.mapBoard.findUnique.mockResolvedValue({ ...board, regionId: 'loc.region' });
    prisma.mapRegionBoundary.create.mockResolvedValue({ id: 'farm-territory' });
    const response = await request('POST', '/map/boundaries', 'gm-1', 'gm', { regionId: 'loc.town', points: polygon });
    expect(response.statusCode).toBe(201);
    expect(prisma.mapRegionBoundary.create).toHaveBeenCalledWith({ data: { boardId: board.id, regionId: 'loc.town', points: polygon, updatedByUserId: 'gm-1' } });
  });

  it('increments the board revision atomically when territory accesses change', async () => {
    const current = { ...board, boundaries: [] };
    prisma.mapBoard.findUnique.mockImplementation(() => Promise.resolve(current));
    prisma.mapBoard.updateMany.mockImplementation(({ where }) => { expect(where.version).toBe(current.version); current.version += 1; return Promise.resolve({ count: 1 }); });
    prisma.mapRegionBoundary.create.mockImplementation(({ data }) => { const boundary = { ...data, id: 'land', version: 1 }; current.boundaries.push(boundary); return Promise.resolve(boundary); });
    prisma.mapRegionBoundary.updateMany.mockImplementation(({ data }) => { Object.assign(current.boundaries[0], { points: data.points, version: 2 }); return Promise.resolve({ count: 1 }); });
    prisma.mapRegionBoundary.deleteMany.mockImplementation(() => { current.boundaries = []; return Promise.resolve({ count: 1 }); });
    expect((await request('POST', '/map/boundaries', 'gm-1', 'gm', { regionId: 'loc.town', points: polygon })).json().version).toBe(3);
    expect((await request('PATCH', '/map/boundaries/land', 'gm-1', 'gm', { points: polygon }, { 'if-match': '1' })).json().version).toBe(4);
    expect((await request('DELETE', '/map/boundaries/land', 'gm-1', 'gm', undefined, { 'if-match': '2' })).statusCode).toBe(204);
    expect(current.version).toBe(5);
    expect(prisma.$transaction).toHaveBeenCalledTimes(3);
  });

  it('does not create a territory after an in-flight board revision conflict', async () => {
    prisma.mapBoard.updateMany.mockResolvedValueOnce({ count: 0 });
    const response = await request('POST', '/map/boundaries', 'gm-1', 'gm', { regionId: 'loc.town', points: polygon });
    expect(response.statusCode).toBe(409);
    expect(prisma.mapRegionBoundary.create).not.toHaveBeenCalled();
  });

  it('filters hidden boundaries and rejects invalid polygons and non-GM edits', async () => {
    prisma.mapBoard.findUnique.mockResolvedValue({ ...board, boundaries: [{ id: 'boundary-1', regionId: 'loc.region', points: polygon, version: 1 }, { id: 'boundary-hidden', regionId: 'loc.hidden-region', points: polygon, version: 1 }] });
    const visible = await request('GET', '/map/board', 'player-1', 'player');
    expect(visible.json().boundaries).toEqual([{ id: 'boundary-1', regionId: 'loc.region', name: 'Planícies', label: null, locationName: 'Planícies', updatedBy: null, points: polygon, version: 1 }]);
    const invalidPolygons = [polygon.slice(0, 2), [{ x: 0, y: 0 }, { x: 0.2, y: 0.2 }, { x: 0.4, y: 0.4 }], [{ x: -0.1, y: 0 }, ...polygon]];
    for (const points of invalidPolygons) expect((await request('POST', '/map/boundaries', 'gm-1', 'gm', { regionId: 'loc.region', points })).statusCode).toBe(400);
    expect((await request('POST', '/map/boundaries', 'player-1', 'player', { regionId: 'loc.region', points: polygon })).statusCode).toBe(403);
    expect(prisma.mapRegionBoundary.create).not.toHaveBeenCalled();
  });

  it('enforces boundary versions and board isolation for updates and removals', async () => {
    prisma.mapBoard.findUnique.mockResolvedValue({ ...board, boundaries: [{ id: 'boundary-1', regionId: 'loc.region', points: polygon, version: 2 }] });
    expect((await request('PATCH', '/map/boundaries/boundary-1', 'gm-1', 'gm', { points: polygon })).statusCode).toBe(428);
    prisma.mapRegionBoundary.updateMany.mockResolvedValueOnce({ count: 0 });
    expect((await request('PATCH', '/map/boundaries/boundary-1', 'gm-1', 'gm', { points: polygon }, { 'if-match': '1' })).statusCode).toBe(409);
    expect(prisma.mapRegionBoundary.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'boundary-1', boardId: 'board-general', version: 1 } }));
    expect((await request('DELETE', '/map/boundaries/boundary-other', 'gm-1', 'gm', undefined, { 'if-match': '2' })).statusCode).toBe(404);
    expect((await request('DELETE', '/map/boundaries/boundary-1', 'gm-1', 'gm', undefined, { 'if-match': '2' })).statusCode).toBe(204);
  });

  it('retargets and renames a boundary without changing its drawing and exposes the last editor', async () => {
    const current = { ...board, boundaries: [{ id: 'land-edit', regionId: 'loc.region', points: polygon, version: 2, updatedBy: { id: 'gm-1', name: 'Mestre' } }] };
    prisma.mapBoard.findUnique.mockResolvedValue(current);
    prisma.mapRegionBoundary.updateMany.mockImplementation(({ data }) => { Object.assign(current.boundaries[0], data, { version: 3 }); return Promise.resolve({ count: 1 }); });
    const response = await request('PATCH', '/map/boundaries/land-edit', 'gm-1', 'gm', { regionId: 'loc.town', name: 'Campos do moinho' }, { 'if-match': '2' });
    expect(response.statusCode).toBe(200);
    expect(response.json().boundaries[0]).toMatchObject({ id: 'land-edit', regionId: 'loc.town', label: 'Campos do moinho', name: 'Campos do moinho', locationName: 'Cidade', points: polygon, updatedBy: { id: 'gm-1', name: 'Mestre' } });
    expect(prisma.mapRegionBoundary.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ regionId: 'loc.town', name: 'Campos do moinho', updatedByUserId: 'gm-1' }) }));
  });

  it('validates retargeted locations, ownership and duplicate boundaries', async () => {
    prisma.mapBoard.findUnique.mockResolvedValue({ ...board, boundaries: [{ id: 'land-edit', regionId: 'loc.region', points: polygon, version: 2 }] });
    expect((await request('PATCH', '/map/boundaries/land-edit', 'player-1', 'player', { name: 'Outro nome' }, { 'if-match': '2' })).statusCode).toBe(403);
    getEntityForRequest.mockResolvedValue(null);
    expect((await request('PATCH', '/map/boundaries/land-edit', 'gm-1', 'gm', { regionId: 'loc.other-campaign' }, { 'if-match': '2' })).statusCode).toBe(404);
    expect(prisma.mapRegionBoundary.updateMany).not.toHaveBeenCalled();
    getEntityForRequest.mockResolvedValue({ id: 'loc.town', name: 'Cidade' });
    prisma.mapRegionBoundary.updateMany.mockRejectedValueOnce({ code: 'P2002' });
    expect((await request('PATCH', '/map/boundaries/land-edit', 'gm-1', 'gm', { regionId: 'loc.town' }, { 'if-match': '2' })).statusCode).toBe(409);
    expect((await request('PATCH', '/map/boundaries/land-edit', 'gm-1', 'gm', {}, { 'if-match': '2' })).statusCode).toBe(400);
  });

  it('loads associations in the clicked pin popup from its selected map', async () => {
    prisma.mapBoard.findUnique.mockResolvedValue({ ...board, id: 'board-region', regionId: 'loc.region', pins: [{ id: 'pin-town', entityType: 'location', entityId: 'loc.town' }] });
    const catalog = {
      'loc.region': { id: 'loc.region', name: 'Planícies', data: { type: 'region' } },
      'loc.town': { id: 'loc.town', name: 'Moinho', data: { type: 'farm', links: [{ type: 'monster', id: 'monster.boar', slot: 'references' }] } },
      'monster.boar': { id: 'monster.boar', name: 'Javali', data: { media: { image: 'https://example.test/boar.png' } } }
    };
    getEntityForRequest.mockImplementation(({ domainId }) => Promise.resolve(catalog[domainId] ?? null));
    const response = await request('GET', '/map/pins/pin-town/content?boardId=board-region&category=monstros', 'player-1', 'player');
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ pinId: 'pin-town', category: 'monstros', items: [{ type: 'monster', id: 'monster.boar', name: 'Javali', imageUrl: 'https://example.test/boar.png' }] });
    getEntityForRequest.mockImplementation(({ domainId }) => Promise.resolve(domainId === 'loc.town' ? null : catalog[domainId] ?? null));
    expect((await request('GET', '/map/pins/pin-town/content?boardId=board-region&category=monstros', 'player-1', 'player')).statusCode).toBe(404);
  });
});

afterEach(async () => { await app.close(); });

const request = (method, suffix, user = 'gm-1', role = 'gm', payload, extraHeaders = {}) => app.inject({
  method,
  url: `/api/v1/campaigns/campaign-1${suffix}`,
  headers: { 'x-user': user, 'x-role': role, ...extraHeaders },
  ...(payload ? { payload } : {})
});

describe('map position routes', () => {
  it('rejects a player trying to move another player marker', async () => {
    const response = await request('PATCH', '/map/positions/player/player-2', 'player-1', 'player', { locationId: 'loc.town', x: 0.2, y: 0.3 });
    expect(response.statusCode).toBe(403);
    expect(prisma.mapPosition.create).not.toHaveBeenCalled();
  });

  it('validates normalized coordinates on the server', async () => {
    const response = await request('PATCH', '/map/positions/group/group', 'gm-1', 'gm', { locationId: 'loc.town', x: 1.2, y: 0.3 });
    expect(response.statusCode).toBe(400);
    expect(prisma.mapPosition.create).not.toHaveBeenCalled();
  });

  it('persists a GM move and emits a campaign-scoped change event', async () => {
    const saved = { id: 'position-1', sessionId: session.id, ownerType: 'group', ownerId: 'group', locationId: 'loc.town', x: 0.2, y: 0.3, updatedByUserId: 'gm-1', updatedAt: new Date('2026-01-01') };
    prisma.mapPosition.findUnique.mockResolvedValue(null);
    prisma.mapPosition.create.mockResolvedValue(saved);
    prisma.mapPositionHistory.create.mockResolvedValue({ id: 'history-1' });
    const emit = vi.fn();
    app.realtime = { to: vi.fn(() => ({ emit })) };

    const response = await request('PATCH', '/map/positions/group/group', 'gm-1', 'gm', { locationId: 'loc.town', x: 0.2, y: 0.3 });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ position: { ownerType: 'group', locationId: 'loc.town', x: 0.2, y: 0.3 }, historyId: 'history-1', changed: true });
    expect(prisma.mapPositionHistory.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ previousLocationId: null, x: 0.2, y: 0.3 }) }));
    expect(app.realtime.to).toHaveBeenCalledWith('campaign:campaign-1');
    expect(emit).toHaveBeenCalledWith('map.position.changed', expect.objectContaining({ sessionId: session.id, ownerType: 'group' }));
  });

  it('keeps existing normalized coordinates when only the location changes', async () => {
    const current = { id: 'position-1', sessionId: session.id, ownerType: 'group', ownerId: 'group', locationId: 'loc.old', x: 0.25, y: 0.75, updatedByUserId: 'gm-1', updatedAt: new Date('2026-01-01') };
    const saved = { ...current, locationId: 'loc.town' };
    prisma.mapPosition.findUnique.mockResolvedValue(current);
    prisma.mapPosition.update.mockResolvedValue(saved);
    prisma.mapPositionHistory.create.mockResolvedValue({ id: 'history-2' });
    const response = await request('PATCH', '/map/positions/group/group', 'gm-1', 'gm', { locationId: 'loc.town' });
    expect(response.statusCode).toBe(200);
    expect(prisma.mapPosition.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ locationId: 'loc.town', x: 0.25, y: 0.75 }) }));
  });

  it('does not create history when the requested position is unchanged', async () => {
    const current = { id: 'position-1', sessionId: session.id, ownerType: 'group', ownerId: 'group', regionId: 'loc.region', locationId: 'loc.town', x: 0.25, y: 0.75, updatedByUserId: 'gm-1', updatedAt: new Date('2026-01-01') };
    prisma.mapPosition.findUnique.mockResolvedValue(current);
    const response = await request('PATCH', '/map/positions/group/group', 'gm-1', 'gm', { locationId: 'loc.town', regionId: 'loc.region', x: 0.25, y: 0.75 });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ changed: false, historyId: null });
    expect(prisma.mapPositionHistory.create).not.toHaveBeenCalled();
    expect(prisma.mapPosition.update).not.toHaveBeenCalled();
  });

  it('rejects a player trying to change a regional pin', async () => {
    const response = await request('PATCH', '/map/locations/loc.town/pin', 'player-1', 'player', { regionId: 'loc.region', x: 0.3, y: 0.4 });
    expect(response.statusCode).toBe(403);
    expect(prisma.mapLocationPin.update).not.toHaveBeenCalled();
  });

  it('returns an authorized regional board and filters hidden pins', async () => {
    const board = {
      id: 'board-1', campaignId: 'campaign-1', name: 'Mapa regional', updatedAt: new Date('2026-01-01'),
      regions: [{ id: 'board-region-1', regionId: 'loc.region', x: 0.1, y: 0.1, width: 0.8, height: 0.8, zIndex: 0, updatedAt: new Date('2026-01-01') }],
      pins: [{ id: 'pin-town', regionId: 'loc.region', locationId: 'loc.town', x: 0.4, y: 0.6, placementSource: 'auto', updatedAt: new Date('2026-01-01') }, { id: 'pin-secret', regionId: 'loc.region', locationId: 'loc.secret', x: 0.2, y: 0.2, placementSource: 'auto', updatedAt: new Date('2026-01-01') }]
    };
    prisma.mapBoard.findUnique.mockResolvedValue(board);
    getEntityForRequest.mockImplementation(({ domainId }) => domainId === 'loc.secret' ? null : Promise.resolve({ id: domainId, name: domainId === 'loc.region' ? 'Região' : 'Cidade', entityType: 'location', data: { type: domainId === 'loc.region' ? 'region' : 'location', media: { map: 'region.png' } }, connections: domainId === 'loc.town' ? [{ connectionId: 'road-1', targetId: 'loc.region', distanceKm: 12.5, travelMinutes: 20, target: { id: 'loc.region', name: 'Região', available: true } }] : [] }));
    const response = await request('GET', '/map/board');
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ pins: [{ locationId: 'loc.town' }] });
    expect(response.json().pins).toHaveLength(1);
    expect(response.json().distances).toMatchObject([{ fromLocationId: 'loc.town', toLocationId: 'loc.region', distanceKm: 12.5, travelMinutes: 20 }]);
  });

  it('allows the GM to adjust a regional pin and marks it manual', async () => {
    const board = { id: 'board-1', campaignId: 'campaign-1', name: 'Mapa regional', imageUrl: 'https://example.test/map.png', version: 1, updatedAt: new Date('2026-01-01'), regions: [{ id: 'board-region-1', regionId: 'loc.region', x: 0.1, y: 0.1, width: 0.8, height: 0.8, zIndex: 0, updatedAt: new Date('2026-01-01') }], pins: [{ id: 'pin-town', regionId: 'loc.region', locationId: 'loc.town', x: 0.4, y: 0.6, placementSource: 'auto', version: 1, updatedAt: new Date('2026-01-01') }] };
    prisma.mapBoard.findUnique.mockResolvedValue(board);
    getEntityForRequest.mockResolvedValue({ id: 'loc.town', name: 'Cidade', entityType: 'location', data: { type: 'location' }, connections: [] });
    const response = await request('PATCH', '/map/locations/loc.town/pin', 'gm-1', 'gm', { x: 0.7, y: 0.8 }, { 'if-match': '1' });
    expect(response.statusCode).toBe(200);
    expect(prisma.mapLocationPin.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'pin-town', boardId: 'board-1', version: 1 }, data: expect.objectContaining({ regionId: null, x: 0.7, y: 0.8, placementSource: 'manual' }) }));
  });

  it('keeps manually adjusted pins when recalculating the regional layout', async () => {
    const board = { id: 'board-1', campaignId: 'campaign-1', name: 'Mapa regional', updatedAt: new Date('2026-01-01'), regions: [{ id: 'board-region-1', regionId: 'loc.region', x: 0.1, y: 0.1, width: 0.8, height: 0.8, zIndex: 0, updatedAt: new Date('2026-01-01') }], pins: [{ id: 'pin-town', regionId: 'loc.region', locationId: 'loc.town', x: 0.7, y: 0.8, placementSource: 'manual', updatedAt: new Date('2026-01-01') }] };
    prisma.mapBoard.findUnique.mockResolvedValue(board);
    getEntityForRequest.mockResolvedValue({ id: 'loc.town', name: 'Cidade', entityType: 'location', data: { type: 'location' }, connections: [] });
    const response = await request('POST', '/map/board/auto-layout', 'gm-1', 'gm', {});
    expect(response.statusCode).toBe(200);
    expect(prisma.mapBoardRegion.update).toHaveBeenCalled();
    expect(prisma.mapLocationPin.update).not.toHaveBeenCalled();
  });

  it('requires the current map version before changing the map image', async () => {
    const board = { id: 'board-1', campaignId: 'campaign-1', name: 'Mapa', imageUrl: null, version: 3, updatedAt: new Date('2026-01-01'), regions: [], pins: [] };
    prisma.mapBoard.findUnique.mockResolvedValue(board);
    const missingVersion = await request('PATCH', '/map/board', 'gm-1', 'gm', { imageUrl: 'https://example.test/map.png' });
    expect(missingVersion.statusCode).toBe(428);
    prisma.mapBoard.updateMany.mockResolvedValueOnce({ count: 0 });
    const stale = await request('PATCH', '/map/board', 'gm-1', 'gm', { imageUrl: 'https://example.test/map.png' }, { 'if-match': '2' });
    expect(stale.statusCode).toBe(409);
    expect(prisma.mapBoard.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ version: 2 }) }));
  });

  it('creates a pin only for an existing location and returns its reference summary', async () => {
    const board = { id: 'board-1', campaignId: 'campaign-1', name: 'Mapa', imageUrl: 'https://example.test/map.png', version: 1, updatedAt: new Date('2026-01-01'), regions: [], pins: [] };
    prisma.mapBoard.findUnique.mockResolvedValue(board);
    prisma.mapLocationPin.create.mockResolvedValue({ id: 'pin-town', boardId: board.id, locationId: 'loc.town', regionId: null, x: 0.2, y: 0.3, version: 1, updatedAt: new Date('2026-01-01') });
    const response = await request('PATCH', '/map/locations/loc.town/pin', 'gm-1', 'gm', { x: 0.2, y: 0.3 }, { 'if-match': '0' });
    expect(response.statusCode).toBe(200);
    expect(prisma.mapLocationPin.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ locationId: 'loc.town', regionId: null, x: 0.2, y: 0.3 }) }));
  });

  it('returns authorized classification metadata and region names for pin candidates', async () => {
    prisma.mapBoard.findUnique.mockResolvedValue({ id: 'board-1', campaignId: 'campaign-1', regions: [], pins: [{ entityType: 'npc', entityId: 'npc.player' }] });
    const entities = [
      { entityType: 'location', id: 'loc.region', name: 'Planícies verdejantes', type: 'region' },
      { entityType: 'location', id: 'loc.city', name: 'Vila', type: 'city', parentId: 'loc.region' },
      { entityType: 'location', id: 'loc.grove', name: 'Bosque do Peregrino', type: 'grove', parentId: 'loc.city' },
      { entityType: 'npc', id: 'npc.entity', name: 'Entidade', characterType: 'entity' },
      { entityType: 'npc', id: 'npc.player', name: 'Personagem jogador', characterType: 'player' },
      { entityType: 'item', id: 'item.meat', name: 'Carne', category: 'material' },
      { entityType: 'monster', id: 'monster.elite', name: 'Elite', rank: 'elite' },
      { entityType: 'quest', id: 'quest.main', name: 'Missão principal', type: 'main' }
    ];
    prisma.entity.findMany.mockResolvedValue(entities.map((entity) => ({ type: entity.entityType, domainId: entity.id })));
    getEntityForRequest.mockImplementation(({ domainId }) => Promise.resolve(entities.find((entity) => entity.id === domainId)));

    const response = await request('GET', '/map/pin-candidates', 'player-1', 'player');
    expect(response.statusCode).toBe(200);
    expect(response.json().items).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'loc.region', pinType: 'region', color: '#8b5cf6' }),
      expect.objectContaining({ id: 'loc.grove', locationType: 'grove', regionId: 'loc.region', regionName: 'Planícies verdejantes' }),
      expect.objectContaining({ id: 'npc.entity', characterType: 'entity', pinned: false }),
      expect.objectContaining({ id: 'npc.player', characterType: 'player', pinned: true }),
      expect.objectContaining({ id: 'item.meat', category: 'material' }),
      expect.objectContaining({ id: 'monster.elite', rank: 'elite' }),
      expect.objectContaining({ id: 'quest.main', questType: 'main' })
    ]));
    expect(response.json().items.every((candidate) => !('entity' in candidate))).toBe(true);
  });

  it('never exposes a hidden region through a visible location pin candidate', async () => {
    prisma.mapBoard.findUnique.mockResolvedValue({ id: 'board-1', campaignId: 'campaign-1', regions: [], pins: [] });
    prisma.entity.findMany.mockResolvedValue([
      { type: 'location', domainId: 'loc.hidden-region' },
      { type: 'location', domainId: 'loc.visible' },
      { type: 'item', domainId: 'item.hidden' }
    ]);
    getEntityForRequest.mockImplementation(({ domainId }) => Promise.resolve(domainId === 'loc.visible'
      ? { id: domainId, name: 'Local visível', type: 'grove', parentId: 'loc.hidden-region' }
      : null));

    const response = await request('GET', '/map/pin-candidates', 'player-1', 'player');
    expect(response.statusCode).toBe(200);
    expect(response.json().items).toEqual([expect.objectContaining({ id: 'loc.visible', regionId: null, regionName: null })]);
    expect(response.body).not.toContain('loc.hidden-region');
    expect(response.body).not.toContain('item.hidden');
  });

  it('uses an authorized root area name without inventing a region for city descendants', async () => {
    prisma.mapBoard.findUnique.mockResolvedValue({ id: 'board-1', campaignId: 'campaign-1', regions: [], pins: [] });
    const entities = [
      { entityType: 'location', id: 'loc.city', name: 'Cidade do Início', type: 'city' },
      { entityType: 'location', id: 'loc.shop', name: 'Loja', type: 'shop', parentId: 'loc.city' }
    ];
    prisma.entity.findMany.mockResolvedValue(entities.map((entity) => ({ type: 'location', domainId: entity.id })));
    getEntityForRequest.mockImplementation(({ domainId }) => Promise.resolve(entities.find((entity) => entity.id === domainId)));
    const response = await request('GET', '/map/pin-candidates', 'player-1', 'player');
    expect(response.json().items).toContainEqual(expect.objectContaining({ id: 'loc.shop', regionId: null, regionName: null, areaName: 'Cidade do Início' }));
  });

  it('creates a map route only between two existing pins', async () => {
    const board = { id: 'board-1', campaignId: 'campaign-1', name: 'Mapa', imageUrl: 'https://example.test/map.png', scaleKm: 100, version: 1, updatedAt: new Date('2026-01-01'), regions: [], pins: [
      { id: 'pin-town', locationId: 'loc.town', regionId: null, x: 0.2, y: 0.3, version: 1, updatedAt: new Date('2026-01-01') },
      { id: 'pin-city', locationId: 'loc.city', regionId: null, x: 0.8, y: 0.7, version: 1, updatedAt: new Date('2026-01-01') }
    ], routes: [] };
    prisma.mapBoard.findUnique.mockResolvedValue(board);
    prisma.mapRoute.create.mockResolvedValue({ id: 'route-1', boardId: board.id, fromLocationId: 'loc.town', toLocationId: 'loc.city', distanceKm: 70, version: 1, points: [] });
    const response = await request('POST', '/map/routes', 'gm-1', 'gm', { fromLocationId: 'loc.town', toLocationId: 'loc.city', distanceKm: 70 });
    expect(response.statusCode).toBe(201);
    expect(prisma.mapRoute.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ fromLocationId: 'loc.town', toLocationId: 'loc.city', distanceKm: 70 }) }));
  });
});
