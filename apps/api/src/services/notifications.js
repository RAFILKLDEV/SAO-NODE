import { prisma } from '../lib/prisma.js';
import { campaignUserRoom } from '../lib/realtime.js';

function serialize(notification) {
  return {
    ...notification,
    createdAt: notification.createdAt?.toISOString?.() ?? notification.createdAt,
    readAt: notification.readAt?.toISOString?.() ?? notification.readAt ?? null
  };
}

export async function createNotifications({
  db = prisma,
  realtime,
  campaignId,
  userIds,
  eventType,
  kind = 'info',
  title,
  message,
  payload = null
}) {
  let recipients = [...new Set((userIds ?? []).filter(Boolean))];
  if (db.membership?.findMany && recipients.length) {
    const memberships = await db.membership.findMany({
      where: { campaignId, userId: { in: recipients } },
      select: { userId: true }
    });
    const members = new Set(memberships.map((membership) => membership.userId));
    recipients = recipients.filter((userId) => members.has(userId));
  }
  if (!campaignId || !recipients.length) return [];
  const notifications = await Promise.all(
    recipients.map((userId) =>
      db.notification.create({
        data: { campaignId, userId, eventType, kind, title, message, payload }
      })
    )
  );
  for (const notification of notifications) {
    realtime?.to(campaignUserRoom(campaignId, notification.userId)).emit('notification.created', serialize(notification));
  }
  return notifications;
}

async function campaignMembers(db, campaignId) {
  return db.membership.findMany({
    where: { campaignId },
    select: { userId: true, role: true }
  });
}

export async function notifyCampaign({ db = prisma, realtime, campaignId, actorUserId, eventType, kind, title, message, payload }) {
  const members = await campaignMembers(db, campaignId);
  return createNotifications({
    db,
    realtime,
    campaignId,
    userIds: members.filter((member) => member.userId !== actorUserId).map((member) => member.userId),
    eventType,
    kind,
    title,
    message,
    payload
  });
}

export async function notifyProgress({ db = prisma, realtime, campaignId, actorUserId, progressId, eventType, kind, title, message, payload }) {
  const [members, progress] = await Promise.all([
    campaignMembers(db, campaignId),
    db.questProgress.findFirst({ where: { id: progressId, campaignId }, select: { ownerType: true, ownerId: true } })
  ]);
  if (!progress) return [];
  const recipients = new Set(members.filter((member) => ['owner', 'gm', 'assistant_gm'].includes(member.role)).map((member) => member.userId));
  if (progress.ownerType === 'player') {
    const account = await db.user?.findUnique?.({ where: { login: progress.ownerId }, select: { id: true } });
    if (account) recipients.add(account.id);
  } else {
    const groupMembers = await db.groupMember.findMany({ where: { group: { campaignId, domainId: progress.ownerId } }, select: { userId: true } });
    groupMembers.forEach((member) => recipients.add(member.userId));
  }
  recipients.delete(actorUserId);
  return createNotifications({ db, realtime, campaignId, userIds: [...recipients], eventType, kind, title, message, payload });
}

export async function notifyEntityChanged({ db = prisma, realtime, campaignId, _actorUserId, type, entityId, action }) {
  const [members, entity, grants] = await Promise.all([
    campaignMembers(db, campaignId),
    db.entity.findUnique({ where: { campaignId_type_domainId: { campaignId, type, domainId: entityId } }, select: { name: true, baseVisibility: true, deletedAt: true } }),
    db.grant.findMany({
      where: { campaignId, entityType: type, entityDomainId: entityId, targetKind: 'entity', targetKey: 'existence', allowance: 'allow' },
      select: { subjectType: true, subjectId: true }
    })
  ]);
  if (!entity) return [];
  const recipients = new Set(members.filter((member) => ['owner', 'gm', 'assistant_gm'].includes(member.role)).map((member) => member.userId));
  if (entity.baseVisibility === 'public') {
    for (const member of members) recipients.add(member.userId);
  } else {
    const direct = grants.filter((grant) => grant.subjectType === 'user').map((grant) => grant.subjectId);
    direct.forEach((userId) => recipients.add(userId));
    const groups = grants.filter((grant) => grant.subjectType === 'group').map((grant) => grant.subjectId);
    if (groups.length) {
      const groupMembers = await db.groupMember.findMany({
        where: { group: { campaignId, domainId: { in: groups } } },
        select: { userId: true }
      });
      groupMembers.forEach((member) => recipients.add(member.userId));
    }
  }
  return createNotifications({
    db,
    realtime,
    campaignId,
    userIds: [...recipients],
    eventType: 'entity.changed',
    kind: action === 'created' ? 'new' : 'edited',
    title: action === 'created' ? 'Novo conteúdo' : 'Conteúdo atualizado',
    message: `${entity.name || 'Um registro'} foi ${action === 'created' ? 'adicionado' : action === 'deleted' ? 'removido' : 'atualizado'}.`,
    payload: { type, id: entityId, action }
  });
}

export async function listNotifications({ db = prisma, campaignId, userId, unreadOnly = false, limit = 50, cursor }) {
  const rows = await db.notification.findMany({
    where: { campaignId, userId, ...(unreadOnly ? { readAt: null } : {}), ...(cursor ? { createdAt: { lt: new Date(cursor) } } : {}) },
    orderBy: { createdAt: 'desc' },
    take: limit + 1
  });
  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit).map(serialize);
  return { items, nextCursor: hasMore ? items[items.length - 1]?.createdAt ?? null : null };
}

export async function markNotificationRead({ db = prisma, campaignId, userId, notificationId }) {
  return db.notification.updateMany({
    where: { id: notificationId, campaignId, userId, readAt: null },
    data: { readAt: new Date() }
  });
}

export async function markAllNotificationsRead({ db = prisma, campaignId, userId }) {
  return db.notification.updateMany({ where: { campaignId, userId, readAt: null }, data: { readAt: new Date() } });
}
