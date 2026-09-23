import { test, expect } from '@playwright/test';
import { normalizeEntity, toLegacyEntity } from '@sao/domain';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=', 'base64');
const file = { name: 'local.png', mimeType: 'image/png', buffer: png };
const animatedGif = Buffer.from('47494638396101000100800000000000ffffff21ff0b4e45545343415045322e30030100000021f904000a0000002c000000000100010000020244010021f904000a0000002c00000000010001000002024c01003b', 'hex');
const uploadedUrl = '/api/v1/campaigns/image-test/media/abcd-1234.png';

async function setup(page, { type = 'city', image = '', role = 'gm' } = {}) {
  const state = {
    entity: normalizeEntity('location', {
      id: 'loc.test', name: 'Local de teste', type, placement: { floor: '1' },
      media: { image, map: 'https://images.test/map.png' },
      fields: [{ key: 'history', value: 'História preservada', visibility: 'gm' }]
    }),
    uploads: 0, writes: [], version: 3, uploadFailures: 0, saveFailures: 0,
    uploadGate: null, saveGate: null
  };
  const legacy = () => ({ ...toLegacyEntity('location', state.entity), version: state.version });
  await page.route('https://images.test/**', async (route) => {
    if (route.request().url().endsWith('/broken.png')) return route.fulfill({ status: 404 });
    if (route.request().url().endsWith('/animated.gif')) return route.fulfill({ contentType: 'image/gif', body: animatedGif });
    const portrait = route.request().url().endsWith('/portrait.svg');
    return route.fulfill({ contentType: 'image/svg+xml', body: `<svg xmlns="http://www.w3.org/2000/svg" width="${portrait ? 400 : 1200}" height="${portrait ? 1000 : 400}"><rect width="100%" height="100%" fill="#224c68"/><circle cx="200" cy="160" r="90" fill="#c6d9aa"/><text x="40" y="320" fill="white" font-size="32">Local de teste</text></svg>` });
  });
  await page.route('**/api/v1/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;
    const json = (body, status = 200) => route.fulfill({ status, json: body });
    if (path.endsWith('/auth/me')) return json({ id: 'gm-test', name: 'GM' });
    if (path.endsWith('/auth/csrf')) return json({ csrfToken: 'test' });
    if (path.endsWith('/campaigns/image-test')) return json({ id: 'image-test', name: 'Teste de imagens', role });
    if (path.endsWith('/memberships') || path.endsWith('/viewers')) return json([]);
    if (path.endsWith('/media') && req.method() === 'POST') {
      state.uploads++;
      if (state.uploadGate) await state.uploadGate;
      if (state.uploadFailures-- > 0) return json({ error: { message: 'A imagem excede o limite permitido.' } }, 413);
      return json({ url: uploadedUrl }, 201);
    }
    if (path === uploadedUrl) return route.fulfill({ contentType: 'image/png', body: png });
    if (/\/locations(?:\/[^/]+)?$/.test(path)) {
      if (['PUT', 'POST'].includes(req.method())) {
        state.writes.push({ data: req.postDataJSON(), version: req.headers()['if-match'] });
        if (state.saveGate) await state.saveGate;
        if (state.saveFailures-- > 0) return json({ error: { message: 'Não foi possível salvar o local.' } }, 500);
        state.entity = normalizeEntity('location', req.postDataJSON(), { format: '2.0' });
        state.version++;
        return json({ ...state.entity, version: state.version });
      }
      if (path.endsWith('/locations')) return json({ items: [legacy()], total: 1 });
      return json(url.searchParams.get('format') === '2'
        ? { schemaVersion: '2.0', data: state.entity, version: state.version }
        : legacy());
    }
    return json({ items: [] });
  });
  await page.goto('/campaigns/image-test/locations?selected=loc.test');
  await expect(page.getByRole('heading', { name: 'Local de teste', exact: true })).toBeVisible();
  return state;
}

