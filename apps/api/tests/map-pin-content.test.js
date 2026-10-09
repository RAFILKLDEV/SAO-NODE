import { beforeEach, describe, expect, it, vi } from 'vitest';
import { normalizeEntity } from '@sao/domain';

vi.mock('../src/lib/prisma.js', () => ({ prisma: {
  entity: { findMany: vi.fn(), findUnique: vi.fn() },
  grant: { findMany: vi.fn() }, groupMember: { findMany: vi.fn() }
} }));
vi.mock('../src/lib/auth.js', () => ({ isGm: (request) => request.viewerContext?.gm }));

import { prisma } from '../src/lib/prisma.js';
import { buildMapPinContent } from '../src/services/map-pin-content.js';
import { getEntityForRequest } from '../src/services/content.js';

let rows;
const record = (type, id, data = {}, extra = {}) => ({
  id: `pk-${id}`, campaignId: 'campaign', type, domainId: id, name: data.name ?? id,
  active: true, baseVisibility: 'public', version: 1, deletedAt: null,
  data: normalizeEntity(type, { id, name: data.name ?? id, visibility: {}, ...data }, { format: '2.0' }),
  fields: [], references: [], locationConnections: [], monsterComponents: [], questObjectives: [], questRewards: [], ...extra
});
const link = (type, id, { slot = 'references', role = 'related', visibility = 'public' } = {}) => ({
  id: `link-${type}-${id}-${role}`, targetType: type, targetDomainId: id, slot, role, visibility
});
const request = (gm = false) => ({ campaign: { id: 'campaign' }, auth: { user: { id: 'player' } }, viewerContext: { gm, userId: 'player', groups: [] }, query: {} });
const content = (id, category, gm = false, type = 'location') => buildMapPinContent({ request: request(gm), pin: { id: 'pin', entityType: type, entityId: id }, category });

beforeEach(() => {
  vi.clearAllMocks();
  rows = [];
  prisma.entity.findUnique.mockImplementation(async ({ where }) => rows.find((row) => Object.entries(where.campaignId_type_domainId).every(([key, value]) => row[key] === value)) ?? null);
  prisma.entity.findMany.mockImplementation(async ({ where }) => rows.filter((row) => row.campaignId === where.campaignId && (!where.type || row.type === where.type) && (!where.deletedAt || row.deletedAt === where.deletedAt)));
  prisma.grant.findMany.mockResolvedValue([]);
});

describe('map location general information gate', () => {
  it('hides a location pin when existence is visible but basic information is secret', async () => {
    rows = [record('location', 'loc.secret-info', { name: 'Nome conhecido', type: 'farm', visibility: { entity: 'public', sections: { basic: 'gm' } } })];
    const input = { request: request(false), type: 'location', domainId: 'loc.secret-info', options: { backlinks: false, format: '1' } };
    expect(await getEntityForRequest(input)).not.toBeNull();
    expect(await getEntityForRequest({ ...input, options: { ...input.options, requireSection: 'basic' } })).toBeNull();
    expect(await getEntityForRequest({ ...input, request: request(true), options: { ...input.options, requireSection: 'basic' } })).not.toBeNull();
  });
});

