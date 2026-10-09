import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/prisma.js', () => ({ prisma: {
  group: { findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn() },
  groupMember: { upsert: vi.fn(), deleteMany: vi.fn() },
  npcAssociation: { findMany: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
  entity: { findUnique: vi.fn() }, membership: { findUnique: vi.fn() }, grant: { findMany: vi.fn() },
  $transaction: vi.fn()
} }));
vi.mock('../src/lib/auth.js', () => ({
  authenticate: async request => { request.auth = { user: { id: 'gm-1' } }; },
  requireCampaign: async request => { request.campaign = { id: request.params.campaignId }; request.membership = { role: request.headers['x-role'] ?? 'gm' }; },
  requireGm: async (request, reply) => { if (request.membership.role === 'player') return reply.code(403).send({ error: 'Forbidden' }); },
  requireCsrf: async () => {}
}));
vi.mock('../src/lib/audit.js', () => ({ audit: vi.fn() }));
vi.mock('../src/services/content.js', () => ({ getEntityForRequest: vi.fn() }));
vi.mock('../src/services/notifications.js', () => ({ createNotifications: vi.fn() }));

import { prisma } from '../src/lib/prisma.js';
import { audit } from '../src/lib/audit.js';
import { getEntityForRequest } from '../src/services/content.js';
import { groupRoutes } from '../src/routes/groups.js';

let app, emit;
const group = { id: 'group-db', campaignId: 'campaign-1', domainId: 'group.explorers', name: 'Exploradores', members: [{ user: { id: 'player-1', name: 'Ana', login: 'ana', passwordHash: 'private' } }] };
const base = '/api/v1/campaigns/campaign-1/groups';
const request = (method, suffix = '', payload, role = 'gm') => app.inject({ method, url: `${base}${suffix}`, payload, headers: { 'x-role': role } });

beforeEach(async () => {
  vi.resetAllMocks();
  app = Fastify();
  emit = vi.fn(); app.decorate('realtime', { to: vi.fn(() => ({ emit })) });
  await app.register(groupRoutes);
  prisma.$transaction.mockImplementation(callback => callback(prisma));
  prisma.group.findMany.mockResolvedValue([group]);
  prisma.group.findUnique.mockResolvedValue(group);
  prisma.membership.findUnique.mockResolvedValue({ userId: 'player-2' });
  prisma.entity.findUnique.mockResolvedValue({ domainId: 'npc.miller', type: 'npc', deletedAt: null });
  prisma.npcAssociation.findMany.mockResolvedValue([]);
  prisma.npcAssociation.upsert.mockResolvedValue({});
  prisma.npcAssociation.deleteMany.mockResolvedValue({ count: 1 });
  prisma.grant.findMany.mockResolvedValue([]);
});
afterEach(async () => { await app.close(); });

