import { prisma } from '../lib/prisma.js';
import { authenticate, requireCampaign, requireCsrf, requireGm } from '../lib/auth.js';
import { rollDrops } from '@sao/domain';
import { apiError } from '@sao/shared';

export async function dropRoutes(app) {
  app.post('/api/v1/campaigns/:campaignId/monsters/:domainId/drops/roll', { preHandler: [authenticate, requireCampaign, requireGm, requireCsrf] }, async (request, reply) => {
    const monster = await prisma.entity.findUnique({
      where: { campaignId_type_domainId: { campaignId: request.campaign.id, type: 'monster', domainId: request.params.domainId } },
      include: { references: true }
    });
    if (!monster || monster.deletedAt) return reply.code(404).send(apiError('NOT_FOUND', 'Monster not found'));
    const refs = monster.references.map((reference) => ({
      type: reference.targetType,
      id: reference.targetDomainId,
      role: reference.role,
      chance: reference.chance ?? undefined
    }));
    const rolled = rollDrops(refs);
    const results = [];
    for (const ref of rolled) {
      const item = await prisma.entity.findUnique({
        where: { campaignId_type_domainId: { campaignId: request.campaign.id, type: 'item', domainId: ref.id } }
      });
      results.push({ id: ref.id, name: item?.deletedAt ? undefined : item?.name, chance: ref.chance ?? 100, broken: !item || Boolean(item.deletedAt) });
    }
    return { monsterId: monster.domainId, results };
  });
}