describe('authorized map pin content', () => {
  it('finds direct links, inverse associations and structural mission locations', async () => {
    rows = [
      record('location', 'loc.mill', { name: 'Fazenda Moinho', type: 'farm' }, { references: [link('monster', 'monster.wolf')] }),
      record('monster', 'monster.wolf', { name: 'Lobo', media: { image: 'https://images.test/wolf.png' } }),
      record('npc', 'npc.miller', { name: 'Moleiro', media: { portrait: 'https://images.test/miller.png' } }, { references: [link('location', 'loc.mill', { slot: 'locations', role: 'main' })] }),
      record('quest', 'quest.delivery', { name: 'A entrega', startSource: { type: 'location', id: 'loc.mill' } }),
      record('item', 'item.grain', { name: 'Trigo', category: 'material' }, { references: [link('location', 'loc.mill', { role: 'found-in' })] })
    ];
    expect((await content('loc.mill', 'monstros')).items).toEqual([expect.objectContaining({ type: 'monster', id: 'monster.wolf', name: 'Lobo', imageUrl: 'https://images.test/wolf.png' })]);
    expect((await content('loc.mill', 'npcs')).items).toEqual([expect.objectContaining({ type: 'npc', id: 'npc.miller', imageUrl: 'https://images.test/miller.png', referenceUrl: '/campaigns/campaign/npcs?selected=npc.miller' })]);
    expect((await content('loc.mill', 'missoes')).items.map((item) => item.id)).toEqual(['quest.delivery']);
    expect((await content('loc.mill', 'itens')).items.map((item) => item.id)).toEqual(['item.grain']);
    expect((await content('loc.mill', 'referencias')).items.map((item) => item.id)).toEqual(['quest.delivery', 'monster.wolf', 'npc.miller', 'item.grain']);
  });

  it('aggregates nested region descendants without duplicating shared references', async () => {
    rows = [
      record('location', 'loc.region', { name: 'Planícies', type: 'region' }),
      record('location', 'loc.village', { name: 'Vila', type: 'village', parentId: 'loc.region' }, { references: [link('monster', 'monster.wolf')] }),
      record('location', 'loc.mill', { name: 'Moinho', type: 'farm', parentId: 'loc.village' }, { references: [link('monster', 'monster.wolf')] }),
      record('location', 'loc.other', { name: 'Outra região', type: 'region' }, { references: [link('monster', 'monster.dragon')] }),
      record('monster', 'monster.wolf', { name: 'Lobo' }),
      record('monster', 'monster.dragon', { name: 'Dragão' })
    ];
    expect((await content('loc.region', 'monstros')).items.map((item) => item.id)).toEqual(['monster.wolf']);
    expect((await content('loc.region', 'informacoes')).items.map((item) => item.id)).toEqual(['loc.region', 'loc.village', 'loc.mill']);
  });

  it('excludes unknown entities and hidden inverse or structural association sections', async () => {
    rows = [
      record('location', 'loc.mill', { type: 'farm' }, { references: [link('monster', 'monster.public'), link('monster', 'monster.secret'), link('item', 'item.secret-relation', { visibility: 'gm' })] }),
      record('monster', 'monster.public', { name: 'Público' }),
      record('monster', 'monster.secret', { name: 'Segredo' }, { baseVisibility: 'discoverable' }),
      record('item', 'item.secret-relation', { name: 'Relação secreta' }),
      record('npc', 'npc.hidden-location', { name: 'Associação oculta', visibility: { sections: { locations: 'gm' } } }, { references: [link('location', 'loc.mill', { slot: 'locations', role: 'main' })] }),
      record('npc', 'npc.hidden-link', { name: 'Referência oculta' }, { references: [link('location', 'loc.mill', { visibility: 'gm' })] }),
      record('quest', 'quest.secret-source', { name: 'Origem oculta', startSource: { type: 'location', id: 'loc.mill' }, visibility: { sections: { flow: 'gm' } } })
    ];
    const playerContent = await content('loc.mill', 'referencias');
    expect(playerContent.items.map((item) => item.id)).toEqual(['monster.public']);
    expect(JSON.stringify(playerContent)).not.toMatch(/Segredo|Associação oculta|Referência oculta|Origem oculta/);
    expect((await content('loc.mill', 'monstros', true)).items.map((item) => item.id)).toEqual(['monster.public', 'monster.secret']);
  });

  it('does not cross a hidden parent or infer descendants from travel connections', async () => {
    rows = [
      record('location', 'loc.region', { type: 'region' }),
      record('location', 'loc.hidden-parent', { type: 'village', parentId: 'loc.region' }, { baseVisibility: 'gm' }),
      record('location', 'loc.public-child', { type: 'farm', parentId: 'loc.hidden-parent' }, { references: [link('item', 'item.hidden-branch')] }),
      record('location', 'loc.connected', { type: 'farm' }, { references: [link('item', 'item.connected')], locationConnections: [{ connectionId: 'road', targetDomainId: 'loc.region', access: 'public', visibility: 'public', data: {} }] }),
      record('item', 'item.hidden-branch'), record('item', 'item.connected')
    ];
    expect((await content('loc.region', 'itens')).items).toEqual([]);
    expect((await content('loc.region', 'itens', true)).items.map((item) => item.id)).toEqual(['item.hidden-branch']);
  });

  it('shows authorized local and NPC services with their source references', async () => {
    rows = [
      record('location', 'loc.region', { type: 'region', services: [{ name: 'Guia', description: 'Travessia pela região' }] }),
      record('location', 'loc.mill', { name: 'Moinho', type: 'farm', parentId: 'loc.region', services: [{ name: 'Moagem', description: 'Produção de farinha' }] }),
      record('npc', 'npc.miller', { name: 'Moleiro', services: [{ name: 'Compra de trigo', description: 'Negociar colheitas' }] }, { references: [link('location', 'loc.mill', { slot: 'locations', role: 'main' })] }),
      record('npc', 'npc.secret-service', { services: [{ name: 'Serviço secreto', description: '' }], visibility: { sections: { services: 'gm' } } }, { references: [link('location', 'loc.mill', { slot: 'locations', role: 'main' })] })
    ];
    const result = await content('loc.region', 'servicos');
    expect(result.items.map((item) => item.name)).toEqual(['Compra de trigo', 'Guia', 'Moagem']);
    expect(result.items[0]).toMatchObject({ type: 'service', sourceId: 'npc.miller', sourceName: 'Moleiro', referenceUrl: '/campaigns/campaign/npcs?selected=npc.miller' });
  });

  it('projects relevant information without leaking fields or internal data', async () => {
    rows = [record('location', 'loc.mill', { name: 'Fazenda Moinho', type: 'farm', state: 'safe', environment: 'Planície' }, {
      fields: [
        { key: 'description', value: 'Fazenda de trigo', visibility: 'public' },
        { key: 'levelRecommended', value: '4', visibility: 'public' },
        { key: 'gmNotes', value: 'Tesouro secreto', visibility: 'gm' }
      ]
    })];
    const result = await content('loc.mill', 'informações');
    expect(result).toMatchObject({ category: 'informacoes', information: { description: 'Fazenda de trigo', fields: expect.arrayContaining([{ label: 'Estado', value: 'Seguro' }, { label: 'Ambiente', value: 'Planície' }, { label: 'Nível recomendado', value: '4' }]) } });
    expect(JSON.stringify(result)).not.toMatch(/Tesouro secreto|_technical|pk-loc/);
    rows[0].baseVisibility = 'gm';
    expect(await content('loc.mill', 'informacoes')).toBeNull();
  });

  it('validates categories and does not resolve cross-campaign entities', async () => {
    rows = [record('location', 'loc.other-campaign', {}, { campaignId: 'other' })];
    expect(await content('loc.other-campaign', 'informacoes')).toBeNull();
    await expect(content('loc.other-campaign', 'invalid')).rejects.toMatchObject({ code: 'INVALID_CATEGORY', statusCode: 400 });
  });
});
