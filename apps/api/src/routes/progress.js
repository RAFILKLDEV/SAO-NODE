import { getEntityForRequest } from '../services/content.js';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { audit } from '../lib/audit.js';
import { authenticate, isGm, requireCampaign, requireCsrf, requireGm } from '../lib/auth.js';
import { evaluateQuestProgress } from '@sao/domain';
import { apiError } from '@sao/shared';

const startSchema = z.object({
  questId: z.string().min(1),
  ownerType: z.enum(['player', 'group']),
  ownerId: z.string().min(1)
});

const updateSchema = z.object({ value: z.number().int().nonnegative(), version: z.number().int().positive().optional() });

function questFromEntity(entity) {
  return {
    objectiveMode: entity.data.objectiveMode ?? 'free',
    objectives: entity.questObjectives.map((objective) => ({
      objectiveId: objective.objectiveId,
      order: objective.sortOrder,
      requiredQuantity: objective.requiredQuantity,
      optional: objective.optional,
      secret: objective.secret,
      dependsOn: objective.dependsOn,
      playerEditable: objective.playerEditable
    }))
  };
}

function evaluationFor(progress) {
  const quest = questFromEntity(progress.questEntity);
  const values = Object.fromEntries(progress.objectives.map((entry) => [entry.objectiveId, entry.value]));
  return { quest, evaluation: evaluateQuestProgress(quest, values) };
}

async function canAccessProgress(request, progress) {
  if (isGm(request)) return true;
  if (progress.ownerType === 'player') return progress.ownerId === request.auth.user.login;
  const group = await prisma.group.findUnique({
    where: { campaignId_domainId: { campaignId: request.campaign.id, domainId: progress.ownerId } },
    include: { members: true }
  });
  return Boolean(group?.members.some((member) => member.userId === request.auth.user.id));
}

async function serializeProgress(progress, request) {
  const { quest, evaluation } = evaluationFor(progress);
  if (isGm(request)) {
    // Progress records for removed objectives stay in the database as history,
    // but must not appear in the current mission/progress menus.
    const currentObjectiveIds = new Set(quest.objectives.map((objective) => objective.objectiveId));
    const currentObjectives = progress.objectives.filter((entry) => !entry.orphaned && currentObjectiveIds.has(entry.objectiveId));
    return {
      id: progress.id,
      questId: progress.questEntity.domainId,
      ownerType: progress.ownerType,
      ownerId: progress.ownerId,
      state: progress.state,
      startedAt: progress.startedAt,
      completedAt: progress.completedAt,
      version: progress.version,
      percentage: evaluation.percentage,
      readyToComplete: evaluation.readyToComplete,
      objectives: currentObjectives.map((entry) => ({
        objectiveId: entry.objectiveId,
        text: progress.questEntity.questObjectives.find((objective) => objective.objectiveId === entry.objectiveId)?.text ?? 'Objetivo removido',
        value: entry.value,
        requiredQuantity: progress.questEntity.questObjectives.find((objective) => objective.objectiveId === entry.objectiveId)?.requiredQuantity ?? 1,
        orphaned: entry.orphaned
      }))
    };
  }

  const visibleQuest = await getEntityForRequest({ request, type: 'quest', domainId: progress.questEntity.domainId });
  if (!visibleQuest) return null;
  const visibleIds = new Set(visibleQuest.objectives.map(o => o.objectiveId));
  const visibleObjectives = quest.objectives.filter(objective => visibleIds.has(objective.objectiveId));
  const visibleValues = Object.fromEntries(
    progress.objectives.filter((entry) => visibleObjectives.some((objective) => objective.objectiveId === entry.objectiveId)).map((entry) => [entry.objectiveId, entry.value])
  );
  const visibleEvaluation = evaluateQuestProgress({ ...quest, objectives: visibleObjectives }, visibleValues);
  const hasHiddenRequired = quest.objectives.some((objective) => !visibleIds.has(objective.objectiveId) && !objective.optional);
  return {
    id: progress.id,
    questId: progress.questEntity.domainId,
    ownerType: progress.ownerType,
    ownerId: progress.ownerId,
    state: progress.state,
    startedAt: progress.startedAt,
    completedAt: progress.completedAt,
    version: progress.version,
    percentage: visibleEvaluation.percentage,
    ...(hasHiddenRequired ? { authoritativeStatusHidden: true } : { readyToComplete: evaluation.readyToComplete }),
    objectives: progress.objectives
      .filter((entry) => visibleObjectives.some((objective) => objective.objectiveId === entry.objectiveId))
      .map((entry) => {
        const definition = visibleObjectives.find((objective) => objective.objectiveId === entry.objectiveId);
        return {
          objectiveId: entry.objectiveId,
          text: progress.questEntity.questObjectives.find((objective) => objective.objectiveId === entry.objectiveId)?.text ?? 'Objetivo removido',
          value: entry.value,
          requiredQuantity: definition?.requiredQuantity ?? 1,
          optional: Boolean(definition?.optional),
          editable: Boolean(definition?.playerEditable) && !evaluation.objectives[entry.objectiveId]?.blocked
        };
      })
  };
}

