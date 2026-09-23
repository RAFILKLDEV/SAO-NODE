import { test, expect } from '@playwright/test';

test('liberação de monstros filtra região e descendentes e não envia seleções ocultas', async ({ page }) => {
  const locations = [
    { id: 'loc.north', name: 'Norte', type: 'region' },
    { id: 'loc.forest', name: 'Floresta', type: 'grove', parentId: 'loc.north' },
    { id: 'loc.south', name: 'Sul', type: 'region' },
    { id: 'loc.empty', name: 'Vazia', type: 'region' }
  ];
  const monsters = [
    { id: 'monster.wolf', name: 'Lobo', references: [{ type: 'location', id: 'loc.forest' }] },
    { id: 'monster.bear', name: 'Urso', references: [{ type: 'location', id: 'loc.north' }] },
    { id: 'monster.snake', name: 'Serpente', references: [{ type: 'location', id: 'loc.south' }] },
    { id: 'monster.unknown', name: 'Sem local', references: [] }
  ];
  let grants = [];
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const json = (body) => route.fulfill({ json: body });
    if (path.endsWith('/auth/me')) return json({ id: 'gm', name: 'Mestre' });
    if (path.endsWith('/auth/csrf')) return json({ csrfToken: 'test' });
    if (path.endsWith('/campaigns/region-test')) return json({ id: 'region-test', name: 'Teste', role: 'gm' });
    if (path.endsWith('/memberships')) return json([{ role: 'player', user: { id: 'player', name: 'Jogador' } }]);
    if (path.endsWith('/viewers')) return json([]);
    if (path.endsWith('/locations')) return json({ items: locations, total: locations.length });
    if (path.endsWith('/monsters')) return json({ items: monsters, total: monsters.length });
    if (path.endsWith('/discoveries/batch')) {
      grants = route.request().postDataJSON().grants;
      return json({ count: grants.length });
    }
    const monster = monsters.find((entry) => path.endsWith(`/monsters/${entry.id}`));
    if (monster) return json({ ...monster, version: 1 });
    return json({ items: [] });
  });
  await page.goto('/campaigns/region-test/monsters?selected=monster.wolf');
  await page.getByRole('button', { name: '◇ Liberar monstros', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const region = dialog.getByRole('combobox', { name: 'Região', exact: true });
  const entities = dialog.locator('.bulk-picker-columns > .bulk-target-picker').first();
  const players = dialog.locator('.bulk-picker-columns > .bulk-target-picker').nth(2);
  await region.selectOption('loc.north');
  await expect(region).toHaveValue('loc.north');
  await expect(entities.getByRole('checkbox')).toHaveCount(2);
  await expect(entities.getByRole('checkbox', { name: 'Lobo', exact: true })).toBeAttached();
  await expect(entities.getByRole('checkbox', { name: 'Urso', exact: true })).toBeAttached();
  await entities.getByRole('button', { name: 'Selecionar todos' }).click();
  await players.getByRole('button', { name: 'Selecionar todos' }).click();
  await expect(dialog.getByRole('button', { name: 'Confirmar permissões' })).toBeEnabled();
  await region.selectOption('loc.empty');
  await expect(dialog.getByText('Nenhum monstro nesta região.')).toBeVisible();
  await expect(entities.getByRole('button', { name: 'Selecionar todos' })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Confirmar permissões' })).toBeDisabled();
  await region.selectOption('');
  await expect(entities.getByRole('checkbox')).toHaveCount(4);
  await expect(entities.getByRole('checkbox', { name: 'Lobo', exact: true })).toBeChecked();
  await region.selectOption('loc.south');
  await expect(entities.getByRole('checkbox')).toHaveCount(1);
  await expect(entities.getByRole('checkbox', { name: 'Serpente', exact: true })).toBeChecked();
  await page.screenshot({ path: 'outputs/monster-region-discovery.png', fullPage: true });
  await dialog.getByRole('button', { name: 'Confirmar permissões' }).click();
  await expect(dialog).toBeHidden();
  expect(grants).toEqual([{
    subjectType: 'user', subjectId: 'player', entityType: 'monster', entityId: 'monster.snake',
    targetKind: 'entity', targetKey: 'existence', allowance: 'allow'
  }]);
});
