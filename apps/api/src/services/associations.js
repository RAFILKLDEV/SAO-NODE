import { associationKey, isSymmetricAssociation, normalizeAssociationBatch } from '@sao/domain';
import { prisma } from '../lib/prisma.js';
import { audit } from '../lib/audit.js';
import { entityRecordToCanonical } from './content.js';

const contentInclude = { fields: true, references: true, locationConnections: true, monsterComponents: true, questObjectives: true, questRewards: true };
const auditSnapshot = (entity) => ({ data: entityRecordToCanonical(entity), source: entity.source ?? null, deletedAt: Boolean(entity.deletedAt) });

export const referenceLink = (reference) => ({
  type: reference.targetType, id: reference.targetDomainId, role: reference.role,
  slot: reference.slot ?? 'references',
  ...(reference.chance != null ? { chance: reference.chance } : {}),
  ...(reference.quantityMin != null ? { quantityMin: reference.quantityMin } : {}),
  ...(reference.quantityMax != null ? { quantityMax: reference.quantityMax } : {}),
  ...(reference.quantityFormula ? { quantityFormula: reference.quantityFormula } : {}),
  ...(reference.valueFormula ? { valueFormula: reference.valueFormula } : {}),
  visibility: reference.visibility ?? 'public'
});
const conflict = () => { throw Object.assign(new Error('As associações foram alteradas. Recarregue e revise as alterações.'), { code: 'VERSION_CONFLICT' }); };
const notFound = () => { throw Object.assign(new Error('Origem ou destino não encontrado nesta campanha.'), { statusCode: 404, code: 'NOT_FOUND' }); };
const entityKey = (type, id) => JSON.stringify([type, id]);

export async function applyAssociations({ campaignId, actorUserId, changes }) {
  return prisma.$transaction(async (tx) => {
    const records = await tx.entity.findMany({
      where: { campaignId, deletedAt: null, OR: changes.flatMap((change) => [
        { type: change.sourceType, domainId: change.sourceId },
        ...change.add.map((link) => ({ type: link.type, domainId: link.id })),
        ...(change.rewards ?? []).map((reward) => ({ type: reward.target.type, domainId: reward.target.id }))
      ]) },
      include: contentInclude
    });
    const catalog = new Map(records.map((record) => [entityKey(record.type, record.domainId), record]));
    const plans = changes.map((change) => {
      const source = catalog.get(entityKey(change.sourceType, change.sourceId));
      if (!source) notFound();
      if (source.version !== change.version) conflict();
      const before = source.references.map(referenceLink);
      const removeKeys = new Set(change.remove.map(associationKey));
      for (const key of removeKeys) if (!before.some((link) => associationKey(link) === key)) conflict();
      const remaining = before.filter((link) => !removeKeys.has(associationKey(link)));
      const additions = normalizeAssociationBatch({ type: source.type, id: source.domainId }, change.add);
      const rewardAdditions = [];
      for (const reward of change.rewards ?? []) {
        if (source.type !== 'quest' || reward.type !== reward.target.type || !catalog.has(entityKey(reward.target.type, reward.target.id))) notFound();
        const existingReward = (source.questRewards ?? []).find((entry) => entry.type === reward.type && entry.data?.target?.type === reward.target.type && entry.data?.target?.id === reward.target.id);
        if (existingReward) {
          const current = existingReward.data;
          if ((current.quantity ?? 1) !== (reward.quantity ?? 1) || (current.amount ?? '') !== (reward.amount ?? '') || (current.currency ?? '') !== (reward.currency ?? '')) conflict();
          continue;
        }
        rewardAdditions.push(reward);
      }
      const actualAdditions = [];
      for (const link of additions) {
        if (!catalog.has(entityKey(link.type, link.id))) notFound();
        const exists = remaining.find((item) => associationKey({ ...item, role: item.role === 'drop' ? 'drops' : item.role }) === associationKey(link));
        if (exists) {
          // Adding a duplicate is a no-op; changing details requires explicit removal.
          if (['chance', 'quantityMin', 'quantityMax', 'quantityFormula', 'valueFormula', 'visibility'].some((key) => (exists[key] ?? (key === 'chance' ? 100 : key === 'visibility' ? 'public' : 1)) !== (link[key] ?? (key === 'chance' ? 100 : key === 'visibility' ? 'public' : 1)))) conflict();
          continue;
        }
        actualAdditions.push(link);
      }
      return { source, before, after: [...remaining, ...actualAdditions], additions: actualAdditions, rewardAdditions, removeKeys };
    });
    // A symmetric relationship is stored once, even when authored from the other side.
    for (const plan of plans) {
      plan.additions = plan.additions.filter((link) => {
        if (!isSymmetricAssociation(link.role)) return true;
        const target = catalog.get(entityKey(link.type, link.id));
        const targetPlan = plans.find((entry) => entry.source.id === target.id);
        const inverse = (targetPlan?.after ?? target.references.map(referenceLink)).find((entry) =>
          entry.type === plan.source.type && entry.id === plan.source.domainId && entry.role === link.role && entry.slot === link.slot);
        if (!inverse) return true;
        // Prefer an already persisted inverse, or a stable ordering for two new sides.
        const inverseAlreadyExists = target.references.some((ref) => associationKey(referenceLink(ref)) === associationKey(inverse)) &&
          !targetPlan?.removeKeys.has(associationKey(inverse));
        return !inverseAlreadyExists && plan.source.id < target.id;
      });
      const addedKeys = new Set(plan.additions.map(associationKey));
      const originalKeys = new Set(plan.before.filter((link) => !plan.removeKeys.has(associationKey(link))).map(associationKey));
      plan.after = plan.after.filter((link) => originalKeys.has(associationKey(link)) || addedKeys.has(associationKey(link)));
    }
    const changed = [];
    for (const { source, before, after, additions, rewardAdditions, removeKeys } of plans) {
      if (!removeKeys.size && !additions.length && !rewardAdditions.length) continue;
      const updated = await tx.entity.updateMany({
        where: { id: source.id, version: source.version, deletedAt: null },
        data: { version: { increment: 1 }, localModifiedAt: new Date() }
      });
      if (updated.count !== 1) conflict();
      const removeIds = source.references.filter((ref) => removeKeys.has(associationKey(referenceLink(ref)))).map((ref) => ref.id);
      if (removeIds.length) await tx.reference.deleteMany({ where: { sourceEntityId: source.id, id: { in: removeIds } } });
      if (additions.length) await tx.reference.createMany({ data: additions.map((link) => ({
        sourceEntityId: source.id, targetType: link.type, targetDomainId: link.id,
        role: link.role, slot: link.slot, chance: link.chance, quantityMin: link.quantityMin, quantityMax: link.quantityMax, quantityFormula: link.quantityFormula, valueFormula: link.valueFormula, visibility: link.visibility ?? 'public'
      })) });
      if (rewardAdditions.length) await tx.questReward.createMany({ data: rewardAdditions.map((reward) => ({
        entityId: source.id, rewardId: reward.rewardId, type: reward.type, data: reward
      })) });
      const saved = await tx.entity.findUnique({ where: { id: source.id }, include: contentInclude });
      await audit(tx, { campaignId, actorUserId, action: 'association.update', entityType: source.type, entityDomainId: source.domainId, before: auditSnapshot(source), after: auditSnapshot(saved), resultVersion: saved.version });
      changed.push({ type: source.type, id: source.domainId, version: source.version + 1 });
    }
    return changed;
  }, { isolationLevel: 'Serializable' });
}
