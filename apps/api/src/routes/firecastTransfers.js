import crypto from 'node:crypto';
import path from 'node:path';
import { mkdir, copyFile, readFile } from 'node:fs/promises';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { config } from '../lib/config.js';
import { authenticate, requireCampaign, requireCsrf, requireGm } from '../lib/auth.js';
import { apiError } from '@sao/shared';
import { getMonsterCanonicalForExport } from '../services/content.js';
import { buildTormenta20CriaturaXml } from '@sao/domain';

const ticketSchema = z.object({
  monsterId: z.string().min(1).max(200)
});
const imageNamePattern = /^[a-f0-9-]{20,80}\.(png|jpg|gif|webp|avif|bmp)$/;
const campaignImagePattern = /^\/api\/v1\/campaigns\/([^/]+)\/media\/([a-f0-9-]+\.(?:png|jpg|gif|webp|avif|bmp))$/;
const ticketTtlMs = 2 * 60 * 1000;

function configured(reply) {
  if (config.saoNodeBridgeToken) return true;
  reply.code(503).send(apiError('FIRECAST_BRIDGE_DISABLED', 'A ponte SAO-NODE/Firecast não está configurada (SAO_NODE_BRIDGE_TOKEN).'));
  return false;
}

function tokenMatches(request) {
  const value = request.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!value || !config.saoNodeBridgeToken) return false;
  const a = Buffer.from(value);
  const b = Buffer.from(config.saoNodeBridgeToken);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function imageSource(monster) {
  const media = monster?.media ?? {};
  const nested = monster?.data?.media ?? {};
  return media.image || media.portrait || nested.image || nested.portrait || monster?.imageURL || monster?.imageUrl || monster?.portraitUrl || '';
}

function publicImageUrl(request, fileName) {
  const base = config.firecastPublicBaseUrl;
  if (!base) {
    const error = new Error('FIRECAST_PUBLIC_BASE_URL precisa apontar para o endereço público do SAO-NODE.');
    error.code = 'FIRECAST_PUBLIC_URL_REQUIRED';
    throw error;
  }
  let parsed;
  try { parsed = new URL(base); } catch {
    const error = new Error('FIRECAST_PUBLIC_BASE_URL inválida.');
    error.code = 'FIRECAST_PUBLIC_URL_INVALID';
    throw error;
  }
  const host = parsed.hostname.toLowerCase();
  if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password || host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.endsWith('.local') || /^10\.|^192\.168\.|^172\.(?:1[6-9]|2\d|3[01])\./.test(host)) {
    const error = new Error('FIRECAST_PUBLIC_BASE_URL não pode ser um endereço local ou privado.');
    error.code = 'FIRECAST_PUBLIC_URL_INVALID';
    throw error;
  }
  return `${base.replace(/\/$/, '')}/api/v1/firecast/images/${fileName}`;
}

async function persistImage({ request, campaignId, monster, transferId }) {
  const source = imageSource(monster);
  if (!source || typeof source !== 'string') return '';
  let parsed;
  try {
    parsed = new URL(source, `${request.protocol}://${request.hostname}`);
  } catch {
    return '';
  }
  const match = campaignImagePattern.exec(parsed.pathname);
  if (!match || match[1] !== campaignId || !imageNamePattern.test(match[2])) {
    // External HTTPS images remain usable as-is. Never proxy or fetch arbitrary URLs.
    if (parsed.protocol === 'https:' && !parsed.username && !parsed.password) return source;
    const error = new Error('A imagem do monstro precisa ser HTTPS ou uma mídia enviada à campanha.');
    error.code = 'FIRECAST_IMAGE_INVALID';
    throw error;
  }
  if (!config.firecastPublicBaseUrl && ['localhost', '127.0.0.1', '::1'].includes(request.hostname)) {
    const error = new Error('Configure FIRECAST_PUBLIC_BASE_URL para transferir uma imagem privada ao Firecast.');
    error.code = 'FIRECAST_IMAGE_BASE_REQUIRED';
    throw error;
  }
  const sourcePath = path.join(config.uploadDir, campaignId, match[2]);
  const ext = path.extname(match[2]);
  const destinationName = `${transferId}${ext}`;
  const destinationDir = path.join(config.uploadDir, 'firecast');
  await mkdir(destinationDir, { recursive: true });
  try {
    await copyFile(sourcePath, path.join(destinationDir, destinationName));
  } catch (error) {
    if (error.code === 'ENOENT') {
      const missing = new Error('A imagem privada do monstro não está disponível no armazenamento.');
      missing.code = 'FIRECAST_IMAGE_NOT_FOUND';
      throw missing;
    }
    throw error;
  }
  return publicImageUrl(request, destinationName);
}

