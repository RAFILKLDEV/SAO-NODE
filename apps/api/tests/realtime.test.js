import { describe, expect, it, vi } from 'vitest';
import {
  campaignUserRoom,
  emitPermissionNotification,
  resolveGrantRecipientUserIds
} from '../src/lib/realtime.js';

describe('permission notifications', () => {
  it('resolves direct users and members of granted groups without duplicates', async () => {
    const db = {
      groupMember: {
        findMany: vi.fn().mockResolvedValue([{ userId: 'player-2' }, { userId: 'player-1' }])
      }
    };

    const result = await resolveGrantRecipientUserIds({
      db,
      campaignId: 'campaign-1',
      grants: [
        { subjectType: 'user', subjectId: 'player-1', allowance: 'allow' },
        { subjectType: 'group', subjectId: 'party-1', allowance: 'allow' },
        { subjectType: 'user', subjectId: 'player-3', allowance: 'deny' }
      ]
    });

    expect(new Set(result)).toEqual(new Set(['player-1', 'player-2']));
    expect(db.groupMember.findMany).toHaveBeenCalledWith({
      where: { group: { campaignId: 'campaign-1', domainId: { in: ['party-1'] } } },
      select: { userId: true }
    });
  });

  it('emits only to the campaign-scoped rooms of affected players', () => {
    const emit = vi.fn();
    const to = vi.fn(() => ({ emit }));

    emitPermissionNotification({
      realtime: { to },
      campaignId: 'campaign-1',
      userIds: ['player-1', 'player-1', 'player-2'],
      payload: { entities: [{ entityType: 'item', entityId: 'item.sword' }] }
    });

    expect(to).toHaveBeenCalledWith([
      campaignUserRoom('campaign-1', 'player-1'),
      campaignUserRoom('campaign-1', 'player-2')
    ]);
    expect(emit).toHaveBeenCalledWith('permissions.notification', {
      entities: [{ entityType: 'item', entityId: 'item.sword' }]
    });
  });
});
