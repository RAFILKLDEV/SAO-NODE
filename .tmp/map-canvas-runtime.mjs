import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { PrismaClient } from '@prisma/client';
import { hashToken } from '../apps/api/src/lib/security.js';
import { io } from 'socket.io-client';
const prisma = new PrismaClient();
try {
  const mode = process.argv[2];
  if (mode === 'before' || mode === 'after') {
    const models = ['mapBoard', 'mapLocationPin', 'mapTravelMarker', 'mapRegionBoundary', 'mapRoute', 'mapRoutePoint'];
    const entries = await Promise.all(models.map(async model => {
      const rows = await prisma[model].findMany({ orderBy: { id: 'asc' } });
      return [model, { count: rows.length, digest: createHash('sha256').update(JSON.stringify(rows)).digest('hex') }];
    }));
    const snapshot = Object.fromEntries(entries);
    if (mode === 'before') await writeFile('.tmp/map-canvas/runtime-before.json', JSON.stringify(snapshot), 'utf8');
    else {
      const original = JSON.parse(await readFile('.tmp/map-canvas/runtime-before.json', 'utf8'));
      if (JSON.stringify(original) !== JSON.stringify(snapshot)) throw new Error('Existing map data changed during the update');
    }
    console.log({ mode, existingMapData: 'verified', counts: Object.fromEntries(entries.map(([model, state]) => [model, state.count])) });
  } else {
    const member = await prisma.membership.findFirst({ where: { role: { in: ['owner', 'gm'] } }, orderBy: { createdAt: 'asc' } });
    if (!member) throw new Error('No campaign owner for read-only smoke test');
    const token = randomUUID();
    const session = await prisma.session.create({ data: { userId: member.userId, tokenHash: hashToken(token), csrfToken: randomUUID(), expiresAt: new Date(Date.now() + 60000) } });
    let socket;
    try {
      const base = 'http://127.0.0.1:3001';
      const response = await fetch(`${base}/api/v1/campaigns/${member.campaignId}/map/drawings`, { headers: { cookie: `sao_session=${token}` } });
      if (response.status !== 200) throw new Error(`Canvas endpoint returned ${response.status}`);
      const body = await response.json();
      if (!Array.isArray(body.items) || body.userId !== member.userId) throw new Error('Invalid canvas response');
      socket = io(base, { transports: ['websocket'], reconnection: false, auth: { campaignId: member.campaignId }, extraHeaders: { Cookie: `sao_session=${token}` } });
      await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); setTimeout(() => reject(new Error('Socket timeout')), 3000).unref(); });
      console.log({ api: 'ready', canvas: 'ready', realtime: 'connected' });
    } finally { socket?.disconnect(); await prisma.session.delete({ where: { id: session.id } }); }
  }
} finally { await prisma.$disconnect(); }
