import Fastify from 'fastify';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { normalizeEntity, referenceGrantKey } from '@sao/domain';
vi.mock('../src/lib/prisma.js', () => ({ prisma: { entity: { findMany: vi.fn(), findUnique: vi.fn() }, grant: { findMany: vi.fn() }, groupMember: { findMany: vi.fn() } } }));
vi.mock('../src/lib/auth.js', () => ({
  authenticate: async request => { request.auth = { user: { id: 'u1' } }; },
  requireCampaign: async request => { request.campaign = { id: request.params.campaignId }; request.viewerContext = { userId: 'u1', groups: [], gm: request.headers['x-role'] === 'gm' }; },
  requireCsrf: async () => {}, isGm: request => request.viewerContext?.gm
}));
import { prisma } from '../src/lib/prisma.js';
import { getEntityForRequest, listEntitiesForRequest, searchForRequest, entityRecordToCanonical } from '../src/services/content.js';
import { dropRoutes } from '../src/routes/drops.js';
let app, rows, grants;
const record = (type, id, extra = {}) => ({ id: 'pk-' + id, campaignId: 'c1', type, domainId: id, name: id, active: true, baseVisibility: 'public', version: 1, deletedAt: null,
  data: normalizeEntity(type, { id, name: id, visibility: {}, ...(type === 'item' ? { category: 'material', valueFormula: '3d4+3' } : {}) }),
  fields: [], references: [], locationConnections: [], monsterComponents: [], questObjectives: [], questRewards: [], ...extra });
const ref = visibility => ({ id: 'ephemeral-row', targetType: 'item', targetDomainId: 'item.a', role: 'drops', slot: 'references', chance: 100, quantityMin: 2, quantityMax: 2, valueFormula: '1d4', visibility });
const request = (gm = false, query = {}) => ({ campaign: { id: 'c1' }, auth: { user: { id: 'u1' } }, viewerContext: { gm, userId: 'u1', groups: [] }, query });
const relationGrant = (allowance = 'allow', subjectId = 'u1') => ({ campaignId: 'c1', entityType: 'monster', entityDomainId: 'monster.a', targetKind: 'reference', targetKey: referenceGrantKey('monster', 'monster.a', { type: 'item', id: 'item.a', role: 'drops' }), subjectType: 'user', subjectId, allowance });
beforeEach(async () => {
  vi.clearAllMocks();
  rows = [record('monster', 'monster.a', { references: [ref('public')] }), record('item', 'item.a')]; grants = [];
  prisma.entity.findUnique.mockImplementation(async ({ where }) => rows.find(row => Object.entries(where.campaignId_type_domainId).every(([k,v]) => row[k] === v)) ?? null);
  prisma.entity.findMany.mockImplementation(async ({ where, skip = 0, take }) => rows.filter(row => row.campaignId === where.campaignId && (!where.type || row.type === where.type) && (!where.name || row.name.includes(where.name.contains)) && (!where.references || row.references.some(r => r.targetDomainId === where.references.some.targetDomainId))).slice(skip, take ? skip + take : undefined));
  prisma.grant.findMany.mockImplementation(async ({ where }) => grants.filter(g => ['campaignId','entityType','entityDomainId','targetKind','targetKey'].every(k => where[k] === undefined || g[k] === where[k])));
  app = Fastify(); await app.register(dropRoutes);
});
afterEach(async () => { await app.close(); vi.restoreAllMocks(); });

