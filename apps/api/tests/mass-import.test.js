import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { normalizeEntity } from '@sao/domain';

const mocks = vi.hoisted(() => ({
  rows: new Map(),
  history: null
}));

vi.mock('../src/lib/prisma.js', () => ({
  prisma: {
    $transaction: vi.fn(),
    entity: { findMany: vi.fn(), findUnique: vi.fn() },
    importHistory: { create: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn() },
    user: { findMany: vi.fn() }
  }
}));
vi.mock('../src/lib/auth.js', () => ({
  authenticate: async (request) => { request.auth = { user: { id: 'gm-1' } }; },
  requireCampaign: async (request) => { request.campaign = { id: request.params.campaignId, slug: 'mass' }; },
  requireCsrf: async () => {},
  requireGm: async () => {}
}));
vi.mock('../src/lib/config.js', () => ({ config: { maxJsonBytes: 128 * 1024 * 1024, importBatchSize: 50, importTransactionTimeoutMs: 300000 } }));
vi.mock('../src/services/notifications.js', () => ({ notifyCampaign: vi.fn() }));
vi.mock('../src/lib/audit.js', () => ({ audit: vi.fn() }));
vi.mock('../src/services/content.js', () => ({
  applyEntityChangeDocument: vi.fn(),
  entityRecordToCanonical: (entity) => entity.canonical ?? entity.data,
  softRemoveImportedEntityTx: vi.fn(async ({ type, domainId }) => {
    const row = mocks.rows.get(`${type}:${domainId}`);
    if (!row) return null;
    row.deletedAt = new Date();
    row.version += 1;
    return row;
  }),
  upsertImportedEntityTx: vi.fn(async ({ type, input }) => {
    const key = `${type}:${input.id}`;
    const current = mocks.rows.get(key);
    const row = current ?? { id: `row-${input.id}`, type, domainId: input.id, version: 0, deletedAt: null };
    Object.assign(row, { name: input.name, data: input, canonical: input, deletedAt: null, version: row.version + 1 });
    mocks.rows.set(key, row);
    return row;
  })
}));
vi.mock('@sao/domain', async (importOriginal) => ({ ...(await importOriginal()), validateEntityCatalog: vi.fn(() => []) }));

import { prisma } from '../src/lib/prisma.js';
import { softRemoveImportedEntityTx, upsertImportedEntityTx } from '../src/services/content.js';
import { jsonRoutes } from '../src/routes/json.js';
import { formatMonsterSheets } from '@sao/domain';

let app;

function makePack(count = 300) {
  const originals = new Map();
  const entities = Array.from({ length: count }, (_, index) => {
    const original = `Ficha ${index + 1}  \r\n\tAção: Investida ${index + 1} (1d20+${index})  \r\n\r\nFim da ficha ${index + 1}  `;
    const data = normalizeEntity('monster', {
      id: `monster.mass-${index + 1}`,
      name: `Monstro ${index + 1}`,
      visibility: { entity: 'gm', sections: {} },
      fields: [
        { key: 'originalSheet', value: original },
        { key: 'importBatch', value: 'mass-300' }
      ],
      statBlocks: {
        default: { nd: index % 20 + 1, combat: { defesa: 15 + index % 10 }, attributes: { for: 10 + index % 8 } },
        'forma-alternativa': { nd: index % 12 + 2, resources: { pv: 40 + index } }
      },
      components: [
        { id: `move-${index}`, kind: 'movement', data: { name: 'Deslocamento', walk: '9m' } },
        { id: `attack-${index}`, kind: 'attack', data: { name: 'Mordida', damage: '1d8+4', critical: '19/x2' } },
        { id: `ability-${index}`, kind: 'ability', data: { name: 'Fúria', description: `Descrição longa ${index}` } },
        { id: `skill-${index}`, kind: 'skill', data: { name: 'Percepção', bonus: 8 + index % 4 } },
        { id: `trait-${index}`, kind: 'trait', data: { name: 'Resistência', description: 'Completa' } }
      ]
    }, { format: '2.0' });
    originals.set(data.id, original);
    return { type: 'monster', data };
  });
  return {
    pack: { schemaVersion: '2.0', packId: 'mass-300', name: 'Importação de 300 monstros', containers: ['monster'], entities },
    originals
  };
}

beforeEach(async () => {
  mocks.rows.clear();
  mocks.history = null;
  vi.clearAllMocks();
  prisma.$transaction.mockImplementation((callback) => callback(prisma));
  prisma.entity.findMany.mockImplementation(async () => [...mocks.rows.values()]);
  prisma.importHistory.create.mockImplementation(async ({ data }) => {
    mocks.history = { id: 'history-mass-300', ...data };
    return mocks.history;
  });
  prisma.importHistory.findFirst.mockImplementation(async () => mocks.history);
  prisma.importHistory.updateMany.mockResolvedValue({ count: 1 });
  app = Fastify();
  app.importPreviews = new Map();
  await app.register(jsonRoutes);
});

afterEach(async () => { await app.close(); });

describe('importação em massa de monstros', () => {
  it('importa 300 fichas completas, preserva textos e desfaz a operação', async () => {
    const { pack, originals } = makePack();
    const startedAt = performance.now();
    const previewResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/campaigns/camp-1/import/preview',
      payload: pack
    });
    expect(previewResponse.statusCode, previewResponse.body).toBe(200);
    const preview = previewResponse.json();
    expect(preview.total).toBe(300);
    expect(preview.selectableCount).toBe(300);
    expect(preview.diff).toHaveLength(50);

    const appliedResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/campaigns/camp-1/import/apply',
      payload: { previewId: preview.previewId, selectionMode: 'all' }
    });
    const elapsed = performance.now() - startedAt;
    expect(appliedResponse.statusCode, appliedResponse.body).toBe(200);
    expect(appliedResponse.json()).toMatchObject({ created: 300, updated: 0, removed: 0, selected: 300 });
    expect(mocks.rows.size).toBe(300);
    expect(mocks.history.changes).toHaveLength(300);
    expect(elapsed).toBeLessThan(10000);

    for (const [id, original] of originals) {
      const row = mocks.rows.get(`monster:${id}`);
      expect(row.data.fields.find((field) => field.key === 'originalSheet')?.value).toBe(original);
    }
    const exported = formatMonsterSheets([...mocks.rows.values()].map((row) => ({ type: 'monster', data: row.data })));
    for (const original of originals.values()) expect(exported).toContain(original);

    const undoResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/campaigns/camp-1/import/history/history-mass-300/undo'
    });
    expect(undoResponse.statusCode, undoResponse.body).toBe(200);
    expect(undoResponse.json()).toMatchObject({ historyId: 'history-mass-300', reverted: 300 });
    expect(softRemoveImportedEntityTx).toHaveBeenCalledTimes(300);
    expect(upsertImportedEntityTx).toHaveBeenCalledTimes(300);
    expect([...mocks.rows.values()].every((row) => row.deletedAt)).toBe(true);
  });
});
