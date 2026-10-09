import { test, expect } from '@playwright/test';
import { normalizeEntity, toLegacyEntity } from '@sao/domain';

async function setup(page, type = 'npc') {
  const id = `${type === 'location' ? 'loc' : type}.test`;
  const entity = normalizeEntity(type, {
    id, name: 'Registro de teste',
    ...(type === 'monster' ? { links: [{ type: 'item', id: 'item.drop', role: 'drops', chance: 100 }] } : {})
  }, { format: '2.0' });
  const collection = type === 'location' ? 'locations' : `${type}s`;
  const writes = [];
  await page.route('**/api/v1/**', route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname;
    const json = body => route.fulfill({ json: body });
    if (path.endsWith('/auth/me')) return json({ id: 'gm-test', name: 'GM' });
    if (path.endsWith('/auth/csrf')) return json({ csrfToken: 'test' });
    if (path.endsWith('/campaigns/dismiss-test')) return json({ id: 'dismiss-test', name: 'Teste', role: 'gm' });
    if (path.endsWith('/memberships')) return json([{ role: 'player', user: { id: 'player-test', name: 'Jogador teste' } }]);
    if (path.endsWith('/search')) return json([{ type, id, name: entity.name }]);
    if (path.endsWith('/notifications')) return json({ items: [] });
    if (path.endsWith('/import/history')) return json({ total: 1, items: [{ id: 'history-test', fileName: 'Pacote de teste', sourceKind: 'json-v2', importedAt: '2026-10-08T12:00:00Z', summary: { created: 1 } }] });
    if (path.endsWith('/import/history/history-test')) return json({ sourceKind: 'json-v2', changes: [] });
    if (path.endsWith('/drops/roll')) return json({ results: [] });
    if (request.method() !== 'GET') { writes.push(path); return json({}); }
    if (path.endsWith(`/${collection}`)) return json({ total: 1, items: [{ ...toLegacyEntity(type, entity), version: 1 }] });
    if (path.endsWith(`/${collection}/${id}`)) return json(url.searchParams.get('format') === '2' ? { schemaVersion: '2.0', data: entity, version: 1 } : { ...toLegacyEntity(type, entity), version: 1 });
    if (path.endsWith('/progress') || path.endsWith('/viewers') || path.endsWith('/players') || path.endsWith('/character-favorites')) return json([]);
    return json({ items: [] });
  });
  await page.goto(`/campaigns/dismiss-test/${collection}?selected=${id}`);
  await expect(page.getByRole('heading', { name: 'Registro de teste', exact: true })).toBeVisible();
  return writes;
}

test('busca global e notificações fecham por clique externo e aceitam cliques internos', async ({ page }) => {
  await setup(page);
  await page.getByLabel('Busca global').fill('Registro');
  const results = page.getByRole('listbox');
  await expect(results).toBeVisible();
  await page.getByLabel('Busca global').click(); await expect(results).toBeVisible();
  await page.getByRole('heading', { name: 'Registro de teste', exact: true }).click();
  await expect(results).toBeHidden();
  await page.getByLabel('Busca global').click();
  await results.getByRole('button', { name: /Registro de teste/ }).click(); await expect(results).toBeHidden();
  await page.getByRole('button', { name: 'Notificações', exact: true }).click();
  const notifications = page.getByRole('region', { name: 'Últimas notificações' });
  await notifications.getByText('Nenhuma notificação por enquanto.').click(); await expect(notifications).toBeVisible();
  await page.getByRole('heading', { name: 'Registro de teste', exact: true }).click(); await expect(notifications).toBeHidden();
});

test('histórico de importação fecha sem alterar o banco', async ({ page }) => {
  const writes = await setup(page);
  await page.goto('/campaigns/dismiss-test/json/history');
  await page.getByRole('button', { name: 'Detalhes', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('heading').click(); await expect(dialog).toBeVisible();
  await page.mouse.click(2, 2); await expect(dialog).toBeHidden();
  expect(writes).toEqual([]);
});

test('atribuição de missão fecha por clique no fundo sem atribuir jogadores', async ({ page }) => {
  const writes = await setup(page, 'quest');
  await page.getByRole('button', { name: 'Atribuir missão', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Atribuir missão' });
  await dialog.getByRole('heading', { name: 'Atribuir missão' }).click(); await expect(dialog).toBeVisible();
  await page.mouse.click(2, 2); await expect(dialog).toBeHidden();
  expect(writes).toEqual([]);
});

test('resultado de drop fecha por clique no fundo', async ({ page }) => {
  await setup(page, 'monster');
  await page.getByRole('button', { name: 'Sortear drop', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('heading').click(); await expect(dialog).toBeVisible();
  await page.mouse.click(2, 2); await expect(dialog).toBeHidden();
});

test('permissões fecham ao clicar fora sem enviar descobertas', async ({ page }) => {
  const writes = await setup(page);
  await page.locator('.detail-card').getByRole('button', { name: '◇ Liberar campos', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('checkbox', { name: 'Jogador teste', exact: true }).check();
  await expect(dialog).toBeVisible();
  await page.mouse.click(2, 2); await expect(dialog).toBeHidden();
  expect(writes).toEqual([]);
});

test('exclusão em massa fecha ao clicar fora sem apagar registros', async ({ page }) => {
  const writes = await setup(page, 'location');
  await page.getByRole('button', { name: '✕ Excluir', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('heading', { name: 'Excluir registros' }).click(); await expect(dialog).toBeVisible();
  await page.mouse.click(2, 2); await expect(dialog).toBeHidden();
  expect(writes).toEqual([]);
});
