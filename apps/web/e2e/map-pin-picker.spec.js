import { test, expect } from '@playwright/test';

const candidates = [
  { type: 'location', id: 'loc.region', name: 'Planícies verdejantes', pinType: 'region', locationType: 'region' },
  { type: 'location', id: 'loc.grove', name: 'Bosque do Peregrino', regionName: 'Planícies verdejantes' },
  { type: 'location', id: 'loc.farm', name: 'Fazenda Abelha Real', regionName: 'Planícies verdejantes' },
  { type: 'npc', id: 'npc.player', name: 'Ana', characterType: 'player' },
  { type: 'npc', id: 'npc.entity', name: 'Zara', characterType: 'entity' },
  { type: 'npc', id: 'npc.vendor', name: 'Bia', characterType: 'npc' },
  { type: 'item', id: 'item.meat', name: 'Carne', category: 'material' },
  { type: 'item', id: 'item.sword', name: 'Espada', category: 'weapon', pinned: true },
  { type: 'monster', id: 'monster.boss', name: 'Rei', rank: 'boss' },
  { type: 'monster', id: 'monster.common', name: 'Lobo', rank: 'common' },
  { type: 'monster', id: 'monster.elite', name: 'Guardião', rank: 'elite' },
  { type: 'quest', id: 'quest.side', name: 'Colheita', questType: 'side' },
  { type: 'quest', id: 'quest.main', name: 'A jornada', questType: 'main' }
];

async function setup(page) {
  const writes = [];
  const board = { id: 'board-test', name: 'Mapa dos filtros', imageUrl: 'https://map.test/image.svg', version: 1, regions: [], pins: [], routes: [], distances: [] };
  await page.route('https://map.test/**', (route) => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="600"><rect width="1200" height="600" fill="#224c68"/></svg>' }));
  await page.route('**/api/v1/**', async (route) => {
    const req = route.request(); const path = new URL(req.url()).pathname;
    const json = (body, status = 200) => route.fulfill({ json: body, status });
    if (path.endsWith('/auth/me')) return json({ id: 'gm-test', name: 'Mestre' });
    if (path.endsWith('/auth/csrf')) return json({ csrfToken: 'test' });
    if (path.endsWith('/campaigns/pin-filter-test')) return json({ id: 'pin-filter-test', name: 'Teste', role: 'gm' });
    if (path.endsWith('/map/board')) return json(board);
    if (path.endsWith('/map/pin-candidates')) return json({ items: candidates.map((candidate) => ({ ...candidate, pinned: candidate.pinned || board.pins.some((pin) => pin.entityType === candidate.type && pin.entityId === candidate.id) })) });
    if (path.endsWith('/map/pins') && req.method() === 'POST') {
      const input = req.postDataJSON(); writes.push(input);
      const entity = candidates.find((candidate) => candidate.type === input.entityType && candidate.id === input.entityId);
      board.pins.push({ ...entity, ...input, id: `pin-${writes.length}`, name: entity.name, version: 1 });
      return json(board, 201);
    }
    return json({ items: [] });
  });
  await page.goto('/campaigns/pin-filter-test/map');
  await page.getByRole('button', { name: 'Modo de edição', exact: true }).click();
  await page.getByRole('button', { name: /Adicionar pin/ }).click();
  await expect(page.getByRole('button', { name: /Entidade existente/ })).toBeEnabled();
  return writes;
}

const typeButton = (page) => page.getByRole('button', { name: /Tipo de entidade/ });
const entityButton = (page) => page.getByRole('button', { name: /Entidade existente/ });
async function chooseType(page, label) {
  await typeButton(page).click();
  await page.getByRole('menuitemradio', { name: label, exact: true }).click();
  return page.getByRole('dialog', { name: `Selecionar ${label.toLocaleLowerCase('pt-BR')}` });
}

test('menus separados mostram região, categoria, classificação e tipos de missão', async ({ page }) => {
  await setup(page);
  await expect(page.getByLabel('Tipo do pin')).toHaveValue('entity');
  await expect(page.locator('.image-map-pin-tools select')).toHaveCount(1);
  await entityButton(page).click();
  const locals = page.getByRole('dialog', { name: 'Selecionar locais' });
  await expect(locals.getByRole('button', { name: 'Planícies verdejantes — Bosque do Peregrino' })).toBeVisible();
  await expect(locals.getByRole('button', { name: 'Planícies verdejantes — Fazenda Abelha Real' })).toBeVisible();
  const characters = await chooseType(page, 'Personagens');
  await expect(characters.locator('[data-picker-option]')).toHaveText(['Entidade — Zara', 'NPC — Bia', 'Jogador — Ana']);
  const items = await chooseType(page, 'Itens');
  await expect(items.getByRole('button', { name: 'Material — Carne' })).toBeVisible();
  await expect(items.getByRole('button', { name: 'Arma — Espada' })).toHaveCount(0);
  const monsters = await chooseType(page, 'Monstros');
  await expect(monsters.locator('[data-picker-option]')).toHaveText(['Comum — Lobo', 'Elite — Guardião', 'Boss — Rei']);
  const quests = await chooseType(page, 'Missões');
  await expect(quests.locator('[data-picker-option]')).toHaveText(['Principal — A jornada', 'Secundária — Colheita']);
});

test('busca, teclado e troca de tipo preservam a seleção e enviam somente o pin escolhido', async ({ page }) => {
  const writes = await setup(page);
  await typeButton(page).focus(); await page.keyboard.press('ArrowDown');
  await expect(page.getByRole('menuitemradio', { name: 'Locais', exact: true })).toBeFocused();
  await page.keyboard.press('Escape'); await expect(typeButton(page)).toBeFocused();
  await entityButton(page).click();
  await page.getByRole('searchbox', { name: 'Buscar locais' }).fill('planicies bosque');
  await expect(page.getByRole('dialog').locator('[data-picker-option]')).toHaveCount(0);
  await page.getByRole('searchbox', { name: 'Buscar locais' }).fill('bosque');
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(entityButton(page)).toContainText('Planícies verdejantes — Bosque do Peregrino');
  await chooseType(page, 'Itens');
  await page.keyboard.press('Escape');
  await expect(entityButton(page)).toContainText('Selecionar itens');
  const image = page.getByAltText('Mapa dos filtros'); const bounds = await image.boundingBox();
  await image.click({ position: { x: bounds.width / 2, y: bounds.height / 2 } });
  expect(writes).toEqual([]);
  await entityButton(page).click(); await page.getByRole('searchbox', { name: 'Buscar itens' }).fill('material');
  await page.getByRole('button', { name: 'Material — Carne', exact: true }).click();
  await image.click({ position: { x: bounds.width / 2, y: bounds.height / 2 } });
  await expect.poll(() => writes.length).toBe(1);
  expect(writes[0]).toMatchObject({ entityType: 'item', entityId: 'item.meat' });
  await expect(page.getByRole('button', { name: 'Modo de edição', exact: true })).toHaveAttribute('data-mode', 'pins');
  await expect(page.getByRole('button', { name: /Adicionar pin/ })).toBeVisible();
});
