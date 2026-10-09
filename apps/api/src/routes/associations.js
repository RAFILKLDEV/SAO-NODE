import { z } from 'zod';
import { ENTITY_TYPES, apiError } from '@sao/shared';
import { prisma } from '../lib/prisma.js';
import { authenticate, requireCampaign, requireCsrf, requireGm } from '../lib/auth.js';
import { applyAssociations, referenceLink } from '../services/associations.js';

const entityType = z.enum(ENTITY_TYPES);
const targetSchema = z.object({ type: entityType, id: z.string().min(1) });
const identitySchema = targetSchema.extend({
  role: z.string().min(1).max(100).default('related'),
  slot: z.enum(['references', 'locations', 'relations']).default('references')
});
const changeSchema = z.object({
  sourceType: entityType,
  sourceId: z.string().min(1),
  version: z.number().int().positive(),
  add: z.array(identitySchema.extend({
    chance: z.number().int().min(1).max(100).optional(),
    quantityMin: z.number().int().positive().optional(),
    quantityMax: z.number().int().positive().optional(),
    quantityFormula: z.string().regex(/^\s*\d+d\d+(?:\s*[+-]\s*\d+)?\s*$/i).optional()
    ,valueFormula: z.string().regex(/^\s*(?:\d+|\d+d\d+(?:\s*[+-]\s*\d+)?)\s*$/i).optional()
    ,visibility: z.enum(['public', 'discoverable', 'gm']).optional()
  }).strict()).max(100).default([]),
  remove: z.array(identitySchema.strict()).max(100).default([]),
  rewards: z.array(z.object({
    rewardId: z.string().min(1),
    type: entityType,
    target: targetSchema,
    quantity: z.union([z.string(), z.number()]).optional(),
    amount: z.union([z.string(), z.number()]).optional(),
    currency: z.string().optional()
  }).strict()).max(100).default([])
}).strict();
const batchSchema = z.object({ changes: z.array(changeSchema).min(1).max(100) }).superRefine(({ changes }, ctx) => {
  if (new Set(changes.map((c) => JSON.stringify([c.sourceType, c.sourceId]))).size !== changes.length)
    ctx.addIssue({ code: 'custom', message: 'Agrupe as alterações de cada origem em uma única entrada.' });
  if (changes.some((change) => change.rewards.length && change.sourceType !== 'quest'))
    ctx.addIssue({ code: 'custom', message: 'Recompensas só podem ser associadas a missões.' });
  if (changes.some((change) => change.rewards.some((reward) => reward.type !== reward.target.type)))
    ctx.addIssue({ code: 'custom', message: 'O tipo da recompensa deve corresponder ao destino.' });
  if (changes.reduce((sum, change) => sum + change.add.length + change.remove.length + change.rewards.length, 0) > 500)
    ctx.addIssue({ code: 'custom', message: 'O lote permite até 500 alterações.' });
});
const entitySelect = { type: true, domainId: true, name: true, version: true, deletedAt: true };
const describe = (entity) => ({ type: entity.type, id: entity.domainId, name: entity.name, version: entity.version, available: !entity.deletedAt });
const entityKey = (entity) => JSON.stringify([entity.type, entity.id]);

export async function associationRoutes(app) {
  const base = '/api/v1/campaigns/:campaignId/associations';
  const read = [authenticate, requireCampaign, requireGm];
  app.get(`${base}/entities`, { preHandler: read }, async (request) => {
    const query = z.object({
      q: z.string().trim().max(200).default(''), type: entityType.optional(),
      page: z.coerce.number().int().positive().default(1),
      pageSize: z.coerce.number().int().positive().max(100).default(30)
    }).parse(request.query);
    const where = {
      campaignId: request.campaign.id, deletedAt: null,
      ...(query.type ? { type: query.type } : {}),
      ...(query.q ? { OR: [
        { name: { contains: query.q, mode: 'insensitive' } },
        { domainId: { contains: query.q, mode: 'insensitive' } }
      ] } : {})
    };
    const [items, total] = await Promise.all([
      prisma.entity.findMany({ where, select: entitySelect, orderBy: [{ name: 'asc' }, { type: 'asc' }, { domainId: 'asc' }], take: query.pageSize, skip: (query.page - 1) * query.pageSize }),
      prisma.entity.count({ where })
    ]);
    return { items: items.map(describe), total, page: query.page, pageSize: query.pageSize };
  });

  app.get(`${base}/:sourceType/:sourceId`, { preHandler: read }, async (request, reply) => {
    const { sourceType: type, sourceId: domainId } = z.object({ sourceType: entityType, sourceId: z.string().min(1) }).parse(request.params);
    const source = await prisma.entity.findUnique({
      where: { campaignId_type_domainId: { campaignId: request.campaign.id, type, domainId } },
      select: { ...entitySelect, references: { orderBy: { createdAt: 'asc' } }, questRewards: { orderBy: { createdAt: 'asc' } } }
    });
    if (!source || source.deletedAt) return reply.code(404).send(apiError('NOT_FOUND', 'Entidade não encontrada.'));
    const links = source.references.map(referenceLink);
    const rewards = (source.questRewards ?? []).map((entry) => entry.data);
    const targetsToDescribe = [
      ...links,
      ...rewards.filter((reward) => reward.target?.type && reward.target?.id).map((reward) => reward.target)
    ];
    const [backlinks, targets] = await Promise.all([
      prisma.reference.findMany({
        where: { targetType: type, targetDomainId: domainId, sourceEntity: { campaignId: request.campaign.id, deletedAt: null } },
        include: { sourceEntity: { select: entitySelect } }, orderBy: { createdAt: 'asc' }
      }),
      targetsToDescribe.length ? prisma.entity.findMany({
        where: { campaignId: request.campaign.id, OR: targetsToDescribe.map((target) => ({ type: target.type, domainId: target.id })) },
        select: entitySelect
      }) : []
    ]);
    const targetMap = new Map(targets.map((entity) => [entityKey(describe(entity)), describe(entity)]));
    return {
      source: describe(source),
      links: links.map((link) => ({ ...link, name: targetMap.get(entityKey(link))?.name ?? link.id, available: targetMap.get(entityKey(link))?.available ?? false })),
      rewards: rewards.map((reward) => ({ ...reward, target: reward.target ? { ...reward.target, name: targetMap.get(entityKey(reward.target))?.name ?? reward.target.id } : undefined })),
      backlinks: backlinks.map((reference) => ({ ...referenceLink(reference), source: describe(reference.sourceEntity) }))
    };
  });

  app.put(base, { preHandler: [...read, requireCsrf] }, async (request) => {
    const { changes } = batchSchema.parse(request.body);
    const entities = await applyAssociations({ campaignId: request.campaign.id, actorUserId: request.auth.user.id, changes });
    for (const entity of entities)
      request.server.realtime?.to(`campaign:${request.campaign.id}`).emit('entity.changed', { ...entity, action: 'updated' });
    return { count: entities.length, entities };
  });
}
