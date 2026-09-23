import { test, expect } from '@playwright/test';
import { normalizeEntity, toLegacyEntity } from '@sao/domain';

async function setup(page, { image = '', role = 'gm', playerCount = 2 } = {}) {
  const state = { grants: [] };
  const entities = ['a', 'b'].map((id) => normalizeEntity('npc', {
    id: `npc.${id}`, name: `Personagem ${id.toUpperCase()}`, media: { image },
    fields: id === 'a' ? [{ key: 'rumor', value: '', visibility: 'gm' }] : []
  }, { format: '2.0' }));
  const legacy = (entity) => ({ ...toLegacyEntity('npc', entity), version: 1 });
  await page.route('https://images.test/**', (route) => route.request().url().endsWith('broken.png')
    ? route.fulfill({ status: 404 })
    : route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="500"><rect width="300" height="500" fill="#224c68"/></svg>' }));
  await page.route('**/api/v1/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const json = (body) => route.fulfill({ json: body });
    if (path.endsWith('/auth/me')) return json({ id: 'viewer', name: 'Viewer' });
    if (path.endsWith('/auth/csrf')) return json({ csrfToken: 'test' });
    if (path.endsWith('/campaigns/npc-test')) return json({ id: 'npc-test', name: 'Teste', role });
    if (path.endsWith('/memberships')) return json(Array.from({ length: playerCount }, (_, i) => ({ role: 'player', user: { id: `player-${i}`, name: `Jogador ${i}` } })));
    if (path.endsWith('/viewers')) return json([]);
    if (path.endsWith('/discoveries/batch')) {
      state.grants.push(...request.postDataJSON().grants);
      return json({ count: state.grants.length });
    }
    if (path.endsWith('/npcs')) return json({ items: entities.map(legacy), total: entities.length });
    const entity = entities.find((entry) => path.endsWith(`/npcs/${entry.id}`));
    if (entity) return json(url.searchParams.get('format') === '2' ? { schemaVersion: '2.0', data: entity, version: 1 } : legacy(entity));
    return json({ items: [] });
  });
  await page.goto('/campaigns/npc-test/npcs?selected=npc.a');
  await expect(page.getByRole('heading', { name: 'Personagem A', exact: true })).toBeVisible();
  return state;
}

