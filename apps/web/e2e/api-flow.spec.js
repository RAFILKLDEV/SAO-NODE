import { test, expect, request as playwrightRequest } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { PrismaClient } from '@prisma/client';

const apiBase = process.env.E2E_API_URL ?? 'http://127.0.0.1:3001';
const createdCampaigns = [];
test.afterAll(async () => {
  if (!process.env.E2E_DATABASE_URL || !createdCampaigns.length) return;
  const prisma = new PrismaClient({ datasourceUrl: process.env.E2E_DATABASE_URL });
  try { await prisma.campaign.deleteMany({ where: { id: { in: createdCampaigns } } }); }
  finally { await prisma.$disconnect(); }
});

async function login(context, login, password) {
  const response = await context.post(`${apiBase}/api/v1/auth/login`, { data: { login, password } });
  expect(response.ok()).toBeTruthy();
  return (await response.json()).csrfToken;
}

test('GM/player JSON v2, discovery, progress and editor flow', async ({ page }) => {
  const gm = await playwrightRequest.newContext();
  const player = await playwrightRequest.newContext();
  const gmCsrf = await login(gm, 'gm', 'gm123');
  const playerCsrf = await login(player, 'player', 'player123');

  const campaigns = await (await gm.get(`${apiBase}/api/v1/campaigns`)).json();
  const demo = campaigns.find((campaign) => campaign.slug === 'aincrad-demo');
  const demoMembers = await (await gm.get(`${apiBase}/api/v1/campaigns/${demo.id}/memberships`)).json();
  const playerUser = demoMembers.find((membership) => membership.user.login === 'player').user;

  const slug = `e2e-${Date.now()}`;
  const created = await gm.post(`${apiBase}/api/v1/campaigns`, {
    headers: { 'x-csrf-token': gmCsrf },
    data: { slug, name: 'E2E Campaign' }
  });
  expect(created.status()).toBe(201);
  const campaign = await created.json();
  createdCampaigns.push(campaign.id);

  await gm.put(`${apiBase}/api/v1/campaigns/${campaign.id}/memberships`, {
    headers: { 'x-csrf-token': gmCsrf },
    data: { userId: playerUser.id, role: 'player' }
  });

  const sample = JSON.parse(await readFile(new URL('../../../examples/floor01.v2.sample.json', import.meta.url), 'utf8'));
  const previewResponse = await gm.post(`${apiBase}/api/v1/campaigns/${campaign.id}/import/preview`, {
    headers: { 'x-csrf-token': gmCsrf },
    data: sample
  });
  expect(previewResponse.ok()).toBeTruthy();
  const preview = await previewResponse.json();
  expect(preview.diff.every((entry) => entry.status === 'NEW')).toBeTruthy();

  const apply = await gm.post(`${apiBase}/api/v1/campaigns/${campaign.id}/import/apply`, {
    headers: { 'x-csrf-token': gmCsrf },
    data: { previewId: preview.previewId, selectedKeys: preview.diff.map((entry) => entry.key) }
  });
  expect(apply.ok()).toBeTruthy();

  const questsForPlayer = await (await player.get(`${apiBase}/api/v1/campaigns/${campaign.id}/quests`)).json();
  const quest = questsForPlayer.items.find((item) => item.id === 'quest.f1.greenfields.boars');
  expect(quest).toBeTruthy();
  expect(quest.fields.some((field) => field.key === 'description')).toBe(false);

  const grantField = await gm.put(`${apiBase}/api/v1/campaigns/${campaign.id}/discoveries`, {
    headers: { 'x-csrf-token': gmCsrf },
    data: {
      subjectType: 'user', subjectId: playerUser.id, entityType: 'quest', entityId: 'quest.f1.greenfields.boars',
      targetKind: 'field', targetKey: 'description', allowance: 'allow'
    }
  });
  expect(grantField.ok()).toBeTruthy();

  const questAfterReveal = await (await player.get(`${apiBase}/api/v1/campaigns/${campaign.id}/quests/quest.f1.greenfields.boars`)).json();
  expect(questAfterReveal.fields.some((field) => field.key === 'description')).toBe(true);

  const secretNpc = await gm.post(`${apiBase}/api/v1/campaigns/${campaign.id}/npcs`, {
    headers: { 'x-csrf-token': gmCsrf },
    data: { id: 'npc.f1.e2e.hidden', name: 'NPC Oculto', active: true, baseVisibility: 'discoverable', tags: [], fields: [{ key: 'note', value: 'revelado', visibility: 'discoverable' }], references: [], factions: [], services: [] }
  });
  expect(secretNpc.status()).toBe(201);
  expect((await (await player.get(`${apiBase}/api/v1/campaigns/${campaign.id}/npcs`)).json()).items.some((item) => item.id === 'npc.f1.e2e.hidden')).toBe(false);

  await gm.put(`${apiBase}/api/v1/campaigns/${campaign.id}/discoveries`, {
    headers: { 'x-csrf-token': gmCsrf },
    data: { subjectType: 'user', subjectId: playerUser.id, entityType: 'npc', entityId: 'npc.f1.e2e.hidden', targetKind: 'entity', targetKey: 'existence', allowance: 'allow' }
  });
  await gm.put(`${apiBase}/api/v1/campaigns/${campaign.id}/discoveries`, {
    headers: { 'x-csrf-token': gmCsrf },
    data: { subjectType: 'user', subjectId: playerUser.id, entityType: 'npc', entityId: 'npc.f1.e2e.hidden', targetKind: 'field', targetKey: 'note', allowance: 'allow' }
  });
  const revealedNpc = await (await player.get(`${apiBase}/api/v1/campaigns/${campaign.id}/npcs/npc.f1.e2e.hidden`)).json();
  expect(revealedNpc.name).toBe('NPC Oculto');
  expect(revealedNpc.fields[0].value).toBe('revelado');

  const started = await gm.post(`${apiBase}/api/v1/campaigns/${campaign.id}/progress`, {
    headers: { 'x-csrf-token': gmCsrf },
    data: { questId: 'quest.f1.greenfields.boars', ownerType: 'player', ownerId: 'player' }
  });
  expect(started.status()).toBe(201);
  const progress = await started.json();

  const playerUpdate = await player.patch(`${apiBase}/api/v1/campaigns/${campaign.id}/progress/${progress.id}/objectives/talk-ragnar`, {
    headers: { 'x-csrf-token': playerCsrf },
    data: { value: 1, version: progress.version }
  });
  expect(playerUpdate.ok()).toBeTruthy();

  const exportResponse = await gm.get(`${apiBase}/api/v1/campaigns/${campaign.id}/export.json`);
  expect(exportResponse.ok()).toBeTruthy();
  const exported = await exportResponse.json();
  expect(exported.schemaVersion).toBe('2.0');
  expect((await (await gm.get(`${apiBase}/api/v1/campaigns/${campaign.id}/export.json?format=1`)).json()).schemaVersion).toBe('1.0');
  const roundTrip = await gm.post(`${apiBase}/api/v1/campaigns/${campaign.id}/import/preview`, { headers: { 'x-csrf-token': gmCsrf }, data: exported });
  expect((await roundTrip.json()).diff.every(entry => entry.status === 'EQUAL')).toBe(true);

  const rePreviewResponse = await gm.post(`${apiBase}/api/v1/campaigns/${campaign.id}/import/preview`, {
    headers: { 'x-csrf-token': gmCsrf },
    data: sample
  });
  const rePreview = await rePreviewResponse.json();
  const questEntry = rePreview.diff.find((entry) => entry.key === 'quest:quest.f1.greenfields.boars');
  const reApply = await gm.post(`${apiBase}/api/v1/campaigns/${campaign.id}/import/apply`, {
    headers: { 'x-csrf-token': gmCsrf },
    data: { previewId: rePreview.previewId, selectedKeys: [questEntry.key] }
  });
  expect(reApply.ok()).toBeTruthy();

  const playerProgress = await (await player.get(`${apiBase}/api/v1/campaigns/${campaign.id}/progress`)).json();
  expect(playerProgress[0].objectives.find((objective) => objective.objectiveId === 'talk-ragnar').value).toBe(1);
  const preservedReveal = await (await player.get(`${apiBase}/api/v1/campaigns/${campaign.id}/quests/quest.f1.greenfields.boars`)).json();
  expect(preservedReveal.fields.some((field) => field.key === 'description')).toBe(true);

  await page.goto('/login');
  await page.getByLabel('Login', { exact: true }).fill('gm');
  await page.getByLabel('Senha', { exact: true }).fill('gm123');
  await page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Escolha uma campanha' })).toBeVisible();
  await page.getByRole('link', { name: 'E2E Campaign', exact: true }).click();
  await page.goto(`/campaigns/${campaign.id}/quests?selected=quest.f1.greenfields.boars`);
  await page.getByRole('button', { name: 'Editar', exact: true }).click();
  const editor = page.getByRole('dialog');
  await editor.getByLabel('Nome', { exact: true }).fill('Caçada revisada no editor');
  const savedRequest = page.waitForRequest(request => request.method() === 'PUT' && request.url().includes('/quests/quest.f1.greenfields.boars'));
  await editor.getByRole('button', { name: 'Salvar', exact: true }).click();
  const payload = (await savedRequest).postDataJSON();
  expect(payload).toHaveProperty('visibility');
  expect(payload).toHaveProperty('links');
  expect(payload).not.toHaveProperty('references');
  expect(payload.rewards.map(reward => reward.rewardId)).toEqual(exported.entities.find(entry => entry.type === 'quest').data.rewards.map(reward => reward.rewardId));
  await expect(editor).toBeHidden();
  const afterEditor = await (await gm.get(`${apiBase}/api/v1/campaigns/${campaign.id}/quests/quest.f1.greenfields.boars?format=2`)).json();
  expect(afterEditor.data.name).toBe('Caçada revisada no editor');
  expect(afterEditor.data.rewards).toEqual(exported.entities.find(entry => entry.type === 'quest').data.rewards);

  await gm.dispose();
  await player.dispose();
});
