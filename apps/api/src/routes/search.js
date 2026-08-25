import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
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
    const refs = await prisma.reference.findMany({
      where: {
        targetType: request.params.type,
        targetDomainId: request.params.domainId,
        sourceEntity: { campaignId: request.campaign.id, deletedAt: null }
      },
      include: { sourceEntity: true }
    });
    const visible = [];
    for (const ref of refs) {
      const source = await getEntityForRequest({ request, type: ref.sourceEntity.type, domainId: ref.sourceEntity.domainId });
      if (source) visible.push({ type: source.entityType, id: source.id, name: source.name, role: ref.role });
    }
    return visible;
  });
}
