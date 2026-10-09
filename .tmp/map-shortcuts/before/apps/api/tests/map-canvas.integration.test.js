import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Server } from 'socket.io';
import { io as client } from 'socket.io-client';
import { prisma } from '../src/lib/prisma.js';
import { buildApp } from '../src/app.js';
import { hashToken } from '../src/lib/security.js';
import { campaignUserRoom } from '../src/lib/realtime.js';
import { createEntity } from '../src/services/content.js';
import { attachCanvasRealtime, canvasPings } from '../src/services/map-canvas.js';

describe.runIf(Boolean(process.env.TEST_DATABASE_URL))('shared map canvas and undo with PostgreSQL', () => {
  let app, io, campaign, board, region, gm, ana, beto, gmSocket, anaSocket, betoSocket;
  const accounts = [], sockets = [];
  const drawing = { kind: 'pencil', color: '#36e9ff', width: 3, opacity: .8, points: [{ x: .1, y: .2 }, { x: .3, y: .4 }] };
  const call = (method, path, payload, actor = gm, extra = {}) => app.inject({ method, url: `/api/v1/campaigns/${campaign.id}/map/${path}`, headers: { cookie: `sao_session=${actor.token}`, 'x-csrf-token': actor.csrf, ...extra }, ...(payload === undefined ? {} : { payload }) });
  const headers = version => ({ 'if-match': String(version) });
  const toggle = async (edit, direction, actor = gm, selected = board) => {
    const response = await call('POST', `edits/${edit.id}?boardId=${selected.id}`, { direction }, actor, headers(edit.version));
    expect(response.statusCode, response.body).toBe(200); return response.json().edit;
  };
  const createDrawing = async (actor = gm, selected = board, shape = drawing) => {
    const response = await call('POST', `drawings?boardId=${selected.id}`, shape, actor);
    expect(response.statusCode, response.body).toBe(201); return response.json();
  };
  const waitEvent = (socket, name, predicate = () => true) => new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { socket.off(name, handler); reject(new Error(`No ${name} event`)); }, 3000);
    const handler = data => { if (predicate(data)) { clearTimeout(timeout); socket.off(name, handler); resolve(data); } };
    socket.on(name, handler);
  });

  beforeAll(async () => {
    app = await buildApp();
    campaign = await prisma.campaign.create({ data: { slug: `canvas-${randomUUID()}`, name: 'Mapa de testes' } });
    for (const [name, role] of [['Mestre', 'owner'], ['Ana', 'player'], ['Beto', 'player']]) {
      const user = await prisma.user.create({ data: { login: `canvas-${randomUUID()}`, name, passwordHash: 'unused' } });
      const csrf = randomUUID(), token = randomUUID();
      const session = await prisma.session.create({ data: { userId: user.id, csrfToken: csrf, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 3600000) } });
      await prisma.membership.create({ data: { campaignId: campaign.id, userId: user.id, role } });
      accounts.push({ ...user, token, csrf, session });
    }
    [gm, ana, beto] = accounts;
    for (const input of [
      { id: 'loc.canvas-a', name: 'A', type: 'city', visibility: { entity: 'public' } },
      { id: 'loc.canvas-b', name: 'B', type: 'city', visibility: { entity: 'public' } },
      { id: 'loc.canvas-c', name: 'C', type: 'city', visibility: { entity: 'public' } },
      { id: 'loc.canvas-region', name: 'Região secreta', type: 'region', visibility: { entity: 'public', sections: { basic: 'gm' } } }
    ]) await createEntity({ campaignId: campaign.id, type: 'location', input, actorUserId: gm.id });
    board = await prisma.mapBoard.create({ data: { campaignId: campaign.id, name: 'Geral', imageUrl: 'https://map.test/general.png', createdByUserId: gm.id } });
    region = await prisma.mapBoard.create({ data: { campaignId: campaign.id, boardKey: 'region:loc.canvas-region', regionId: 'loc.canvas-region', name: 'Secreto', imageUrl: 'https://map.test/region.png', createdByUserId: gm.id } });
    await app.ready();
    io = new Server(app.server); app.realtime = io;
    io.use((socket, next) => {
      const actor = accounts.find(row => row.token === socket.handshake.auth.token);
      if (!actor) return next(new Error('unauthorized'));
      Object.assign(socket.data, { userId: actor.id, campaignId: campaign.id, csrfToken: actor.csrf, sessionId: actor.session.id, expiresAt: actor.session.expiresAt.getTime() });
      next();
    });
    io.on('connection', socket => { socket.join(`campaign:${campaign.id}`); socket.join(campaignUserRoom(campaign.id, socket.data.userId)); });
    attachCanvasRealtime(io);
    await app.listen({ port: 0, host: '127.0.0.1' });
    for (const actor of accounts) {
      const socket = client(`http://127.0.0.1:${app.server.address().port}`, { transports: ['websocket'], auth: { token: actor.token }, reconnection: false });
      sockets.push(socket); await waitEvent(socket, 'connect');
    }
    [gmSocket, anaSocket, betoSocket] = sockets;
  }, 20000);
  afterAll(async () => {
    for (const socket of sockets) socket.disconnect();
    io?.close(); await app?.close();
    if (campaign) await prisma.campaign.delete({ where: { id: campaign.id } });
    for (const actor of accounts) await prisma.user.delete({ where: { id: actor.id } });
    canvasPings.clear(); await prisma.$disconnect();
  });

  it('stores author and style and reloads drawings independently of road data', async () => {
    const created = await createDrawing(ana);
    const response = await call('GET', `drawings?boardId=${board.id}`, undefined, beto);
    expect(response.json()).toMatchObject({ boardId: board.id, userId: beto.id, items: [expect.objectContaining({ id: created.id, authorUserId: ana.id, authorName: 'Ana', ...drawing })] });
    expect((await prisma.mapBoard.findUnique({ where: { id: board.id } })).roadNetwork).toBeNull();
  });
  it('validates coordinates, kinds, text, colors and point limits', async () => {
    for (const invalid of [{ ...drawing, kind: 'script' }, { ...drawing, color: 'blue' }, { ...drawing, width: 100 }, { ...drawing, points: [{ x: 2, y: 0 }] }, { ...drawing, points: Array(2001).fill({ x: 0, y: 0 }) }, { ...drawing, kind: 'text', text: '' }]) {
      expect((await call('POST', 'drawings', invalid, ana)).statusCode).toBe(400);
    }
    for (const kind of ['line', 'arrow', 'rectangle', 'ellipse', 'text']) await createDrawing(ana, board, { ...drawing, kind, ...(kind === 'text' ? { text: 'Atenção', points: [{ x: .5, y: .5 }] } : {}) });
  });
  it('restricts players to their drawings and keeps preview mode read only', async () => {
    const created = await createDrawing(ana);
    expect((await call('DELETE', `drawings/${created.id}`, undefined, beto, headers(1))).statusCode).toBe(403);
    expect((await call('POST', `drawings?viewAsUserId=${ana.id}`, drawing)).statusCode).toBe(403);
    expect((await call('POST', 'drawings', drawing, ana, { 'x-csrf-token': 'wrong' })).statusCode).toBe(403);
    expect((await call('POST', 'drawings/clear', { scope: 'all', versions: [{ id: created.id, version: 1 }] }, ana)).statusCode).toBe(403);
    expect((await call('POST', `edits/${created.edit.id}`, { direction: 'undo' }, beto, headers(1))).statusCode).toBe(404);
    const erased = await call('DELETE', `drawings/${created.id}`, undefined, gm, headers(1));
    expect(erased.statusCode, erased.body).toBe(200);
    await toggle(erased.json().edit, 'undo');
  });
  it('rejects inaccessible regions and boards from another campaign', async () => {
    for (const [method, path, payload] of [['GET', 'drawings', undefined], ['POST', 'drawings', drawing], ['POST', 'pings', { x: .3, y: .4, color: '#ffffff' }]]) {
      expect((await call(method, `${path}?boardId=${region.id}`, payload, ana)).statusCode).toBe(404);
    }
    expect((await call('GET', `drawings?boardId=${region.id}&viewAsUserId=${ana.id}`)).statusCode).toBe(404);
    expect((await call('GET', 'drawings?boardId=missing', undefined, ana)).statusCode).toBe(404);
    const other = await prisma.campaign.create({ data: { slug: `other-${randomUUID()}`, name: 'Outra' } });
    const foreign = await prisma.mapBoard.create({ data: { campaignId: other.id, name: 'Outra', imageUrl: 'https://map.test/x.png', createdByUserId: gm.id } });
    expect((await call('POST', `drawings?boardId=${foreign.id}`, drawing)).statusCode).toBe(404);
    await prisma.campaign.delete({ where: { id: other.id } });
  });
  it('undoes and redoes consecutive drawing operations without changing IDs', async () => {
    const created = await createDrawing(ana);
    const erased = await call('DELETE', `drawings/${created.id}`, undefined, ana, headers(1));
    let deletion = await toggle(erased.json().edit, 'undo', ana);
    let creation = await toggle(created.edit, 'undo', ana);
    expect(await prisma.mapDrawing.findUnique({ where: { id: created.id } })).toBeNull();
    creation = await toggle(creation, 'redo', ana);
    expect((await prisma.mapDrawing.findUnique({ where: { id: created.id } })).active).toBe(true);
    await toggle(deletion, 'redo', ana);
    expect((await prisma.mapDrawing.findUnique({ where: { id: created.id } })).active).toBe(false);
    expect((await call('POST', `edits/${creation.id}`, { direction: 'undo' }, ana, headers(1))).statusCode).toBe(409);
  });
  it('clears only chosen own drawings atomically and restores a bulk clear', async () => {
    const created = await createDrawing(beto);
    const own = (await call('GET', 'drawings', undefined, beto)).json().items.filter(row => row.authorUserId === beto.id);
    const invalid = own.map(row => ({ id: row.id, version: row.version + 1 }));
    expect((await call('POST', 'drawings/clear', { scope: 'mine', versions: invalid }, beto)).statusCode).toBe(409);
    expect((await prisma.mapDrawing.findUnique({ where: { id: created.id } })).active).toBe(true);
    const cleared = await call('POST', 'drawings/clear', { scope: 'mine', versions: own.map(({ id, version }) => ({ id, version })) }, beto);
    expect(cleared.statusCode, cleared.body).toBe(200);
    expect(await prisma.mapDrawing.count({ where: { boardId: board.id, active: true, authorUserId: beto.id } })).toBe(0);
    await toggle(cleared.json().edit, 'undo', beto);
    expect(await prisma.mapDrawing.count({ where: { boardId: board.id, active: true, authorUserId: beto.id } })).toBe(own.length);
  });
  it('does not undo another participant’s drawing changes', async () => {
    const created = await createDrawing(ana);
    await call('DELETE', `drawings/${created.id}`, undefined, gm, headers(1));
    const response = await call('POST', `edits/${created.edit.id}`, { direction: 'undo' }, ana, headers(1));
    expect(response.statusCode).toBe(409);
    expect((await prisma.mapDrawing.findUnique({ where: { id: created.id } })).active).toBe(false);
    expect((await prisma.mapEdit.findUnique({ where: { id: created.edit.id } })).version).toBe(1);
  });
  it('only one concurrent undo commits and malformed or stale versions cannot change the board', async () => {
    const created = await createDrawing(beto);
    expect((await call('POST', `edits/${created.edit.id}`, { direction: 'undo' }, beto)).statusCode).toBe(400);
    const responses = await Promise.all([0, 1].map(() => call('POST', `edits/${created.edit.id}`, { direction: 'undo' }, beto, headers(1))));
    expect(responses.map(r => r.statusCode).sort()).toEqual([200, 409]);
    expect(await prisma.mapDrawing.findUnique({ where: { id: created.id } })).toBeNull();
  });
  it('enforces the drawing limit atomically including redo and keeps the journal unchanged on failure', async () => {
    const created = await createDrawing(gm, region);
    const undone = await toggle(created.edit, 'undo', gm, region);
    await prisma.mapDrawing.createMany({ data: Array.from({ length: 1000 }, () => ({ boardId: region.id, authorUserId: gm.id, data: drawing })) });
    expect((await call('POST', `drawings?boardId=${region.id}`, drawing)).statusCode).toBe(409);
    const response = await call('POST', `edits/${undone.id}?boardId=${region.id}`, { direction: 'redo' }, gm, headers(undone.version));
    expect(response.statusCode, response.body).toBe(409); expect(response.json().error.code).toBe('DRAWING_LIMIT');
    expect((await prisma.mapEdit.findUnique({ where: { id: undone.id } })).version).toBe(undone.version);
    await prisma.mapDrawing.deleteMany({ where: { boardId: region.id } });
  });
  it('journals pin creation, movement, deletion and restores legacy route point IDs', async () => {
    const version = (await call('GET', 'board')).json().version;
    const placed = await call('POST', 'pins?undo=1', { entityType: 'location', entityId: 'loc.canvas-a', x: .2, y: .3 }, gm, headers(version));
    expect(placed.statusCode, placed.body).toBe(201);
    const pin = placed.json().pins.find(row => row.entityId === 'loc.canvas-a');
    const second = await prisma.mapLocationPin.create({ data: { boardId: board.id, entityType: 'location', entityId: 'loc.canvas-b', locationId: 'loc.canvas-b', x: .8, y: .7, updatedByUserId: gm.id } });
    const route = await prisma.mapRoute.create({ data: { boardId: board.id, fromPinId: pin.id, toPinId: second.id, fromLocationId: 'loc.canvas-a', toLocationId: 'loc.canvas-b', updatedByUserId: gm.id, points: { create: [{ x: .5, y: .6, order: 0, updatedByUserId: gm.id }] } }, include: { points: true } });
    const moved = await call('PATCH', `pins/${pin.id}?undo=1`, { x: .3, y: .4 }, gm, headers(pin.version));
    expect(moved.statusCode, moved.body).toBe(200);
    const changed = moved.json().pins.find(row => row.id === pin.id);
    const deleted = await call('DELETE', `pins/${pin.id}?undo=1`, undefined, gm, headers(changed.version));
    expect(deleted.statusCode, deleted.body).toBe(200);
    expect(await prisma.mapRoute.findUnique({ where: { id: route.id } })).toBeNull();
    const deletion = await toggle(deleted.json().edit, 'undo');
    const restored = await prisma.mapRoute.findUnique({ where: { id: route.id }, include: { points: true } });
    expect(restored.points.map(p => p.id)).toEqual(route.points.map(p => p.id));
    const movement = await toggle(moved.json().edit, 'undo');
    expect(await prisma.mapLocationPin.findUnique({ where: { id: pin.id } })).toMatchObject({ id: pin.id, x: .2, y: .3 });
    await toggle(movement, 'redo'); await toggle(deletion, 'redo');
    expect(await prisma.mapLocationPin.findUnique({ where: { id: pin.id } })).toBeNull();
    await toggle({ ...deletion, version: deletion.version + 1 }, 'undo');
  });
  it('undoes and redoes creation, moves and deletion of the same pin in order', async () => {
    const version = (await call('GET', 'board')).json().version;
    const placed = await call('POST', 'pins?undo=1', { entityType: 'location', entityId: 'loc.canvas-c', x: .2, y: .3 }, gm, headers(version));
    expect(placed.statusCode, placed.body).toBe(201);
    const pin = placed.json().pins.find(row => row.entityId === 'loc.canvas-c');
    const moved = await call('PATCH', `pins/${pin.id}?undo=1`, { x: .4, y: .5 }, gm, headers(pin.version));
    const current = moved.json().pins.find(row => row.id === pin.id);
    const removed = await call('DELETE', `pins/${pin.id}?undo=1`, undefined, gm, headers(current.version));
    const deletion = await toggle(removed.json().edit, 'undo');
    const movement = await toggle(moved.json().edit, 'undo');
    const creation = await toggle(placed.json().edit, 'undo');
    expect(await prisma.mapLocationPin.findUnique({ where: { id: pin.id } })).toBeNull();
    await toggle(creation, 'redo'); await toggle(movement, 'redo'); await toggle(deletion, 'redo');
    expect(await prisma.mapLocationPin.findUnique({ where: { id: pin.id } })).toBeNull();
  });
  it('rejects pin undo after a foreign edit and rolls back a stale create version', async () => {
    const pin = await prisma.mapLocationPin.findFirst({ where: { boardId: board.id, entityId: 'loc.canvas-a' } });
    const moved = await call('PATCH', `pins/${pin.id}?undo=1`, { x: .4, y: .5 }, gm, headers(pin.version));
    expect(moved.statusCode, moved.body).toBe(200);
    await prisma.mapLocationPin.update({ where: { id: pin.id }, data: { x: .9, version: { increment: 1 }, updatedByUserId: beto.id } });
    expect((await call('POST', `edits/${moved.json().edit.id}`, { direction: 'undo' }, gm, headers(1))).statusCode).toBe(409);
    expect((await prisma.mapLocationPin.findUnique({ where: { id: pin.id } })).x).toBe(.9);
    const count = await prisma.mapEdit.count({ where: { boardId: board.id } });
    expect((await call('POST', 'markers?undo=1', { ownerType: 'custom', name: 'Ruínas', x: .2, y: .2 }, gm, headers(0))).statusCode).toBe(409);
    expect(await prisma.mapEdit.count({ where: { boardId: board.id } })).toBe(count);
  });
  it('lets players undo their own travel markers but not other players’ markers', async () => {
    const version = (await call('GET', 'board', undefined, ana)).json().version;
    const placed = await call('POST', 'markers?undo=1', { ownerType: 'player', x: .3, y: .3 }, ana, headers(version));
    expect(placed.statusCode, placed.body).toBe(201);
    const marker = placed.json().travelMarkers.find(row => row.ownerId === ana.id);
    expect((await call('PATCH', `markers/${marker.id}?undo=1`, { x: .5, y: .5 }, beto, headers(marker.version))).statusCode).toBe(403);
    const creation = await toggle(placed.json().edit, 'undo', ana);
    expect(await prisma.mapTravelMarker.findUnique({ where: { id: marker.id } })).toBeNull();
    await toggle(creation, 'redo', ana);
    expect(await prisma.mapTravelMarker.findUnique({ where: { id: marker.id } })).toMatchObject({ ownerId: ana.id, x: .3, y: .3 });
  });
  it('does not restore pins whose associated entity was deleted', async () => {
    const pin = await prisma.mapLocationPin.findFirst({ where: { boardId: board.id, entityId: 'loc.canvas-b' } });
    const removed = await call('DELETE', `pins/${pin.id}?undo=1`, undefined, gm, headers(pin.version));
    expect(removed.statusCode, removed.body).toBe(200);
    await prisma.entity.update({ where: { campaignId_type_domainId: { campaignId: campaign.id, type: 'location', domainId: pin.entityId } }, data: { deletedAt: new Date() } });
    expect((await call('POST', `edits/${removed.json().edit.id}`, { direction: 'undo' }, gm, headers(1))).statusCode).toBe(409);
    expect(await prisma.mapLocationPin.findUnique({ where: { id: pin.id } })).toBeNull();
  });
  it('broadcasts drawing changes and pings to multiple clients and supports cancelling pings', async () => {
    const notification = waitEvent(betoSocket, 'map.canvas.changed', event => event.boardId === board.id);
    await createDrawing(ana); expect((await notification).boardId).toBe(board.id);
    const incoming = waitEvent(betoSocket, 'map.ping');
    const sent = await call('POST', 'pings', { x: .42, y: .24, color: '#fb7185' }, ana);
    expect(sent.statusCode, sent.body).toBe(201);
    expect((await incoming).ping).toMatchObject({ ...sent.json().ping, authorName: 'Ana' });
    expect(sent.json().ping.expiresAt - Date.now()).toBeLessThanOrEqual(5000);
    const id = sent.json().ping.id;
    expect((await call('DELETE', `pings/${id}`, undefined, beto)).statusCode).toBe(403);
    const removed = waitEvent(betoSocket, 'map.ping.removed');
    expect((await call('DELETE', `pings/${id}`, undefined, ana)).statusCode).toBe(200);
    expect((await removed).id).toBe(id);
    expect((await call('GET', 'drawings', undefined, ana)).json().pings.some(p => p.id === id)).toBe(false);
    expect((await call('POST', 'pings', { id, x: .42, y: .24, color: '#fb7185' }, ana)).statusCode).toBe(201);
    canvasPings.clear();
  });
  it('filters secret board realtime coordinates for each recipient', async () => {
    const received = [];
    const listener = event => { if (event.boardId === region.id) received.push(event); };
    anaSocket.on('map.ping', listener); betoSocket.on('map.ping', listener);
    const incoming = waitEvent(gmSocket, 'map.ping', event => event.boardId === region.id);
    expect((await call('POST', `pings?boardId=${region.id}`, { x: .7, y: .7, color: '#ffffff' })).statusCode).toBe(201);
    await incoming;
    await new Promise(resolve => setTimeout(resolve, 120));
    expect(received).toEqual([]);
    anaSocket.off('map.ping', listener); betoSocket.off('map.ping', listener);
  });
  it('streams stroke previews, clears them in order and rejects invalid CSRF and revoked sessions', async () => {
    const id = randomUUID(), payload = { boardId: board.id, id, seq: 1, csrfToken: ana.csrf, drawing };
    const incoming = waitEvent(betoSocket, 'map.drawing.preview', event => event.id === id && event.drawing);
    anaSocket.emit('map.drawing.preview', payload);
    expect(await incoming).toMatchObject({ id, seq: 1, authorUserId: ana.id, drawing });
    expect(await prisma.mapDrawing.findUnique({ where: { id } })).toBeNull();
    const cleared = waitEvent(betoSocket, 'map.drawing.preview', event => event.id === id && !event.drawing);
    anaSocket.emit('map.drawing.preview', { ...payload, seq: 2, drawing: null });
    expect((await cleared).seq).toBe(2);
    const invalid = [], listener = event => invalid.push(event);
    betoSocket.on('map.drawing.preview', listener);
    await new Promise(resolve => setTimeout(resolve, 90));
    anaSocket.emit('map.drawing.preview', { ...payload, seq: 3, csrfToken: 'invalid' });
    anaSocket.emit('map.drawing.preview', { ...payload, drawing: null });
    await prisma.session.delete({ where: { id: ana.session.id } });
    anaSocket.emit('map.drawing.preview', { ...payload, seq: 4 });
    await new Promise(resolve => setTimeout(resolve, 150));
    expect(invalid).toEqual([]); betoSocket.off('map.drawing.preview', listener);
  });
});
