import { normalizeEntity, validateEntityCatalog } from '@sao/domain';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { config } from '../lib/config.js';
import { authenticate, requireCampaign, requireCsrf, requireGm } from '../lib/auth.js';
import { randomToken } from '../lib/security.js';
import { apiError } from '@sao/shared';
import {
  JSON_IMPORT_TEMPLATE,
  saoDataJsonSchema,
  buildDiff,
  exportSaoDataJson,
  parseSaoDataJson
} from '@sao/json';
import {
  applyEntityChangeDocument,
  entityRecordToCanonical,
  softRemoveImportedEntityTx,
  upsertImportedEntityTx
} from '../services/content.js';

const includeAll = {
  fields: true,
  references: true,
  locationConnections: true,
  monsterComponents: true,
  questObjectives: true,
  questRewards: true
};

const applySchema = z.object({
  previewId: z.string().min(1),
  selectedKeys: z.array(z.string()).default([])
});
const exportTypes = ['npc', 'location', 'item', 'monster', 'quest'];
const exportSchema = z.object({
  types: z
    .preprocess(
      (value) => typeof value === 'string' ? value.split(',').filter(Boolean) : value,
      z.array(z.enum(exportTypes)).min(1).optional()
    ),
  format: z.enum(['1', '2']).default('2')
});