const progressInclude = {
  questEntity: { include: { questObjectives: true } },
  objectives: true
};

export async function progressRoutes(app) {
  app.get('/api/v1/campaigns/:campaignId/progress', { preHandler: [authenticate, requireCampaign] }, async (request) => {
    const rows = await prisma.questProgress.findMany({
      where: { campaignId: request.campaign.id },
      include: progressInclude,
      orderBy: { startedAt: 'desc' }
    });
    const allowed = [];
    for (const row of rows) if (await canAccessProgress(request, row)) allowed.push(await serializeProgress(row, request));
    return allowed.filter(Boolean);
  });

  app.post('/api/v1/campaigns/:campaignId/progress', { preHandler: [authenticate, requireCampaign, requireGm, requireCsrf] }, async (request, reply) => {
    const parsed = startSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(apiError('INVALID_INPUT', 'Invalid progress owner', parsed.error.flatten()));
    const quest = await prisma.entity.findUnique({
      where: { campaignId_type_domainId: { campaignId: request.campaign.id, type: 'quest', domainId: parsed.data.questId } },
      include: { questObjectives: true }
    });
    if (!quest || quest.deletedAt) return reply.code(404).send(apiError('NOT_FOUND', 'Quest not found'));

    if (parsed.data.ownerType === 'player') {
      const user = await prisma.user.findUnique({ where: { login: parsed.data.ownerId } });
      const membership = user && (await prisma.membership.findUnique({ where: { campaignId_userId: { campaignId: request.campaign.id, userId: user.id } } }));
      if (!membership) return reply.code(400).send(apiError('INVALID_OWNER', 'Player is not a campaign member'));
    } else {
      const group = await prisma.group.findUnique({ where: { campaignId_domainId: { campaignId: request.campaign.id, domainId: parsed.data.ownerId } } });
      if (!group) return reply.code(400).send(apiError('INVALID_OWNER', 'Group does not exist in this campaign'));
    }

    const progress = await prisma.$transaction(async (tx) => {
      const saved = await tx.questProgress.upsert({
        where: { questEntityId_ownerType_ownerId: { questEntityId: quest.id, ownerType: parsed.data.ownerType, ownerId: parsed.data.ownerId } },
        create: { campaignId: request.campaign.id, questEntityId: quest.id, ownerType: parsed.data.ownerType, ownerId: parsed.data.ownerId },
        update: { state: 'active', completedAt: null, failedAt: null, version: { increment: 1 } }
      });
      for (const objective of quest.questObjectives) {
        await tx.questObjectiveProgress.upsert({
          where: { progressId_objectiveId: { progressId: saved.id, objectiveId: objective.objectiveId } },
          create: { progressId: saved.id, questObjectiveId: objective.id, objectiveId: objective.objectiveId, value: 0 },
          update: { questObjectiveId: objective.id, orphaned: false }
        });
      }
      await audit(tx, { campaignId: request.campaign.id, actorUserId: request.auth.user.id, action: 'quest.progress.start', entityType: 'quest', entityDomainId: quest.domainId, subjectType: parsed.data.ownerType, subjectId: parsed.data.ownerId, after: parsed.data });
      return tx.questProgress.findUnique({ where: { id: saved.id }, include: progressInclude });
    });
    request.server.realtime?.to(`campaign:${request.campaign.id}`).emit('progress.changed', { id: progress.id, questId: quest.domainId });
    return reply.code(201).send(await serializeProgress(progress, request));
  });

  app.patch('/api/v1/campaigns/:campaignId/progress/:progressId/objectives/:objectiveId', { preHandler: [authenticate, requireCampaign, requireCsrf] }, async (request, reply) => {
    const parsed = updateSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(apiError('INVALID_INPUT', 'Invalid objective progress', parsed.error.flatten()));
    const progress = await prisma.questProgress.findFirst({ where: { id: request.params.progressId, campaignId: request.campaign.id }, include: progressInclude });
    if (!progress || !(await canAccessProgress(request, progress))) return reply.code(404).send(apiError('NOT_FOUND', 'Progress not found'));
    const objective = progress.questEntity.questObjectives.find((item) => item.objectiveId === request.params.objectiveId);
    if (!objective) return reply.code(404).send(apiError('NOT_FOUND', 'Objective not found'));

    const gm = isGm(request);
    const visibleQuest = gm ? null : await getEntityForRequest({ request, type: 'quest', domainId: progress.questEntity.domainId });
    if (!gm && (!visibleQuest?.objectives.some(o => o.objectiveId === objective.objectiveId) || !objective.playerEditable)) {
      return reply.code(403).send(apiError('FORBIDDEN', 'This objective is not player-editable'));
    }

    const { evaluation } = evaluationFor(progress);
    if (!gm && evaluation.objectives[objective.objectiveId]?.blocked) {
      return reply.code(409).send(apiError('OBJECTIVE_BLOCKED', 'An earlier required objective must be completed first'));
    }
    if (parsed.data.version && parsed.data.version !== progress.version) {
      return reply.code(409).send(apiError('VERSION_CONFLICT', 'Progress was changed by another user'));
    }

    const updated = await prisma.$transaction(async (tx) => {
      const locked = await tx.questProgress.updateMany({ where: { id: progress.id, version: progress.version }, data: { version: { increment: 1 } } });
      if (locked.count !== 1) { const error = new Error('Progress was changed by another user'); error.code = 'VERSION_CONFLICT'; throw error; }
      const before = progress.objectives.find((entry) => entry.objectiveId === objective.objectiveId)?.value ?? 0;
      await tx.questObjectiveProgress.upsert({
        where: { progressId_objectiveId: { progressId: progress.id, objectiveId: objective.objectiveId } },
        create: { progressId: progress.id, questObjectiveId: objective.id, objectiveId: objective.objectiveId, value: parsed.data.value, updatedByUserId: request.auth.user.id },
        update: { value: parsed.data.value, questObjectiveId: objective.id, orphaned: false, updatedByUserId: request.auth.user.id }
      });
      const refreshed = await tx.questProgress.findUnique({ where: { id: progress.id }, include: progressInclude });
      const state = evaluationFor(refreshed).evaluation;
      if (state.readyToComplete && refreshed.state === 'active') {
        // readyToComplete is derived; completion remains an explicit GM action.
      }
      await audit(tx, { campaignId: request.campaign.id, actorUserId: request.auth.user.id, action: 'quest.progress.objective.update', entityType: 'quest', entityDomainId: progress.questEntity.domainId, targetKind: 'objective', targetKey: objective.objectiveId, subjectType: progress.ownerType, subjectId: progress.ownerId, before: { value: before }, after: { value: parsed.data.value } });
      return refreshed;
    });
    request.server.realtime?.to(`campaign:${request.campaign.id}`).emit('progress.changed', { id: updated.id, questId: updated.questEntity.domainId });
    return serializeProgress(updated, request);
  });

  app.post('/api/v1/campaigns/:campaignId/progress/:progressId/complete', { preHandler: [authenticate, requireCampaign, requireGm, requireCsrf] }, async (request, reply) => {
    const progress = await prisma.questProgress.findFirst({ where: { id: request.params.progressId, campaignId: request.campaign.id }, include: progressInclude });
    if (!progress) return reply.code(404).send(apiError('NOT_FOUND', 'Progress not found'));
    const state = evaluationFor(progress).evaluation;
    if (!state.readyToComplete) return reply.code(409).send(apiError('NOT_READY', 'Required objectives are incomplete'));
    const updated = await prisma.questProgress.update({ where: { id: progress.id }, data: { state: 'completed', completedAt: new Date(), version: { increment: 1 } }, include: progressInclude });
    request.server.realtime?.to(`campaign:${request.campaign.id}`).emit('progress.changed', { id: updated.id, questId: updated.questEntity.domainId });
    return serializeProgress(updated, request);
  });
}
