import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { config } from '../lib/config.js';
import { authenticate, requireCampaign, requireCsrf, requireGm } from '../lib/auth.js';
import { randomToken } from '../lib/security.js';
import { apiError } from '@sao/shared';
import { buildDiff, exportSaoData, parseSaoData, validateAgainstXsd } from '@sao/xml';
import {
  entityRecordToAuthoritative,
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

const applySchema = z.object({ previewId: z.string().min(1), selectedKeys: z.array(z.string()).default([]) });
const xsdUrl = new URL('../../../../schemas/saoData-v1.xsd', import.meta.url);

async function readValidatedUpload(request) {
  const part = await request.file({ limits: { fileSize: config.maxXmlBytes, files: 1 } });
  if (!part) throw new Error('XML file is required');
  const fileName = part.filename ?? '';
  if (!fileName.toLowerCase().endsWith('.xml')) throw new Error('File extension must be .xml');
  if (!['application/xml', 'text/xml'].includes(part.mimetype)) throw new Error('MIME type must be application/xml or text/xml');
  const buffer = await part.toBuffer();
  if (buffer.length > config.maxXmlBytes) throw new Error('XML exceeds maximum size');
  return { fileName, xml: buffer.toString('utf8') };
}

export async function xmlRoutes(app) {
  app.post(
    '/api/v1/campaigns/:campaignId/import/preview',
    {
      preHandler: [authenticate, requireCampaign, requireGm, requireCsrf],
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } }
    },
    async (request, reply) => {
      let uploaded;
      try {
        uploaded = await readValidatedUpload(request);
      } catch (error) {
        return reply.code(400).send(apiError('INVALID_XML_UPLOAD', error.message));
      }
      const xsd = await readFile(xsdUrl, 'utf8');
      let parsed;
      try {
        parsed = await parseSaoData(uploaded.xml, {
          maxBytes: config.maxXmlBytes,
          xsd,
          fileName: uploaded.fileName
        });
      } catch (error) {
        return reply.code(400).send(apiError('INVALID_XML', error.message));
      }

      const existingRows = await prisma.entity.findMany({
        where: { campaignId: request.campaign.id, type: { in: parsed.pack.presentContainers } },
        include: includeAll
      });
      const existing = existingRows.map((entity) => ({
        type: entity.type,
        id: entity.domainId,
        data: {
          ...entityRecordToAuthoritative(entity),
          ...(entity.deletedAt ? { __deleted: true } : {})
        }
      }));
      const diff = buildDiff(existing, parsed.pack);

      const warnings = [];
      for (const warning of parsed.warnings) {
        const target = await prisma.entity.findUnique({
          where: {
            campaignId_type_domainId: {
              campaignId: request.campaign.id,
              type: warning.reference.type,
              domainId: warning.reference.id
            }
          }
        });
        if (!target || target.deletedAt) warnings.push(warning);
      }

      const previewId = randomToken(18);
      app.importPreviews.set(previewId, {
        campaignId: request.campaign.id,
        userId: request.auth.user.id,
        fileName: uploaded.fileName,
        pack: parsed.pack,
        diff,
        expiresAt: Date.now() + 15 * 60 * 1000
      });
      return {
        previewId,
        pack: {
          schemaVersion: parsed.pack.schemaVersion,
          packId: parsed.pack.packId,
          name: parsed.pack.name,
          language: parsed.pack.language,
          presentContainers: parsed.pack.presentContainers
        },
        warnings,
        diff: diff.map(({ key, type, id, status, selected, before, after }) => ({ key, type, id, status, selected, before, after }))
      };
    }
  );

  app.post('/api/v1/campaigns/:campaignId/import/apply', { preHandler: [authenticate, requireCampaign, requireGm, requireCsrf], config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
    const parsed = applySchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(apiError('INVALID_INPUT', 'Invalid import selection', parsed.error.flatten()));
    const preview = app.importPreviews.get(parsed.data.previewId);
    if (!preview || preview.expiresAt <= Date.now() || preview.campaignId !== request.campaign.id || preview.userId !== request.auth.user.id) {
      return reply.code(410).send(apiError('PREVIEW_EXPIRED', 'Import preview expired or does not belong to this session'));
    }
    const selected = new Set(parsed.data.selectedKeys);
    const allowedKeys = new Set(preview.diff.map((entry) => entry.key));
    for (const key of selected) if (!allowedKeys.has(key)) return reply.code(400).send(apiError('INVALID_SELECTION', `Unknown diff key: ${key}`));

    const incomingByKey = new Map(preview.pack.entities.map((entity) => [`${entity.type}:${entity.data.id}`, entity]));
    const source = {
      kind: 'saoData-v1',
      packId: preview.pack.packId,
      fileName: preview.fileName,
      importedAt: new Date().toISOString()
    };

    const summary = await prisma.$transaction(async (tx) => {
      let created = 0;
      let updated = 0;
      let removed = 0;
      for (const entry of preview.diff) {
        if (!selected.has(entry.key)) continue;
        if (entry.status === 'REMOVED_FROM_XML') {
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
      const result = { created, updated, removed, selected: selected.size, packId: preview.pack.packId };
      await tx.importHistory.create({
        data: {
          campaignId: request.campaign.id,
          packId: preview.pack.packId,
          fileName: preview.fileName,
          sourceKind: 'saoData-v1',
          summary: result,
          importedByUserId: request.auth.user.id
        }
      });
      return result;
    });

    app.importPreviews.delete(parsed.data.previewId);
    request.server.realtime?.to(`campaign:${request.campaign.id}`).emit('import.applied', summary);
    return summary;
  });

  app.get('/api/v1/campaigns/:campaignId/export.xml', { preHandler: [authenticate, requireCampaign, requireGm] }, async (request, reply) => {
    const rows = await prisma.entity.findMany({
      where: { campaignId: request.campaign.id, deletedAt: null },
      include: includeAll,
      orderBy: [{ type: 'asc' }, { domainId: 'asc' }]
    });
    const entities = rows.map((entity) => ({ type: entity.type, data: entityRecordToAuthoritative(entity) }));
    const xml = exportSaoData({
      packId: `${request.campaign.slug}.export`,
      name: request.campaign.name,
      language: 'pt-BR',
      entities
    });
    const xsd = await readFile(xsdUrl, 'utf8');
    await validateAgainstXsd(xml, xsd, 'export.xml');
    reply.header('content-type', 'application/xml; charset=utf-8');
    reply.header('content-disposition', `attachment; filename="${request.campaign.slug}.xml"`);
    return xml;
  });
}
