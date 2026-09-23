import { normalizeEntity, stableValue, validateEntityCatalog } from '@sao/domain';
import { entityRecordToCanonical, splitEntity } from './content.js';

export const contentInclude = {
  fields: true,
  references: true,
  locationConnections: true,
  monsterComponents: true,
  questObjectives: true,
  questRewards: true
};
const equal = (a, b) => JSON.stringify(stableValue(a)) === JSON.stringify(stableValue(b));
export function planDataMigration(rows, { preserveAliasConflicts = false } = {}) {
  const errors = [];
  const diagnostics = [];
  const changes = [];
  const campaigns = new Map();
  for (const row of rows) {
    try {
      const rowDiagnostics = [];
      const data = entityRecordToCanonical(row, {
        diagnostics: rowDiagnostics,
        conflicts: preserveAliasConflicts ? 'preserve' : 'error'
      });
      diagnostics.push(
        ...rowDiagnostics.map((diagnostic) => ({
          campaignId: row.campaignId,
          type: row.type,
          id: row.domainId,
          ...diagnostic
        }))
      );
      const catalog = campaigns.get(row.campaignId) ?? [];
      if (!row.deletedAt) catalog.push({ type: row.type, data });
      campaigns.set(row.campaignId, catalog);
      const split = splitEntity(row.type, normalizeEntity(row.type, data));
      if (row.schemaVersion !== 2 || !equal(row.data, split.data))
        changes.push({ row, data, split });
    } catch (error) {
      errors.push({
        campaignId: row.campaignId,
        type: row.type,
        id: row.domainId,
        message: error.message
      });
    }
  }
  const warnings = [];
  for (const [campaignId, entities] of campaigns) {
    try {
      warnings.push(...validateEntityCatalog(entities).map((w) => ({ campaignId, ...w })));
    } catch (error) {
      errors.push({ campaignId, message: error.message });
    }
  }
  return { errors, warnings, diagnostics, changes, total: rows.length };
}

export async function applyDataMigration(tx, plan) {
  if (plan.errors.length) throw new Error('Migração bloqueada: corrija os erros do dry-run');
  for (const { row, data, split } of plan.changes) {
    const current = await tx.entity.findUnique({ where: { id: row.id } });
    if (
      !current ||
      current.version !== row.version ||
      !equal(current.data, row.data) ||
      String(current.updatedAt) !== String(row.updatedAt)
    )
      throw new Error(`Conteúdo alterado durante a migração: ${row.domainId}`);
    await tx.entity.update({
      where: { id: row.id },
      data: { data: split.data, schemaVersion: 2, updatedAt: row.updatedAt }
    });
    for (const link of data.links) {
      const existing = row.references.find(
        (r) =>
          r.targetType === link.type &&
          r.targetDomainId === link.id &&
          r.role === link.role &&
          (r.slot ?? 'references') === link.slot
      );
      if (!existing)
        await tx.reference.create({
          data: {
            sourceEntityId: row.id,
            targetType: link.type,
            targetDomainId: link.id,
            role: link.role,
            slot: link.slot,
            chance: link.chance,
            quantityMin: link.quantityMin,
            quantityMax: link.quantityMax,
            createdAt: row.createdAt
          }
        });
    }
    for (const reward of data.rewards ?? []) {
      const existing = row.questRewards.find((r) => r.rewardId === reward.rewardId);
      if (existing)
        await tx.questReward.update({ where: { id: existing.id }, data: { data: reward } });
    }
    const saved = await tx.entity.findUnique({ where: { id: row.id }, include: contentInclude });
    if (!equal(entityRecordToCanonical(saved), data))
      throw new Error(`Round-trip divergente: ${row.domainId}`);
  }
  // Fixed identifiers from our migration, never interpolated from content.
  const checks = {
    Entity: ['Entity_type_check', 'Entity_visibility_check', 'Entity_version_check'],
    Reference: ['Reference_quantity_check', 'Reference_slot_check'],
    NarrativeField: ['NarrativeField_visibility_check'],
    LocationConnection: ['LocationConnection_values_check'],
    MonsterComponent: ['MonsterComponent_values_check'],
    QuestObjective: ['QuestObjective_values_check'],
    Membership: ['Membership_role_check']
  };
  for (const [table, constraints] of Object.entries(checks))
    for (const constraint of constraints)
      await tx.$executeRawUnsafe(`ALTER TABLE "${table}" VALIDATE CONSTRAINT "${constraint}"`);
  return {
    migrated: plan.changes.length,
    unchanged: plan.total - plan.changes.length,
    constraintsValidated: true
  };
}
