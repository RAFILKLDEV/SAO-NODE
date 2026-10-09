import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/prisma.js', () => ({ prisma: {
  $transaction: vi.fn(),
  auditLog: { findMany: vi.fn(), count: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn() },
  user: { findMany: vi.fn() },
  group: { findMany: vi.fn() },
  entity: { findMany: vi.fn(), findUnique: vi.fn() }
} }));
vi.mock('../src/lib/auth.js', () => ({
  authenticate: async (request) => { request.auth = { user: { id: 'gm-1' } }; },
  requireCampaign: async (request) => { request.campaign = { id: request.params.campaignId }; },
  requireCsrf: async () => {},
  requireGm: async () => {}
}));
vi.mock('../src/lib/audit.js', () => ({ audit: vi.fn() }));
vi.mock('../src/services/content.js', () => ({
  entityRecordToCanonical: (entity) => entity.canonical ?? entity.data,
  softRemoveImportedEntityTx: vi.fn(),
  upsertImportedEntityTx: vi.fn()
}));
vi.mock('@sao/domain', async (importOriginal) => ({ ...(await importOriginal()), validateEntityCatalog: vi.fn(() => []) }));
import { prisma } from '../src/lib/prisma.js';
import { upsertImportedEntityTx } from '../src/services/content.js';
import { auditRoutes } from '../src/routes/audit.js';

let app;
let current;
let event;
const beforeData = { id: 'item.meat', name: 'Carne antes' };
const afterData = { id: 'item.meat', name: 'Carne depois' };
beforeEach(async () => {
  vi.clearAllMocks();
  app = Fastify();
  await app.register(auditRoutes);
  current = { id: 'item-row', type: 'item', domainId: 'item.meat', name: 'Carne depois', version: 5, deletedAt: null, data: afterData, canonical: afterData };
  event = { id: 'audit-1', campaignId: 'camp-1', actorUserId: 'gm-1', action: 'entity.update', entityType: 'item', entityDomainId: 'item.meat', before: { data: beforeData, source: null, deletedAt: false }, after: { data: afterData, source: null, deletedAt: false }, resultVersion: 5, revertedAt: null };
  prisma.$transaction.mockImplementation((callback) => callback(prisma));
  prisma.auditLog.findFirst.mockResolvedValue(event);
  prisma.auditLog.findMany.mockResolvedValue([event]);
  prisma.auditLog.count.mockResolvedValue(61);
  prisma.auditLog.updateMany.mockResolvedValue({ count: 1 });
  prisma.user.findMany.mockResolvedValue([{ id: 'gm-1', name: 'Rafael', login: 'rafael' }]);
  prisma.group.findMany.mockResolvedValue([]);
  prisma.entity.findMany.mockResolvedValue([current]);
  prisma.entity.findUnique.mockResolvedValue(current);
});
afterEach(async () => { await app.close(); });

describe('audit routes', () => {
  it('returns pagination and resolved actor/entity names', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/campaigns/camp-1/audit?page=2&pageSize=50' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ total: 61, page: 2, pageSize: 50, items: [{ actor: { name: 'Rafael' }, entityName: 'Carne depois', reversible: true }] });
  });

  it('undoes a content edit with an exact version and rejects a later version', async () => {
    let response = await app.inject({ method: 'POST', url: '/api/v1/campaigns/camp-1/audit/audit-1/undo' });
    expect(response.statusCode, response.body).toBe(200);
    expect(upsertImportedEntityTx).toHaveBeenCalledWith(expect.objectContaining({ type: 'item', domainId: 'item.meat', input: beforeData, source: null }));
    current.version = 6;
    response = await app.inject({ method: 'POST', url: '/api/v1/campaigns/camp-1/audit/audit-1/undo' });
    expect(response.statusCode).toBe(409);
  });
});