test('arquivo só é enviado ao salvar; abas, falhas e nova tentativa preservam o formulário', async ({ page }) => {
  const state = await setup(page);
  await page.getByRole('button', { name: 'Editar', exact: true }).click();
  await page.getByLabel('Arquivo da imagem').setInputFiles(file);
  await expect(page.getByAltText('Prévia da imagem do local')).toBeVisible();
  await page.getByRole('tab', { name: 'Descrição', exact: true }).click();
  await page.getByLabel('Descrição', { exact: true }).fill('Descrição preenchida após escolher a imagem.');
  await page.getByRole('tab', { name: 'Geral', exact: true }).click();
  await expect(page.getByText('Selecionado: local.png')).toBeVisible();
  expect(state.uploads).toBe(0);
  let releaseUpload;
  state.uploadGate = new Promise((resolve) => { releaseUpload = resolve; });
  state.saveFailures = 1;
  await page.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Enviando imagem…' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Cancelar', exact: true })).toBeDisabled();
  await expect(page.getByLabel('Nome', { exact: true })).toBeDisabled();
  releaseUpload();
  await expect(page.getByText('Não foi possível salvar o local.', { exact: true })).toBeVisible();
  expect(state.uploads).toBe(1);
  expect(state.writes[0].version).toBe('3');
  await page.getByLabel('Subtítulo', { exact: true }).fill('Mantido na nova tentativa');
  let releaseSave;
  state.saveGate = new Promise((resolve) => { releaseSave = resolve; });
  await page.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Salvando…' })).toBeDisabled();
  await expect.poll(() => state.writes.length).toBe(2);
  releaseSave();
  await expect(page.getByRole('dialog')).toBeHidden();
  expect(state.uploads).toBe(1);
  expect(state.entity.media).toEqual({ image: uploadedUrl, map: 'https://images.test/map.png' });
  expect(state.entity.fields).toEqual(expect.arrayContaining([expect.objectContaining({ key: 'description', value: 'Descrição preenchida após escolher a imagem.' })]));
  expect(state.entity.subtitle).toBe('Mantido na nova tentativa');
  await page.getByRole('button', { name: 'Editar', exact: true }).click();
  await expect(page.getByLabel('Ou cole o link da imagem')).toHaveValue(uploadedUrl);
});

