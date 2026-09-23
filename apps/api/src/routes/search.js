import { z } from 'zod';
import { authenticate, requireCampaign } from '../lib/auth.js';
import { apiError } from '@sao/shared';
import { getEntityForRequest, searchForRequest } from '../services/content.js';

const searchSchema = z.object({ q: z.string().min(1), limit: z.coerce.number().int().positive().max(100).default(30) });

export async function searchRoutes(app) {
  app.get('/api/v1/campaigns/:campaignId/search', { preHandler: [authenticate, requireCampaign] }, async (request, reply) => {
    const parsed = searchSchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send(apiError('INVALID_QUERY', 'q is required', parsed.error.flatten()));
    return searchForRequest({ request, query: parsed.data.q, limit: parsed.data.limit });
  });

  app.get('/api/v1/campaigns/:campaignId/references/backlinks/:type/:domainId', { preHandler: [authenticate, requireCampaign] }, async (request) => {
    const target = await getEntityForRequest({
      request,
      type: request.params.type,
      domainId: request.params.domainId
    });
    if (!target) return [];

    return target.backlinks ?? [];
  });
}