it.each([
  ['public', true, false, false, 1], ['public', false, false, false, 0],
  ['discoverable', true, false, false, 0], ['discoverable', true, true, false, 1],
  ['discoverable', false, true, false, 0], ['gm', true, false, false, 0],
  ['gm', false, false, false, 0], ['gm', true, true, false, 0], ['gm', false, false, true, 1]
])('%s relation, item known=%s grant=%s GM=%s protects every projection and loot', async (visibility, known, granted, gm, count) => {
  rows[0].references[0].visibility = visibility;
  rows[1].baseVisibility = known ? 'public' : 'discoverable';
  if (granted) grants.push(relationGrant());
  const monster = await getEntityForRequest({ request: request(gm), type: 'monster', domainId: 'monster.a' });
  expect(monster.references).toHaveLength(count);
  const v2 = await getEntityForRequest({ request: request(gm, { format: '2' }), type: 'monster', domainId: 'monster.a' });
  expect(v2.data.links).toHaveLength(count);
  const list = await listEntitiesForRequest({ request: request(gm), type: 'monster' });
  expect(list.items[0].references).toHaveLength(count);
  const filtered = await listEntitiesForRequest({ request: request(gm), type: 'monster', dropId: 'item.a' });
  expect(filtered.items).toHaveLength(count);
  if (known || gm) {
    const item = await getEntityForRequest({ request: request(gm), type: 'item', domainId: 'item.a' });
    expect(item.backlinks).toHaveLength(count);
  }
  const search = await searchForRequest({ request: request(gm), query: 'monster' });
  expect(search[0]).not.toHaveProperty('references');
  const response = await app.inject({ method: 'POST', url: '/api/v1/campaigns/c1/monsters/monster.a/drops/roll?format=2', headers: gm ? { 'x-role': 'gm' } : {} });
  expect(response.statusCode, response.body).toBe(200);
  expect(response.json().results).toHaveLength(count);
});
it('denies grants for other users and explicit denial, keeps stable keys after child replacement', async () => {
  rows[0].references[0] = { ...ref('discoverable'), id: 'new-row' };
  grants = [relationGrant('allow', 'u2')];
  expect((await getEntityForRequest({ request: request(), type: 'monster', domainId: 'monster.a' })).references).toEqual([]);
  grants = [relationGrant()];
  expect((await getEntityForRequest({ request: request(), type: 'monster', domainId: 'monster.a' })).references).toHaveLength(1);
  grants = [relationGrant('deny')];
  expect((await getEntityForRequest({ request: request(), type: 'monster', domainId: 'monster.a' })).references).toEqual([]);
});
it('paginates authorized drops, including results beyond the first candidate batch', async () => {
  rows = [...Array.from({ length: 101 }, (_, i) => record('monster', 'monster.hidden' + i, { references: [ref('gm')] })), rows[0], rows[1]];
  const result = await listEntitiesForRequest({ request: request(false, { format: '2' }), type: 'monster', dropId: 'item.a', pageSize: 1 });
  expect(result.items.map(item => item.id)).toEqual(['monster.a']);
  expect((await listEntitiesForRequest({ request: request(), type: 'monster', dropId: 'item.a', pageSize: 1, page: 2 })).items).toEqual([]);
});
it('loot uses the monster formula before the item fallback, without persisting a roll', async () => {
  vi.spyOn(Math, 'random').mockReturnValue(0);
  const roll = () => app.inject({ method: 'POST', url: '/api/v1/campaigns/c1/monsters/monster.a/drops/roll' });
  expect((await roll()).json().results[0]).toMatchObject({ cashValue: 1, valueFormula: '1d4', category: 'material' });
  rows[0].references[0].valueFormula = '10';
  expect((await roll()).json().results[0]).toMatchObject({ cashValue: 10, valueFormula: '10' });
  delete rows[0].references[0].valueFormula;
  expect((await roll()).json().results[0]).toMatchObject({ cashValue: 6, valueFormula: '3d4+3' });
  expect(rows[1].data).not.toHaveProperty('cashValue');
  expect((await app.inject({ method: 'POST', url: '/api/v1/campaigns/other/monsters/monster.a/drops/roll' })).statusCode).toBe(404);
});
it('ignores item and monster quantity formulas when rolling monster loot', async () => {
  vi.spyOn(Math, 'random').mockReturnValue(0);
  rows[1].data.quantityFormula = '1d20';
  rows[0].references[0].quantityFormula = '1d40';
  rows[0].references[0].quantityMin = 2;
  rows[0].references[0].quantityMax = 2;
  const response = await app.inject({ method: 'POST', url: '/api/v1/campaigns/c1/monsters/monster.a/drops/roll' });
  expect(response.json().results[0]).toMatchObject({ cashValue: 1, valueFormula: '1d4' });
  expect(response.json().results[0]).not.toHaveProperty('quantity');
  expect(response.json().results[0]).not.toHaveProperty('quantityFormula');
  delete rows[0].references[0].quantityFormula;
  const fallback = await app.inject({ method: 'POST', url: '/api/v1/campaigns/c1/monsters/monster.a/drops/roll' });
  expect(fallback.json().results[0]).toMatchObject({ cashValue: 1, valueFormula: '1d4' });
});
it('rebuilds persisted visibility in authoritative exports', () => {
  rows[0].references[0].visibility = 'gm';
  expect(entityRecordToCanonical(rows[0]).links[0].visibility).toBe('gm');
});
