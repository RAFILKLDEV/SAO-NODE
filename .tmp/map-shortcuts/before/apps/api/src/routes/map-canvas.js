import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authenticate, requireCampaign, requireCsrf, isGm } from '../lib/auth.js';
import { apiError } from '@sao/shared';
import { drawingInput, pingInput, canvasBoard, emitCanvas, mapEntry, recordMapEdit, toggleMapEdit, canvasPings, activePings } from '../services/map-canvas.js';

const root = '/api/v1/campaigns/:campaignId/map';
const read = [authenticate, requireCampaign];
const writable = async (request, reply) => {
  if (request.query?.viewAsUserId) return reply.code(403).send(apiError('VIEWER_READ_ONLY', 'Saia de Visualizar como para usar as ferramentas.'));
};
const write = [...read, writable, requireCsrf];
const version = request => {
  const value = request.headers['if-match'];
  if (!/^\d+$/.test(String(value ?? ''))) throw Object.assign(new Error('Informe a versão da alteração.'), { statusCode: 400, code: 'VERSION_REQUIRED' });
  return Number(value);
};
const denied = reply => reply.code(403).send(apiError('FORBIDDEN', 'Você pode apagar apenas seus próprios desenhos.'));
const missing = reply => reply.code(404).send(apiError('NOT_FOUND', 'Desenho não encontrado neste mapa.'));
const changed = async (request, board) => emitCanvas(request.server.realtime, request, board, 'map.canvas.changed', {});

export async function mapCanvasRoutes(app) {
  app.get(`${root}/drawings`, { preHandler: read }, async request => {
    const board = await canvasBoard(request);
    const items = await prisma.mapDrawing.findMany({ where: { boardId: board.id, active: true }, orderBy: { createdAt: 'asc' }, take: 1000 });
    const users = await prisma.user.findMany({ where: { id: { in: [...new Set(items.map(row => row.authorUserId))] } }, select: { id: true, name: true } });
    return { boardId: board.id, items: items.map(row => ({ id: row.id, version: row.version, authorUserId: row.authorUserId, authorName: users.find(user => user.id === row.authorUserId)?.name ?? 'Jogador', ...row.data })), pings: activePings(board.id), userId: request.auth.user.id };
  });
  app.post(`${root}/drawings`, { preHandler: write }, async (request, reply) => {
    const parsed = drawingInput.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(apiError('INVALID_DRAWING', 'Confira o desenho, cor e espessura.', parsed.error.flatten()));
    const board = await canvasBoard(request);
    if (await prisma.mapDrawing.count({ where: { boardId: board.id, active: true } }) >= 1000) return reply.code(409).send(apiError('DRAWING_LIMIT', 'Apague alguns desenhos antes de adicionar outros.'));
    const previewId = z.string().uuid().safeParse(request.headers['x-map-preview-id']);
    const id = previewId.success ? previewId.data : randomUUID(), row = { id, boardId: board.id, authorUserId: request.auth.user.id, data: parsed.data, active: true };
    const edit = await recordMapEdit(request, board, [mapEntry('drawing', null, id)], [mapEntry('drawing', row)], 'Desenhar no mapa');
    await changed(request, board);
    return reply.code(201).send({ edit, id });
  });
  app.delete(`${root}/drawings/:drawingId`, { preHandler: write }, async (request, reply) => {
    const board = await canvasBoard(request), row = await prisma.mapDrawing.findUnique({ where: { id: request.params.drawingId } });
    if (!row || row.boardId !== board.id || !row.active) return missing(reply);
    if (!isGm(request) && row.authorUserId !== request.auth.user.id) return denied(reply);
    const expected = mapEntry('drawing', row, row.id, version(request));
    const edit = await recordMapEdit(request, board, [expected], [mapEntry('drawing', { ...row, active: false })], 'Apagar desenho');
    await changed(request, board); return { edit };
  });
  app.post(`${root}/drawings/clear`, { preHandler: write }, async (request, reply) => {
    const parsed = z.object({ scope: z.enum(['mine', 'all']), versions: z.array(z.object({ id: z.string().min(1), version: z.number().int().positive() }).strict()).min(1).max(1000) }).strict().safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(apiError('INVALID_INPUT', 'Selecione os desenhos a apagar.'));
    if (parsed.data.scope === 'all' && !isGm(request)) return denied(reply);
    const board = await canvasBoard(request);
    const rows = await prisma.mapDrawing.findMany({ where: { boardId: board.id, active: true, ...(parsed.data.scope === 'mine' ? { authorUserId: request.auth.user.id } : {}) } });
    if (rows.length !== parsed.data.versions.length || new Set(parsed.data.versions.map(row => row.id)).size !== rows.length || rows.some(row => !parsed.data.versions.some(v => v.id === row.id && v.version === row.version))) throw Object.assign(new Error('Os desenhos mudaram. Atualize antes de limpar.'), { statusCode: 409, code: 'VERSION_CONFLICT' });
    const edit = await recordMapEdit(request, board, rows.map(row => mapEntry('drawing', row)), rows.map(row => mapEntry('drawing', { ...row, active: false })), parsed.data.scope === 'mine' ? 'Limpar meus desenhos' : 'Limpar todos os desenhos');
    await changed(request, board); return { edit };
  });
  app.post(`${root}/edits/:editId`, { preHandler: write }, async (request, reply) => {
    const parsed = z.object({ direction: z.enum(['undo', 'redo']) }).strict().safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(apiError('INVALID_INPUT', 'Informe desfazer ou refazer.'));
    const board = await canvasBoard(request);
    const edit = await toggleMapEdit(request, board, request.params.editId, parsed.data.direction, version(request));
    await changed(request, board);
    request.server.realtime?.to(`campaign:${request.campaign.id}`).emit('map.pin.changed', { boardId: board.id, reason: parsed.data.direction });
    return { edit };
  });
  app.post(`${root}/pings`, { preHandler: write, config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (request, reply) => {
    const parsed = pingInput.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(apiError('INVALID_INPUT', 'Ping inválido.'));
    const board = await canvasBoard(request), current = activePings(board.id);
    if (current.filter(p => p.authorUserId === request.auth.user.id).length >= 8) return reply.code(429).send(apiError('PING_LIMIT', 'Aguarde um momento antes de enviar mais pings.'));
    const ping = { ...parsed.data, id: parsed.data.id ?? randomUUID(), authorUserId: request.auth.user.id, authorName: request.auth.user.name ?? 'Jogador', expiresAt: Date.now() + 5000 };
    if (current.some(p => p.id === ping.id)) return reply.code(409).send(apiError('ALREADY_EXISTS', 'Esse ping já existe.'));
    canvasPings.set(board.id, [...current, ping]);
    const cleanup = setTimeout(() => activePings(board.id), 5100); cleanup.unref?.();
    await emitCanvas(request.server.realtime, request, board, 'map.ping', { ping });
    return reply.code(201).send({ ping });
  });
  app.delete(`${root}/pings/:pingId`, { preHandler: write }, async (request, reply) => {
    const board = await canvasBoard(request), current = activePings(board.id), ping = current.find(p => p.id === request.params.pingId);
    if (ping && !isGm(request) && ping.authorUserId !== request.auth.user.id) return reply.code(403).send(apiError('FORBIDDEN', 'Você pode apagar apenas seus próprios pings.'));
    canvasPings.set(board.id, current.filter(p => p.id !== request.params.pingId));
    await emitCanvas(request.server.realtime, request, board, 'map.ping.removed', { id: request.params.pingId });
    return { ok: true };
  });
}
