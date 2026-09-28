import { describe, expect, it, vi } from 'vitest';
import {
  createNotifications,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  notifyEntityChanged
} from '../src/services/notifications.js';

describe('notification service', () => {
  it('persists one notification per recipient and emits the persisted record', async () => {
    const createdAt = new Date('2026-09-25T12:00:00.000Z');
    const create = vi.fn(async ({ data }) => ({ id: `n-${data.userId}`, ...data, createdAt, readAt: null }));
    const emit = vi.fn();
    const db = { notification: { create } };

    const result = await createNotifications({
      db,
      realtime: { to: vi.fn(() => ({ emit })) },
      campaignId: 'campaign-1',
      userIds: ['user-1', 'user-1', 'user-2'],
      eventType: 'entity.changed',
      title: 'Novo conteúdo',
      message: 'Registro criado',
      payload: { type: 'npc', id: 'npc.1' }
    });

    expect(result).toHaveLength(2);
    expect(create).toHaveBeenCalledTimes(2);
    expect(emit).toHaveBeenCalledWith('notification.created', expect.objectContaining({ id: 'n-user-1', readAt: null }));
  });

  it('filters notifications by owner and unread state', async () => {
    const findMany = vi.fn().mockResolvedValue([
      { id: 'n-1', createdAt: new Date('2026-09-25T12:00:00.000Z'), readAt: null },
      { id: 'n-2', createdAt: new Date('2026-09-24T12:00:00.000Z'), readAt: null }
    ]);
    const db = { notification: { findMany } };
    const result = await listNotifications({ db, campaignId: 'campaign-1', userId: 'user-1', unreadOnly: true, limit: 1 });

    expect(result.items).toHaveLength(1);
    expect(result.nextCursor).toBe('2026-09-25T12:00:00.000Z');
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { campaignId: 'campaign-1', userId: 'user-1', readAt: null }, take: 2 }));
  });

  it('only notifies GMs and explicitly granted users for protected entities', async () => {
    const db = {
      membership: { findMany: vi.fn().mockResolvedValue([{ userId: 'gm', role: 'gm' }, { userId: 'player', role: 'player' }]) },
      entity: { findUnique: vi.fn().mockResolvedValue({ name: 'Segredo', baseVisibility: 'gm', deletedAt: null }) },
      grant: { findMany: vi.fn().mockResolvedValue([{ subjectType: 'user', subjectId: 'player' }]) },
      notification: { create: vi.fn(async ({ data }) => ({ id: data.userId, ...data, createdAt: new Date(), readAt: null })) }
    };
    const to = vi.fn(() => ({ emit: vi.fn() }));

    await notifyEntityChanged({ db, realtime: { to }, campaignId: 'campaign-1', actorUserId: 'actor', type: 'npc', entityId: 'npc.secret', action: 'updated' });

    expect(db.notification.create).toHaveBeenCalledTimes(2);
    expect(new Set(db.notification.create.mock.calls.map(([call]) => call.data.userId))).toEqual(new Set(['gm', 'player']));
  });

  it('marks one or all notifications as read within the user campaign scope', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const db = { notification: { updateMany } };
    await markNotificationRead({ db, campaignId: 'campaign-1', userId: 'user-1', notificationId: 'n-1' });
    await markAllNotificationsRead({ db, campaignId: 'campaign-1', userId: 'user-1' });
    expect(updateMany).toHaveBeenCalledTimes(2);
    expect(updateMany.mock.calls[0][0].where).toMatchObject({ id: 'n-1', campaignId: 'campaign-1', userId: 'user-1' });
    expect(updateMany.mock.calls[1][0].where).toEqual({ campaignId: 'campaign-1', userId: 'user-1', readAt: null });
  });
});
