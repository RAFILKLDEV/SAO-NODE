import { test, expect } from '@playwright/test';
import { normalizeRoadNetwork } from '@sao/domain';

const campaignId = 'canvas-ui-test';
async function setup(page, role = 'gm') {
  const state = { writes: [], edits: new Map(), conflict: false, next: 1 };
  const boards = ['general', 'regional'].map((key, i) => ({ id: `${key}-canvas`, name: i ? 'Mapa regional' : 'Mapa geral', regionId: i ? 'loc.region' : null, regionName: i ? 'Região' : null, version: 1, imageUrl: `https://canvas.test/${key}.svg`, pins: [{ id: `pin-${key}`, entityType: 'location', entityId: 'loc.city', name: 'Cidade', pinType: 'location', x: .65, y: .55, version: 1 }], travelMarkers: [], markerCandidates: [], boundaries: [], routes: [], distances: [], boundaryCandidates: [], drawings: [], pings: [], roadNetwork: null }));
  state.boards = boards;
  const actor = role === 'player' ? 'ana' : 'gm';
  state.authorName = actor === 'ana' ? 'Ana' : 'Mestre';
  await page.route('https://canvas.test/**', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="600"><rect width="1200" height="600" fill="#224c68"/></svg>' }));
  await page.route('**/api/v1/**', route => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname, method = req.method();
    const boardId = url.searchParams.get('boardId'), board = boards.find(b => b.id === boardId) ?? boards[0];
    const json = (body, status = 200) => route.fulfill({ json: body, status });
    const failure = () => json({ error: { code: 'VERSION_CONFLICT', message: 'Outra pessoa alterou este conteúdo. Atualize o mapa antes de desfazer.' } }, 409);
    if (path.endsWith('/auth/me')) return json({ id: actor, name: actor === 'ana' ? 'Ana' : 'Mestre' });
    if (path.endsWith('/auth/csrf')) return json({ csrfToken: 'test' });
    if (path.endsWith(`/campaigns/${campaignId}`)) return json({ id: campaignId, name: 'Testes', role });
    if (path.endsWith('/memberships')) return json([{ user: { id: 'ana', name: 'Ana' }, role: 'player' }]);
    if (method !== 'GET') state.writes.push({ path, method, boardId, body: req.postDataJSON(), headers: req.headers() });
    if (path.endsWith('/map/boards')) return json({ items: boards, regions: [] });
    if (path.endsWith('/map/board')) return json(board);
    if (path.endsWith('/map/drawings') && method === 'GET') return json({ boardId: board.id, userId: actor, items: board.drawings, pings: board.pings });
    const record = (kind, before, label) => {
      const edit = { id: `edit-${state.next++}`, version: 1, applied: true, label };
      state.edits.set(edit.id, { ...edit, boardId: board.id, kind, before, after: structuredClone(board[kind]) });
      return edit;
    };
    if (path.endsWith('/map/drawings') && method === 'POST') {
      const before = structuredClone(board.drawings), id = req.headers()['x-map-preview-id'];
      board.drawings.push({ ...req.postDataJSON(), id, version: 1, authorUserId: actor, authorName: actor === 'ana' ? 'Ana' : 'Mestre' });
      const result = { id, edit: record('drawings', before, 'Desenhar') };
      if (state.saveDelay) return new Promise(resolve => setTimeout(() => resolve(json(result, 201)), state.saveDelay));
      return json(result, 201);
    }
    if (path.includes('/map/drawings/') && method === 'DELETE') {
      const before = structuredClone(board.drawings), id = path.split('/').at(-1);
      board.drawings = board.drawings.filter(d => d.id !== id); return json({ edit: record('drawings', before, 'Apagar desenho') });
    }
    if (path.endsWith('/map/drawings/clear')) {
      const before = structuredClone(board.drawings), { scope } = req.postDataJSON();
      board.drawings = scope === 'all' ? [] : board.drawings.filter(d => d.authorUserId !== actor);
      return json({ edit: record('drawings', before, 'Limpar desenhos') });
    }
    if (path.includes('/map/edits/')) {
      const edit = state.edits.get(path.split('/').at(-1));
      if (state.conflict || !edit || edit.boardId !== board.id || edit.version !== Number(req.headers()['if-match'])) return failure();
      edit.applied = req.postDataJSON().direction === 'redo'; edit.version++;
      board[edit.kind] = structuredClone(edit.applied ? edit.after : edit.before);
      if (edit.kind === 'pins') board.version++;
      return json({ edit: { id: edit.id, version: edit.version, applied: edit.applied, label: edit.label } });
    }
    if (path.endsWith('/map/pings') && method === 'POST') {
      const ping = { ...req.postDataJSON(), id: req.postDataJSON().id ?? `ping-${state.next++}`, authorName: state.authorName, authorUserId: actor, expiresAt: Date.now() + 3000 };
      board.pings.push(ping); return json({ ping }, 201);
    }
    if (path.includes('/map/pings/') && method === 'DELETE') { board.pings = board.pings.filter(p => p.id !== path.split('/').at(-1)); return json({ ok: true }); }
    if (path.includes('/map/pins/') && ['PATCH', 'DELETE'].includes(method)) {
      const before = structuredClone(board.pins), id = path.split('/').at(-1), pin = board.pins.find(p => p.id === id);
      if (method === 'PATCH') Object.assign(pin, req.postDataJSON(), { version: pin.version + 1 }); else board.pins = board.pins.filter(p => p.id !== id);
      board.version++; return json({ ...board, edit: record('pins', before, method === 'DELETE' ? 'Apagar pin' : 'Mover pin') });
    }
    if (path.endsWith('/map/network') && method === 'PUT') { board.roadNetwork = normalizeRoadNetwork(req.postDataJSON()); board.version++; return json(board); }
    return json({ items: [] });
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/campaigns/${campaignId}/map`);
  await expect(page.locator('.image-map-art')).toBeVisible();
  await expect(page.locator('.map-drawing-toolbar')).toBeVisible();
  return state;
}
async function openTools(page) {
  const button = page.locator('.map-drawing-summary button[aria-expanded]');
  if (await button.getAttribute('aria-expanded') !== 'true') await button.click();
}
async function tool(page, name) { await openTools(page); await page.locator('.map-drawing-tools').getByRole('button', { name, exact: true }).click(); }
async function point(page, x, y) {
  const b = await page.locator('.image-map-art').boundingBox(); return { x: b.x + x * b.width, y: b.y + y * b.height };
}
async function stroke(page, points = [[.2, .65], [.4, .8], [.55, .68]]) {
  await page.locator('.image-map-art').scrollIntoViewIfNeeded();
  const first = await point(page, ...points[0]); await page.mouse.move(first.x, first.y); await page.mouse.down();
  for (const [x, y] of points.slice(1)) { const p = await point(page, x, y); await page.mouse.move(p.x, p.y, { steps: 8 }); }
  await page.mouse.up();
}
async function clickMap(page, x, y) { const p = await point(page, x, y); await page.mouse.click(p.x, p.y); }
async function mode(page, name) {
  const button = page.getByRole('button', { name: 'Modo de edição', exact: true });
  for (let i = 0; i < 4 && await button.getAttribute('data-mode') !== name; i++) await button.click();
  await expect(button).toHaveAttribute('data-mode', name);
}

test('desenho livre salva estilo e pontos, desfaz, refaz e permanece ao recarregar', async ({ page }) => {
  const state = await setup(page);
  await tool(page, 'Lápis'); await page.getByRole('button', { name: 'Cor #fb7185', exact: true }).click();
  await stroke(page);
  await expect(page.locator('[data-drawing-id]')).toHaveCount(1);
  expect(state.boards[0].drawings[0]).toMatchObject({ kind: 'pencil', color: '#fb7185', authorUserId: 'gm' });
  expect(state.boards[0].drawings[0].points.length).toBeGreaterThan(3);
  await page.keyboard.press('Control+z'); await expect(page.locator('[data-drawing-id]')).toHaveCount(0);
  await page.keyboard.press('Control+Shift+z'); await expect(page.locator('[data-drawing-id]')).toHaveCount(1);
  expect(state.writes.filter(w => w.path.includes('/edits/')).every(w => w.boardId === 'general-canvas')).toBe(true);
  await page.reload(); await expect(page.locator('[data-drawing-id]')).toHaveCount(1);
});
test('formas, texto, borracha e limpeza oferecem desfazer e preservam undo em campos de texto', async ({ page }) => {
  const state = await setup(page);
  for (const name of ['Linha', 'Seta', 'Retângulo', 'Elipse']) { await tool(page, name); await stroke(page, [[.3, .6], [.6, .8]]); await expect(page.locator('[data-drawing-id]')).toHaveCount(state.boards[0].drawings.length); }
  await tool(page, 'Texto'); await page.getByRole('textbox', { name: 'Texto do desenho' }).fill('Saída norte');
  const writes = state.writes.length; await page.keyboard.press('Control+z'); expect(state.writes).toHaveLength(writes);
  await page.getByRole('textbox', { name: 'Texto do desenho' }).fill('Saída norte'); await clickMap(page, .3, .85);
  await expect(page.locator('.map-drawing-layer text')).toHaveText('Saída norte');
  await tool(page, 'Borracha'); await clickMap(page, .45, .7); await expect(page.locator('[data-drawing-id]')).toHaveCount(4);
  await page.keyboard.press('Control+z'); await expect(page.locator('[data-drawing-id]')).toHaveCount(5);
  await openTools(page); await page.getByRole('button', { name: 'Limpar meus desenhos', exact: true }).click();
  await expect(page.locator('[data-drawing-id]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Desfazer desenho ou ping', exact: true }).click(); await expect(page.locator('[data-drawing-id]')).toHaveCount(5);
});
test('Ctrl+Z cancela o traço em andamento sem salvar e sem desfazer a ação anterior', async ({ page }) => {
  const state = await setup(page); await tool(page, 'Lápis');
  await stroke(page); await expect(page.locator('[data-drawing-id]')).toHaveCount(1);
  const start = await point(page, .25, .8), end = await point(page, .6, .9);
  await page.mouse.move(start.x, start.y); await page.mouse.down(); await page.mouse.move(end.x, end.y, { steps: 8 });
  await page.keyboard.press('Control+z'); await page.mouse.up();
  await expect(page.locator('[data-drawing-id]')).toHaveCount(1);
  expect(state.writes.filter(w => w.path.endsWith('/drawings'))).toHaveLength(1);
  expect(state.writes.filter(w => w.path.includes('/edits/'))).toHaveLength(0);
});
test('ping mostra autor, pode ser desfeito e refeito, e expira após três segundos', async ({ page }) => {
  const state = await setup(page, 'player');
  await tool(page, 'Ping'); await clickMap(page, .45, .65);
  await expect(page.locator('.map-ping')).toHaveText('Ana');
  await page.keyboard.press('Control+z'); await expect(page.locator('.map-ping')).toHaveCount(0);
  await page.keyboard.press('Control+y'); await expect(page.locator('.map-ping')).toHaveCount(1);
  expect(state.writes.filter(w => w.path.includes('/pings')).every(w => w.boardId === 'general-canvas')).toBe(true);
  await expect(page.locator('.map-ping')).toHaveCount(0, { timeout: 4000 });
  await page.getByRole('button', { name: 'Concluir desenho' }).click();
  await page.keyboard.down('Alt'); await clickMap(page, .55, .75); await page.keyboard.up('Alt');
  await expect(page.locator('.map-ping')).toHaveCount(1);
});
test('Alt+clique funciona sobre pins e caminhos durante a edição sem acionar outras ferramentas', async ({ page }) => {
  const state = await setup(page);
  await mode(page, 'network'); await stroke(page, [[.2, .65], [.8, .65]]);
  await expect(page.locator('.map-network-road')).toHaveCount(1);
  await page.keyboard.down('Alt'); await clickMap(page, .45, .65); await page.keyboard.up('Alt');
  await expect(page.locator('.map-ping')).toHaveCount(1);
  await expect(page.locator('.map-network-road')).toHaveCount(1);
  await page.keyboard.press('Control+z'); await expect(page.locator('.map-ping')).toHaveCount(0);
  await expect(page.locator('.map-network-road')).toHaveCount(1);
  await page.getByRole('button', { name: 'Salvar caminhos', exact: true }).click();
  await mode(page, 'pins');
  await page.getByRole('button', { name: 'Cidade', exact: true }).click({ modifiers: ['Alt'] });
  await expect(page.locator('.map-ping')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Cidade', exact: true })).toHaveAttribute('aria-pressed', 'false');
  expect(state.writes.some(w => w.path.includes('/pins/'))).toBe(false);
  await mode(page, 'view'); await tool(page, 'Borracha');
  await page.keyboard.down('Alt'); await clickMap(page, .45, .7); await page.keyboard.up('Alt');
  await expect.poll(() => state.writes.filter(w => w.path.endsWith('/pings')).length).toBe(3);
  expect(state.writes.some(w => w.path.includes('/drawings/'))).toBe(false);
});
test('Ctrl+arrastar usa lápis temporário, inclusive sobre pins, e preserva o modo e o desfazer', async ({ page }) => {
  const state = await setup(page);
  await tool(page, 'Linha');
  await page.keyboard.down('Control'); await stroke(page); await page.keyboard.up('Control');
  await expect(page.locator('[data-drawing-id]')).toHaveCount(1);
  expect(state.boards[0].drawings[0].kind).toBe('pencil');
  expect(state.boards[0].drawings[0].points.length).toBeGreaterThan(3);
  await expect(page.locator('.map-drawing-summary button[aria-expanded]')).toHaveText('✎ Linha');
  await stroke(page); await expect(page.locator('[data-drawing-id]')).toHaveCount(2);
  expect(state.boards[0].drawings[1].kind).toBe('line');
  await mode(page, 'network');
  await page.keyboard.down('Control'); await stroke(page); await page.keyboard.up('Control');
  await expect(page.locator('[data-drawing-id]')).toHaveCount(3);
  await expect(page.locator('.map-network-road')).toHaveCount(0);
  await page.keyboard.press('Control+z'); await expect(page.locator('[data-drawing-id]')).toHaveCount(2);
  await page.keyboard.press('Control+y'); await expect(page.locator('[data-drawing-id]')).toHaveCount(3);
  await mode(page, 'pins');
  const pin = page.getByRole('button', { name: 'Cidade', exact: true }), b = await pin.boundingBox();
  await page.keyboard.down('Control'); await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down();
  const end = await point(page, .8, .8); await page.mouse.move(end.x, end.y, { steps: 8 }); await page.mouse.up(); await page.keyboard.up('Control');
  await expect(page.locator('[data-drawing-id]')).toHaveCount(4);
  expect(state.boards[0].pins[0]).toMatchObject({ x: .65, y: .55 });
  expect(state.writes.some(w => w.path.includes('/pins/'))).toBe(false);
  await expect(pin).toHaveAttribute('aria-pressed', 'false');
  await page.keyboard.press('Control+z'); await expect(page.locator('[data-drawing-id]')).toHaveCount(3);
});
test('Ctrl+Z cancela o lápis temporário durante a edição de caminhos', async ({ page }) => {
  const state = await setup(page); await mode(page, 'network');
  await stroke(page, [[.2, .65], [.8, .65]]); await expect(page.locator('.map-network-road')).toHaveCount(1);
  const a = await point(page, .2, .85), b = await point(page, .7, .85);
  await page.keyboard.down('Control'); await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 8 });
  await page.keyboard.press('z'); await page.mouse.up(); await page.keyboard.up('Control');
  await expect(page.locator('[data-drawing-id]')).toHaveCount(0);
  await expect(page.locator('.map-network-road')).toHaveCount(1);
  expect(state.writes.some(w => w.path.endsWith('/drawings'))).toBe(false);
});
test('salvamento do lápis mantém Alt+clique ativo e não transfere Ctrl+Z para os caminhos', async ({ page }) => {
  const state = await setup(page); await mode(page, 'network');
  await stroke(page, [[.2, .65], [.8, .65]]); await expect(page.locator('.map-network-road')).toHaveCount(1);
  state.saveDelay = 2000;
  await page.keyboard.down('Control'); await stroke(page, [[.2, .8], [.6, .85]]); await page.keyboard.up('Control');
  await page.keyboard.press('Control+z'); await expect(page.locator('.map-network-road')).toHaveCount(1);
  await page.keyboard.down('Alt'); await clickMap(page, .45, .65); await page.keyboard.up('Alt');
  await expect(page.locator('.map-ping')).toHaveCount(1);
  await page.keyboard.down('Control'); await clickMap(page, .45, .65); await page.keyboard.up('Control');
  await expect(page.locator('.map-network-road')).toHaveCount(1);
  await expect(page.locator('[data-drawing-id]')).toHaveCount(1);
  expect(state.writes.filter(w => w.path.endsWith('/drawings'))).toHaveLength(1);
  expect(state.writes.some(w => w.path.includes('/edits/'))).toBe(false);
});
test('atalhos funcionam ao calibrar regiões sem adicionar pontos à régua nem interceptar menus', async ({ page }) => {
  const state = await setup(page); await mode(page, 'regions');
  await page.getByRole('button', { name: 'Regiões', exact: true }).click({ modifiers: ['Alt'] });
  await expect(page.getByRole('menuitem', { name: 'Calibrar escala', exact: true })).toBeVisible();
  expect(state.writes).toHaveLength(0);
  await page.getByRole('menuitem', { name: 'Calibrar escala', exact: true }).click();
  await page.keyboard.down('Alt'); await clickMap(page, .45, .7); await page.keyboard.up('Alt');
  await expect(page.locator('.map-ping')).toHaveCount(1);
  await page.keyboard.down('Control'); await stroke(page); await page.keyboard.up('Control');
  await expect(page.locator('[data-drawing-id]')).toHaveCount(1);
  await expect(page.locator('.image-map-ruler')).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: 'Calibrar escala', exact: true })).toHaveCount(0);
  expect(state.writes.every(w => w.path.endsWith('/pings') || w.path.endsWith('/drawings'))).toBe(true);
});
test('ping mantém círculo e ondas centrados no clique com uma legenda espaçosa', async ({ page }) => {
  const state = await setup(page, 'player'); state.authorName = 'Ana — Arqueira de Brisacampo';
  await page.locator('.image-map-art').scrollIntoViewIfNeeded();
  const target = await point(page, .45, .7);
  await page.keyboard.down('Alt'); await page.mouse.click(target.x, target.y); await page.keyboard.up('Alt');
  const circle = page.locator('.map-ping > span'); await expect(circle).toBeVisible();
  const bounds = await circle.boundingBox();
  expect(Math.abs(bounds.x + bounds.width / 2 - target.x)).toBeLessThan(1);
  expect(Math.abs(bounds.y + bounds.height / 2 - target.y)).toBeLessThan(1);
  const label = await page.locator('.map-ping strong').boundingBox();
  expect(label.height).toBeGreaterThan(25); expect(label.y).toBeGreaterThan(bounds.y + bounds.height);
  expect(label.width).toBeGreaterThan(150);
  const pulse = await circle.evaluate(node => {
    const style = getComputedStyle(node, '::before'), matrix = new DOMMatrix(style.transform);
    const origin = style.transformOrigin.split(' ').map(parseFloat);
    return { x: parseFloat(style.left) + origin[0] + matrix.e, y: parseFloat(style.top) + origin[1] + matrix.f, center: node.clientWidth / 2 };
  });
  expect(Math.abs(pulse.x - pulse.center)).toBeLessThan(.1); expect(Math.abs(pulse.y - pulse.center)).toBeLessThan(.1);
  await page.locator('.image-map').screenshot({ path: test.info().outputPath('ping-centered.png') });
});
test('mapas têm camadas e históricos separados e Visualizar como não permite alterações', async ({ page }) => {
  const state = await setup(page); await tool(page, 'Lápis'); await stroke(page);
  await expect(page.locator('[data-drawing-id]')).toHaveCount(1);
  await page.getByRole('button', { name: 'Mapas', exact: true }).click(); await page.getByRole('menuitemradio', { name: /^Mapa regional/ }).click();
  await expect(page.locator('[data-drawing-id]')).toHaveCount(0); await expect(page.getByRole('button', { name: 'Desfazer desenho ou ping' })).toBeDisabled();
  await tool(page, 'Linha'); await stroke(page); await expect(page.locator('[data-drawing-id]')).toHaveCount(1);
  await page.keyboard.press('Control+z'); await expect(page.locator('[data-drawing-id]')).toHaveCount(0);
  expect(state.writes.at(-1).boardId).toBe('regional-canvas');
  await page.getByLabel('Visualizar como').selectOption('ana'); await expect(page.locator('.map-drawing-summary button[aria-expanded]')).toBeDisabled();
  const before = state.writes.length; await page.keyboard.press('Control+z');
  await page.keyboard.down('Alt'); await clickMap(page, .45, .7); await page.keyboard.up('Alt');
  await page.keyboard.down('Control'); await stroke(page); await page.keyboard.up('Control');
  expect(state.writes).toHaveLength(before);
});
test('caminhos desfazem desenho, movimento e exclusão; desfazer depois de salvar exige novo salvamento', async ({ page }) => {
  const state = await setup(page); await mode(page, 'network'); await stroke(page, [[.2, .65], [.8, .65]]);
  await expect(page.locator('.map-network-road')).toHaveCount(1);
  await page.keyboard.press('Control+z'); await expect(page.locator('.map-network-road')).toHaveCount(0);
  await page.keyboard.press('Control+y'); await expect(page.locator('.map-network-road')).toHaveCount(1);
  await page.locator('.map-network-node').first().focus(); await page.keyboard.press('ArrowDown');
  const moved = await page.locator('.map-network-node').first().getAttribute('cy');
  await page.keyboard.press('Control+z'); expect(await page.locator('.map-network-node').first().getAttribute('cy')).not.toBe(moved);
  await page.getByRole('button', { name: 'Salvar caminhos', exact: true }).click(); await expect(page.getByRole('button', { name: 'Salvar caminhos', exact: true })).toBeDisabled();
  await page.keyboard.press('Control+z'); await expect(page.locator('.map-network-road')).toHaveCount(0); await expect(page.getByRole('button', { name: 'Salvar caminhos', exact: true })).toBeEnabled();
  await page.keyboard.press('Control+Shift+z'); await clickMap(page, .5, .65); await page.getByRole('button', { name: 'Excluir trecho', exact: true }).click();
  await expect(page.locator('.map-network-road')).toHaveCount(0); await page.keyboard.press('Control+z'); await expect(page.locator('.map-network-road')).toHaveCount(1);
  expect(state.writes.filter(w => w.path.endsWith('/network'))).toHaveLength(1);
});
test('pins desfazem movimento e exclusão e preservam a posição em conflitos', async ({ page }) => {
  const state = await setup(page); await mode(page, 'pins');
  const original = { ...state.boards[0].pins[0] }, button = page.getByRole('button', { name: 'Cidade', exact: true }), b = await button.boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down(); await page.mouse.move(b.x + b.width / 2 + 70, b.y + b.height / 2 + 25, { steps: 8 }); await page.mouse.up();
  await expect(page.getByRole('button', { name: 'Desfazer pin' })).toBeEnabled();
  expect(state.boards[0].pins[0].x).not.toBe(original.x);
  await page.keyboard.press('Control+z'); await expect.poll(() => state.boards[0].pins[0].x).toBe(original.x);
  await expect(page.getByRole('button', { name: 'Refazer pin' })).toBeEnabled();
  await page.keyboard.press('Control+y'); await expect.poll(() => state.boards[0].pins[0].x).not.toBe(original.x);
  await button.click(); await page.getByRole('button', { name: 'Remover pin Cidade', exact: true }).click(); await expect(button).toHaveCount(0);
  await page.keyboard.press('Control+z'); await expect(button).toBeVisible();
  state.conflict = true; const unchanged = state.boards[0].pins[0].x;
  await page.keyboard.press('Control+z'); await expect(page.getByRole('alert')).toContainText('Outra pessoa'); expect(state.boards[0].pins[0].x).toBe(unchanged);
});
test('menu é compacto em celular e fecha ao tocar fora sem desativar a ferramenta', async ({ page }) => {
  await setup(page); await page.setViewportSize({ width: 390, height: 844 }); await tool(page, 'Lápis');
  const toolbar = await page.locator('.map-drawing-toolbar').boundingBox(); expect(toolbar.width).toBeLessThan(360);
  await stroke(page); await expect(page.locator('.map-drawing-options')).toBeHidden(); await expect(page.locator('[data-drawing-id]')).toHaveCount(1);
  await page.screenshot({ path: '.tmp/map-canvas/mobile.png' });
});
