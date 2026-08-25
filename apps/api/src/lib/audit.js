export async function audit(tx, input) {
  return tx.auditLog.create({
    data: {
      campaignId: input.campaignId,
      actorUserId: input.actorUserId,
      action: input.action,
      entityType: input.entityType,
      entityDomainId: input.entityDomainId,
      targetKind: input.targetKind,
      targetKey: input.targetKey,
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      before: input.before ?? undefined,
      after: input.after ?? undefined
    }
  });
}
