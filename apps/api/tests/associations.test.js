import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/prisma.js', () => ({
  prisma: {
    $transaction: vi.fn(),
    entity: { findMany: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() },
    reference: { deleteMany: vi.fn(), createMany: vi.fn() },
    questReward: { createMany: vi.fn() }
  }
}));
vi.mock('../src/lib/audit.js', () => ({ audit: vi.fn() }));
import { prisma } from '../src/lib/prisma.js';
import { applyAssociations } from '../src/services/associations.js';

let records;
beforeEach(() => {
  vi.clearAllMocks();
  records = [
    { id: 'monster-row-1', type: 'monster', domainId: 'monster.capivara', name: 'Capivara', active: true, data: {}, version: 3, fields: [], references: [], locationConnections: [], monsterComponents: [], questObjectives: [], questRewards: [] },
    { id: 'monster-row-2', type: 'monster', domainId: 'monster.boar', name: 'Javali', active: true, data: {}, version: 8, fields: [], references: [], locationConnections: [], monsterComponents: [], questObjectives: [], questRewards: [] },
    { id: 'loc-row', type: 'location', domainId: 'loc.forest', name: 'Floresta', active: true, data: {}, version: 1, fields: [], references: [], locationConnections: [], monsterComponents: [], questObjectives: [], questRewards: [] },
    { id: 'item-row', type: 'item', domainId: 'item.meat', name: 'Carne', active: true, data: {}, version: 1, fields: [], references: [], locationConnections: [], monsterComponents: [], questObjectives: [], questRewards: [] },
    { id: 'quest-row', type: 'quest', domainId: 'quest.hunt', name: 'Caçada', active: true, data: {}, version: 4, fields: [], references: [], locationConnections: [], monsterComponents: [], questObjectives: [], questRewards: [] }
  ];
  prisma.$transaction.mockImplementation((callback) => callback(prisma));
  prisma.entity.findMany.mockImplementation(async ({ where }) => records.filter((record) =>
    where.OR.some((target) => target.type === record.type && target.domainId === record.domainId)
  ));
  prisma.entity.updateMany.mockImplementation(async ({ where }) => {
    const record = records.find((item) => item.id === where.id);
    if (!record || record.version !== where.version) return { count: 0 };
    record.version += 1;
    return { count: 1 };
  });
  prisma.entity.findUnique.mockImplementation(async ({ where }) => records.find((record) => record.id === where.id) ?? null);
  prisma.reference.createMany.mockResolvedValue({ count: 1 });
  prisma.reference.deleteMany.mockResolvedValue({ count: 0 });
  prisma.questReward.createMany.mockResolvedValue({ count: 1 });
});

describe('associações em lote', () => {
  it('grava drops e locais em cada monstro selecionado', async () => {
    await applyAssociations({ campaignId: 'campaign', actorUserId: 'gm', changes: [
      { sourceType: 'monster', sourceId: 'monster.capivara', version: 3, add: [{ type: 'item', id: 'item.meat', role: 'drops', quantityFormula: '1d40' }], remove: [] },
      { sourceType: 'monster', sourceId: 'monster.boar', version: 8, add: [{ type: 'location', id: 'loc.forest', role: 'found-in' }], remove: [] }
    ] });
    expect(prisma.reference.createMany).toHaveBeenCalledTimes(2);
    expect(prisma.reference.createMany).toHaveBeenNthCalledWith(1, { data: [expect.objectContaining({ sourceEntityId: 'monster-row-1', targetType: 'item', targetDomainId: 'item.meat', role: 'drops', quantityFormula: '1d40' })] });
    expect(prisma.reference.createMany).toHaveBeenNthCalledWith(2, { data: [expect.objectContaining({ sourceEntityId: 'monster-row-2', targetType: 'location', targetDomainId: 'loc.forest', role: 'found-in' })] });
  });

  it('grava recompensa estruturada na missão proprietária', async () => {
    const reward = { rewardId: 'reward-meat', type: 'item', target: { type: 'item', id: 'item.meat' }, quantity: '1d4' };
    await applyAssociations({ campaignId: 'campaign', actorUserId: 'gm', changes: [
      { sourceType: 'quest', sourceId: 'quest.hunt', version: 4, add: [], remove: [], rewards: [reward] }
    ] });
    expect(prisma.questReward.createMany).toHaveBeenCalledWith({ data: [
      { entityId: 'quest-row', rewardId: 'reward-meat', type: 'item', data: reward }
    ] });
  });
});