for (const type of ['region', 'city', 'dungeon']) {
  test(`${type}: criar sem imagem e editar com link, remover e cancelar`, async ({ page }) => {
    const state = await setup(page, { type });
    await page.getByRole('button', { name: '＋ Novo', exact: true }).click();
    await page.getByLabel('Nome', { exact: true }).fill('Local novo');
    await page.getByRole('combobox', { name: /^Tipo/ }).selectOption(type);
    await expect(page.getByLabel('Arquivo da imagem')).toBeVisible();
    await page.getByRole('button', { name: 'Salvar', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeHidden();
    expect(state.entity.media.image).toBe('');
    await page.getByRole('button', { name: 'Editar', exact: true }).click();
    await page.getByLabel('Ou cole o link da imagem').fill('https://images.test/landscape.svg');
    await page.getByRole('button', { name: 'Salvar', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeHidden();
    expect(state.uploads).toBe(0);
    await page.getByRole('button', { name: 'Editar', exact: true }).click();
    await page.getByRole('button', { name: 'Remover imagem' }).click();
    await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
    expect(state.entity.media.image).toBe('https://images.test/landscape.svg');
    await page.getByRole('button', { name: 'Editar', exact: true }).click();
    await page.getByRole('button', { name: 'Remover imagem' }).click();
    await page.getByRole('button', { name: 'Salvar', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeHidden();
    expect(state.entity.media.image).toBe('');
    await expect(page.getByRole('button', { name: /Ampliar imagem de/ })).toHaveCount(0);
  });
}

test('validação de URL e arquivo; falha de prévia não impede salvar; cancelar não envia arquivo', async ({ page }) => {
  const state = await setup(page);
  await page.getByRole('button', { name: 'Editar', exact: true }).click();
  await page.getByLabel('Arquivo da imagem').setInputFiles({ name: 'texto.txt', mimeType: 'text/plain', buffer: Buffer.from('texto') });
  await expect(page.getByRole('alert')).toContainText('Escolha uma imagem');
  await page.getByLabel('Ou cole o link da imagem').fill('javascript:alert(1)');
  await expect(page.getByRole('alert')).toContainText('HTTP ou HTTPS');
  await page.getByRole('button', { name: 'Salvar', exact: true }).click();
  expect(state.writes).toHaveLength(0);
  await page.getByLabel('Ou cole o link da imagem').fill('https://images.test/broken.png');
  await expect(page.getByText(/Não foi possível carregar a prévia/)).toBeVisible();
  await page.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  expect(state.entity.media.image).toBe('https://images.test/broken.png');
  await expect(page.getByText('Imagem do local indisponível.')).toBeVisible();
  await page.getByRole('button', { name: 'Editar', exact: true }).click();
  await page.getByLabel('Arquivo da imagem').setInputFiles(file);
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
  expect(state.uploads).toBe(0);
});

test('erro de upload mantém a seleção e permite tentar novamente', async ({ page }) => {
  const state = await setup(page);
  state.uploadFailures = 1;
  await page.getByRole('button', { name: 'Editar', exact: true }).click();
  await page.getByLabel('Arquivo da imagem').setInputFiles(file);
  await page.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(page.getByText('A imagem excede o limite permitido.')).toBeVisible();
  expect(state.writes).toHaveLength(0);
  await expect(page.getByText('Selecionado: local.png')).toBeVisible();
  await page.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  expect(state.uploads).toBe(2);
});

test('destaque horizontal e ampliação acessível no desktop e celular', async ({ page }, testInfo) => {
  await setup(page, { image: 'https://images.test/landscape.svg' });
  const trigger = page.getByRole('button', { name: 'Ampliar imagem de Local de teste' });
  const image = page.getByRole('button', { name: 'Editar imagem de Local de teste' }).locator('img');
  await expect(image).toHaveCSS('object-fit', 'contain');
  const imageBox = await image.boundingBox();
  const infoBox = await page.getByText('Informações básicas', { exact: true }).boundingBox();
  expect(infoBox.y).toBeGreaterThan(imageBox.y + imageBox.height);
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Imagem de Local de teste' });
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Fechar imagem' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  await page.screenshot({ path: testInfo.outputPath('desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await trigger.click();
  await expect(dialog).toBeVisible();
  const box = await dialog.boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: testInfo.outputPath('mobile-expanded.png') });
  await dialog.getByRole('button', { name: 'Fechar imagem' }).click();
  await page.getByRole('button', { name: 'Editar', exact: true }).click();
  await page.getByLabel('Ou cole o link da imagem').fill('https://images.test/portrait.svg');
  await expect(page.getByAltText('Prévia da imagem do local')).toHaveCSS('object-fit', 'contain');
  await page.getByAltText('Prévia da imagem do local').scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('mobile-editor.png') });
});

test('novo local com arquivo e troca para GIF animado por link', async ({ page }) => {
  const state = await setup(page);
  await page.getByRole('button', { name: '＋ Novo', exact: true }).click();
  await page.getByLabel('Nome', { exact: true }).fill('Caverna nova');
  await page.getByRole('combobox', { name: /^Tipo/ }).selectOption('dungeon');
  await page.getByLabel('Arquivo da imagem').setInputFiles(file);
  expect(state.uploads).toBe(0);
  await page.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  expect(state.entity.media.image).toBe(uploadedUrl);
  expect(state.writes[0].version).toBeUndefined();
  await page.getByRole('button', { name: 'Editar', exact: true }).click();
  await page.getByLabel('Arquivo da imagem').setInputFiles({ name: 'local.gif', mimeType: 'image/gif', buffer: animatedGif });
  await expect(page.getByAltText('Prévia da imagem do local')).toBeVisible();
  await expect(page.getByAltText('Prévia da imagem do local')).toHaveJSProperty('naturalWidth', 1);
  await page.getByLabel('Ou cole o link da imagem').fill('https://images.test/animated.gif');
  await page.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  expect(state.uploads).toBe(1);
  const trigger = page.getByRole('button', { name: 'Ampliar imagem de Caverna nova' });
  await expect(page.getByRole('button', { name: 'Editar imagem de Caverna nova' }).locator('img')).toHaveJSProperty('naturalWidth', 1);
  await trigger.click();
  await expect(page.getByRole('dialog').locator('img')).toHaveAttribute('src', 'https://images.test/animated.gif');
});

test('jogador não recebe controles de edição nem imagem omitida pela API', async ({ page }) => {
  await setup(page, { role: 'player' });
  await expect(page.getByRole('button', { name: 'Editar', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Ampliar imagem de/ })).toHaveCount(0);
  await expect(page.getByText('Sem imagem do local', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /Adicionar imagem de/ })).toHaveCount(0);
});

test('quadro vazio abre Geral pelo teclado e imagem cadastrada também abre o editor', async ({ page }) => {
  const state = await setup(page);
  const placeholder = page.getByRole('button', { name: 'Adicionar imagem de Local de teste' });
  await expect(placeholder).toBeVisible();
  await expect(placeholder).toContainText('Sem imagem do local');
  await placeholder.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('tab', { name: 'Geral', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.getByLabel('Ou cole o link da imagem').fill('https://images.test/landscape.svg');
  await page.getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeHidden();
  expect(state.entity.media.image).toBe('https://images.test/landscape.svg');
  await page.getByRole('button', { name: 'Editar imagem de Local de teste' }).click();
  await expect(page.getByLabel('Ou cole o link da imagem')).toHaveValue('https://images.test/landscape.svg');
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
});
