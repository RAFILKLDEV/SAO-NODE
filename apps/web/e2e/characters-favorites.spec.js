import { test, expect } from '@playwright/test';
import { normalizeEntity, toLegacyEntity } from '@sao/domain';

async function setup(page, role = 'player') {
  const state = { favorites: [], requests: [], writes: [] };
  const entities = [
    normalizeEntity('npc', { id: 'npc.a', name: 'Pessoa A', characterType: 'npc', tags: ['entidade'], identity: { race: 'Humano', gender: 'Outro', age: 30, profession: 'Guia' }, visibility: {} }),
    normalizeEntity('npc', { id: 'npc.b', name: 'Entidade B', characterType: 'entity', visibility: {} })
  ];
  const roster = [{ userId: 'user.player', name: 'Jogador C' }];
  await page.route('**/api/v1/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = decodeURIComponent(url.pathname);
    state.requests.push(`${req.method()} ${path}`);
    const json = (body, status = 200) => route.fulfill({ status, json: body });
    if (path.endsWith('/auth/me')) return json({ user: { id: 'viewer', name: 'Viewer' } });
    if (path.endsWith('/auth/csrf')) return json({ csrfToken: 'test' });
    if (path.endsWith('/campaigns/characters-test')) return json({ id: 'characters-test', name: 'Teste', role });
    if (path.endsWith('/characters/players')) return json(roster);
    if (path.endsWith('/character-favorites')) return json(state.favorites);
    if (path.includes('/character-favorites/')) {
      const [targetType, targetId] = path.split('/').slice(-2);
      state.favorites = state.favorites.filter((entry) => entry.targetType !== targetType || entry.targetId !== targetId);
      if (req.method() === 'PUT') state.favorites.push({ targetType, targetId });
      return json({ ok: true });
    }
    if (path.endsWith('/memberships') || path.endsWith('/viewers')) return json([]);
    if (path.endsWith('/npcs')) return json({ items: entities.map((entity) => ({ ...toLegacyEntity('npc', entity), version: 1 })) });
    const entity = entities.find((entity) => path.endsWith(`/npcs/${entity.id}`));
    if (entity) {
      if (req.method() === 'PUT') { state.writes.push(req.postDataJSON()); return json({ version: 2 }); }
      return json(url.searchParams.get('format') === '2'
        ? { schemaVersion: '2.0', data: entity, version: 1 }
        : { ...toLegacyEntity('npc', entity), version: 1 });
    }
    return json({ items: [] });
  });
  await page.goto('/campaigns/characters-test/npcs');
  await expect(page.getByRole('heading', { name: 'Pessoa A', exact: true })).toBeVisible();
  return state;
}

test('player lists NPC/entity/player, favorites all three and never requests a player as an NPC', async ({ page }) => {
  const state = await setup(page);
  const list = page.locator('aside.entity-list');
  await expect(list.getByRole('button', { name: /Pessoa A/ })).toBeVisible();
  await page.getByRole('button', { name: '☆ Favoritar', exact: true }).click();
  await expect(page.getByRole('button', { name: '★ Desfavoritar' })).toBeEnabled();
  await page.getByRole('button', { name: 'Entidades', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Entidade B', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '☆ Favoritar', exact: true }).click();
  await expect(page.getByRole('button', { name: '★ Desfavoritar' })).toBeEnabled();
  await page.getByRole('button', { name: 'Jogadores', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Jogador C', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '☆ Favoritar', exact: true }).click();
  await expect(page.getByRole('button', { name: '★ Desfavoritar' })).toBeEnabled();
  await page.getByRole('button', { name: 'Favoritos', exact: true }).click();
  for (const name of ['Pessoa A', 'Entidade B', 'Jogador C']) await expect(list.getByRole('button', { name: new RegExp(name) })).toBeVisible();
  await list.getByRole('button', { name: /Jogador C/ }).click();
  await page.getByRole('button', { name: '★ Desfavoritar' }).click();
  await expect(list.getByRole('button', { name: /Jogador C/ })).toHaveCount(0);
  expect(state.requests.filter((request) => request.includes('/npcs/player:'))).toEqual([]);
  expect(state.requests.some((request) => request.endsWith('/memberships'))).toBe(false);
  expect(state.requests).toContain('PUT /api/v1/campaigns/characters-test/character-favorites/player/user.player');
  expect(state.favorites).toEqual([{ targetType: 'npc', targetId: 'npc.a' }, { targetType: 'npc', targetId: 'npc.b' }]);
});

test('editor has one identity section and saves explicit characterType without losing identity', async ({ page }) => {
  const state = await setup(page, 'gm');
  await page.getByRole('button', { name: 'Editar', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Tipo de personagem')).toHaveValue('npc');
  await expect(dialog.getByLabel('Raça', { exact: true })).toHaveCount(0);
  await expect(dialog.getByLabel('Título', { exact: true })).toHaveCount(0);
  await expect(dialog.getByRole('tab', { name: 'T20', exact: true })).toHaveCount(0);
  await dialog.getByLabel('Tipo de personagem').selectOption('entity');
  await dialog.getByRole('tab', { name: 'Identidade', exact: true }).click();
  await expect(dialog.getByLabel('Raça', { exact: true })).toHaveValue('Humano');
  await expect(dialog.getByLabel('Profissão', { exact: true })).toHaveValue('Guia');
  await dialog.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(state.writes[0]).toMatchObject({ id: 'npc.a', characterType: 'entity', identity: { race: 'Humano', profession: 'Guia' } });
});