describe('group characters', () => {
  it('adds an existing character without creating users, granting content or duplicating the link', async () => {
    const links = new Map();
    prisma.npcAssociation.upsert.mockImplementation(({ create }) => { links.set(`${create.campaignId}:${create.ownerId}:${create.npcDomainId}`, create); return Promise.resolve(create); });
    for (let index = 0; index < 2; index += 1) expect((await request('POST', '/group.explorers/characters', { characterId: 'npc.miller' })).statusCode).toBe(200);
    expect(links.size).toBe(1);
    const key = { campaignId: 'campaign-1', npcDomainId: 'npc.miller', ownerType: 'group', ownerId: 'group.explorers' };
    expect(prisma.npcAssociation.upsert).toHaveBeenCalledWith({ where: { campaignId_npcDomainId_ownerType_ownerId: key }, create: key, update: {} });
    expect(prisma.entity.findUnique).toHaveBeenCalledWith({ where: { campaignId_type_domainId: { campaignId: 'campaign-1', type: 'npc', domainId: 'npc.miller' } } });
    expect(prisma.groupMember.upsert).not.toHaveBeenCalled();
    expect(prisma.grant.findMany).not.toHaveBeenCalled();
    expect(audit).toHaveBeenCalledWith(prisma, expect.objectContaining({ action: 'group.character.add', entityDomainId: 'npc.miller' }));
    expect(emit).toHaveBeenCalledWith('group.changed', { groupId: 'group.explorers' });
  });

  it('removes only the selected group association in the current campaign', async () => {
    expect((await request('DELETE', '/group.explorers/characters/npc.miller')).statusCode).toBe(204);
    expect(prisma.npcAssociation.deleteMany).toHaveBeenCalledWith({ where: { campaignId: 'campaign-1', npcDomainId: 'npc.miller', ownerType: 'group', ownerId: 'group.explorers' } });
    expect(prisma.groupMember.deleteMany).not.toHaveBeenCalled();
    expect(audit).toHaveBeenCalledWith(prisma, expect.objectContaining({ action: 'group.character.remove' }));
  });

  it('rejects character changes by players', async () => {
    expect((await request('POST', '/group.explorers/characters', { characterId: 'npc.miller' }, 'player')).statusCode).toBe(403);
    expect((await request('DELETE', '/group.explorers/characters/npc.miller', undefined, 'player')).statusCode).toBe(403);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it.each([null, { deletedAt: new Date() }])('rejects missing, foreign or deleted characters (%j)', async entity => {
    prisma.entity.findUnique.mockResolvedValue(entity);
    expect((await request('POST', '/group.explorers/characters', { characterId: 'npc.foreign' })).statusCode).toBe(404);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects missing or foreign groups before reading characters or writing links', async () => {
    prisma.group.findUnique.mockResolvedValue(null);
    expect((await request('POST', '/group.foreign/characters', { characterId: 'npc.miller' })).statusCode).toBe(404);
    expect((await request('DELETE', '/group.foreign/characters/npc.miller')).statusCode).toBe(404);
    expect(prisma.group.findUnique).toHaveBeenCalledWith({ where: { campaignId_domainId: { campaignId: 'campaign-1', domainId: 'group.foreign' } } });
    expect(prisma.entity.findUnique).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it.each([{}, { characterId: '' }])('rejects invalid selections (%j)', async payload => {
    expect((await request('POST', '/group.explorers/characters', payload)).statusCode).toBe(400);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('lists characters using basic-content permissions and does not expose hidden identities', async () => {
    prisma.npcAssociation.findMany.mockResolvedValue([{ ownerId: group.domainId, npcDomainId: 'npc.miller' }, { ownerId: group.domainId, npcDomainId: 'npc.secret' }]);
    getEntityForRequest.mockImplementation(({ domainId, request: req }) => Promise.resolve(domainId === 'npc.secret' && req.membership.role === 'player' ? null : { id: domainId, name: domainId === 'npc.secret' ? 'Agente secreto' : 'Moleiro', characterType: 'npc', secret: 'private' }));
    const gm = await request('GET');
    expect(gm.json()[0].characters).toHaveLength(2);
    const player = await request('GET', '', undefined, 'player');
    expect(player.json()[0].characters).toEqual([{ id: 'npc.miller', name: 'Moleiro', characterType: 'npc' }]);
    for (const secret of ['npc.secret', 'Agente secreto', 'passwordHash', 'private']) expect(player.body).not.toContain(secret);
    expect(getEntityForRequest).toHaveBeenCalledWith(expect.objectContaining({ type: 'npc', options: { backlinks: false, format: '1', requireSection: 'basic' } }));
    expect(prisma.npcAssociation.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { campaignId: 'campaign-1', ownerType: 'group', ownerId: { in: ['group.explorers'] } } }));
  });

  it('does not attach a user from outside the campaign', async () => {
    prisma.membership.findUnique.mockResolvedValue(null);
    expect((await request('POST', '/group.explorers/members', { userId: 'foreign-user' })).statusCode).toBe(404);
    expect(prisma.membership.findUnique).toHaveBeenCalledWith({ where: { campaignId_userId: { campaignId: 'campaign-1', userId: 'foreign-user' } } });
    expect(prisma.groupMember.upsert).not.toHaveBeenCalled();
  });

  it('continues adding campaign users separately from characters', async () => {
    expect((await request('POST', '/group.explorers/members', { userId: 'player-2' })).statusCode).toBe(200);
    expect(prisma.groupMember.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: { groupId: group.id, userId: 'player-2' } }));
    expect(prisma.npcAssociation.upsert).not.toHaveBeenCalled();
    expect(emit).toHaveBeenCalledWith('permissions.changed', { reason: 'group-membership', groupId: group.domainId });
  });
});
