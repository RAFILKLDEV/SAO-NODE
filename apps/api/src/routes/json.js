import { formatMonsterSheets, normalizeEntity, validateEntityCatalog, normalizeLegacyDropFormulas } from '@sao/domain';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { notifyCampaign } from '../services/notifications.js';
import { discoverableImport } from '../services/importVisibility.js';
import { config } from '../lib/config.js';
import { authenticate, requireCampaign, requireCsrf, requireGm } from '../lib/auth.js';
import { randomToken } from '../lib/security.js';
import { audit } from '../lib/audit.js';
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
  // `selectedKeys` remains supported for older clients. New clients can use
  // selectionMode=all and transmit only exception keys.
  selectedKeys: z.array(z.string()).optional(),
  selectionMode: z.enum(['explicit', 'all']).optional(),
  selectAll: z.boolean().optional(),
  excludedKeys: z.array(z.string()).default([]),
  includedKeys: z.array(z.string()).default([]),
  selection: z.object({
    mode: z.enum(['explicit', 'all']).optional(),
    excludedKeys: z.array(z.string()).default([]),
    includedKeys: z.array(z.string()).default([])
  }).optional()
}).superRefine((value, ctx) => {
  const mode = value.selection?.mode ?? value.selectionMode ?? (value.selectAll ? 'all' : 'explicit');
  if (mode === 'explicit' && !(value.selectedKeys?.length || value.includedKeys.length || value.selection?.includedKeys.length))
    ctx.addIssue({ code: 'custom', path: ['selectedKeys'], message: 'Selecione ao menos uma alteração' });
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
const monsterExportSchema = z.object({
  types: z.preprocess(
    (value) => typeof value === 'string' ? value.split(',').filter(Boolean) : value,
    z.array(z.literal('monster')).min(1).default(['monster'])
  ),
  format: z.enum(['txt', 'md']).default('txt'),
  ids: z.preprocess(
    (value) => typeof value === 'string' ? value.split(',').map((id) => id.trim()).filter(Boolean) : value,
    z.array(z.string().min(1).max(160)).max(1000).optional()
  )
});
const historyQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20)
});
const previewQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(50),
  type: z.string().optional(),
  status: z.string().optional(),
  search: z.string().trim().max(120).optional(),
  // Removals are an explicit opt-in. A package may intentionally be partial.
  includeRemovals: z.preprocess((value) => {
    if (value == null || value === '') return false;
    if (typeof value === 'boolean') return value;
    return String(value).toLowerCase() === 'true';
  }, z.boolean()).default(false)
});

function compactDiffEntry(entry) {
  return {
    key: entry.key,
    type: entry.type,
    id: entry.id,
    name: entry.name ?? entry.after?.name ?? entry.before?.name ?? null,
    status: entry.status,
    selected: entry.selected,
    visibilityChange: entry.visibilityChange ?? null
  };
}

function previewDiffPage(diff, query) {
  const search = query.search?.toLocaleLowerCase('pt-BR');
  const filtered = diff.filter((entry) =>
    (!query.type || entry.type === query.type) &&
    (!query.status || entry.status === query.status) &&
    (!search || `${entry.type}:${entry.id}`.toLocaleLowerCase('pt-BR').includes(search))
  );
  const offset = (query.page - 1) * query.pageSize;
  return {
    items: filtered.slice(offset, offset + query.pageSize).map(compactDiffEntry),
    total: filtered.length,
    page: query.page,
    pageSize: query.pageSize,
    hasMore: offset + query.pageSize < filtered.length
  };
}

function selectionStats(diff) {
  const selectable = diff.filter((entry) => entry.status !== 'EQUAL' && entry.status !== 'REMOVED_FROM_JSON');
  return {
    selectableCount: selectable.length,
    defaultSelectedCount: selectable.length,
    selectedCount: selectable.length
  };
}

export function resolveApplySelection(input, preview) {
  const mode = input.selection?.mode ?? input.selectionMode ?? (input.selectAll ? 'all' : 'explicit');
  const explicitKeys = new Set([
    ...(input.selectedKeys ?? []),
    ...(input.includedKeys ?? []),
    ...(input.selection?.includedKeys ?? [])
  ]);
  const excludedKeys = new Set([
    ...(input.excludedKeys ?? []),
    ...(input.selection?.excludedKeys ?? [])
  ]);
  const allowedKeys = new Set(preview.diff.map((entry) => entry.key));
  for (const key of [...explicitKeys, ...excludedKeys]) {
    if (!allowedKeys.has(key)) return { error: key };
  }

  const selected = mode === 'all'
    ? new Set(preview.diff
      .filter((entry) => entry.status !== 'EQUAL' && entry.status !== 'REMOVED_FROM_JSON')
      .map((entry) => entry.key))
    : new Set();
  for (const key of explicitKeys) selected.add(key);
  for (const key of excludedKeys) selected.delete(key);
  // EQUAL entries are never actionable, even when a stale or hand-written
  // client payload includes their keys.
  for (const entry of preview.diff) if (entry.status === 'EQUAL') selected.delete(entry.key);
  return { selected, mode };
}

