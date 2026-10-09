import { authenticate, requireCampaign, requireCsrf } from '../lib/auth.js';
import { rollDrops } from '@sao/domain';
import { apiError } from '@sao/shared';
import { getEntityForRequest } from '../services/content.js';

export async function dropRoutes(app) {
  app.post('/api/v1/campaigns/:campaignId/monsters/:domainId/drops/roll', { preHandler: [authenticate, requireCampaign, requireCsrf] }, async (request, reply) => {
    const options = { format: '1', backlinks: false };
    const monster = await getEntityForRequest({ request, type: 'monster', domainId: request.params.domainId, options });
    if (!monster) return reply.code(404).send(apiError('NOT_FOUND', 'Monster not found'));
    const refs = [];
    for (const reference of monster.references ?? []) {
      if (reference.type !== 'item' || !['drops', 'drop'].includes(reference.role)) continue;
      const item = await getEntityForRequest({ request, type: 'item', domainId: reference.id, options });
      if (!item) continue;
      const { quantityMin: _quantityMin, quantityMax: _quantityMax, quantityFormula: _quantityFormula, ...dropReference } = reference;
      refs.push({ ...dropReference, role: 'drops', name: item.name, category: item.category,
        valueFormula: reference.valueFormula ?? item.valueFormula });
    }
    const results = rollDrops(refs).map(ref => ({ id: ref.id, name: ref.name, category: ref.category,
      chance: ref.chance ?? 100, cashValue: ref.cashValue,
      valueFormula: ref.valueFormula, broken: false }));
    return { monsterId: monster.id, results };
  });
}
