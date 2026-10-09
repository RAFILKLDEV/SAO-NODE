import { test, expect } from '@playwright/test';

const campaignId = 'groups-ui-test';
const players = [{ user: { id: 'player-ana', name: 'Ana' }, role: 'player' }, { user: { id: 'player-beto', name: 'Beto' }, role: 'player' }];
const characters = [{ id: 'npc.miller', name: 'Moleiro', characterType: 'npc' }, { id: 'npc.hero', name: 'Herói', characterType: 'player' }];

async function setup(page, role = 'gm') {
  const groups = [{ id: 'group.explorers', name: 'Exploradores', members: [{ id: 'player-ana', name: 'Ana' }], characters: [] }, { id: 'group.scouts', name: 'Batedores', members: [], characters: [] }];
  const writes = [], searches = [];
  await page.route('**/api/v1/**', async route => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname;
    const json = (body, status = 200) => route.fulfill({ json: body, status });
    if (path.endsWith('/auth/me')) return json({ id: role === 'gm' ? 'gm-test' : 'player-ana', name: role === 'gm' ? 'Mestre' : 'Ana' });
    if (path.endsWith('/auth/csrf')) return json({ csrfToken: 'test' });
    if (path.endsWith(`/campaigns/${campaignId}`)) return json({ id: campaignId, name: 'Teste de grupos', role });
    if (path.endsWith('/memberships')) return json(players);
    if (path.endsWith('/npcs')) {
      const search = url.searchParams.get('search') ?? ''; searches.push(search);
      return json({ items: characters.filter(character => character.name.toLocaleLowerCase('pt-BR').includes(search.toLocaleLowerCase('pt-BR'))) });
    }
    if (req.method() !== 'GET') writes.push({ path, method: req.method(), body: req.postDataJSON() });
    if (path.endsWith('/groups')) {
      if (req.method() === 'GET') return json(groups);
      const body = req.postDataJSON(); const created = { id: body.domainId, name: body.name, members: [], characters: [] };
      groups.push(created); return json(created, 201);
    }
    const match = path.match(/\/groups\/([^/]+)\/(members|characters)(?:\/([^/]+))?$/);
    if (match) {
      const group = groups.find(group => group.id === decodeURIComponent(match[1]));
      if (req.method() === 'POST') {
        const body = req.postDataJSON();
        const member = match[2] === 'members' ? players.find(entry => entry.user.id === body.userId)?.user : characters.find(entry => entry.id === body.characterId);
        if (!group[match[2]].some(entry => entry.id === member.id)) group[match[2]].push(member);
        return json({ ok: true });
      }
      group[match[2]] = group[match[2]].filter(member => member.id !== decodeURIComponent(match[3]));
      return route.fulfill({ status: 204 });
    }
    return json({ items: [] });
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/campaigns/${campaignId}/groups`);
  await expect(page.getByRole('heading', { name: 'Grupos', exact: true })).toBeVisible();
  await expect(page.getByRole('article', { name: 'Grupo Exploradores' })).toBeVisible();
  return { groups, writes, searches };
}

test('grupos permitem jogadores e personagens com controles compactos e busca', async ({ page }) => {
  const state = await setup(page);
  const group = page.getByRole('article', { name: 'Grupo Exploradores' });
  await expect(group.getByLabel('Tipo', { exact: true })).toHaveCount(0);
  await expect(group.getByRole('button', { name: /Remover/ })).toHaveCount(0);
  expect((await group.boundingBox()).height).toBeLessThan(160);
  await group.getByRole('button', { name: 'Editar integrantes de Exploradores' }).click();
  await group.getByLabel('Jogador', { exact: true }).selectOption('player-beto');
  await group.getByRole('button', { name: 'Adicionar', exact: true }).click();
  await expect(group.locator('.group-members')).toContainText('Beto');
  await expect(group.getByLabel('Jogador', { exact: true }).locator('option[value="player-beto"]')).toHaveCount(0);
  await group.getByLabel('Tipo', { exact: true }).selectOption('character');
  await group.getByLabel('Buscar personagem').fill('Mole');
  await expect.poll(() => state.searches.includes('Mole')).toBe(true);
  await expect(group.getByLabel('Personagem', { exact: true }).locator('option')).toHaveCount(2);
  await group.getByLabel('Personagem', { exact: true }).selectOption('npc.miller');
  await group.getByRole('button', { name: 'Adicionar', exact: true }).click();
  await expect(group.locator('.group-members')).toContainText('Moleiro');
  await expect(group.getByLabel('Personagem', { exact: true }).locator('option[value="npc.miller"]')).toHaveCount(0);
  await group.getByLabel('Buscar personagem').fill('Herói');
  await expect(group.getByLabel('Personagem', { exact: true }).locator('option[value="npc.hero"]')).toHaveCount(1);
  await group.getByLabel('Personagem', { exact: true }).selectOption('npc.hero');
  await group.getByRole('button', { name: 'Adicionar', exact: true }).click();
  await expect(group).toContainText('4 integrantes');
  if (process.env.MAP_UI_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.MAP_UI_SCREENSHOT_DIR}/groups-edit-desktop.png`, fullPage: true });
  await group.getByRole('button', { name: 'Remover Moleiro do grupo Exploradores' }).click();
  await expect(group.locator('.group-members')).not.toContainText('Moleiro');
  await group.getByRole('button', { name: 'Remover Beto do grupo Exploradores' }).click();
  await expect(group.locator('.group-members')).not.toContainText('Beto');
  await group.getByRole('button', { name: 'Editar integrantes de Exploradores' }).click();
  await expect(group.getByLabel('Tipo', { exact: true })).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await group.getByRole('button', { name: 'Editar integrantes de Exploradores' }).click();
  const bounds = await group.boundingBox(); expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  if (process.env.MAP_UI_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.MAP_UI_SCREENSHOT_DIR}/groups-edit-mobile.png`, fullPage: true });
  expect(state.writes).toEqual([
    { method: 'POST', path: `/api/v1/campaigns/${campaignId}/groups/group.explorers/members`, body: { userId: 'player-beto' } },
    { method: 'POST', path: `/api/v1/campaigns/${campaignId}/groups/group.explorers/characters`, body: { characterId: 'npc.miller' } },
    { method: 'POST', path: `/api/v1/campaigns/${campaignId}/groups/group.explorers/characters`, body: { characterId: 'npc.hero' } },
    { method: 'DELETE', path: `/api/v1/campaigns/${campaignId}/groups/group.explorers/characters/npc.miller`, body: null },
    { method: 'DELETE', path: `/api/v1/campaigns/${campaignId}/groups/group.explorers/members/player-beto`, body: null }
  ]);
});

test('novo grupo abre um formulário pequeno e cancelar não salva', async ({ page }) => {
  const state = await setup(page);
  await expect(page.getByLabel('Nome do grupo')).toHaveCount(0);
  await page.getByRole('button', { name: 'Novo grupo', exact: true }).click();
  await page.getByLabel('Nome do grupo').fill('Três amigos');
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
  expect(state.writes).toEqual([]);
  await page.getByRole('button', { name: 'Novo grupo', exact: true }).click();
  await page.getByRole('button', { name: 'Criar', exact: true }).click();
  await expect(page.getByRole('article', { name: 'Grupo Três amigos' })).toBeVisible();
  await expect(page.getByLabel('Nome do grupo')).toHaveCount(0);
  expect(state.writes[0].body).toEqual({ domainId: 'group.tres-amigos', name: 'Três amigos' });
});

test('jogador consulta integrantes sem controles de edição', async ({ page }) => {
  const state = await setup(page, 'player');
  state.groups[0].characters.push(characters[0]);
  await page.reload();
  const group = page.getByRole('article', { name: 'Grupo Exploradores' });
  await expect(group).toContainText('Ana'); await expect(group).toContainText('Moleiro');
  await expect(page.getByRole('button', { name: /Novo grupo|Editar integrantes|Remover/ })).toHaveCount(0);
  await expect(group.locator('select, input')).toHaveCount(0);
  expect(state.writes).toEqual([]);
});
