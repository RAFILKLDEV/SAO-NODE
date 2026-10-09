import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { authenticate, requireCampaign, requireCsrf, requireGm } from '../lib/auth.js';
import { apiError } from '@sao/shared';
import { validateEntityCatalog } from '@sao/domain';
import { audit } from '../lib/audit.js';
import { entityRecordToCanonical, softRemoveImportedEntityTx, upsertImportedEntityTx } from '../services/content.js';

const querySchema = z.object({ page: z.coerce.number().int().positive().default(1), pageSize: z.coerce.number().int().positive().max(100).default(50) });
const includeAll = { fields: true, references: true, locationConnections: true, monsterComponents: true, questObjectives: true, questRewards: true };
const reversibleActions = new Set(['entity.create', 'entity.update', 'entity.delete', 'entity.import.create', 'entity.import.update', 'entity.import.remove', 'association.update']);
const rowKey = (type, id) => `${type}:${id}`;
const snapshotName = (snapshot) => snapshot?.data?.name ?? snapshot?.name ?? null;

export async function auditRoutes(app) {
  app.get('/api/v1/campaigns/:campaignId/audit', { preHandler: [authenticate, requireCampaign, requireGm] }, async (request, reply) => {
    const parsed = querySchema.safeParse(request.query);
    if (!parsed.success) return reply.code(400).send(apiError('INVALID_QUERY', 'Invalid paging', parsed.error.flatten()));
    const where = { campaignId: request.campaign.id };
    const [rows, total] = await Promise.all([
      prisma.auditLog.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (parsed.data.page - 1) * parsed.data.pageSize, take: parsed.data.pageSize }),
      prisma.auditLog.count({ where })
    ]);
    const userIds = [...new Set(rows.flatMap((row) => [row.actorUserId, row.subjectType === 'user' ? row.subjectId : null].filter(Boolean)))];
    const groupIds = [...new Set(rows.filter((row) => row.subjectType === 'group').map((row) => row.subjectId).filter(Boolean))];
    const entityKeys = [...new Map(rows.filter((row) => row.entityType && row.entityDomainId).map((row) => [rowKey(row.entityType, row.entityDomainId), { type: row.entityType, domainId: row.entityDomainId }])).values()];
    const [users, groups, entities] = await Promise.all([
      userIds.length ? prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, login: true } }) : [],
      groupIds.length ? prisma.group.findMany({ where: { campaignId: request.campaign.id, domainId: { in: groupIds } }, select: { domainId: true, name: true } }) : [],
      entityKeys.length ? prisma.entity.findMany({ where: { campaignId: request.campaign.id, OR: entityKeys }, select: { type: true, domainId: true, name: true } }) : []
    ]);
    const usersById = new Map(users.map((user) => [user.id, user]));
    const groupsById = new Map(groups.map((group) => [group.domainId, group.name]));
    const entitiesByKey = new Map(entities.map((entity) => [rowKey(entity.type, entity.domainId), entity.name]));
    const items = rows.map((row) => ({
      ...row,
      actor: usersById.get(row.actorUserId) ?? { id: row.actorUserId, name: 'Usuário removido', login: null },
      entityName: snapshotName(row.after) ?? snapshotName(row.before) ?? entitiesByKey.get(rowKey(row.entityType, row.entityDomainId)) ?? null,
      subjectName: row.subjectType === 'user' ? usersById.get(row.subjectId)?.name ?? 'Jogador removido' : row.subjectType === 'group' ? groupsById.get(row.subjectId) ?? 'Grupo removido' : null,
      reversible: reversibleActions.has(row.action) && row.resultVersion != null && row.after != null && !row.revertedAt
    }));
    return { items, total, page: parsed.data.page, pageSize: parsed.data.pageSize };
  });

  app.post('/api/v1/campaigns/:campaignId/audit/:auditId/undo', { preHandler: [authenticate, requireCampaign, requireGm, requireCsrf] }, async (request, reply) => {
    try {
      const result = await prisma.$transaction(async (tx) => {
        const event = await tx.auditLog.findFirst({ where: { id: request.params.auditId, campaignId: request.campaign.id } });
        if (!event) return { error: apiError('NOT_FOUND', 'Evento de auditoria não encontrado.'), status: 404 };
        if (event.revertedAt) return { error: apiError('ALREADY_REVERTED', 'Este evento já foi desfeito.'), status: 409 };
        if (!reversibleActions.has(event.action) || event.resultVersion == null || event.after == null)
          return { error: apiError('NOT_REVERSIBLE', 'Este evento não possui snapshot reversível.'), status: 409 };
        const current = await tx.entity.findUnique({
          where: { campaignId_type_domainId: { campaignId: request.campaign.id, type: event.entityType, domainId: event.entityDomainId } },
          include: includeAll
        });
        if (!current || current.version !== event.resultVersion)
          return { error: apiError('VERSION_CONFLICT', 'O conteúdo foi alterado depois deste evento; nada foi revertido.'), status: 409 };
        const before = event.before;
        if (before !== null && (!before?.data || typeof before.deletedAt !== 'boolean'))
          return { error: apiError('NOT_REVERSIBLE', 'O snapshot anterior está incompleto.'), status: 409 };
        const rows = await tx.entity.findMany({ where: { campaignId: request.campaign.id }, include: includeAll });
        const catalog = new Map(rows.filter((row) => !row.deletedAt).map((row) => [rowKey(row.type, row.domainId), { type: row.type, data: entityRecordToCanonical(row) }]));
        if (!before || before.deletedAt) catalog.delete(rowKey(event.entityType, event.entityDomainId));
        else catalog.set(rowKey(event.entityType, event.entityDomainId), { type: event.entityType, data: before.data });
        try { validateEntityCatalog([...catalog.values()]); }
        catch (error) { return { error: apiError('INVALID_CONTENT', error.message), status: 409 };
        }
        const source = { kind: 'undo', auditId: event.id, importedAt: new Date().toISOString() };
        const change = { tx, campaignId: request.campaign.id, type: event.entityType, domainId: event.entityDomainId, actorUserId: request.auth.user.id, source };
        if (!before) await softRemoveImportedEntityTx(change);
        else {
          await upsertImportedEntityTx({ ...change, input: before.data, source: before.source });
          if (before.deletedAt) await softRemoveImportedEntityTx({ ...change, source: before.source });
        }
        const now = new Date();
        const marked = await tx.auditLog.updateMany({ where: { id: event.id, revertedAt: null }, data: { revertedAt: now, revertedByUserId: request.auth.user.id } });
        if (marked.count !== 1) throw Object.assign(new Error('Este evento já foi desfeito.'), { code: 'ALREADY_REVERTED' });
        await audit(tx, { campaignId: request.campaign.id, actorUserId: request.auth.user.id, action: 'audit.undo', entityType: event.entityType, entityDomainId: event.entityDomainId, before: event.after, after: event.before, revertsAuditId: event.id });
        return { id: event.id, revertedAt: now };
      }, { isolationLevel: 'Serializable', timeout: 60000 });
      if (result.error) return reply.code(result.status).send(result.error);
      return result;
    } catch (error) {
      if (error.code === 'ALREADY_REVERTED') return reply.code(409).send(apiError(error.code, error.message));
      if (error.code === 'P2034') return reply.code(409).send(apiError('VERSION_CONFLICT', 'O conteúdo foi alterado durante o undo; nada foi revertido.'));
      throw error;
    }
  });
}
