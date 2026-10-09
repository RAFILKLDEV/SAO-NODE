import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/prisma.js', () => ({ prisma: {
  membership: { findMany: vi.fn() },
  grant: { findMany: vi.fn(), count: vi.fn(), groupBy: vi.fn() },
  user: { findMany: vi.fn() },
  group: { findMany: vi.fn() },
  entity: { findMany: vi.fn() },
  $transaction: vi.fn()
} }));
vi.mock('../src/lib/auth.js', () => ({
  authenticate: async (request) => { request.auth = { user: { id: 'gm-1' } }; },
  requireCampaign: async (request) => { request.campaign = { id: request.params.campaignId }; },
  requireCsrf: async () => {},
  requireGm: async () => {}
}));
vi.mock('../src/lib/audit.js', () => ({ audit: vi.fn() }));
vi.mock('../src/services/content.js', () => ({ entityRecordToCanonical: (entity) => ({ id: entity.domainId, name: entity.name }) }));
import { prisma } from '../src/lib/prisma.js';
import { grantRoutes } from '../src/routes/grants.js';

let app;
beforeEach(async () => {
  vi.clearAllMocks();
  app = Fastify();
  await app.register(grantRoutes);
  prisma.membership.findMany.mockResolvedValue([{ userId: 'player-1', role: 'player', user: { name: 'Jogadora', login: 'player' } }]);
  prisma.grant.groupBy.mockResolvedValue([{ subjectId: 'player-1', _count: { _all: 127 }, _max: { updatedAt: new Date('2026-09-30T12:00:00Z') } }]);
  prisma.grant.findMany.mockResolvedValue([{ id: 'grant-1', campaignId: 'camp-1', actorUserId: 'gm-1', subjectType: 'user', subjectId: 'player-1', entityType: 'item', entityDomainId: 'item.meat', targetKind: 'entity', targetKey: 'existence', allowance: 'allow', updatedAt: new Date() }]);
  prisma.grant.count.mockResolvedValue(205);
  prisma.user.findMany.mockResolvedValue([{ id: 'gm-1', name: 'Mestre', login: 'gm' }, { id: 'player-1', name: 'Jogadora', login: 'player' }]);
  prisma.group.findMany.mockResolvedValue([]);
  prisma.entity.findMany.mockResolvedValue([{ id: 'item-row', type: 'item', domainId: 'item.meat', name: 'Carne', baseVisibility: 'public', data: {}, fields: [], references: [], locationConnections: [], monsterComponents: [], questObjectives: [], questRewards: [] }]);
});
afterEach(async () => { await app.close(); });

describe('discoveries pagination', () => {
  it('summarizes grant counts per member for player cards', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/campaigns/camp-1/discoveries/subjects' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual([{ userId: 'player-1', role: 'player', name: 'Jogadora', login: 'player', count: 127, updatedAt: '2026-09-30T12:00:00.000Z' }]);
  });

  it('paginates recent grants and resolves actor/content names', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/campaigns/camp-1/discoveries?page=2&pageSize=100&subjectType=user&subjectId=player-1' });
    expect(response.statusCode).toBe(200);
    expect(prisma.grant.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { campaignId: 'camp-1', subjectType: 'user', subjectId: 'player-1' }, skip: 100, take: 100 }));
    expect(response.json()).toMatchObject({ total: 205, page: 2, pageSize: 100, items: [{ actorName: 'Mestre', subjectName: 'Jogadora', entityName: 'Carne' }] });
  });
});
