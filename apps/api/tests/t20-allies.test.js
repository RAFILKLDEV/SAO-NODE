import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/prisma.js', () => ({ prisma: { grant: { findMany: vi.fn() } } }));
import { prisma } from '../src/lib/prisma.js';
import { entityRecordToCanonical, normalizeInput, serializeEntityForRequest, splitEntity } from '../src/services/content.js';

const allyTypes = [{ type: 'atirador', rank: 'veterano' }, { type: 'medico', rank: 'mestre' }];
const record = (basic = 'discoverable') => {
  const parsed = normalizeInput('npc', { id: 'npc.ally', name: 'Aliado', characterType: 'entity', allyTypes, visibility: { entity: 'public', sections: { basic, additional: 'public' } } });
  return { id: 'db-ally', campaignId: 'campaign-1', domainId: parsed.id, type: 'npc', name: parsed.name, active: true, baseVisibility: 'public', version: 1, data: splitEntity('npc', parsed).data, fields: [], references: [], source: {} };
};
const viewer = gm => ({ campaign: { id: 'campaign-1' }, query: {}, viewerContext: { gm, userId: gm ? 'gm-1' : 'player-1', groups: [] } });
beforeEach(() => { vi.resetAllMocks(); prisma.grant.findMany.mockResolvedValue([]); });

describe('character ally persistence and permissions', () => {
  it('stores only selected types and grades in canonical data and validates incoming choices', () => {
    expect(entityRecordToCanonical(record()).allyTypes).toEqual(allyTypes);
    expect(record().data.allyTypes[0]).toEqual({ type: 'atirador', rank: 'veterano' });
    expect(() => normalizeInput('npc', { id: 'npc.x', name: 'X', allyTypes: [...allyTypes, { type: 'guardiao', rank: 'iniciante' }] })).toThrow();
    expect(() => normalizeInput('npc', { id: 'npc.x', name: 'X', allyTypes: [allyTypes[0], { type: 'atirador', rank: 'mestre' }] })).toThrow();
  });

  it.each(['1', '2'])('filters undiscovered basic information on the server in format %s, even with public additional information', async format => {
    const entity = record();
    const gm = await serializeEntityForRequest(entity, viewer(true), { backlinks: false, format });
    expect(format === '2' ? gm.data.allyTypes : gm.allyTypes).toEqual(allyTypes);
    const player = await serializeEntityForRequest(entity, viewer(false), { backlinks: false, format });
    expect(JSON.stringify(player)).not.toContain('allyTypes');
    expect(JSON.stringify(player)).not.toContain('atirador');
    prisma.grant.findMany.mockResolvedValue([{ subjectType: 'user', subjectId: 'player-1', targetKind: 'field', targetKey: 'section.basic', allowance: 'allow' }]);
    const discovered = await serializeEntityForRequest(entity, viewer(false), { backlinks: false, format });
    expect(format === '2' ? discovered.data.allyTypes : discovered.allyTypes).toEqual(allyTypes);
  });
});