export async function jsonRoutes(app) {
  app.get('/api/v1/campaigns/:campaignId/import/schema', { preHandler: [authenticate, requireCampaign, requireGm] }, async () => saoDataJsonSchema());
  app.get(
    '/api/v1/campaigns/:campaignId/import/template',
    { preHandler: [authenticate, requireCampaign, requireGm] },
    async () => JSON_IMPORT_TEMPLATE
  );

  app.post(
    '/api/v1/campaigns/:campaignId/import/preview',
    {
      preHandler: [authenticate, requireCampaign, requireGm, requireCsrf],
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } }
    },
    async (request, reply) => {
      let parsed;
      try {
        parsed = parseSaoDataJson(request.body, { maxBytes: config.maxJsonBytes });
      } catch (error) {
        return reply.code(400).send(apiError('INVALID_JSON', error.message));
      }

      const existingRows = await prisma.entity.findMany({
        where: { campaignId: request.campaign.id },
        include: includeAll
      });
      const existing = existingRows.map((entity) => ({
        type: entity.type,
        id: entity.domainId,
        data: {
          ...entityRecordToCanonical(entity),
          ...(entity.deletedAt ? { __deleted: true } : {})
        }
      }));
      const operations = parsed.pack.operations ?? [];
      let pack = parsed.pack;
      if (operations.length > 0) {
        const currentByKey = new Map(
          existingRows
            .filter((entity) => !entity.deletedAt)
            .map((entity) => [`${entity.type}:${entity.domainId}`, entity])
        );
        try {
          pack = {
            ...parsed.pack,
            entities: operations.map((operation) => {
              const current = currentByKey.get(`${operation.type}:${operation.id}`);
              if (!current) throw new Error(`Entidade da operação não encontrada: ${operation.type}:${operation.id}`);
              const next = applyEntityChangeDocument(entityRecordToCanonical(current), operation);
              return {
                type: operation.type,
                data: normalizeEntity(operation.type, { ...next, id: operation.id }, { format: '2.0' })
              };
            })
          };
        } catch (error) {
          return reply.code(400).send(apiError('INVALID_CONTENT', error.message));
        }
      }
      let warnings;
      try { warnings = validateEntityCatalog(pack.entities, existingRows.filter(e => !e.deletedAt).map(e => ({ type: e.type, data: entityRecordToCanonical(e) }))); }
      catch (error) { return reply.code(400).send(apiError('INVALID_CONTENT', error.message)); }
      const diff = buildDiff(
        operations.length > 0 ? existing : existing.filter(e => pack.containers.includes(e.type)),
        pack
      );

      const unresolvedWarnings = [];
      for (const warning of [...parsed.warnings, ...warnings]) {
        const target = await prisma.entity.findUnique({
          where: {
            campaignId_type_domainId: {
              campaignId: request.campaign.id,
              type: warning.reference.type,
              domainId: warning.reference.id
            }
          }
        });
        if (!target || target.deletedAt) unresolvedWarnings.push(warning);
      }

      const previewId = randomToken(18);
      app.importPreviews.set(previewId, {
        campaignId: request.campaign.id,
        userId: request.auth.user.id,
        fileName: `${pack.packId}.json`,
        pack,
        diff,
        versions: Object.fromEntries(existingRows.map(e => [`${e.type}:${e.domainId}`, e.version])),
        expiresAt: Date.now() + 15 * 60 * 1000
      });
      return {
        previewId,
        pack: {
          schemaVersion: pack.schemaVersion,
          packId: pack.packId,
          name: pack.name,
          language: pack.language,
          containers: pack.containers,
          operationCount: operations.length,
          diagnostics: parsed.diagnostics
        },
        warnings: unresolvedWarnings,
        diff
      };
    }
  );

  app.post(
    '/api/v1/campaigns/:campaignId/import/apply',
    {
      preHandler: [authenticate, requireCampaign, requireGm, requireCsrf],
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } }
    },
    async (request, reply) => {
      const parsed = applySchema.safeParse(request.body);
      if (!parsed.success)
        return reply
          .code(400)
          .send(apiError('INVALID_INPUT', 'Seleção de importação inválida', parsed.error.flatten()));
      const preview = app.importPreviews.get(parsed.data.previewId);
      if (
        !preview ||
        preview.expiresAt <= Date.now() ||
        preview.campaignId !== request.campaign.id ||
        preview.userId !== request.auth.user.id
      ) {
        return reply
          .code(410)
          .send(apiError('PREVIEW_EXPIRED', 'A prévia expirou ou pertence a outra sessão'));
      }
      const selected = new Set(parsed.data.selectedKeys);
      const allowedKeys = new Set(preview.diff.map((entry) => entry.key));
      for (const key of selected) {
        if (!allowedKeys.has(key))
          return reply
            .code(400)
            .send(apiError('INVALID_SELECTION', `Chave de alteração desconhecida: ${key}`));
      }

      const incomingByKey = new Map(
        preview.pack.entities.map((entity) => [`${entity.type}:${entity.data.id}`, entity])
      );
      const source = {
        kind: 'json',
        packId: preview.pack.packId,
        fileName: preview.fileName,
        importedAt: new Date().toISOString()
      };
      const summary = await prisma.$transaction(async (tx) => {
        const rows = await tx.entity.findMany({ where: { campaignId: request.campaign.id }, include: includeAll });
        const byKey = new Map(rows.map(e => [`${e.type}:${e.domainId}`, e]));
        for (const entry of preview.diff.filter(e => selected.has(e.key))) {
          if (byKey.get(entry.key)?.version !== preview.versions[entry.key]) {
            const error = new Error('A campanha mudou após a prévia. Gere uma nova prévia.'); error.code = 'VERSION_CONFLICT'; throw error;
          }
        }
        const finalCatalog = new Map(rows.filter(e => !e.deletedAt).map(e => [`${e.type}:${e.domainId}`, { type: e.type, data: entityRecordToCanonical(e) }]));
        for (const entry of preview.diff.filter(e => selected.has(e.key))) {
          if (entry.status === 'REMOVED_FROM_JSON') finalCatalog.delete(entry.key);
          else finalCatalog.set(entry.key, incomingByKey.get(entry.key));
        }
        try { validateEntityCatalog([...finalCatalog.values()]); }
        catch (error) { error.code = 'INVALID_CONTENT'; throw error; }
        let created = 0;
        let updated = 0;
        let removed = 0;
        for (const entry of preview.diff) {
          if (!selected.has(entry.key) || entry.status === 'EQUAL') continue;
          if (entry.status === 'REMOVED_FROM_JSON') {
            await softRemoveImportedEntityTx({
              tx,
              campaignId: request.campaign.id,
              type: entry.type,
              domainId: entry.id,
              actorUserId: request.auth.user.id,
              source
            });
            removed += 1;
            continue;
          }
          const incoming = incomingByKey.get(entry.key);
          if (!incoming) continue;
          await upsertImportedEntityTx({
            tx,
            campaignId: request.campaign.id,
            type: incoming.type,
            input: incoming.data,
            actorUserId: request.auth.user.id,
            source
          });
          if (entry.status === 'NEW') created += 1;
          else updated += 1;
        }
        const result = {
          created,
          updated,
          removed,
          selected: selected.size,
          packId: preview.pack.packId
        };
        await tx.importHistory.create({
          data: {
            campaignId: request.campaign.id,
            packId: preview.pack.packId,
            fileName: preview.fileName,
            sourceKind: 'json-v2',
            summary: result,
            importedByUserId: request.auth.user.id
          }
        });
        return result;
      }, { isolationLevel: 'Serializable', timeout: 60000 });

      app.importPreviews.delete(parsed.data.previewId);
      request.server.realtime?.to(`campaign:${request.campaign.id}`).emit('import.applied', summary);
      return summary;
    }
  );

  app.get(
    '/api/v1/campaigns/:campaignId/export.json',
    { preHandler: [authenticate, requireCampaign, requireGm] },
    async (request, reply) => {
      const parsed = exportSchema.safeParse(request.query);
      if (!parsed.success)
        return reply.code(400).send(apiError('INVALID_QUERY', 'Categorias de exportação inválidas', parsed.error.flatten()));
      const types = parsed.data.types ?? exportTypes;
      const rows = await prisma.entity.findMany({
        where: { campaignId: request.campaign.id, deletedAt: null, type: { in: types } },
        include: includeAll,
        orderBy: [{ type: 'asc' }, { domainId: 'asc' }]
      });
      const entities = rows.map((entity) => ({
        type: entity.type,
        data: entityRecordToCanonical(entity)
      }));
      const document = exportSaoDataJson({
        packId: `${request.campaign.slug}.export`,
        name: request.campaign.name,
        containers: types,
        format: parsed.data.format === '1' ? '1.0' : '2.0',
        entities
      });
      reply.header('content-type', 'application/json; charset=utf-8');
      reply.header(
        'content-disposition',
        `attachment; filename="${request.campaign.slug}.json"`
      );
      return JSON.stringify(document, null, 2);
    }
  );
}
