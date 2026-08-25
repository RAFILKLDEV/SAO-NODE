import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authenticate, requireCampaign, requireGm } from '../lib/auth.js';
import { apiError } from '@sao/shared';

const querySchema = z.object({ page: z.coerce.number().int().positive().default(1), pageSize: z.coerce.number().int().positive().max(100).default(50) });

export async function auditRoutes(app) {
  app.get('/api/v1/campaigns/:campaignId/audit', { preHandler: [authenticate, requireCampaign, requireGm] }, async (request, reply) => {
    const parsed = querySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send(apiError('INVALID_QUERY', 'Invalid paging', parsed.error.flatten()));
    return prisma.auditLog.findMany({
      where: { campaignId: request.campaign.id },
      orderBy: { createdAt: 'desc' },
      skip: (parsed.data.page - 1) * parsed.data.pageSize,
      take: parsed.data.pageSize
    });
  });
}
