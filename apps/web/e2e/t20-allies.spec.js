import { test, expect } from '@playwright/test';
import { normalizeEntity, toLegacyEntity } from '@sao/domain';

async function setup(page, characterType = 'npc', role = 'gm', allyTypes) {
  const state = { entity: normalizeEntity('npc', { id: 'npc.partner', name: 'Parceiro', characterType, allyTypes, visibility: { entity: 'public', sections: { basic: 'public' } } }), version: 1, writes: [] };
  await page.route('**/api/v1/**', async route => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname;
    const json = (body, status = 200) => route.fulfill({ json: body, status });
    if (path.endsWith('/auth/me')) return json({ user: { id: 'viewer', name: 'Viewer' } });
    if (path.endsWith('/auth/csrf')) return json({ csrfToken: 'test' });
    if (path.endsWith('/campaigns/t20-allies')) return json({ id: 't20-allies', name: 'Aliados', role });
    if (path.endsWith('/memberships') || path.endsWith('/viewers') || path.endsWith('/characters/players') || path.endsWith('/character-favorites')) return json([]);
    if (path.endsWith('/npcs')) return json({ items: [{ ...toLegacyEntity('npc', state.entity), version: state.version }] });
    if (path.endsWith('/npcs/npc.partner')) {
      if (req.method() === 'PUT') {
        const body = req.postDataJSON(); state.writes.push({ body, version: req.headers()['if-match'] });
        if (Number(req.headers()['if-match']) !== state.version) return json({ error: { code: 'VERSION_CONFLICT', message: 'Alterado por outra pessoa' } }, 409);
        state.entity = normalizeEntity('npc', body); state.version += 1;
      }
      return json(url.searchParams.get('format') === '2' ? { schemaVersion: '2.0', data: state.entity, version: state.version } : { ...toLegacyEntity('npc', state.entity), version: state.version });
    }
    return json({ items: [] });
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/campaigns/t20-allies/npcs');
  await expect(page.getByRole('heading', { name: 'Parceiro', exact: true })).toBeVisible();
  return state;
}

for (const characterType of ['npc', 'entity', 'player']) test(`dois tipos de aliado podem ser escolhidos e consultados nas informações básicas (${characterType})`, async ({ page }) => {
  const state = await setup(page, characterType);
  await page.getByRole('button', { name: 'Editar', exact: true }).click();
  const dialog = page.getByRole('dialog'), first = dialog.getByLabel('Tipo de aliado 1', { exact: true }), second = dialog.getByLabel('Tipo de aliado 2', { exact: true });
  await expect(first).toBeVisible(); await expect(second).toBeDisabled();
  const labels = (await first.locator('option').allTextContents()).slice(1);
  expect(labels).toHaveLength(36); expect(labels).toEqual([...labels].sort((a, b) => a.localeCompare(b, 'pt-BR')));
  await first.selectOption('atirador:iniciante');
  await expect(dialog.locator('.t20-allies-editor')).toContainText('+1d6');
  await expect(second).toBeEnabled(); await expect(second.locator('option[value^="atirador:"]')).toHaveCount(0);
  await first.selectOption('atirador:veterano');
  await second.selectOption('guardiao:mestre');
  await expect(dialog.locator('.t20-allies-editor')).toContainText('+1d10');
  await expect(dialog.locator('.t20-allies-editor')).toContainText('Defesa +4');
  await expect(dialog.locator('.t20-allies-editor select')).toHaveCount(2);
  await expect(first.locator('option[value^="guardiao:"]')).toHaveCount(0);
  if (characterType === 'npc' && process.env.T20_UI_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.T20_UI_SCREENSHOT_DIR}/allies-editor-desktop.png`, fullPage: true });
  await dialog.getByRole('button', { name: 'Salvar', exact: true }).click(); await expect(dialog).toHaveCount(0);
  expect(state.writes[0]).toMatchObject({ version: '1', body: { characterType, allyTypes: [{ type: 'atirador', rank: 'veterano' }, { type: 'guardiao', rank: 'mestre' }] } });
  const basic = page.locator('.module-card').filter({ has: page.getByRole('heading', { name: 'Informações básicas', exact: true }) });
  await expect(basic).toContainText('Atirador - Veterano'); await expect(basic).toContainText('+1d10');
  await expect(basic).toContainText('Guardião - Mestre'); await expect(basic).toContainText('testes de resistência +2');
  await expect(basic).not.toContainText('Nenhuma informação cadastrada.');
  await page.reload(); await expect(basic).toContainText('+1d10');
  if (characterType === 'npc' && process.env.T20_UI_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.T20_UI_SCREENSHOT_DIR}/allies-view-desktop.png`, fullPage: true });
  await page.getByRole('button', { name: 'Editar', exact: true }).click();
  await first.selectOption('fortao:iniciante'); await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await expect(basic).toContainText('Atirador - Veterano'); expect(state.writes).toHaveLength(1);
  await page.getByRole('button', { name: 'Editar', exact: true }).click();
  await second.selectOption(''); await first.selectOption('');
  await dialog.getByRole('button', { name: 'Salvar', exact: true }).click(); await expect(dialog).toHaveCount(0);
  expect(state.writes[1]).toMatchObject({ version: '2', body: { allyTypes: [] } });
  await expect(page.getByRole('region', { name: 'Aliado Tormenta20' })).toHaveCount(0);
});

test('visualização do jogador mostra os benefícios e o editor cabe no celular', async ({ page }) => {
  await setup(page, 'npc', 'player', [{ type: 'atirador', rank: 'iniciante' }]);
  await expect(page.getByRole('region', { name: 'Aliado Tormenta20' })).toContainText('Dano à distância +1d6');
  await expect(page.getByRole('button', { name: 'Editar', exact: true })).toHaveCount(0);
  await setup(page, 'entity');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Editar', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Tipo de aliado 1', { exact: true }).selectOption('destruidor:mestre');
  await dialog.getByLabel('Tipo de aliado 2', { exact: true }).selectOption('medico:veterano');
  await dialog.locator('.t20-allies-editor').scrollIntoViewIfNeeded();
  for (const choice of await dialog.locator('.t20-allies-editor select').all()) {
    const bounds = await choice.boundingBox(); expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
  }
  if (process.env.T20_UI_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.T20_UI_SCREENSHOT_DIR}/allies-editor-mobile.png`, fullPage: true });
});