function safeImportFileName(request, packId) {
  const header = request.headers['x-file-name'];
  if (typeof header !== 'string' || !header.trim()) return `${packId}.json`;
  const base = header.split(/[\\/]/).pop().trim().slice(0, 180);
  const safe = Array.from(base, (character) => {
    const code = character.codePointAt(0);
    return code < 32 || '<>:"|?*'.includes(character) ? '_' : character;
  }).join('');
  return safe || `${packId}.json`;
}

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
      const query = previewQuerySchema.safeParse(request.query);
      if (!query.success)
        return reply.code(400).send(apiError('INVALID_QUERY', 'Paginação da prévia inválida', query.error.flatten()));
      let parsed;
      try {
        const input = request.body && typeof request.body === 'object' && !Array.isArray(request.body)
          ? Object.fromEntries(Object.entries(request.body).filter(([key]) => key !== 'includeRemovals'))
          : request.body;
        parsed = parseSaoDataJson(input, { maxBytes: config.maxJsonBytes, migrateDropFormulas: false });
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
      normalizeLegacyDropFormulas(pack.entities, parsed.diagnostics, existing.filter(entry => !entry.data.__deleted));
      pack = { ...pack, entities: pack.entities.map((entry) => ({
        ...entry, data: discoverableImport(entry.type, entry.data)
      })) };
      let warnings;
      try { warnings = validateEntityCatalog(pack.entities, existingRows.filter(e => !e.deletedAt).map(e => ({ type: e.type, data: entityRecordToCanonical(e) }))); }
      catch (error) { return reply.code(400).send(apiError('INVALID_CONTENT', error.message)); }
      // Removals are opt-in so a partial package can never delete unrelated
      // campaign content merely because it was omitted from the upload.
      const bodyIncludeRemovals = request.body && typeof request.body === 'object'
        ? request.body.includeRemovals === true
        : false;
      const includeRemovals = query.data.includeRemovals || bodyIncludeRemovals;
      const diff = buildDiff(
        operations.length > 0 ? existing : existing.filter(e => pack.containers.includes(e.type)),
        pack
      ).filter((entry) => includeRemovals || entry.status !== 'REMOVED_FROM_JSON');

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
      // Keep complete documents in the campaign snapshot and incoming pack,
      // while retaining only metadata in the in-memory diff index. This avoids
      // storing another before/after copy for every large monster sheet.
      const storedDiff = diff.map((entry) => ({
        key: entry.key,
        type: entry.type,
        id: entry.id,
        name: entry.after?.name ?? entry.before?.name ?? null,
        status: entry.status,
        selected: entry.selected,
        visibilityChange: entry.visibilityChange ?? null
      }));
      const diffKeys = new Set(storedDiff.map((entry) => entry.key));
      const existingSnapshot = existing.filter((entry) => diffKeys.has(`${entry.type}:${entry.id}`));
      const versions = Object.fromEntries(
        existingRows
          .filter((entity) => diffKeys.has(`${entity.type}:${entity.domainId}`))
          .map((entity) => [`${entity.type}:${entity.domainId}`, entity.version])
      );
      for (const [id, preview] of app.importPreviews) {
        if (preview.expiresAt <= Date.now()) app.importPreviews.delete(id);
      }
      // A user can keep several previews open, but never allow abandoned large
      // packs to accumulate indefinitely in the process.
      if (app.importPreviews.size >= 20) {
        const oldest = [...app.importPreviews.entries()].sort((a, b) => a[1].expiresAt - b[1].expiresAt)[0];
        if (oldest) app.importPreviews.delete(oldest[0]);
      }
      app.importPreviews.set(previewId, {
        campaignId: request.campaign.id,
        userId: request.auth.user.id,
        fileName: safeImportFileName(request, pack.packId),
        pack,
        diff: storedDiff,
        existing: existingSnapshot,
        versions,
        expiresAt: Date.now() + 15 * 60 * 1000
      });
      const diffPage = previewDiffPage(storedDiff, query.data);
      const stats = selectionStats(storedDiff);
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
        // Keep the initial response bounded. Full before/after documents are
        // available from GET /import/preview/:previewId/details?key=...
        diff: diffPage.items,
        total: diffPage.total,
        page: diffPage.page,
        pageSize: diffPage.pageSize,
        hasMore: diffPage.hasMore,
        selectableCount: stats.selectableCount,
        defaultSelectedCount: stats.defaultSelectedCount
      };
    }
  );

  app.get(
    '/api/v1/campaigns/:campaignId/import/preview/:previewId',
    { preHandler: [authenticate, requireCampaign, requireGm] },
    async (request, reply) => {
      const parsed = previewQuerySchema.safeParse(request.query);
      if (!parsed.success)
        return reply.code(400).send(apiError('INVALID_QUERY', 'Paginação da prévia inválida', parsed.error.flatten()));
      const preview = app.importPreviews.get(request.params.previewId);
      if (!preview || preview.expiresAt <= Date.now() || preview.campaignId !== request.campaign.id || preview.userId !== request.auth.user.id)
        return reply.code(410).send(apiError('PREVIEW_EXPIRED', 'A prévia expirou ou pertence a outra sessão'));
      return {
        previewId: request.params.previewId,
        ...previewDiffPage(preview.diff, parsed.data),
        ...selectionStats(preview.diff)
      };
    }
  );

  app.get(
    '/api/v1/campaigns/:campaignId/import/preview/:previewId/details',
    { preHandler: [authenticate, requireCampaign, requireGm] },
    async (request, reply) => {
      const key = z.string().min(1).max(240).safeParse(request.query?.key);
      if (!key.success) return reply.code(400).send(apiError('INVALID_QUERY', 'A chave da alteração é obrigatória'));
      const preview = app.importPreviews.get(request.params.previewId);
      if (!preview || preview.expiresAt <= Date.now() || preview.campaignId !== request.campaign.id || preview.userId !== request.auth.user.id)
        return reply.code(410).send(apiError('PREVIEW_EXPIRED', 'A prévia expirou ou pertence a outra sessão'));
      const entry = preview.diff.find((item) => item.key === key.data);
      if (!entry) return reply.code(404).send(apiError('NOT_FOUND', 'Alteração não encontrada na prévia'));
      const incoming = preview.pack.entities.find((item) => `${item.type}:${item.data.id}` === key.data);
      const previous = preview.existing.find((item) => `${item.type}:${item.id}` === key.data);
      return {
        key: entry.key,
        type: entry.type,
        id: entry.id,
        status: entry.status,
        selected: entry.selected,
        before: entry.before ?? previous?.data ?? null,
        after: entry.after ?? incoming?.data ?? null,
        versions: { before: preview.versions[key.data] ?? null }
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
      const resolvedSelection = resolveApplySelection(parsed.data, preview);
      if (resolvedSelection.error)
        return reply
          .code(400)
          .send(apiError('INVALID_SELECTION', `Chave de alteração desconhecida: ${resolvedSelection.error}`));
      const selected = resolvedSelection.selected;
      if (!selected.size)
        return reply
          .code(400)
          .send(apiError('INVALID_SELECTION', 'Selecione ao menos uma alteração'));

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
        const reversibleChanges = [];
        const selectedEntries = preview.diff.filter((entry) => selected.has(entry.key) && entry.status !== 'EQUAL');
        // Keep one transaction and history record, but yield work to bounded
        // batches so very large monster packs do not build an unbounded loop.
        const configuredBatchSize = Number(config.importBatchSize ?? 100);
        const batchSize = Number.isFinite(configuredBatchSize) && configuredBatchSize > 0
          ? Math.floor(configuredBatchSize)
          : 100;
        for (let offset = 0; offset < selectedEntries.length; offset += batchSize) {
          const batch = selectedEntries.slice(offset, offset + batchSize);
          for (const entry of batch) {
            const previous = byKey.get(entry.key);
            const before = previous ? {
              data: entityRecordToCanonical(previous),
              source: previous.source,
              deletedAt: Boolean(previous.deletedAt)
            } : null;
            let after;
            if (entry.status === 'REMOVED_FROM_JSON') {
            const saved = await softRemoveImportedEntityTx({
              tx,
              campaignId: request.campaign.id,
              type: entry.type,
              domainId: entry.id,
              actorUserId: request.auth.user.id,
              source
            });
            after = { data: before?.data ?? null, source, deletedAt: true };
            removed += 1;
            const resultVersion = saved?.version;
            reversibleChanges.push({ type: entry.type, id: entry.id, status: entry.status, before, after, resultVersion });
              continue;
            } else {
              const incoming = incomingByKey.get(entry.key);
              if (!incoming) continue;
              const saved = await upsertImportedEntityTx({
              tx,
              campaignId: request.campaign.id,
              type: incoming.type,
              input: incoming.data,
              actorUserId: request.auth.user.id,
              source
              });
              after = { data: incoming.data, source, deletedAt: false };
              if (entry.status === 'NEW') created += 1;
              else updated += 1;
              reversibleChanges.push({ type: entry.type, id: entry.id, status: entry.status, before, after, resultVersion: saved.version });
            }
          }
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
            importedByUserId: request.auth.user.id,
            changes: reversibleChanges,
            reversibleCount: reversibleChanges.length
          }
        });
        return result;
      }, {
        isolationLevel: 'Serializable',
        timeout: config.importTransactionTimeoutMs ?? 300000
      });

      app.importPreviews.delete(parsed.data.previewId);
      await notifyCampaign({ db: prisma, realtime: request.server.realtime, campaignId: request.campaign.id, actorUserId: request.auth.user.id, eventType: 'import.applied', kind: 'info', title: 'Importação concluída', message: 'Novos dados foram importados para a campanha.', payload: summary });
      request.server.realtime?.to(`campaign:${request.campaign.id}`).emit('import.applied', summary);
      return summary;
    }
  );

  app.get('/api/v1/campaigns/:campaignId/import/history', { preHandler: [authenticate, requireCampaign, requireGm] }, async (request, reply) => {
    const parsed = historyQuerySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send(apiError('INVALID_QUERY', 'Paginação inválida', parsed.error.flatten()));
    const where = { campaignId: request.campaign.id, sourceKind: { not: 'legacy' } };
    const [rows, total] = await Promise.all([
      prisma.importHistory.findMany({ where, select: { id: true, packId: true, fileName: true, sourceKind: true, summary: true, importedByUserId: true, importedAt: true, revertedAt: true, revertedByUserId: true, reversibleCount: true }, orderBy: [{ importedAt: 'desc' }, { id: 'desc' }], skip: (parsed.data.page - 1) * parsed.data.pageSize, take: parsed.data.pageSize }),
      prisma.importHistory.count({ where })
    ]);
    const actorIds = [...new Set(rows.map((row) => row.importedByUserId).filter(Boolean))];
    const users = actorIds.length
      ? await prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true, login: true } })
      : [];
    const usersById = new Map(users.map((user) => [user.id, user]));
    return { items: rows.map((row) => ({ ...row, importedBy: usersById.get(row.importedByUserId) ?? null, reversible: row.reversibleCount > 0 })), total, page: parsed.data.page, pageSize: parsed.data.pageSize };
  });

  app.get('/api/v1/campaigns/:campaignId/import/history/:historyId', { preHandler: [authenticate, requireCampaign, requireGm] }, async (request, reply) => {
    const row = await prisma.importHistory.findFirst({ where: { id: request.params.historyId, campaignId: request.campaign.id, sourceKind: { not: 'legacy' } } });
    if (!row) return reply.code(404).send(apiError('NOT_FOUND', 'Importação não encontrada.'));
    return row;
  });

  app.post('/api/v1/campaigns/:campaignId/import/history/:historyId/undo', { preHandler: [authenticate, requireCampaign, requireGm, requireCsrf] }, async (request, reply) => {
    let result;
    try {
      result = await prisma.$transaction(async (tx) => {
      const history = await tx.importHistory.findFirst({ where: { id: request.params.historyId, campaignId: request.campaign.id } });
      if (!history) return { error: apiError('NOT_FOUND', 'Importação não encontrada.'), status: 404 };
      if (history.revertedAt) return { error: apiError('ALREADY_REVERTED', 'Esta importação já foi desfeita.'), status: 409 };
      if (history.sourceKind === 'baseline' || history.reversibleCount < 1) return { error: apiError('NOT_REVERSIBLE', 'Este registro é apenas um ponto inicial do histórico.'), status: 409 };
      const changes = Array.isArray(history.changes) ? history.changes : [];
      if (!changes.length) return { error: apiError('NOT_REVERSIBLE', 'Esta importação não possui snapshots reversíveis.'), status: 409 };
      const rows = await tx.entity.findMany({ where: { campaignId: request.campaign.id }, include: includeAll });
      const byKey = new Map(rows.map((row) => [`${row.type}:${row.domainId}`, row]));
      for (const change of changes) {
        const current = byKey.get(`${change.type}:${change.id}`);
        if (!current || current.version !== change.resultVersion) return { error: apiError('VERSION_CONFLICT', `O conteúdo ${change.type}:${change.id} foi alterado após a importação.`), status: 409 };
      }
      const finalCatalog = new Map(rows.filter((row) => !row.deletedAt).map((row) => [`${row.type}:${row.domainId}`, { type: row.type, data: entityRecordToCanonical(row) }]));
      for (const change of changes) {
        const key = `${change.type}:${change.id}`;
        if (!change.before || change.before.deletedAt) finalCatalog.delete(key);
        else finalCatalog.set(key, { type: change.type, data: change.before.data });
      }
      try { validateEntityCatalog([...finalCatalog.values()]); }
      catch (error) { return { error: apiError('INVALID_CONTENT', error.message), status: 409 }; }
      const undoSource = { kind: 'undo', packId: history.packId, fileName: history.fileName, importedAt: new Date().toISOString() };
      for (const change of changes) {
        const args = { tx, campaignId: request.campaign.id, type: change.type, domainId: change.id, actorUserId: request.auth.user.id, source: undoSource };
        if (!change.before) {
          await softRemoveImportedEntityTx(args);
          continue;
        }
        await upsertImportedEntityTx({ ...args, input: change.before.data, source: change.before.source });
        if (change.before.deletedAt) await softRemoveImportedEntityTx({ ...args, source: change.before.source });
      }
      const now = new Date();
      const marked = await tx.importHistory.updateMany({ where: { id: history.id, campaignId: request.campaign.id, revertedAt: null }, data: { revertedAt: now, revertedByUserId: request.auth.user.id } });
      if (marked.count !== 1) throw Object.assign(new Error('Esta importação já foi desfeita.'), { code: 'ALREADY_REVERTED' });
      await audit(tx, { campaignId: request.campaign.id, actorUserId: request.auth.user.id, action: 'import.undo', before: { historyId: history.id, summary: history.summary }, after: { historyId: history.id, revertedAt: now.toISOString() } });
      return { result: { historyId: history.id, reverted: changes.length, revertedAt: now } };
      }, {
        isolationLevel: 'Serializable',
        timeout: config.importTransactionTimeoutMs ?? 300000
      });
    } catch (error) {
      if (['ALREADY_REVERTED', 'VERSION_CONFLICT'].includes(error.code))
        return reply.code(409).send(apiError(error.code, error.message));
      if (error.code === 'P2034') return reply.code(409).send(apiError('VERSION_CONFLICT', 'A campanha foi alterada durante a reversão; nada foi desfeito.'));
      throw error;
    }
    if (result.error) return reply.code(result.status).send(result.error);
    await notifyCampaign({ db: prisma, realtime: request.server.realtime, campaignId: request.campaign.id, actorUserId: request.auth.user.id, eventType: 'import.reverted', kind: 'info', title: 'Importação desfeita', message: 'As alterações da importação foram revertidas.', payload: result.result });
    request.server.realtime?.to(`campaign:${request.campaign.id}`).emit('import.reverted', result.result);
    return result.result;
  });

  app.get(
    '/api/v1/campaigns/:campaignId/export.monsters',
    { preHandler: [authenticate, requireCampaign, requireGm] },
    async (request, reply) => {
      const parsed = monsterExportSchema.safeParse(request.query);
      if (!parsed.success)
        return reply.code(400).send(apiError('INVALID_QUERY', 'Opções de exportação de monstros inválidas', parsed.error.flatten()));
      const where = {
        campaignId: request.campaign.id,
        type: 'monster',
        deletedAt: null,
        ...(parsed.data.ids?.length ? { domainId: { in: parsed.data.ids } } : {})
      };
      const rows = await prisma.entity.findMany({
        where,
        include: includeAll,
        orderBy: [{ domainId: 'asc' }]
      });
      const monsters = rows.map((entity) => ({ type: 'monster', data: entityRecordToCanonical(entity) }));
      const body = formatMonsterSheets(monsters, { format: parsed.data.format });
      const extension = parsed.data.format === 'md' ? 'md' : 'txt';
      reply.header('content-type', `${parsed.data.format === 'md' ? 'text/markdown' : 'text/plain'}; charset=utf-8`);
      reply.header('content-disposition', `attachment; filename="${request.campaign.slug}.monsters.${extension}"`);
      return body;
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
