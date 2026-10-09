import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import { buildApp } from '../src/app.js';
import { hashToken } from '../src/lib/security.js';
import { createEntity } from '../src/services/content.js';
import { enablePlayerQuestUpdates } from '../../../scripts/enable-player-quest-updates.mjs';

describe.runIf(Boolean(process.env.TEST_DATABASE_URL))('player quest progress with PostgreSQL', () => {
  let app, campaign, otherCampaign, gm, ana, beto, own, foreign, shared;
  const users = [];
  const call = (method, path, payload, actor = ana, campaignId = campaign.id) => app.inject({ method, url: `/api/v1/campaigns/${campaignId}/progress${path}`, headers: { cookie: `sao_session=${actor.token}`, 'x-csrf-token': actor.csrf }, ...(payload === undefined ? {} : { payload }) });
  const update = async (progress, objectiveId, value, actor = ana, version = progress.version) => call('PATCH', `/${progress.id}/objectives/${objectiveId}`, { value, version }, actor);
  beforeAll(async () => {
    app = await buildApp();
    campaign = await prisma.campaign.create({ data: { slug: `progress-${randomUUID()}`, name: 'Progresso de teste' } });
    for (const [name, role] of [['Mestre', 'owner'], ['Ana', 'player'], ['Beto', 'player']]) {
      const user = await prisma.user.create({ data: { login: `progress-${randomUUID()}`, name, passwordHash: 'unused' } });
      const csrf = randomUUID(), token = randomUUID();
      await prisma.session.create({ data: { userId: user.id, csrfToken: csrf, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + 3600000) } });
      await prisma.membership.create({ data: { campaignId: campaign.id, userId: user.id, role } });
      users.push({ ...user, csrf, token });
    }
    [gm, ana, beto] = users;
    await createEntity({ campaignId: campaign.id, type: 'quest', actorUserId: gm.id, input: {
      id: 'quest.progress-test', name: 'Caçada', visibility: { entity: 'public', sections: { objectives: 'public' } },
      objectives: [
        { objectiveId: 'hunt', text: 'Derrote javalis', type: 'kill', requiredQuantity: 5, order: 1, visibility: 'public', playerEditable: true },
        { objectiveId: 'report', text: 'Relate a caçada', type: 'talk', requiredQuantity: 2, order: 2, dependsOn: ['hunt'], visibility: 'public', playerEditable: true },
        { objectiveId: 'gm', text: 'Decisão do mestre', type: 'talk', order: 3, visibility: 'public', playerEditable: false },
        { objectiveId: 'secret', text: 'Objetivo secreto', type: 'talk', order: 4, optional: true, secret: true, visibility: 'gm', playerEditable: true },
        { objectiveId: 'default', text: 'Objetivo novo', type: 'talk', order: 5, optional: true, visibility: 'public' }
      ]
    } });
    await prisma.group.create({ data: { campaignId: campaign.id, domainId: 'group.hunters', name: 'Caçadores', members: { create: { userId: ana.id } } } });
    const start = async (ownerType, ownerId) => {
      const response = await call('POST', '', { questId: 'quest.progress-test', ownerType, ownerId }, gm);
      expect(response.statusCode, response.body).toBe(201); return response.json();
    };
    own = await start('player', ana.login); foreign = await start('player', beto.login); shared = await start('group', 'group.hunters');
    otherCampaign = await prisma.campaign.create({ data: { slug: `progress-other-${randomUUID()}`, name: 'Outra campanha' } });
    await createEntity({ campaignId: otherCampaign.id, type: 'quest', actorUserId: gm.id, input: { id: 'quest.progress-test', name: 'Outra missão', objectives: [{ objectiveId: 'legacy', type: 'talk', order: 1, playerEditable: false }] } });
  });
  afterAll(async () => {
    await app?.close();
    if (campaign) await prisma.campaign.delete({ where: { id: campaign.id } });
    if (otherCampaign) await prisma.campaign.delete({ where: { id: otherCampaign.id } });
    for (const user of users) await prisma.user.delete({ where: { id: user.id } });
    await prisma.$disconnect();
  });
  it('lists only owned/group missions, exposes permitted inputs and hides secret objectives', async () => {
    const response = await call('GET', ''); expect(response.statusCode).toBe(200);
    const rows = response.json(); expect(rows.map(row => row.id).sort()).toEqual([own.id, shared.id].sort());
    const objectives = rows.find(row => row.id === own.id).objectives;
    expect(objectives.find(row => row.objectiveId === 'hunt').editable).toBe(true);
    expect(objectives.find(row => row.objectiveId === 'report').editable).toBe(false);
    expect(objectives.find(row => row.objectiveId === 'gm').editable).toBe(true);
    expect(objectives.find(row => row.objectiveId === 'default').editable).toBe(true);
    expect(objectives.some(row => row.objectiveId === 'secret')).toBe(false);
    const players = await call('GET', '/players'); expect(players.json().map(row => row.id)).toEqual([ana.id]);
  });
  it('lets a player save and decrease their own objective with optimistic version checks', async () => {
    let response = await update(own, 'hunt', 3); expect(response.statusCode, response.body).toBe(200); own = response.json();
    expect(own.objectives.find(row => row.objectiveId === 'hunt').value).toBe(3);
    expect(own.version).toBe(2);
    response = await update(own, 'hunt', 1); expect(response.statusCode, response.body).toBe(200); own = response.json();
    const stored = await prisma.questObjectiveProgress.findUnique({ where: { progressId_objectiveId: { progressId: own.id, objectiveId: 'hunt' } } });
    expect(stored).toMatchObject({ value: 1, updatedByUserId: ana.id });
  });
  it('lets assigned players update legacy objectives with playerEditable=false', async () => {
    const response = await update(own, 'gm', 1); expect(response.statusCode, response.body).toBe(200); own = response.json();
    expect(own.objectives.find(row => row.objectiveId === 'gm')).toMatchObject({ value: 1, editable: true });
  });
  it('rejects other players missions and hidden objectives', async () => {
    expect((await update(foreign, 'hunt', 1)).statusCode).toBe(404);
    expect((await update(own, 'secret', 1)).statusCode).toBe(403);
    const values = await prisma.questObjectiveProgress.findMany({ where: { progressId: foreign.id } });
    expect(values.every(row => row.value === 0)).toBe(true);
  });
  it('enforces dependencies, quantity limits and stale versions without overwriting values', async () => {
    let response = await update(own, 'report', 1); expect(response.statusCode).toBe(409); expect(response.json().error.code).toBe('OBJECTIVE_BLOCKED');
    expect((await update(own, 'hunt', 6)).statusCode).toBe(400);
    response = await update(own, 'hunt', 0, ana, 1); expect(response.statusCode).toBe(409); expect(response.json().error.code).toBe('VERSION_CONFLICT');
    response = await update(own, 'hunt', 5); expect(response.statusCode, response.body).toBe(200); own = response.json();
    expect(own.objectives.find(row => row.objectiveId === 'report').editable).toBe(true);
    response = await update(own, 'report', 1); expect(response.statusCode, response.body).toBe(200); own = response.json();
  });
  it('allows group members to update shared missions and rejects non-members', async () => {
    expect((await update(shared, 'hunt', 1, beto)).statusCode).toBe(404);
    const response = await update(shared, 'hunt', 2); expect(response.statusCode, response.body).toBe(200); shared = response.json();
    expect(shared.objectives.find(row => row.objectiveId === 'hunt').value).toBe(2);
  });
  it('prevents players from completing missions or changing closed progress', async () => {
    expect((await call('POST', `/${own.id}/complete`, {})).statusCode).toBe(403);
    await prisma.questProgress.update({ where: { id: own.id }, data: { state: 'completed' } });
    const response = await update(own, 'hunt', 2); expect(response.statusCode).toBe(409); expect(response.json().error.code).toBe('PROGRESS_CLOSED');
    const entries = (await call('GET', '')).json();
    expect(entries.find(entry => entry.id === own.id).objectives.every(objective => !objective.editable)).toBe(true);
  });
  it('enables stored flags atomically within a campaign, preserving IDs and progress, and can run twice', async () => {
    const progressBefore = await prisma.questObjectiveProgress.findMany({ where: { progress: { campaignId: campaign.id } }, orderBy: { id: 'asc' } });
    const questBefore = await prisma.entity.findUnique({ where: { campaignId_type_domainId: { campaignId: campaign.id, type: 'quest', domainId: 'quest.progress-test' } }, include: { questObjectives: true } });
    const result = await enablePlayerQuestUpdates({ campaignId: campaign.id, actorUserId: gm.id });
    expect(result).toEqual({ missions: 1, objectives: 1 });
    const questAfter = await prisma.entity.findUnique({ where: { id: questBefore.id }, include: { questObjectives: true } });
    expect(questAfter.version).toBe(questBefore.version + 1);
    expect(questAfter.questObjectives.every(objective => objective.playerEditable)).toBe(true);
    expect(questAfter.questObjectives.map(objective => objective.id).sort()).toEqual(questBefore.questObjectives.map(objective => objective.id).sort());
    expect(await prisma.questObjectiveProgress.findMany({ where: { progress: { campaignId: campaign.id } }, orderBy: { id: 'asc' } })).toEqual(progressBefore);
    expect(await prisma.questObjective.count({ where: { entity: { campaignId: otherCampaign.id }, playerEditable: false } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { campaignId: campaign.id, action: 'quest.objectives.player-editable.enable', resultVersion: questAfter.version } })).toBe(1);
    expect(await enablePlayerQuestUpdates({ campaignId: campaign.id, actorUserId: gm.id })).toEqual({ missions: 0, objectives: 0 });
  });
  it('does not let an assigned player use a different campaign or bypass required campaign scope', async () => {
    const response = await call('PATCH', `/${shared.id}/objectives/hunt`, { value: 1 }, ana, otherCampaign.id);
    expect(response.statusCode).toBe(404);
    await expect(enablePlayerQuestUpdates({ actorUserId: gm.id })).rejects.toThrow('Campaign and actor');
  });
});
