import { z } from 'zod';
import { authenticate, requireCampaign, requireCsrf } from '../lib/auth.js';
import { apiError } from '@sao/shared';
import { campaignUserRoom } from '../lib/realtime.js';
import { listNotifications, markAllNotificationsRead, markNotificationRead } from '../services/notifications.js';

const querySchema = z.object({
  unreadOnly: z.enum(['true', 'false']).default('false').transform((value) => value === 'true'),
  limit: z.coerce.number().int().positive().max(100).default(50),
  cursor: z.string().datetime().optional()
});

export async function notificationRoutes(app) {
  app.get('/api/v1/campaigns/:campaignId/notifications', { preHandler: [authenticate, requireCampaign] }, async (request, reply) => {
    const parsed = querySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send(apiError('INVALID_QUERY', 'Invalid notification query', parsed.error.flatten()));
    return listNotifications({ ...parsed.data, campaignId: request.campaign.id, userId: request.auth.user.id });
  });

  app.patch('/api/v1/campaigns/:campaignId/notifications/:notificationId/read', { preHandler: [authenticate, requireCampaign, requireCsrf] }, async (request, reply) => {
    const result = await markNotificationRead({ campaignId: request.campaign.id, userId: request.auth.user.id, notificationId: request.params.notificationId });
    if (!result.count) return reply.code(404).send(apiError('NOT_FOUND', 'Notification not found'));
    request.server.realtime?.to(campaignUserRoom(request.campaign.id, request.auth.user.id)).emit('notifications.read', {});
    return { ok: true };
  });

  app.post('/api/v1/campaigns/:campaignId/notifications/read-all', { preHandler: [authenticate, requireCampaign, requireCsrf] }, async (request) => {
    const result = await markAllNotificationsRead({ campaignId: request.campaign.id, userId: request.auth.user.id });
    request.server.realtime?.to(campaignUserRoom(request.campaign.id, request.auth.user.id)).emit('notifications.read', {});
    return { ok: true, count: result.count };
  });
}
