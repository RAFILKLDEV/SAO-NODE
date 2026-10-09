import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { ENTITY_TYPES, apiError } from '@sao/shared';
import { authenticate, requireCampaign, requireCsrf, requireGm } from '../lib/auth.js';
import {
  createEntity,
  deleteEntity,
  applyEntityChanges,
  getEntityForRequest,
  getMonsterCanonicalForExport,
  listEntitiesForRequest,
  updateEntity
} from '../services/content.js';
import { notifyEntityChanged } from '../services/notifications.js';
import { buildTormenta20CriaturaXml } from '@sao/domain';

const querySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(50),
  search: z.string().default(''),
  sort: z.enum(['name', 'updatedAt']).default('name'),
  viewAsUserId: z.string().min(1).optional(),
  format: z.enum(['1', '2']).default('1')
  ,dropId: z.string().min(1).optional()
});

export async function entityRoutes(app) {
  for (const type of ENTITY_TYPES) {
    const plural = type === 'location' ? 'locations' : `${type}s`;
    const base = `/api/v1/campaigns/:campaignId/${plural}`;

    app.get(base, { preHandler: [authenticate, requireCampaign] }, async (request, reply) => {
      const query = querySchema.safeParse(request.query);
      if (!query.success)
        return reply
          .code(400)
          .send(apiError('INVALID_QUERY', 'Invalid query', query.error.flatten()));
      return listEntitiesForRequest({ request, type, ...query.data });
    });

    app.get(
      `${base}/:domainId`,
      { preHandler: [authenticate, requireCampaign] },
      async (request, reply) => {
        const result = await getEntityForRequest({
          request,
          type,
          domainId: request.params.domainId
        });
        if (!result) return reply.code(404).send(apiError('NOT_FOUND', 'Entity not found'));
        return result;
      }
    );

    if (type === 'monster') {
      app.get(
        `${base}/:domainId/firecast.xml`,
        { preHandler: [authenticate, requireCampaign, requireGm] },
        async (request, reply) => {
          const monster = await getMonsterCanonicalForExport({
            campaignId: request.campaign.id,
            domainId: request.params.domainId
          });
          if (!monster) return reply.code(404).send(apiError('NOT_FOUND', 'Entity not found'));
          const xml = buildTormenta20CriaturaXml(monster);
          return reply.header('Content-Type', 'application/xml; charset=utf-8').send(xml);
        }
      );
    }

    app.post(
      base,
      { preHandler: [authenticate, requireCampaign, requireGm, requireCsrf] },
      async (request, reply) => {
        const entity = await createEntity({
          campaignId: request.campaign.id,
          type,
          input: request.body,
          actorUserId: request.auth.user.id
        });
        await notifyEntityChanged({ db: prisma, realtime: request.server.realtime, campaignId: request.campaign.id, actorUserId: request.auth.user.id, type, entityId: entity.domainId, action: 'created' });
        request.server.realtime
          ?.to(`campaign:${request.campaign.id}`)
          .emit('entity.changed', { type, id: entity.domainId, action: 'created' });
        return reply.code(201).send({ id: entity.domainId, version: entity.version });
      }
    );

    app.put(
      `${base}/:domainId`,
      { preHandler: [authenticate, requireCampaign, requireGm, requireCsrf] },
      async (request, reply) => {
        const version = Number(request.headers['if-match'] ?? request.body?.version);
        if (!Number.isInteger(version))
          return reply
            .code(428)
            .send(apiError('VERSION_REQUIRED', 'Use If-Match with the current entity version'));
        const entity = await updateEntity({
          campaignId: request.campaign.id,
          type,
          domainId: request.params.domainId,
          input: request.body,
          version,
          actorUserId: request.auth.user.id
        });
        if (!entity) return reply.code(404).send(apiError('NOT_FOUND', 'Entity not found'));
        await notifyEntityChanged({ db: prisma, realtime: request.server.realtime, campaignId: request.campaign.id, actorUserId: request.auth.user.id, type, entityId: entity.domainId, action: 'updated' });
        request.server.realtime
          ?.to(`campaign:${request.campaign.id}`)
          .emit('entity.changed', { type, id: entity.domainId, action: 'updated' });
        return { id: entity.domainId, version: entity.version };
      }
    );

    app.patch(
      `${base}/:domainId`,
      { preHandler: [authenticate, requireCampaign, requireGm, requireCsrf] },
      async (request, reply) => {
        const body = request.body ?? {};
        const expectedVersion = Number(request.headers['if-match'] ?? body.expectedVersion ?? body.version);
        if (!Number.isInteger(expectedVersion)) return reply.code(428).send(apiError('VERSION_REQUIRED', 'Use If-Match or expectedVersion'));
        const entity = await applyEntityChanges({
          campaignId: request.campaign.id, type, domainId: request.params.domainId,
          expectedVersion, set: body.set, add: body.add, remove: body.remove,
          actorUserId: request.auth.user.id
        });
        if (!entity) return reply.code(404).send(apiError('NOT_FOUND', 'Entity not found'));
        await notifyEntityChanged({ db: prisma, realtime: request.server.realtime, campaignId: request.campaign.id, actorUserId: request.auth.user.id, type, entityId: entity.domainId, action: 'updated' });
        request.server.realtime?.to(`campaign:${request.campaign.id}`).emit('entity.changed', { type, id: entity.domainId, action: 'updated' });
        return { id: entity.domainId, version: entity.version };
      }
    );

    app.delete(
      `${base}/:domainId`,
      { preHandler: [authenticate, requireCampaign, requireGm, requireCsrf] },
      async (request, reply) => {
        const deleted = await deleteEntity({
          campaignId: request.campaign.id,
          type,
          domainId: request.params.domainId,
          actorUserId: request.auth.user.id
        });
        if (!deleted) return reply.code(404).send(apiError('NOT_FOUND', 'Entity not found'));
        if (deleted.blocked)
          return reply
            .code(409)
            .send(apiError('ENTITY_REFERENCED', 'Entity is referenced by other entities', {
              references: deleted.references
            }));
        await notifyEntityChanged({ db: prisma, realtime: request.server.realtime, campaignId: request.campaign.id, actorUserId: request.auth.user.id, type, entityId: request.params.domainId, action: 'deleted' });
        request.server.realtime
          ?.to(`campaign:${request.campaign.id}`)
          .emit('entity.changed', { type, id: request.params.domainId, action: 'deleted' });
        return reply.code(204).send();
      }
    );
  }
}