test('foto ausente abre o editor na aba Geral pelo teclado', async ({ page }) => {
  await setup(page);
  const placeholder = page.getByRole('button', { name: 'Adicionar imagem de Personagem A' });
  await expect(placeholder).toContainText('Sem foto do personagem');
  await placeholder.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('tab', { name: 'Geral', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('button', { name: 'Adicionar foto', exact: true })).toBeVisible();
});

test('foto válida preserva retrato, amplia e retorna foco; clique principal edita', async ({ page }) => {
  await setup(page, { image: 'https://images.test/portrait.svg' });
  const edit = page.getByRole('button', { name: 'Editar imagem de Personagem A' });
  const image = edit.locator('img');
  await expect(image).toHaveCSS('object-fit', 'contain');
  await expect(image).toHaveCSS('max-height', '300px');
  const trigger = page.getByRole('button', { name: 'Ampliar imagem de Personagem A' });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Imagem de Personagem A' });
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Fechar imagem' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
  await page.screenshot({ path: 'outputs/npc-photo-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await trigger.click();
  const box = await dialog.boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: 'outputs/npc-photo-mobile.png' });
  await page.keyboard.press('Escape');
  await edit.click();
  await expect(page.getByRole('tab', { name: 'Geral', exact: true })).toHaveAttribute('aria-selected', 'true');
});

test('foto quebrada mantém o acesso à edição', async ({ page }) => {
  await setup(page, { image: 'https://images.test/broken.png' });
  await expect(page.getByText('Foto indisponível', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Editar imagem de Personagem A' }).click();
  await expect(page.getByRole('tab', { name: 'Geral', exact: true })).toBeVisible();
});

test('jogador vê espaço reservado e amplia foto sem controles de edição', async ({ page }) => {
  await setup(page, { role: 'player' });
  await expect(page.getByText('Sem foto do personagem')).toBeVisible();
  await expect(page.getByRole('button', { name: /Adicionar imagem|Editar/ })).toHaveCount(0);
  await setup(page, { role: 'player', image: 'https://images.test/portrait.svg' });
  await page.getByRole('button', { name: 'Ampliar imagem de Personagem A' }).click();
  await expect(page.getByRole('dialog', { name: 'Imagem de Personagem A' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Editar/ })).toHaveCount(0);
});

test('ficha individual seleciona personagem e libera grupos vazios sem enviar nomes de grupos', async ({ page }) => {
  const state = await setup(page);
  await page.locator('.detail-card').getByRole('button', { name: '◇ Liberar campos' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('checkbox', { name: 'Personagem A' })).toBeChecked();
  await expect(dialog.getByText('Campos vazios também serão liberados e aparecerão quando forem preenchidos')).toBeVisible();
  await expect(dialog.getByRole('checkbox', { name: /Apresentação/ })).not.toBeChecked();
  await dialog.getByRole('checkbox', { name: /Apresentação/ }).check();
  await dialog.getByRole('checkbox', { name: 'Jogador 0', exact: true }).check();
  await expect(dialog.getByRole('checkbox', { name: 'Anotações do mestre' })).not.toBeChecked();
  await page.screenshot({ path: 'outputs/npc-permissions-review.png', fullPage: true });
  await dialog.getByRole('button', { name: 'Confirmar permissões' }).click();
  await expect(dialog).toBeHidden();
  expect(state.grants).toHaveLength(7);
  expect(state.grants.map((grant) => grant.targetKey)).toEqual(['existence', 'section.basic', 'imageURL', 'shortDescription', 'description', 'appearance', 'section.identity']);
  expect(state.grants.every((grant) => grant.entityId === 'npc.a' && grant.subjectId === 'player-0' && grant.targetKind !== 'group')).toBe(true);
});

test('lista mantém seleção explícita e controles de selecionar e desmarcar todos', async ({ page }) => {
  const state = await setup(page);
  await page.getByRole('button', { name: '◇ Liberar personagens', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const columns = dialog.locator('.bulk-picker-columns > .bulk-target-picker');
  await expect(dialog.getByRole('checkbox', { name: 'Personagem A' })).not.toBeChecked();
  await expect(dialog.getByRole('button', { name: 'Confirmar permissões' })).toBeDisabled();
  for (const index of [0, 1, 2]) await columns.nth(index).getByRole('button', { name: 'Selecionar todos', exact: true }).click();
  await expect(dialog.getByRole('checkbox', { name: 'rumor', exact: true })).toBeChecked();
  await columns.nth(1).getByRole('button', { name: 'Desselecionar todos', exact: true }).click();
  await expect(dialog.getByRole('checkbox', { name: /Apresentação/ })).not.toBeChecked();
  await expect(dialog.getByRole('checkbox', { name: 'rumor', exact: true })).not.toBeChecked();
  await dialog.getByRole('checkbox', { name: /Personalidade e história/ }).check();
  await dialog.getByRole('button', { name: 'Confirmar permissões' }).click();
  await expect(dialog).toBeHidden();
  expect(state.grants).toHaveLength(20);
  for (const entityId of ['npc.a', 'npc.b']) for (const subjectId of ['player-0', 'player-1']) {
    expect(state.grants.filter((grant) => grant.entityId === entityId && grant.subjectId === subjectId).map((grant) => grant.targetKey)).toEqual(['existence', 'section.basic', 'imageURL', 'personality', 'history']);
  }
});

test('bloqueia mais de 500 permissões e permite reduzir a seleção', async ({ page }) => {
  await setup(page, { playerCount: 72 });
  await page.locator('.detail-card').getByRole('button', { name: '◇ Liberar campos' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.locator('.bulk-picker-columns > .bulk-target-picker').nth(2).getByRole('button', { name: 'Selecionar todos' }).click();
  await dialog.getByRole('checkbox', { name: /Apresentação/ }).check();
  await expect(dialog.getByRole('alert')).toContainText('504 permissões');
  await expect(dialog.getByRole('button', { name: 'Confirmar permissões' })).toBeDisabled();
  await dialog.getByRole('checkbox', { name: 'Jogador 0', exact: true }).uncheck();
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Confirmar permissões' })).toBeEnabled();
});
