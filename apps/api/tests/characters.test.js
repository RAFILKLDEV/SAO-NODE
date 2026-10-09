import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Exercise the actual routes while keeping these tests independent of PostgreSQL.
vi.mock('../src/lib/prisma.js', () => ({ prisma: {
  membership: { findMany: vi.fn(), findFirst: vi.fn() },
  characterFavorite: { findMany: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
} }));
vi.mock('../src/lib/auth.js', () => ({
  authenticate: async (request) => { request.auth = { user: { id: request.headers['x-user'] ?? 'u1' } }; },
  requireCampaign: async (request) => { request.campaign = { id: request.params.campaignId }; request.membership = { role: request.headers['x-role'] ?? 'player' }; },
  requireCsrf: async () => {},
  requireGm: async (request, reply) => { if (request.membership.role !== 'gm') return reply.code(403).send({ error: 'Forbidden' }); }
}));
vi.mock('../src/services/content.js', () => ({ getEntityForRequest: vi.fn() }));
vi.mock('../src/lib/audit.js', () => ({ audit: vi.fn() }));
import { prisma } from '../src/lib/prisma.js';
import { getEntityForRequest } from '../src/services/content.js';
import { characterRoutes } from '../src/routes/characters.js';

let app;
beforeEach(async () => {
  vi.clearAllMocks();
  app = Fastify();
  await app.register(characterRoutes);
  const records = new Map();
  const key = (record) => [record.campaignId, record.userId, record.targetType, record.targetId].join('|');
  const matches = (record, where) => Object.entries(where).every(([field, value]) => record[field] === value);
  prisma.characterFavorite.upsert.mockImplementation(async ({ create }) => { records.set(key(create), create); return create; });
  prisma.characterFavorite.findMany.mockImplementation(async ({ where }) => [...records.values()].filter((record) => matches(record, where)).map(({ targetType, targetId }) => ({ targetType, targetId })));
  prisma.characterFavorite.deleteMany.mockImplementation(async ({ where }) => { for (const [id, record] of records) if (matches(record, where)) records.delete(id); return { count: 1 }; });
  getEntityForRequest.mockImplementation(async ({ domainId }) => domainId.endsWith('.hidden') ? null : { id: domainId, characterType: domainId === 'npc.entity' ? 'entity' : 'npc' });
  prisma.membership.findFirst.mockResolvedValue({ userId: 'u2' });
});
afterEach(async () => { await app.close(); });
const request = (method, suffix, user = 'u1', campaign = 'c1', payload) => app.inject({ method, url: `/api/v1/campaigns/${campaign}${suffix}`, headers: { 'x-user': user }, payload });

describe('character routes', () => {
  it('exposes a limited player roster to player members', async () => {
    prisma.membership.findMany.mockResolvedValue([{ userId: 'u2', characterImageUrl: '/portrait.png', user: { name: 'Jogador' } }]);
    const response = await request('GET', '/characters/players');
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([{ userId: 'u2', name: 'Jogador', characterImageUrl: '/portrait.png' }]);
    expect(prisma.membership.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { campaignId: 'c1', role: 'player' }, select: { userId: true, characterImageUrl: true, user: { select: { name: true } } } }));
  });
  it('favorites NPC, entity and player once, isolates users and campaigns, and removes only the owner favorite', async () => {
    for (const target of ['npc/npc.a', 'npc/npc.entity', 'player/u2']) {
      expect((await request('PUT', `/character-favorites/${target}`)).statusCode).toBe(200);
      await request('PUT', `/character-favorites/${target}`);
    }
    expect((await request('GET', '/character-favorites')).json()).toHaveLength(3);
    expect((await request('GET', '/character-favorites', 'u2')).json()).toEqual([]);
    expect((await request('GET', '/character-favorites', 'u1', 'c2')).json()).toEqual([]);
    await request('DELETE', '/character-favorites/player/u2', 'u2');
    expect((await request('GET', '/character-favorites')).json()).toHaveLength(3);
    await request('DELETE', '/character-favorites/player/u2');
    expect((await request('GET', '/character-favorites')).json()).toHaveLength(2);
    expect(prisma.characterFavorite.upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { campaignId_userId_targetType_targetId: { campaignId: 'c1', userId: 'u1', targetType: 'player', targetId: 'u2' } } }));
  });
  it('rejects hidden NPCs and players outside the campaign', async () => {
    expect((await request('PUT', '/character-favorites/npc/npc.hidden')).statusCode).toBe(404);
    prisma.membership.findFirst.mockResolvedValue(null);
    expect((await request('PUT', '/character-favorites/player/outside')).statusCode).toBe(404);
    expect(prisma.characterFavorite.upsert).not.toHaveBeenCalled();
  });
  it('allows favorites for locations, items, monsters and quests only when visible', async () => {
    for (const targetType of ['location', 'item', 'monster', 'quest']) {
      expect((await request('PUT', `/character-favorites/${targetType}/${targetType}.visible`)).statusCode).toBe(200);
      expect(getEntityForRequest).toHaveBeenLastCalledWith(expect.objectContaining({ type: targetType, domainId: `${targetType}.visible` }));
    }
    expect((await request('PUT', '/character-favorites/monster/monster.hidden')).statusCode).toBe(404);
  });
});
