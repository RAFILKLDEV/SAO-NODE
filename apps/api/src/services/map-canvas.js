import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { isGm } from '../lib/auth.js';
import { audit } from '../lib/audit.js';
import { campaignUserRoom } from '../lib/realtime.js';
import { getEntityForRequest } from './content.js';

const point = z.object({ x: z.number().finite().min(0).max(1), y: z.number().finite().min(0).max(1) }).strict();
export const drawingInput = z.object({
  kind: z.enum(['pencil', 'line', 'arrow', 'rectangle', 'ellipse', 'text']),
  color: z.string().regex(/^#[\da-f]{6}$/i), width: z.number().min(1).max(16),
  opacity: z.number().min(.1).max(1), points: z.array(point).min(1).max(2000),
  text: z.string().trim().max(160).optional()
}).strict().superRefine((value, ctx) => {
  if (value.kind === 'text' ? !value.text : value.points.length < 2) ctx.addIssue({ code: 'custom', message: 'Desenho incompleto' });
});
export const pingInput = point.extend({ color: z.string().regex(/^#[\da-f]{6}$/i), id: z.string().uuid().optional() }).strict();
const columns = {
  pin: ['id', 'boardId', 'regionId', 'entityType', 'entityId', 'locationId', 'x', 'y', 'placementSource', 'updatedByUserId'],
  marker: ['id', 'boardId', 'ownerType', 'ownerId', 'name', 'x', 'y', 'updatedByUserId'],
  drawing: ['id', 'boardId', 'authorUserId', 'data', 'active'],
  route: ['id', 'boardId', 'fromPinId', 'toPinId', 'fromLocationId', 'toLocationId', 'label', 'sourceConnectionId', 'distanceKm', 'updatedByUserId']
};
const models = { pin: 'mapLocationPin', marker: 'mapTravelMarker', drawing: 'mapDrawing', route: 'mapRoute' };
const conflict = () => Object.assign(new Error('Outra pessoa alterou este conteúdo. Atualize o mapa antes de desfazer.'), { statusCode: 409, code: 'VERSION_CONFLICT' });
const notFound = () => Object.assign(new Error('Mapa ou alteração não encontrado.'), { statusCode: 404, code: 'NOT_FOUND' });
export function mapEntry(kind, row, id = row?.id, version = row?.version ?? 0) {
  const value = row ? Object.fromEntries(columns[kind].filter(key => row[key] !== undefined).map(key => [key, row[key]])) : null;
  if (value && kind === 'route') value.points = (row.points ?? []).map(p => ({ id: p.id, x: p.x, y: p.y, order: p.order, updatedByUserId: p.updatedByUserId }));
  return { kind, id, version, value };
}
const editSummary = edit => ({ id: edit.id, version: edit.version, applied: edit.applied, label: edit.label });

export async function canvasBoard(request) {
  const board = await prisma.mapBoard.findUnique({ where: request.query?.boardId ? { id: request.query.boardId } : { campaignId_boardKey: { campaignId: request.campaign.id, boardKey: 'general' } } });
  if (!board || board.campaignId !== request.campaign.id || !board.imageUrl) throw notFound();
  if (request.query?.viewAsUserId) {
    if (!isGm(request)) throw notFound();
    const member = await prisma.membership.findUnique({ where: { campaignId_userId: { campaignId: request.campaign.id, userId: request.query.viewAsUserId } } });
    if (member?.role !== 'player') throw notFound();
  }
  if (board.regionId && !await getEntityForRequest({ request, type: 'location', domainId: board.regionId, options: { backlinks: false, format: '1', requireSection: 'basic' } })) throw notFound();
  return board;
}

export async function emitCanvas(io, request, board, event, payload, volatile = false) {
  if (!io) return;
  // Payloads with coordinates go only to members who can access this board now.
  const memberships = await prisma.membership.findMany({ where: { campaignId: request.campaign.id }, include: { user: { select: { id: true } } } });
  const rooms = [];
  for (const member of memberships) {
    const viewer = { campaign: request.campaign, auth: { user: { id: member.userId } }, membership: member, query: {} };
    if (!board.regionId || await getEntityForRequest({ request: viewer, type: 'location', domainId: board.regionId, options: { backlinks: false, format: '1', requireSection: 'basic' } })) rooms.push(campaignUserRoom(request.campaign.id, member.userId));
  }
  if (rooms.length) (volatile ? io.to(rooms).volatile : io.to(rooms)).emit(event, { boardId: board.id, ...payload });
}

async function actualEntry(tx, entry, boardId) {
  const row = await tx[models[entry.kind]].findUnique({ where: { id: entry.id }, ...(entry.kind === 'route' ? { include: { points: { orderBy: { order: 'asc' } } } } : {}) });
  if (row && row.boardId !== boardId) throw conflict();
  return mapEntry(entry.kind, row, entry.id, row?.version ?? entry.version);
}

async function applyEntries(tx, request, board, expected, desired) {
  const results = [];
  const addedDrawings = desired.reduce((count, row) => count + Number(row.kind === 'drawing' && row.value?.active === true) - Number(row.kind === 'drawing' && expected.find(old => old.id === row.id)?.value?.active === true), 0);
  if (addedDrawings > 0 && await tx.mapDrawing.count({ where: { boardId: board.id, active: true } }) + addedDrawings > 1000) throw Object.assign(new Error('Apague alguns desenhos antes de adicionar ou restaurar outros.'), { statusCode: 409, code: 'DRAWING_LIMIT' });
  // Delete dependent routes before their pins; restores create pins first.
  const ordered = [...desired].sort((a, b) => Number(b.kind === 'route' && !b.value) - Number(a.kind === 'route' && !a.value));
  for (const wanted of ordered) {
    const previous = expected.find(entry => entry.kind === wanted.kind && entry.id === wanted.id);
    const current = await actualEntry(tx, previous, board.id);
    if (!isDeepStrictEqual(current.value, previous.value) || (current.value && current.version !== previous.version)) throw conflict();
    const model = tx[models[wanted.kind]];
    const version = Math.max(current.version, wanted.version, previous.version) + 1;
    if (!wanted.value) {
      if (wanted.kind === 'pin' && await tx.mapRoute.count({ where: { boardId: board.id, OR: [{ fromPinId: wanted.id }, { toPinId: wanted.id }] } })) throw conflict();
      if (current.value && !(await model.deleteMany({ where: { id: wanted.id, boardId: board.id, version: current.version } })).count) throw conflict();
      results.push({ ...wanted, version }); continue;
    }
    const { points, ...value } = wanted.value;
    const data = { ...value, version, ...(wanted.kind !== 'drawing' ? { updatedByUserId: request.auth.user.id } : {}) };
    if (current.value) {
      if (!(await model.updateMany({ where: { id: wanted.id, boardId: board.id, version: current.version }, data })).count) throw conflict();
      if (wanted.kind === 'route') {
        await tx.mapRoutePoint.deleteMany({ where: { routeId: wanted.id } });
        for (const p of points) await tx.mapRoutePoint.create({ data: { ...p, routeId: wanted.id } });
      }
    } else {
      if (wanted.kind === 'route') {
        for (const id of [data.fromPinId, data.toPinId]) if (!await tx.mapLocationPin.findFirst({ where: { id, boardId: board.id } })) throw conflict();
      }
      await model.create({ data: { ...data, ...(points ? { points: { create: points } } : {}) } });
    }
    results.push(await actualEntry(tx, { ...wanted, version }, board.id));
  }
  if (desired.some(entry => entry.kind !== 'drawing') && !(await tx.mapBoard.updateMany({ where: { id: board.id, campaignId: request.campaign.id, version: board.version }, data: { version: { increment: 1 } } })).count) throw conflict();
  return results;
}

export async function recordMapEdit(request, board, before, desired, label, afterChange) {
  try {
    return await prisma.$transaction(async tx => {
      if (before.some(entry => ['pin', 'marker'].includes(entry.kind) && !entry.value)) {
        const current = await tx.mapBoard.findUnique({ where: { id: board.id } });
        if (current?.version !== Number(request.headers['if-match'])) throw conflict();
      }
      let after = await applyEntries(tx, request, board, before, desired);
      if (afterChange) { await afterChange(tx); after = await Promise.all(after.map(entry => actualEntry(tx, entry, board.id))); }
      const edit = await tx.mapEdit.create({ data: { boardId: board.id, actorUserId: request.auth.user.id, label, before, after, expected: after } });
      await audit(tx, { campaignId: request.campaign.id, actorUserId: request.auth.user.id, action: 'map.edit', targetKind: 'map', targetKey: board.id, before, after, resultVersion: edit.version });
      return editSummary(edit);
    }, { isolationLevel: 'Serializable', timeout: 15000 });
  } catch (error) { if (['P2002', 'P2034'].includes(error.code)) throw conflict(); throw error; }
}

export async function toggleMapEdit(request, board, id, direction, version) {
  try {
    return await prisma.$transaction(async tx => {
      const edit = await tx.mapEdit.findFirst({ where: { id, boardId: board.id, actorUserId: request.auth.user.id } });
      if (!edit) throw notFound();
      if (edit.version !== version || edit.applied !== (direction === 'undo')) throw conflict();
      const desired = direction === 'undo' ? edit.before : edit.after;
      for (const entry of desired) {
        if (entry.kind === 'drawing') {
          const drawing = entry.value ?? edit.expected.find(row => row.id === entry.id)?.value;
          if (drawing?.authorUserId !== request.auth.user.id && !isGm(request)) throw notFound();
        }
        if (entry.kind === 'pin' || entry.kind === 'route') { if (!isGm(request)) throw notFound(); }
        if (entry.kind === 'pin' && entry.value && !await tx.entity.findFirst({ where: { campaignId: request.campaign.id, type: entry.value.entityType, domainId: entry.value.entityId, deletedAt: null } })) throw conflict();
        if (entry.kind === 'marker' && !isGm(request)) {
          const marker = entry.value ?? edit.expected.find(row => row.id === entry.id)?.value;
          if (marker?.ownerType !== 'player' || marker.ownerId !== request.auth.user.id) throw notFound();
        }
        if (entry.kind === 'marker' && entry.value?.ownerType === 'player' && (await tx.membership.findUnique({ where: { campaignId_userId: { campaignId: request.campaign.id, userId: entry.value.ownerId } } }))?.role !== 'player') throw conflict();
        if (entry.kind === 'marker' && entry.value?.ownerType === 'group' && entry.value.ownerId !== request.campaign.id && !await tx.group.findUnique({ where: { campaignId_domainId: { campaignId: request.campaign.id, domainId: entry.value.ownerId } } })) throw conflict();
      }
      const after = await applyEntries(tx, request, board, edit.expected, desired);
      if (!(await tx.mapEdit.updateMany({ where: { id: edit.id, version }, data: { expected: after, applied: direction === 'redo', version: { increment: 1 } } })).count) throw conflict();
      // Rebase this user's adjacent undo/redo steps after an inverse operation.
      // Other users' commands are never rebased or overwritten.
      const neighbors = await tx.mapEdit.findMany({ where: { boardId: board.id, actorUserId: request.auth.user.id, id: { not: edit.id } }, orderBy: { createdAt: 'desc' }, take: 100 });
      for (const neighbor of neighbors) {
        let changed = false;
        const expected = neighbor.expected.map(entry => {
          const actual = after.find(row => row.kind === entry.kind && row.id === entry.id);
          if (actual && isDeepStrictEqual(actual.value, entry.value)) { changed = true; return actual; }
          return entry;
        });
        if (changed) await tx.mapEdit.update({ where: { id: neighbor.id }, data: { expected } });
      }
      await audit(tx, { campaignId: request.campaign.id, actorUserId: request.auth.user.id, action: `map.edit.${direction}`, targetKind: 'map', targetKey: board.id, before: edit.expected, after, resultVersion: version + 1 });
      return { ...editSummary(edit), version: version + 1, applied: direction === 'redo' };
    }, { isolationLevel: 'Serializable', timeout: 15000 });
  } catch (error) { if (['P2002', 'P2034'].includes(error.code)) throw conflict(); throw error; }
}

export async function journalPin(request, board, kind, beforeRow, data, operation, afterChange) {
  if (operation === 'create' && Number(request.headers['if-match']) !== board.version) throw conflict();
  if (operation !== 'create' && Number(request.headers['if-match']) !== beforeRow.version) throw conflict();
  const id = beforeRow?.id ?? randomUUID();
  const before = [mapEntry(kind, beforeRow, id)];
  const desired = [mapEntry(kind, operation === 'delete' ? null : { ...beforeRow, ...data, id, boardId: board.id }, id, beforeRow?.version ?? 0)];
  if (kind === 'pin' && operation !== 'create') {
    for (const route of (board.routes ?? []).filter(r => r.fromPinId === id || r.toPinId === id)) {
      before.push(mapEntry('route', route)); desired.push(mapEntry('route', operation === 'delete' ? null : route, route.id, route.version));
    }
  }
  const edit = await recordMapEdit(request, board, before, desired, `${operation === 'create' ? 'Colocar' : operation === 'delete' ? 'Apagar' : 'Mover'} pin`, afterChange);
  request.server.realtime?.to(`campaign:${request.campaign.id}`).emit('map.pin.changed', { boardId: board.id, reason: 'pin-edited' });
  return edit;
}

export const canvasPings = new Map();
export function activePings(boardId) {
  const now = Date.now();
  const pings = (canvasPings.get(boardId) ?? []).filter(ping => ping.expiresAt > now);
  if (pings.length) canvasPings.set(boardId, pings); else canvasPings.delete(boardId);
  return pings;
}

export function attachCanvasRealtime(io) {
  io.on('connection', socket => {
    let lastPreview = 0;
    const sequences = new Map();
    socket.on('map.drawing.preview', async payload => {
      const parsed = z.object({ boardId: z.string().min(1).max(256), id: z.string().uuid(), seq: z.number().int().positive(), csrfToken: z.string(), drawing: drawingInput.nullable() }).strict().safeParse(payload);
      if (!parsed.success || parsed.data.csrfToken !== socket.data.csrfToken || socket.data.expiresAt <= Date.now() || (parsed.data.drawing && Date.now() - lastPreview < 70)) return;
      if (parsed.data.seq <= (sequences.get(parsed.data.id) ?? 0)) return;
      if (sequences.size > 100) sequences.delete(sequences.keys().next().value);
      sequences.set(parsed.data.id, parsed.data.seq);
      lastPreview = Date.now();
      try {
        const session = await prisma.session.findUnique({ where: { id: socket.data.sessionId }, include: { user: { select: { name: true } } } });
        if (!session || session.userId !== socket.data.userId || session.csrfToken !== parsed.data.csrfToken || session.expiresAt <= new Date()) return;
        const membership = await prisma.membership.findUnique({ where: { campaignId_userId: { campaignId: socket.data.campaignId, userId: socket.data.userId } } });
        if (!membership) return;
        const request = { campaign: { id: socket.data.campaignId }, membership, auth: { user: { id: socket.data.userId } }, query: { boardId: parsed.data.boardId } };
        const board = await canvasBoard(request);
        if (sequences.get(parsed.data.id) !== parsed.data.seq) return;
        await emitCanvas(io, request, board, 'map.drawing.preview', { id: parsed.data.id, seq: parsed.data.seq, authorUserId: socket.data.userId, authorName: session.user.name, drawing: parsed.data.drawing, expiresAt: Date.now() + 3000 }, true);
      } catch { /* Inaccessible boards and expired sessions cannot publish previews. */ }
    });
  });
}