export async function firecastTransferRoutes(app) {
  app.decorate('firecastTransfers', new Map());
  app.decorate('firecastReceipts', new Map());

  app.post('/api/v1/campaigns/:campaignId/monsters/:monsterId/firecast-transfer',
    { preHandler: [authenticate, requireCampaign, requireGm, requireCsrf] },
    async (request, reply) => {
      if (!configured(reply)) return;
      const parsed = ticketSchema.safeParse({ monsterId: request.params.monsterId });
      if (!parsed.success) return reply.code(400).send(apiError('INVALID_INPUT', 'Monstro inválido.'));
      const monster = await getMonsterCanonicalForExport({ campaignId: request.campaign.id, domainId: parsed.data.monsterId });
      if (!monster) return reply.code(404).send(apiError('NOT_FOUND', 'Monstro não encontrado.'));
      for (const [key, pending] of request.server.firecastTransfers) {
        if (pending.expiresAt < Date.now()) request.server.firecastTransfers.delete(key);
      }
      for (const [key, receipt] of request.server.firecastReceipts) {
        if (Date.now() - receipt.updatedAt > 15 * 60 * 1000) request.server.firecastReceipts.delete(key);
      }
      if (request.server.firecastTransfers.size >= 1000)
        return reply.code(429).send(apiError('TRANSFER_BUSY', 'Há muitas transferências pendentes. Tente novamente em instantes.'));
      for (const [pendingTicket, pending] of request.server.firecastTransfers) {
        if (pending.userId === request.auth.user.id && pending.campaignId === request.campaign.id && pending.monsterId === monster.id)
          return reply.code(200).send({ ticket: pendingTicket, transferId: pending.transferId, expiresIn: Math.max(0, pending.expiresAt - Date.now()) });
      }
      const transferId = crypto.randomUUID();
      let imageUrl;
      try {
        imageUrl = await persistImage({ request, campaignId: request.campaign.id, monster, transferId });
      } catch (error) {
        if (['FIRECAST_IMAGE_BASE_REQUIRED', 'FIRECAST_PUBLIC_URL_REQUIRED', 'FIRECAST_PUBLIC_URL_INVALID'].includes(error.code))
          return reply.code(503).send(apiError(error.code, error.message));
        if (error.code === 'FIRECAST_IMAGE_INVALID') return reply.code(422).send(apiError(error.code, error.message));
        if (error.code === 'FIRECAST_IMAGE_NOT_FOUND') return reply.code(404).send(apiError(error.code, error.message));
        throw error;
      }
      const exportMonster = imageUrl
        ? { ...monster, media: { ...(monster.media ?? {}), image: imageUrl } }
        : monster;
      const xml = buildTormenta20CriaturaXml(exportMonster);
      const ticket = crypto.randomBytes(32).toString('base64url');
      request.server.firecastTransfers.set(ticket, {
        transferId,
        campaignId: request.campaign.id,
        monsterId: monster.id,
        monsterName: monster.name,
        userId: request.auth.user.id,
        expiresAt: Date.now() + ticketTtlMs,
        xml,
        imageUrl,
        originalSheet: (monster.fields ?? []).find((field) => field.key === 'originalSheet')?.value ?? monster.originalSheet ?? '',
        monster: exportMonster
      });
      request.server.firecastReceipts.set(transferId, { status: 'queued', message: '', updatedAt: Date.now(), userId: request.auth.user.id, campaignId: request.campaign.id });
      return reply.code(201).send({ ticket, transferId, expiresIn: ticketTtlMs });
    });

  app.post('/api/v1/firecast/transfers/redeem', async (request, reply) => {
    if (!tokenMatches(request)) return reply.code(401).send(apiError('UNAUTHORIZED', 'Credencial da ponte inválida.'));
    const ticket = typeof request.body?.ticket === 'string' ? request.body.ticket : '';
    const item = request.server.firecastTransfers.get(ticket);
    // Consume before doing any work: tickets are one-time even when redemption fails.
    if (!item || item.expiresAt < Date.now()) {
      if (item) request.server.firecastTransfers.delete(ticket);
      return reply.code(410).send(apiError('TRANSFER_EXPIRED', 'A transferência expirou ou já foi recebida.'));
    }
    request.server.firecastTransfers.delete(ticket);
    const membership = await prisma.membership.findUnique({
      where: { campaignId_userId: { campaignId: item.campaignId, userId: item.userId } }
    });
    if (!membership || !['owner', 'gm', 'assistant_gm'].includes(membership.role))
      return reply.code(403).send(apiError('FORBIDDEN', 'A transferência exige permissão de mestre.'));
    const receipt = request.server.firecastReceipts.get(item.transferId);
    if (receipt) { receipt.status = 'redeemed'; receipt.updatedAt = Date.now(); }
    return {
      transferId: item.transferId,
      campaignId: item.campaignId,
      monsterId: item.monsterId,
      monsterName: item.monsterName,
      xml: item.xml,
      imageUrl: item.imageUrl,
      originalSheet: item.originalSheet,
      monster: item.monster
    };
  });

  app.get('/api/v1/firecast/images/:fileName', async (request, reply) => {
    const { fileName } = request.params;
    if (!imageNamePattern.test(fileName)) return reply.code(404).send(apiError('NOT_FOUND', 'Imagem não encontrada.'));
    try {
      const buffer = await readFile(path.join(config.uploadDir, 'firecast', fileName));
      const ext = path.extname(fileName).slice(1);
      const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
      return reply.type(mime).header('Cache-Control', 'public, max-age=31536000, immutable').send(buffer);
    } catch (error) {
      if (error.code === 'ENOENT') return reply.code(404).send(apiError('NOT_FOUND', 'Imagem não encontrada.'));
      throw error;
    }
  });

  app.post('/api/v1/firecast/transfers/:transferId/ack', async (request, reply) => {
    if (!tokenMatches(request)) return reply.code(401).send(apiError('UNAUTHORIZED', 'Credencial da ponte inválida.'));
    const receipt = request.server.firecastReceipts.get(request.params.transferId);
    if (!receipt) return reply.code(404).send(apiError('NOT_FOUND', 'Recibo não encontrado.'));
    const status = String(request.body?.status || '');
    if (!['applied', 'rejected', 'failed'].includes(status)) return reply.code(400).send(apiError('INVALID_INPUT', 'Estado de recebimento inválido.'));
    receipt.status = status;
    receipt.message = String(request.body?.message || '').slice(0, 1000);
    receipt.updatedAt = Date.now();
    return { ok: true, transferId: request.params.transferId, status, message: receipt.message };
  });

  app.get('/api/v1/firecast/transfers/:transferId', async (request, reply) => {
    if (!tokenMatches(request)) return reply.code(401).send(apiError('UNAUTHORIZED', 'Credencial da ponte inválida.'));
    const receipt = request.server.firecastReceipts.get(request.params.transferId);
    if (!receipt) return reply.code(404).send(apiError('NOT_FOUND', 'Recibo não encontrado.'));
    return { ok: true, transferId: request.params.transferId, status: receipt.status, message: receipt.message };
  });
}
