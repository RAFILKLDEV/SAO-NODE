import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/prisma.js', () => ({ prisma: {
  $transaction: vi.fn(),
  entity: { findMany: vi.fn(), findUnique: vi.fn() },
  importHistory: { findMany: vi.fn(), count: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn() },
  user: { findMany: vi.fn() }
} }));
vi.mock('../src/lib/auth.js', () => ({
  authenticate: async (request) => { request.auth = { user: { id: 'gm-1' } }; },
  requireCampaign: async (request) => { request.campaign = { id: request.params.campaignId, slug: 'camp' }; },
  requireCsrf: async () => {},
  requireGm: async () => {}
}));
vi.mock('../src/lib/config.js', () => ({ config: { maxJsonBytes: 2_000_000 } }));
vi.mock('../src/services/notifications.js', () => ({ notifyCampaign: vi.fn() }));
vi.mock('../src/lib/audit.js', () => ({ audit: vi.fn() }));
vi.mock('../src/services/content.js', () => ({
  applyEntityChangeDocument: vi.fn(),
  entityRecordToCanonical: (entity) => entity.canonical ?? entity.data,
  softRemoveImportedEntityTx: vi.fn(),
  upsertImportedEntityTx: vi.fn()
}));
vi.mock('@sao/domain', async (importOriginal) => ({ ...(await importOriginal()), validateEntityCatalog: vi.fn(() => []) }));

import { prisma } from '../src/lib/prisma.js';
import { upsertImportedEntityTx } from '../src/services/content.js';
import { jsonRoutes } from '../src/routes/json.js';

let app;
let current;
let history;
const beforeData = { id: 'item.meat', name: 'Carne anterior', schemaVersion: '2.0' };
const afterData = { id: 'item.meat', name: 'Carne importada', schemaVersion: '2.0' };

beforeEach(async () => {
  vi.clearAllMocks();
  app = Fastify();
  app.importPreviews = new Map();
  await app.register(jsonRoutes);
  current = { id: 'row-item', type: 'item', domainId: 'item.meat', name: 'Carne importada', version: 5, deletedAt: null, data: afterData, canonical: afterData };
  history = {
    id: 'import-1', campaignId: 'camp-1', packId: 'pack', fileName: 'pack.json', sourceKind: 'json-v2', reversibleCount: 1,
    summary: { created: 0, updated: 1, removed: 0 }, revertedAt: null,
    changes: [{ type: 'item', id: 'item.meat', status: 'UPDATED', before: { data: beforeData, source: null, deletedAt: false }, after: { data: afterData, source: { kind: 'json' }, deletedAt: false }, resultVersion: 5 }]
  };
  prisma.$transaction.mockImplementation((callback) => callback(prisma));
  prisma.importHistory.findFirst.mockResolvedValue(history);
  prisma.importHistory.updateMany.mockResolvedValue({ count: 1 });
  prisma.entity.findMany.mockResolvedValue([current]);
  prisma.user.findMany.mockResolvedValue([{ id: 'gm-1', name: 'Mestre', login: 'mestre' }]);
  upsertImportedEntityTx.mockImplementation(async ({ input }) => {
    current.version += 1;
    current.name = input.name;
    current.data = input;
    current.canonical = input;
    return current;
  });
});
afterEach(async () => { await app.close(); });

const undoRequest = () => app.inject({ method: 'POST', url: '/api/v1/campaigns/camp-1/import/history/import-1/undo' });

describe('import history routes', () => {
  it('reverts an import only when every entity still has its applied version', async () => {
    const response = await undoRequest();
    expect(response.statusCode, response.body).toBe(200);
    expect(upsertImportedEntityTx).toHaveBeenCalledWith(expect.objectContaining({ type: 'item', domainId: 'item.meat', input: beforeData, source: null }));
    expect(prisma.importHistory.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'import-1', campaignId: 'camp-1', revertedAt: null }, data: expect.objectContaining({ revertedByUserId: 'gm-1' }) }));
  });

  it('rejects an undo when the imported entity has changed since the snapshot', async () => {
    current.version = 6;
    const response = await undoRequest();
    expect(response.statusCode).toBe(409);
    expect(upsertImportedEntityTx).not.toHaveBeenCalled();
    expect(prisma.importHistory.updateMany).not.toHaveBeenCalled();
  });

  it('lists history with actor names and bounded pagination metadata', async () => {
    const row = { id: 'import-1', importedByUserId: 'gm-1', summary: history.summary, reversibleCount: 1 };
    prisma.importHistory.findMany.mockResolvedValue([row]);
    prisma.importHistory.count.mockResolvedValue(41);
    const response = await app.inject({ method: 'GET', url: '/api/v1/campaigns/camp-1/import/history?page=2&pageSize=20' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ total: 41, page: 2, pageSize: 20, items: [{ importedBy: { name: 'Mestre' }, reversible: true }] });
    expect(prisma.importHistory.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { campaignId: 'camp-1', sourceKind: { not: 'legacy' } } }));
    expect(prisma.importHistory.count).toHaveBeenCalledWith({ where: { campaignId: 'camp-1', sourceKind: { not: 'legacy' } } });
  });

  it('keeps the initial database snapshot as a visible but non-reversible baseline', async () => {
    history = {
      ...history,
      sourceKind: 'baseline',
      importedByUserId: null,
      reversibleCount: 0,
      changes: [{ type: 'item', id: 'item.meat', status: 'BASELINE', after: { data: afterData }, resultVersion: 5 }]
    };
    prisma.importHistory.findFirst.mockResolvedValue(history);
    const response = await undoRequest();
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({ error: { code: 'NOT_REVERSIBLE' } });
    expect(prisma.entity.findMany).not.toHaveBeenCalled();
    expect(upsertImportedEntityTx).not.toHaveBeenCalled();
  });

  it('lists the baseline without requiring a synthetic actor', async () => {
    prisma.importHistory.findMany.mockResolvedValue([{ id: 'baseline-camp-1', importedByUserId: null, sourceKind: 'baseline', reversibleCount: 0 }]);
    prisma.importHistory.count.mockResolvedValue(1);
    const response = await app.inject({ method: 'GET', url: '/api/v1/campaigns/camp-1/import/history' });
    expect(response.statusCode).toBe(200);
    expect(response.json().items[0]).toMatchObject({ importedBy: null, reversible: false });
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });
});
