export function campaignUserRoom(campaignId, userId) {
  return `campaign:${campaignId}:user:${userId}`;
}

export async function resolveGrantRecipientUserIds({ db, campaignId, grants }) {
  const userIds = new Set();
  const groupIds = new Set();

  for (const grant of grants ?? []) {
    if (!grant || grant.allowance !== 'allow') continue;
    if (grant.subjectType === 'user' && grant.subjectId) userIds.add(grant.subjectId);
    if (grant.subjectType === 'group' && grant.subjectId) groupIds.add(grant.subjectId);
  }

  if (groupIds.size) {
    const members = await db.groupMember.findMany({
      where: {
        group: {
          campaignId,
          domainId: { in: [...groupIds] }
        }
      },
      select: { userId: true }
    });
    for (const member of members) userIds.add(member.userId);
  }

  return [...userIds];
}

export function emitPermissionNotification({ realtime, campaignId, userIds, payload }) {
  if (!realtime) return;
  const rooms = [...new Set(userIds ?? [])].map((userId) => campaignUserRoom(campaignId, userId));
  if (!rooms.length) return;
  realtime.to(rooms).emit('permissions.notification', payload);
}
