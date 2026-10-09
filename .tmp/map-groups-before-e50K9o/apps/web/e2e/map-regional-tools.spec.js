import { test, expect } from '@playwright/test';
import { findRoadPath, findRoadPaths, nearestRoadPoint, normalizeRoadNetwork } from '@sao/domain';

const campaignId = 'regional-tools-test';
const pin = (id, entityId, name, x, y, pinType = 'location') => ({ id, entityType: 'location', entityId, locationId: entityId, name, x, y, pinType, version: 1 });

const players = [{ user: { id: 'player-ana', name: 'Ana' }, role: 'player' }, { user: { id: 'player-beto', name: 'Beto' }, role: 'player' }];
const markerCandidates = [{ ownerType: 'player', ownerId: 'player-ana', name: 'Ana' }, { ownerType: 'player', ownerId: 'player-beto', name: 'Beto' }, { ownerType: 'group', ownerId: 'group.explorers', name: 'Exploradores' }];

function networkPaths(board, from, to, viaEdgeId, limit = 6) {
  const factor = board.scale && board.roadNetwork ? board.scale.distanceKm / Math.hypot((board.scale.endX - board.scale.startX) * board.roadNetwork.imageWidth, (board.scale.endY - board.scale.startY) * board.roadNetwork.imageHeight) : null;
  return findRoadPaths(board.roadNetwork, from, to, factor, { limit, coverageLimit: 32, allowReturns: Boolean(viaEdgeId), preferredEdgeIds: viaEdgeId ? [viaEdgeId] : [], fromTerritory: board.boundaries.find((boundary) => boundary.regionId === (from.entityId ?? from.locationId))?.points, toTerritory: board.boundaries.find((boundary) => boundary.regionId === (to.entityId ?? to.locationId))?.points });
}

async function setup(page, { role = 'gm', scale = null, network = null, legacy = false, extraPins = [], distances = [], boundaries = [], previewHiddenIds = [] } = {}) {
  const boards = [
    { id: 'general-board', regionId: null, name: 'Mapa geral', imageUrl: 'https://map.test/general.svg', version: 1, regions: [], pins: [pin('pin-mill', 'loc.mill', 'Fazenda Moinho', .25, .45), pin('pin-plains', 'loc.plains', 'Planícies verdejantes', .7, .45, 'region')], routes: [], distances: [], boundaries: [], scale },
    { id: 'region-board', regionId: 'loc.plains', regionName: 'Planícies verdejantes', floor: '1', name: 'Mapa das Planícies', imageUrl: 'https://map.test/plains.svg', version: 1, regions: [], pins: [pin('pin-grove', 'loc.grove', 'Bosque do Peregrino', .35, .4)], routes: [], distances: [], boundaries: [], scale: null }
  ];
  const regions = [{ id: 'loc.plains', name: 'Planícies verdejantes', boardId: 'region-board', imageUrl: 'https://map.test/plains.svg' }, { id: 'loc.hills', name: 'Serra dourada', imageUrl: 'https://map.test/hills.svg' }];
  boards[0].roadNetwork = network;
  boards[0].pins.push(...extraPins); boards[0].distances = distances; boards[0].boundaries = boundaries;
  for (const board of boards) Object.assign(board, { travelMarkers: [], markerCandidates, boundaryCandidates: [{ id: 'loc.mill', name: 'Fazenda Moinho' }, { id: 'loc.grove', name: 'Bosque do Peregrino' }, ...regions.map(({ id, name }) => ({ id, name }))] });
  if (legacy) boards[0].routes.push({ id: 'legacy-route', fromPinId: 'pin-mill', toPinId: 'pin-plains', points: [], distanceKm: 999, version: 1 });
  const writes = []; const reads = []; const contentReads = [];
  await page.route('https://map.test/**', (route) => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="600"><rect width="1200" height="600" fill="#224c68"/></svg>' }));
  await page.route('https://images.test/**', (route) => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="8000" height="8000"><rect width="8000" height="8000" fill="#987032"/></svg>' }));
  await page.route('**/api/v1/**', async (route) => {
    const req = route.request(); const url = new URL(req.url()); const path = url.pathname;
    const selectedId = url.searchParams.get('boardId');
    if (req.method() === 'GET' && (path.endsWith('/map/boards') || path.endsWith('/map/board')) && !boards.some((entry) => !entry.regionId)) boards.unshift({ id: 'replacement-general-board', regionId: null, name: 'Mapa da campanha', imageUrl: null, version: 1, regions: [], pins: [], routes: [], distances: [], boundaries: [], scale: null });
    const board = selectedId ? boards.find((entry) => entry.id === selectedId) : boards.find((entry) => !entry.regionId);
    const viewer = url.searchParams.get('viewAsUserId');
    const visiblePins = board?.pins.filter((pin) => !viewer || !previewHiddenIds.includes(pin.id)) ?? [];
    const available = [...visiblePins, ...(board?.travelMarkers ?? [])];
    const json = (body, status = 200) => {
      if (body === board && board) {
        const distances = board.distances.flatMap((entry) => {
          const from = visiblePins.find((pin) => pin.entityId === entry.fromLocationId), to = visiblePins.find((pin) => pin.entityId === entry.toLocationId);
          if (!from || !to) return [];
          const path = board.roadNetwork ? networkPaths(board, from, to, null, 1) : null;
          return [{ ...entry, catalogDistanceKm: entry.distanceKm, distanceKm: path ? path.distanceKm : entry.distanceKm, networkStatus: path?.status ?? null, distanceSource: path ? 'network' : 'catalog' }];
        });
        body = { ...board, pins: visiblePins, distances, boundaryCandidates: viewer || role === 'player' ? [] : board.boundaryCandidates ?? [], markerCandidates: viewer ? [] : role === 'player' ? markerCandidates.filter((entry) => entry.ownerType === 'player' && entry.ownerId === 'player-ana') : board.markerCandidates ?? [], travelMarkers: (board.travelMarkers ?? []).map((marker) => ({ ...marker, canMove: !viewer && (role !== 'player' || (marker.ownerType === 'player' && marker.ownerId === 'player-ana')) })) };
      }
      return route.fulfill({ json: body, status });
    };
    if (path.endsWith('/auth/me')) return json({ id: role === 'player' ? 'player-ana' : 'gm-test', name: role === 'player' ? 'Ana' : 'Mestre' });
    if (path.endsWith('/auth/csrf')) return json({ csrfToken: 'test' });
    if (path.endsWith(`/campaigns/${campaignId}`)) return json({ id: campaignId, name: 'Teste regional', role });
    if (path.endsWith('/memberships')) { reads.push({ path }); return json(players); }
    if (path.endsWith('/players') && req.method() === 'GET') return json({ error: { code: 'NOT_FOUND', message: 'Rota não encontrada' } }, 404);
    if (req.method() !== 'GET') writes.push({ path, boardId: selectedId, method: req.method(), body: req.postDataJSON(), headers: req.headers() });
    if (path.endsWith('/map/boards') && req.method() === 'GET') return json({ items: boards.map(({ id, name, regionId, regionName, floor, imageUrl, version }) => ({ id, name, regionId, regionName, floor, imageUrl, version })), regions });
    if (path.endsWith('/map/boards') && req.method() === 'POST') {
      const input = req.postDataJSON(); const region = regions.find((entry) => entry.id === input.regionId);
      const created = { id: 'created-board', ...input, regionName: region.name, version: 1, pins: [], routes: [], distances: [], boundaries: [], scale: null, travelMarkers: [], markerCandidates, boundaryCandidates: boards[0].boundaryCandidates };
      boards.push(created); region.boardId = created.id;
      return json(created, 201);
    }
    if (path.includes('/map/boards/') && req.method() === 'DELETE') {
      const index = boards.findIndex((entry) => entry.id === path.split('/').at(-1));
      if (index < 0) return json({ error: { code: 'NOT_FOUND', message: 'Mapa não encontrado' } }, 404);
      if (Number(req.headers()['if-match']) !== boards[index].version) return json({ error: { code: 'VERSION_CONFLICT', message: 'O mapa foi alterado por outra pessoa' } }, 409);
      const [deleted] = boards.splice(index, 1);
      const region = regions.find((entry) => entry.id === deleted.regionId);
      if (region) region.boardId = null;
      return route.fulfill({ status: 204 });
    }
    if (path.endsWith('/map/board') && req.method() === 'GET') { reads.push({ boardId: selectedId, viewAsUserId: viewer }); return board ? json(board) : json({ error: { code: 'NOT_FOUND', message: 'Mapa não encontrado' } }, 404); }
    if (path.endsWith('/map/board') && req.method() === 'PATCH') { Object.assign(board, req.postDataJSON(), { version: board.version + 1 }); return json(board); }
    if (path.endsWith('/map/network') && req.method() === 'PUT') {
      if (Number(req.headers()['if-match']) !== board.version) return json({ error: { code: 'VERSION_CONFLICT', message: 'O mapa foi alterado por outra pessoa' } }, 409);
      board.roadNetwork = normalizeRoadNetwork(req.postDataJSON()); board.version += 1;
      return json(board);
    }
    if (path.endsWith('/map/network/path')) {
      const fromPinId = url.searchParams.get('fromPinId'), toPinId = url.searchParams.get('toPinId'), viaEdgeId = url.searchParams.get('viaEdgeId');
      reads.push({ path, boardId: selectedId, fromPinId, toPinId, viaEdgeId, viewAsUserId: viewer });
      const from = available.find((pin) => pin.id === fromPinId), to = available.find((pin) => pin.id === toPinId);
      if (!from || !to) return json({ error: { code: 'NOT_FOUND', message: 'Pin não encontrado neste mapa' } }, 404);
      const paths = networkPaths(board, from, to, viaEdgeId);
      return json({ ...paths, alternatives: paths.paths, version: board.version, boardId: board.id, fromPinId, toPinId });
    }
    if (path.endsWith('/map/network/destinations')) {
      const fromPinId = url.searchParams.get('fromPinId'), from = available.find((pin) => pin.id === fromPinId);
      reads.push({ path, fromPinId, viewAsUserId: viewer });
      const items = available.filter((pin) => pin.id !== fromPinId).flatMap((to) => {
        const path = networkPaths(board, from, to, null, 1);
        return path.status === 'found' ? [{ toPinId: to.id, toName: to.name, toLocationId: to.locationId, distanceKm: path.distanceKm, distancePixels: path.distancePixels }] : [];
      });
      return json({ boardId: board.id, version: board.version, fromPinId, items });
    }
    if (path.endsWith('/map/markers') && req.method() === 'POST') {
      const input = req.postDataJSON();
      if (role === 'player' && input.ownerType === 'player') input.ownerId ??= 'player-ana';
      const candidate = markerCandidates.find((entry) => entry.ownerType === input.ownerType && entry.ownerId === input.ownerId);
      board.travelMarkers.push({ ...input, id: `marker-${board.travelMarkers.length + 1}`, name: input.name ?? candidate?.name ?? 'Grupo', ...(board.roadNetwork ? nearestRoadPoint(board.roadNetwork, input)?.point : input), version: 1, color: '#fb923c', canMove: true }); board.version += 1;
      return json(board, 201);
    }
    if (path.includes('/map/markers/') && req.method() === 'PATCH') {
      const marker = board.travelMarkers.find((entry) => entry.id === path.split('/').at(-1)), input = req.postDataJSON();
      Object.assign(marker, input, board.roadNetwork ? nearestRoadPoint(board.roadNetwork, input)?.point : input, { version: marker.version + 1 }); board.version += 1;
      return json(board);
    }
    if (path.includes('/map/pins/') && req.method() === 'PATCH') {
      const selected = board.pins.find((entry) => entry.id === path.split('/').at(-1));
      Object.assign(selected, req.postDataJSON(), { version: selected.version + 1 }); board.version += 1;
      return json(board);
    }
    if (path.endsWith('/map/routes') && req.method() === 'POST') {
      board.routes.push({ id: 'route-test', ...req.postDataJSON(), version: 1, points: [] });
      return json(board, 201);
    }
    if (path.endsWith('/map/board/scale') && req.method() === 'PATCH') {
      const input = req.postDataJSON(); const calibration = { ...(board.scale ?? {}), ...input };
      const pixelLength = Math.hypot((calibration.endX - calibration.startX) * calibration.imageWidth, (calibration.endY - calibration.startY) * calibration.imageHeight);
      board.scale = { ...calibration, pixelLength, kmPerPixel: calibration.distanceKm / pixelLength };
      board.scaleKm = calibration.imageWidth * board.scale.kmPerPixel; board.version += 1;
      return json(board);
    }
    if (path.endsWith('/map/boundaries') && req.method() === 'POST') {
      const input = req.postDataJSON(); const region = board.boundaryCandidates.find((entry) => entry.id === input.regionId);
      board.boundaries.push({ id: `boundary-${board.boundaries.length + 1}`, ...input, label: input.name, name: input.name ?? region.name, locationName: region.name, updatedBy: { id: 'gm-test', name: 'Mestre' }, updatedAt: new Date().toISOString(), version: 1 }); board.version += 1;
      return json(board, 201);
    }
    if (path.includes('/map/boundaries/') && req.method() === 'PATCH') {
      const boundary = board.boundaries.find(entry => entry.id === path.split('/').at(-1));
      if (!boundary) return json({ error: { code: 'NOT_FOUND', message: 'Limite não encontrado' } }, 404);
      if (Number(req.headers()['if-match']) !== boundary.version) return json({ error: { code: 'VERSION_CONFLICT', message: 'O limite foi alterado' } }, 409);
      const input = req.postDataJSON(), region = board.boundaryCandidates.find(entry => entry.id === (input.regionId ?? boundary.regionId));
      Object.assign(boundary, input, { label: input.name, name: input.name ?? region.name, locationName: region.name, updatedBy: { id: 'gm-test', name: 'Mestre' }, updatedAt: new Date().toISOString(), version: boundary.version + 1 }); board.version += 1;
      return json(board);
    }
    if (path.includes('/map/boundaries/') && req.method() === 'DELETE') {
      const index = board.boundaries.findIndex(entry => entry.id === path.split('/').at(-1));
      if (index < 0) return json({ error: { code: 'NOT_FOUND', message: 'Limite não encontrado' } }, 404);
      if (Number(req.headers()['if-match']) !== board.boundaries[index].version) return json({ error: { code: 'VERSION_CONFLICT', message: 'O limite foi alterado' } }, 409);
      board.boundaries.splice(index, 1); board.version += 1; return route.fulfill({ status: 204 });
    }
    if (path.endsWith('/content')) {
      const category = url.searchParams.get('category'); contentReads.push({ boardId: selectedId, category, path });
      const items = category === 'monstros' ? [{ type: 'monster', id: 'monster.wolf', name: 'Lobo cinzento', subtitle: 'Comum', imageUrl: 'https://images.test/wolf.svg' }]
        : category === 'itens' ? [{ type: 'item', id: 'item.grain', name: 'Trigo', subtitle: 'Material', imageUrl: 'https://images.test/grain.svg' }]
          : category === 'npcs' ? [{ type: 'npc', id: 'npc.miller', name: 'Moleiro', imageUrl: 'https://images.test/miller.svg' }]
            : [];
      return json({ pinId: path.split('/').at(-2), category, items, ...(category === 'informacoes' ? { information: { description: 'Fazenda de trigo e moinho de água.', fields: [{ label: 'Ambiente', value: 'Planície' }] } } : {}) });
    }
    if (path.endsWith('/map/pin-candidates')) return json({ items: [] });
    return json({ items: [] });
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/campaigns/${campaignId}/map`);
  await expect(page.getByRole('heading', { name: 'Mapa geral', exact: true })).toBeVisible();
  await expect(page.locator('.image-map-art')).toBeVisible();
  return { boards, writes, reads, contentReads };
}

async function chooseMap(page, name) {
  await page.getByRole('button', { name: 'Mapas', exact: true }).click();
  await page.getByRole('menuitemradio', { name: new RegExp(`^${name}`) }).click();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
}

async function mapAction(page, name) {
  await page.getByRole('button', { name: 'Mapas', exact: true }).click();
  await page.getByRole('menuitem', { name, exact: true }).click();
}

async function editorMode(page, mode) {
  const button = page.getByRole('button', { name: 'Modo de edição', exact: true });
  for (let i = 0; i < 4 && await button.getAttribute('data-mode') !== mode; i += 1) {
    const current = await button.getAttribute('data-mode'); await button.click();
    await expect(button).not.toHaveAttribute('data-mode', current);
  }
  await expect(button).toHaveAttribute('data-mode', mode);
}

async function mapTool(page, name) {
  await editorMode(page, 'regions');
  await page.getByRole('button', { name: 'Regiões', exact: true }).click();
  await page.getByRole('menuitem', { name, exact: true }).click();
}

async function editPins(page) { await editorMode(page, 'pins'); }

async function clickMap(page, x, y) {
  const image = page.locator('.image-map-art');
  const bounds = await image.boundingBox();
  await image.click({ position: { x: bounds.width * x, y: bounds.height * y } });
}

async function roadsMode(page, name) {
  if (name === 'Editar rede') return editorMode(page, 'network');
  await editorMode(page, 'view');
  const button = page.getByRole('button', { name: 'Consultar percurso', exact: true });
  if (await button.getAttribute('aria-pressed') !== 'true') await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
}

async function drawRoad(page, points) {
  await page.locator('.image-map-art').scrollIntoViewIfNeeded();
  const bounds = await page.locator('.image-map-art').boundingBox();
  await page.mouse.move(bounds.x + points[0][0] * bounds.width, bounds.y + points[0][1] * bounds.height);
  await page.mouse.down();
  for (const [x, y] of points.slice(1)) await page.mouse.move(bounds.x + x * bounds.width, bounds.y + y * bounds.height, { steps: 10 });
  await page.mouse.up();
}

const sharedRoad = { imageWidth: 1200, imageHeight: 600, nodes: [{ id: 'west', x: .1, y: .5 }, { id: 'east', x: .9, y: .5 }], edges: [{ id: 'main', from: 'west', to: 'east' }] };
const calibratedScale = { startX: .1, startY: .8, endX: .6, endY: .8, distanceKm: 10, imageWidth: 1200, imageHeight: 600, pixelLength: 600, kmPerPixel: 10 / 600 };
const alternateRoad = { imageWidth: 1200, imageHeight: 600, nodes: [{ id: 'west', x: .2, y: .45 }, { id: 'east', x: .75, y: .45 }, { id: 'north-west', x: .2, y: .2 }, { id: 'north-east', x: .75, y: .2 }], edges: [{ id: 'direct', from: 'west', to: 'east' }, { id: 'west-access', from: 'west', to: 'north-west' }, { id: 'north-road', from: 'north-west', to: 'north-east' }, { id: 'east-access', from: 'north-east', to: 'east' }] };
const gapRoad = { imageWidth: 1200, imageHeight: 600, nodes: [{ id: 'a', x: .1, y: .45 }, { id: 'b', x: .4, y: .45 }, { id: 'c', x: .4 + 10 / 1200, y: .45 }, { id: 'd', x: .65, y: .45 }, { id: 'e', x: .65 + 10 / 1200, y: .45 }, { id: 'f', x: .9, y: .45 }], edges: [{ id: 'west', from: 'a', to: 'b' }, { id: 'middle', from: 'c', to: 'd' }, { id: 'east', from: 'e', to: 'f' }] };

test('cruzamento antigo funciona na consulta e o reparo do editor só persiste ao salvar', async ({ page }) => {
  const network = { imageWidth: 1200, imageHeight: 600, nodes: [{ id: 'a', x: .1, y: .45 }, { id: 'b', x: .9, y: .45 }, { id: 'c', x: .7, y: .1 }, { id: 'd', x: .7, y: .9 }], edges: [{ id: 'horizontal', from: 'a', to: 'b' }, { id: 'vertical', from: 'c', to: 'd' }] };
  const state = await setup(page, { network }); state.boards[0].pins[1].y = .7; await page.reload();
  await roadsMode(page, 'Consultar percurso');
  await page.getByRole('button', { name: 'Fazenda Moinho', exact: true }).click(); await page.getByRole('button', { name: 'Planícies verdejantes', exact: true }).click();
  await expect(page.locator('.map-network-path')).toHaveCount(1);
  await expect(page.locator('.map-network-road')).toHaveCount(2); expect(state.writes).toEqual([]);
  const bounds = await page.locator('.image-map-art').boundingBox();
  await page.mouse.click(bounds.x + .7 * bounds.width, bounds.y + .8 * bounds.height); await expect.poll(() => state.reads.some(entry => entry.viaEdgeId === 'vertical')).toBe(true);
  await expect(page.locator('.map-network-path')).toHaveCount(1);
  await roadsMode(page, 'Editar rede');
  await expect(page.locator('.map-network-road')).toHaveCount(4); await expect(page.getByRole('button', { name: 'Salvar caminhos', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await page.getByRole('dialog', { name: 'Caminhos não salvos' }).getByRole('button', { name: 'Descartar rascunho' }).click();
  await expect(page.locator('.map-network-road')).toHaveCount(2); expect(state.writes).toEqual([]);
  await roadsMode(page, 'Editar rede'); await page.getByRole('button', { name: 'Salvar caminhos', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Salvar caminhos', exact: true })).toBeDisabled();
  expect(state.boards[0].roadNetwork.edges).toHaveLength(4); expect(state.writes.filter(entry => entry.path.endsWith('/map/network'))).toHaveLength(1);
});

test('revisão de ligações permite navegar, ignorar, unir e descartar sem salvar automaticamente', async ({ page }) => {
  const state = await setup(page, { network: structuredClone(gapRoad), scale: calibratedScale });
  await roadsMode(page, 'Editar rede'); await page.getByRole('button', { name: 'Revisar ligações', exact: true }).click();
  const review = page.getByRole('group', { name: 'Revisar ligações próximas' });
  await expect(review).toContainText('Ligação 1 de 2'); await expect(page.locator('.map-network-connection-suggestion')).toHaveCount(1);
  const first = await page.locator('.map-network-connection-suggestion').getAttribute('points');
  await review.getByRole('button', { name: 'Próximo', exact: false }).click();
  await expect(review).toContainText('Ligação 2 de 2'); await expect(page.locator('.map-network-connection-suggestion')).not.toHaveAttribute('points', first);
  await page.setViewportSize({ width: 390, height: 844 }); await expect(review).toContainText('Ligação 2 de 2');
  if (process.env.MAP_UI_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.MAP_UI_SCREENSHOT_DIR}/connection-review-mobile.png`, fullPage: true });
  await review.getByRole('button', { name: 'Ignorar', exact: true }).click(); await expect(review).toContainText('Ligação 1 de 1');
  await expect(page.getByRole('button', { name: 'Salvar caminhos', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Revisar ligações', exact: true }).click(); await page.getByRole('button', { name: 'Revisar ligações', exact: true }).click();
  await expect(review).toContainText('Ligação 1 de 1');
  await review.getByRole('button', { name: 'Unir', exact: true }).click();
  await expect(review).toContainText('Nenhuma ligação próxima'); await expect(page.getByRole('button', { name: 'Salvar caminhos', exact: true })).toBeEnabled();
  expect(state.writes).toEqual([]); expect(state.boards[0].roadNetwork.nodes).toHaveLength(6);
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await page.getByRole('dialog', { name: 'Caminhos não salvos' }).getByRole('button', { name: 'Descartar rascunho' }).click();
  expect(state.writes).toEqual([]); expect(state.boards[0].roadNetwork.nodes).toHaveLength(6);
  await roadsMode(page, 'Editar rede'); await page.getByRole('button', { name: 'Revisar ligações', exact: true }).click();
  await expect(review).toContainText('Ligação 1 de 2');
  await review.getByRole('button', { name: 'Unir', exact: true }).click(); await review.getByRole('button', { name: 'Unir', exact: true }).click();
  await expect(review).toContainText('Nenhuma ligação próxima');
  await page.getByRole('button', { name: 'Salvar caminhos', exact: true }).click(); await expect(page.getByRole('button', { name: 'Salvar caminhos', exact: true })).toBeDisabled();
  expect(state.boards[0].roadNetwork.nodes).toHaveLength(4);
  await roadsMode(page, 'Consultar percurso'); await page.getByRole('button', { name: 'Fazenda Moinho', exact: true }).click(); await page.getByRole('button', { name: 'Planícies verdejantes', exact: true }).click();
  await expect(page.locator('.map-network-path')).toHaveCount(1);
  expect(state.writes.filter(entry => entry.path.endsWith('/map/network'))).toHaveLength(1);
});

test('união revisada mantém o rascunho durante conflito e exige revisar a versão atual', async ({ page }) => {
  const state = await setup(page, { network: structuredClone(gapRoad) });
  await roadsMode(page, 'Editar rede'); await page.getByRole('button', { name: 'Revisar ligações', exact: true }).click();
  const review = page.getByRole('group', { name: 'Revisar ligações próximas' });
  await review.getByRole('button', { name: 'Unir', exact: true }).click(); await review.getByRole('button', { name: 'Unir', exact: true }).click();
  state.boards[0].version = 2;
  await page.getByRole('button', { name: 'Salvar caminhos', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Revisar alterações' })).toBeVisible();
  expect(state.boards[0].roadNetwork.nodes).toHaveLength(6); await expect(page.locator('.map-network-node')).toHaveCount(4);
  await expect(page.getByRole('button', { name: 'Salvar caminhos', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Revisar alterações' }).click();
  await page.getByRole('dialog', { name: 'Revisar rede alterada' }).getByRole('button', { name: 'Manter meu rascunho' }).click();
  await page.getByRole('button', { name: 'Salvar caminhos', exact: true }).click(); await expect(page.getByRole('button', { name: 'Salvar caminhos', exact: true })).toBeDisabled();
  expect(state.boards[0].roadNetwork.nodes).toHaveLength(4);
  expect(state.writes.filter(entry => entry.path.endsWith('/map/network')).map(entry => entry.headers['if-match'])).toEqual(['1', '2']);
});

test('limite pode ser renomeado, associado a outro local, redesenhado e apagado', async ({ page }) => {
  const state = await setup(page);
  await mapTool(page, 'Delimitar regiões');
  await page.getByLabel('Local ou região do limite').selectOption('loc.plains');
  await drawRoad(page, [[.1, .1], [.6, .1], [.6, .6], [.1, .6], [.1, .1]]);
  await page.getByRole('button', { name: 'Salvar limite', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Editar limite Planícies verdejantes', exact: true })).toBeVisible();
  const original = structuredClone(state.boards[0].boundaries[0]);
  await page.getByRole('button', { name: 'Editar limite Planícies verdejantes', exact: true }).click();
  await page.getByLabel('Local ou região do limite').selectOption('loc.grove');
  await page.getByLabel('Nome do limite').fill('Reserva do Bosque');
  await page.getByRole('button', { name: 'Salvar limite', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Editar limite Reserva do Bosque', exact: true })).toContainText('Última edição por Mestre');
  expect(state.boards[0].boundaries[0]).toMatchObject({ id: original.id, regionId: 'loc.grove', name: 'Reserva do Bosque', version: 2, points: original.points });
  await page.getByRole('button', { name: 'Editar limite Reserva do Bosque', exact: true }).click();
  await page.getByRole('button', { name: 'Refazer desenho', exact: true }).click();
  await drawRoad(page, [[.2, .2], [.8, .2], [.8, .7], [.2, .7], [.2, .2]]);
  await page.getByRole('button', { name: 'Cancelar limite', exact: true }).click();
  expect(state.boards[0].boundaries[0].points).toEqual(original.points);
  await page.getByRole('button', { name: 'Selecionar limite Reserva do Bosque', exact: true }).click();
  await page.getByRole('button', { name: 'Refazer desenho', exact: true }).click();
  await drawRoad(page, [[.2, .2], [.8, .2], [.8, .7], [.2, .7], [.2, .2]]);
  await page.getByRole('button', { name: 'Salvar limite', exact: true }).click();
  await expect.poll(() => state.boards[0].boundaries[0].version).toBe(3);
  expect(state.boards[0].boundaries[0].points).not.toEqual(original.points);
  await page.getByRole('button', { name: 'Editar limite Reserva do Bosque', exact: true }).click();
  if (process.env.MAP_UI_SCREENSHOT_DIR) { await page.evaluate(() => window.scrollTo(0, 0)); await page.screenshot({ path: `${process.env.MAP_UI_SCREENSHOT_DIR}/boundary-manager-desktop.png`, fullPage: true }); }
  await page.getByRole('button', { name: 'Apagar limite', exact: true }).click();
  await expect(page.locator('.image-map-boundary:not(.draft) polygon')).toHaveCount(0);
  expect(state.boards[0].boundaries).toEqual([]);
  expect(state.writes.filter(entry => entry.path.includes('/map/boundaries')).map(entry => entry.method)).toEqual(['POST', 'PATCH', 'PATCH', 'DELETE']);
});

test('painel compacto e móvel permite escolher uma bifurcação com retorno sem salvar caminhos', async ({ page }) => {
  const branch = { imageWidth: 1200, imageHeight: 600, nodes: [{ id: 'west', x: .2, y: .45 }, { id: 'fork', x: .475, y: .45 }, { id: 'east', x: .75, y: .45 }, { id: 'north', x: .475, y: .2 }], edges: [{ id: 'west-road', from: 'west', to: 'fork' }, { id: 'east-road', from: 'fork', to: 'east' }, { id: 'branch-road', from: 'fork', to: 'north' }] };
  const state = await setup(page, { network: branch, scale: calibratedScale });
  await roadsMode(page, 'Consultar percurso');
  await page.getByRole('button', { name: 'Fazenda Moinho', exact: true }).click(); await page.getByRole('button', { name: 'Planícies verdejantes', exact: true }).click();
  const popup = page.getByRole('complementary', { name: 'Percursos possíveis' });
  await expect(popup).toContainText('Percurso 1 de 1');
  await expect(popup.getByRole('button', { name: 'Próximo', exact: false })).toBeDisabled();
  const title = await popup.locator('.map-route-popup-title').boundingBox();
  await page.mouse.move(title.x + 10, title.y + 10); await page.mouse.down();
  await page.mouse.move(title.x + 10, title.y + 410, { steps: 6 }); await page.mouse.up();
  const direct = await page.locator('.map-network-path').getAttribute('points');
  const chooseBranch = async () => {
    const bounds = await page.locator('.image-map-art').boundingBox();
    await page.mouse.click(bounds.x + .475 * bounds.width, bounds.y + .3 * bounds.height);
  };
  await chooseBranch();
  await expect(page.locator('.map-network-path')).not.toHaveAttribute('points', direct);
  await expect(popup).toContainText('14 km'); await expect(popup).toContainText('Com retorno');
  await expect.poll(async () => { const box = await popup.boundingBox(); return box.y + box.height; }).toBeLessThanOrEqual(892);
  await expect(popup).toHaveCSS('position', 'fixed');
  await popup.getByRole('button', { name: 'Anterior', exact: false }).click();
  await expect(page.locator('.map-network-path')).toHaveAttribute('points', direct);
  await expect(popup).toContainText('Percurso 1 de 1');
  await expect(popup).not.toContainText('Com retorno');
  await chooseBranch();
  await expect(popup).toContainText('Percurso 2 de 2');
  if (process.env.MAP_UI_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.MAP_UI_SCREENSHOT_DIR}/route-popup-desktop.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(popup).toBeVisible();
  await expect(popup).toContainText('Percurso 2 de 2');
  const mobileTitle = await popup.locator('.map-route-popup-title').boundingBox();
  await page.mouse.move(mobileTitle.x + 10, mobileTitle.y + 10); await page.mouse.down();
  await page.mouse.move(-100, -100, { steps: 6 }); await page.mouse.up();
  const clamped = await popup.boundingBox();
  expect(clamped.x).toBeGreaterThanOrEqual(8); expect(clamped.y).toBeGreaterThanOrEqual(8);
  if (process.env.MAP_UI_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.MAP_UI_SCREENSHOT_DIR}/route-popup-mobile.png` });
  expect(state.writes).toEqual([]);
});

test('rede começa vazia e une desenhos, cruzamentos e sobreposições sem alterar os caminhos antigos', async ({ page }) => {
  const state = await setup(page, { legacy: true });
  await expect(page.locator('.map-network-road')).toHaveCount(0);
  await expect(page.locator('.image-map-route')).toHaveCount(0);
  await roadsMode(page, 'Editar rede');
  await drawRoad(page, [[.1, .55], [.9, .55]]);
  await expect(page.locator('.map-network-node')).toHaveCount(2);
  await drawRoad(page, [[.5, .2], [.5, .85]]);
  await expect(page.locator('.map-network-road')).toHaveCount(4);
  await expect(page.locator('.map-network-node')).toHaveCount(5);
  await drawRoad(page, [[.3, .55], [.7, .55]]);
  await expect(page.locator('.map-network-road')).toHaveCount(6);
  expect(state.writes).toEqual([]);
  expect(state.boards[0].roadNetwork).toBeNull();
  const firstNode = page.locator('.map-network-node').first();
  await firstNode.focus(); await page.keyboard.press('ArrowUp');
  await page.getByRole('button', { name: 'Salvar caminhos', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Salvar caminhos', exact: true })).toBeDisabled();
  expect(state.writes.filter((entry) => entry.path.endsWith('/map/network'))).toHaveLength(1);
  expect(state.writes[0]).toMatchObject({ method: 'PUT', boardId: 'general-board', headers: { 'if-match': '1' }, body: { imageWidth: 1200, imageHeight: 600 } });
  expect(state.boards[0].routes[0].id).toBe('legacy-route');
  const edges = state.boards[0].roadNetwork.edges;
  expect(new Set(edges.map((edge) => [edge.from, edge.to].sort().join('|'))).size).toBe(edges.length);
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await expect(page.locator('.map-network-node')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.map-network-road')).toHaveCount(6);
  expect(await page.locator('.map-network-road').first().evaluate((el) => getComputedStyle(el).stroke)).toBe('rgb(255, 219, 62)');
  expect(await page.locator('.image-map-route-outline').first().evaluate((el) => getComputedStyle(el).stroke)).toBe('rgb(8, 8, 8)');
});

test('consulta dois pins em azul, inclui acessos e o terceiro clique inicia outra consulta sem popups', async ({ page }) => {
  const state = await setup(page, { role: 'player', network: sharedRoad });
  await page.getByRole('button', { name: 'Consultar percurso', exact: true }).click();
  await expect(page.getByRole('menuitemradio', { name: 'Editar rede', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Consultar percurso', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const from = page.getByRole('button', { name: 'Fazenda Moinho', exact: true }), to = page.getByRole('button', { name: 'Planícies verdejantes', exact: true });
  await from.click(); await expect(page.getByRole('dialog')).toHaveCount(0); await to.click();
  await expect(page.locator('.map-network-path')).toHaveCount(1);
  await expect(page.locator('.map-network-access')).toHaveCount(2);
  await expect(page.locator('.map-network-path')).toHaveCSS('stroke', 'rgb(59, 130, 246)');
  for (const access of await page.locator('.map-network-access').all()) await expect(access).toHaveCSS('stroke', 'rgb(59, 130, 246)');
  await expect(page.locator('.map-route-popup')).toContainText('Sem escala');
  await expect(page.locator('.image-map-pin[aria-pressed="true"]')).toHaveCount(2);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  if (process.env.MAP_UI_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.MAP_UI_SCREENSHOT_DIR}/network-query-desktop.png` });
  await from.click();
  await expect(page.locator('.map-network-path')).toHaveCount(0);
  await expect(page.locator('.image-map-pin[aria-pressed="true"]')).toHaveCount(1);
  expect(state.writes).toEqual([]); expect(state.contentReads).toEqual([]);
  await page.getByRole('button', { name: 'Consultar percurso', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Consultar percurso', exact: true })).toHaveAttribute('aria-pressed', 'false'); await from.click();
  await expect(page.getByRole('dialog', { name: 'Fazenda Moinho', exact: true })).toBeVisible();
});

test('excluir um trecho desconecta a rede e a consulta informa ausência de caminho', async ({ page }) => {
  const state = await setup(page, { network: sharedRoad });
  await roadsMode(page, 'Editar rede');
  await drawRoad(page, [[.4, .5], [.6, .5]]);
  await expect(page.locator('.map-network-road')).toHaveCount(3);
  const bounds = await page.locator('.image-map-art').boundingBox();
  await page.mouse.click(bounds.x + .5 * bounds.width, bounds.y + .5 * bounds.height);
  await page.getByRole('button', { name: 'Excluir trecho', exact: true }).click();
  await expect(page.locator('.map-network-road')).toHaveCount(2);
  await page.getByRole('button', { name: 'Salvar caminhos', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Salvar caminhos', exact: true })).toBeDisabled();
  await roadsMode(page, 'Consultar percurso');
  await page.getByRole('button', { name: 'Fazenda Moinho', exact: true }).click(); await page.getByRole('button', { name: 'Planícies verdejantes', exact: true }).click();
  await expect(page.locator('.map-route-popup')).toContainText('Não existe caminho conectado entre esses locais');
  await expect(page.locator('.map-network-path')).toHaveCount(0);
  expect(state.boards[0].roadNetwork.edges).toHaveLength(2);
});

test('consultas recalculam depois de mudar a escala, mover pins e editar a rede', async ({ page }) => {
  const state = await setup(page, { network: sharedRoad });
  const consult = async () => {
    await roadsMode(page, 'Consultar percurso');
    await page.getByRole('button', { name: 'Fazenda Moinho', exact: true }).click();
    await page.getByRole('button', { name: 'Planícies verdejantes', exact: true }).click();
    await expect(page.locator('.map-network-path')).toHaveCount(1);
  };
  await consult();
  await expect(page.locator('.map-route-popup')).toContainText('Sem escala');
  await mapTool(page, 'Calibrar escala'); await clickMap(page, .1, .85); await clickMap(page, .6, .85);
  const calibration = page.getByRole('dialog', { name: 'Definir escala', exact: true });
  await calibration.getByLabel('Distância do trecho (km)').fill('10'); await calibration.getByRole('button', { name: 'Salvar escala', exact: true }).click();
  await expect(calibration).toHaveCount(0); await consult();
  const kilometers = async () => Number((await page.locator('.map-route-popup').textContent()).match(/([\d,]+) km/)?.[1].replace(',', '.'));
  await expect.poll(kilometers).toBeCloseTo(10, 1);
  await editPins(page);
  const selected = await page.getByRole('button', { name: 'Fazenda Moinho', exact: true }).boundingBox(), image = await page.locator('.image-map-art').boundingBox();
  await page.mouse.move(selected.x + selected.width / 2, selected.y + selected.height / 2); await page.mouse.down();
  await page.mouse.move(selected.x + selected.width / 2 + image.width * .1, selected.y + selected.height / 2, { steps: 6 }); await page.mouse.up();
  await expect.poll(() => state.boards[0].pins[0].x).toBeCloseTo(.35, 2); await consult();
  await expect.poll(kilometers).toBeCloseTo(8, 1);
  await roadsMode(page, 'Editar rede');
  const node = page.locator('.map-network-node').first(); await node.focus(); await page.keyboard.press('ArrowDown');
  await page.getByRole('button', { name: 'Salvar caminhos', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Salvar caminhos', exact: true })).toBeDisabled(); await consult();
  expect(state.reads.filter((entry) => entry.path?.endsWith('/map/network/path'))).toHaveLength(4);
  expect(state.writes.some((entry) => entry.path.includes('/map/routes'))).toBe(false);
});

test('trocar de mapa exige salvar ou descartar o rascunho e continuar mantém os desenhos', async ({ page }) => {
  const state = await setup(page);
  await roadsMode(page, 'Editar rede'); await drawRoad(page, [[.1, .6], [.9, .6]]);
  await page.getByRole('button', { name: 'Mapas', exact: true }).click(); await page.getByRole('menuitemradio', { name: /^Mapa das Planícies/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Caminhos não salvos' });
  await expect(dialog).toBeVisible(); await dialog.getByRole('button', { name: 'Continuar editando' }).click();
  await expect(page.getByRole('heading', { name: 'Mapa geral', exact: true })).toBeVisible(); await expect(page.locator('.map-network-road')).toHaveCount(1);
  await page.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await dialog.getByRole('button', { name: 'Descartar rascunho' }).click();
  await expect(page.locator('.map-network-road')).toHaveCount(0); expect(state.writes).toEqual([]);
  await roadsMode(page, 'Editar rede'); await drawRoad(page, [[.1, .6], [.9, .6]]);
  await page.getByRole('button', { name: 'Mapas', exact: true }).click(); await page.getByRole('menuitemradio', { name: /^Mapa das Planícies/ }).click();
  await dialog.getByRole('button', { name: 'Salvar caminhos', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Mapa das Planícies', exact: true })).toBeVisible();
  expect(state.boards[0].roadNetwork.edges).toHaveLength(1);
  expect(state.boards[1].roadNetwork).toBeUndefined();
});

test('conflito preserva o rascunho e só permite salvar depois de revisar a rede atual', async ({ page }) => {
  const state = await setup(page);
  await roadsMode(page, 'Editar rede'); await drawRoad(page, [[.1, .6], [.9, .6]]);
  state.boards[0].version = 2; state.boards[0].roadNetwork = sharedRoad;
  await page.getByRole('button', { name: 'Salvar caminhos', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Revisar alterações' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Salvar caminhos', exact: true })).toBeDisabled();
  await expect(page.locator('.map-network-road')).toHaveCount(1);
  await page.getByRole('button', { name: 'Revisar alterações' }).click();
  const review = page.getByRole('dialog', { name: 'Revisar rede alterada' });
  await expect(review).toContainText('versão 2');
  await review.getByRole('button', { name: 'Manter meu rascunho' }).click();
  await page.getByRole('button', { name: 'Salvar caminhos', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Salvar caminhos', exact: true })).toBeDisabled();
  expect(state.writes.filter((entry) => entry.path.endsWith('/map/network')).map((entry) => entry.headers['if-match'])).toEqual(['1', '2']);
  expect(state.boards[0].roadNetwork.nodes[0].y).toBeCloseTo(.6, 2);
});

test('voltar no navegador preserva o rascunho até descartar explicitamente', async ({ page }) => {
  await setup(page); await chooseMap(page, 'Mapa das Planícies');
  const historyIndex = await page.evaluate(() => history.state.idx);
  await roadsMode(page, 'Editar rede'); await drawRoad(page, [[.1, .6], [.9, .6]]);
  await page.evaluate(() => history.back());
  const dialog = page.getByRole('dialog', { name: 'Caminhos não salvos' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Continuar editando' }).click();
  await expect(page).toHaveURL(/\?map=region-board$/); await expect(page.locator('.map-network-road')).toHaveCount(1);
  await expect(dialog).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => history.state.idx)).toBe(historyIndex);
  await page.evaluate(() => history.back()); await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Descartar rascunho' }).click();
  await expect(page.getByRole('heading', { name: 'Mapa geral', exact: true })).toBeVisible();
});

test.describe('rede no celular', () => {
  test.use({ hasTouch: true, isMobile: true });
  test('gestos de toque desenham e movem pontos sem salvar automaticamente', async ({ page }) => {
    const state = await setup(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await roadsMode(page, 'Editar rede');
    await page.locator('.image-map-art').scrollIntoViewIfNeeded();
    const bounds = await page.locator('.image-map-art').boundingBox();
    const cdp = await page.context().newCDPSession(page);
    const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
    await touch('touchStart', bounds.x + .15 * bounds.width, bounds.y + .25 * bounds.height);
    for (let i = 1; i <= 10; i += 1) await touch('touchMove', bounds.x + (.15 + .07 * i) * bounds.width, bounds.y + .25 * bounds.height);
    await touch('touchEnd');
    await expect(page.locator('.map-network-node')).toHaveCount(2);
    const node = await page.locator('.map-network-node').first().boundingBox();
    await touch('touchStart', node.x + node.width / 2, node.y + node.height / 2);
    await touch('touchMove', node.x + node.width / 2 + 15, node.y + node.height / 2 + 20); await touch('touchEnd');
    await expect(page.locator('.map-network-node')).toHaveCount(2); expect(state.writes).toEqual([]);
    const finish = await page.locator('.map-network-finish').boundingBox();
    expect(finish.x).toBeGreaterThanOrEqual(8); expect(finish.x + finish.width).toBeLessThanOrEqual(382);
    if (process.env.MAP_UI_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.MAP_UI_SCREENSHOT_DIR}/network-edit-mobile.png` });
    await page.getByRole('button', { name: 'Salvar caminhos', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Salvar caminhos', exact: true })).toBeDisabled();
    expect(state.boards[0].roadNetwork.nodes[0].y).toBeGreaterThan(.3);
  });
});

test('mapas regionais salvos permanecem isolados e permitem criar outro mapa da região', async ({ page }) => {
  const state = await setup(page);
  await chooseMap(page, 'Mapa das Planícies');
  await expect(page).toHaveURL(/\?map=region-board$/);
  await expect(page.getByRole('button', { name: 'Bosque do Peregrino', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Fazenda Moinho', exact: true })).toHaveCount(0);
  await mapAction(page, 'Alterar mapa');
  const edit = page.getByRole('dialog');
  await edit.getByLabel('Nome do mapa').fill('Planícies detalhadas');
  await edit.getByRole('button', { name: 'Salvar mapa', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Planícies detalhadas', exact: true })).toBeVisible();
  expect(state.writes.find((entry) => entry.path.endsWith('/map/board'))).toMatchObject({ boardId: 'region-board', body: { name: 'Planícies detalhadas' } });
  expect(state.boards[0]).toMatchObject({ name: 'Mapa geral', imageUrl: 'https://map.test/general.svg', pins: expect.arrayContaining([expect.objectContaining({ id: 'pin-mill' })]) });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Planícies detalhadas', exact: true })).toBeVisible();
  expect(state.reads.filter(entry => 'boardId' in entry).at(-1).boardId).toBe('region-board');
  await mapAction(page, 'Novo mapa de região');
  const create = page.getByRole('dialog');
  await create.getByLabel('Região do mapa').selectOption('loc.hills');
  await expect(create.getByLabel('Nome do mapa')).toHaveValue('Serra dourada');
  await create.getByRole('button', { name: 'Salvar mapa', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Serra dourada', exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\?map=created-board$/);
  expect(state.writes.find((entry) => entry.path.endsWith('/map/boards'))).toMatchObject({ method: 'POST', body: { regionId: 'loc.hills', name: 'Serra dourada', imageUrl: 'https://map.test/hills.svg' } });
  await page.getByRole('button', { name: 'Mapas', exact: true }).click();
  await expect(page.getByRole('menuitemradio', { name: /^Serra dourada/ })).toBeVisible();
});

test('escala calibrada pode ser corrigida sem tracejado persistente e mantém a medida ao redimensionar', async ({ page }) => {
  const state = await setup(page);
  await chooseMap(page, 'Mapa das Planícies');
  await mapTool(page, 'Calibrar escala');
  await clickMap(page, .15, .85); await clickMap(page, .65, .85);
  const calibration = page.getByRole('dialog', { name: 'Definir escala', exact: true });
  await calibration.getByLabel('Distância do trecho (km)').fill('10');
  await calibration.getByRole('button', { name: 'Salvar escala', exact: true }).click();
  await expect(calibration).toHaveCount(0);
  await expect(page.locator('.image-map-ruler')).toHaveCount(0);
  await expect(page.getByLabel('Escala 2 km', { exact: true })).toBeVisible();
  const first = state.writes.find((entry) => entry.path.endsWith('/map/board/scale'));
  expect(first.boardId).toBe('region-board');
  expect(first.body).toMatchObject({ distanceKm: 10, imageWidth: 1200, imageHeight: 600 });
  expect(first.body.startX).toBeCloseTo(.15, 2); expect(first.body.endX).toBeCloseTo(.65, 2);
  await mapTool(page, 'Editar escala');
  const edit = page.getByRole('dialog', { name: 'Editar escala', exact: true });
  await expect(edit.getByLabel('Distância do trecho (km)')).toHaveValue('10');
  await edit.getByLabel('Distância do trecho (km)').fill('25');
  await edit.getByRole('button', { name: 'Salvar escala', exact: true }).click();
  await expect(page.getByLabel('Escala 5 km', { exact: true })).toBeVisible();
  const changes = state.writes.filter((entry) => entry.path.endsWith('/map/board/scale'));
  expect(changes).toHaveLength(2); expect(changes[1]).toMatchObject({ boardId: 'region-board', body: { distanceKm: 25 } });
  expect(Object.keys(changes[1].body)).toEqual(['distanceKm']);
  expect(state.boards[0].scale).toBeNull();
  const ratio = async () => {
    const image = await page.locator('.image-map-art').boundingBox();
    const bar = await page.locator('.image-map-scale-bar').boundingBox();
    return bar.width / image.width;
  };
  const largeRatio = await ratio();
  await page.setViewportSize({ width: 900, height: 900 });
  await expect.poll(ratio).toBeCloseTo(largeRatio, 3);
  await page.reload();
  await expect(page.getByLabel('Escala 5 km', { exact: true })).toBeVisible();
  await expect(page.locator('.image-map-ruler')).toHaveCount(0);
});

test('popup do local e da região carrega categorias sob demanda em listas compactas', async ({ page }, testInfo) => {
  const state = await setup(page);
  await page.getByRole('button', { name: 'Fazenda Moinho', exact: true }).click();
  const popup = page.getByRole('dialog', { name: 'Fazenda Moinho', exact: true });
  await expect(popup).toBeVisible();
  await expect(popup.getByRole('button', { name: /Monstros/ })).toBeVisible();
  expect(state.contentReads).toEqual([]);
  await popup.getByRole('button', { name: /Monstros/ }).click();
  await expect(popup.getByRole('link', { name: /Lobo cinzento/ })).toHaveAttribute('href', `/campaigns/${campaignId}/monsters?selected=monster.wolf`);
  await expect(popup.getByRole('button', { name: 'Itens', exact: true })).toHaveCount(0);
  const image = popup.locator('.map-detail-list img');
  await expect(image).toBeVisible();
  const bounds = await image.boundingBox(); expect(bounds.width).toBeLessThanOrEqual(32); expect(bounds.height).toBeLessThanOrEqual(32);
  expect(await popup.evaluate((element) => getComputedStyle(element).position)).toBe('fixed');
  expect(await popup.evaluate((element) => getComputedStyle(element).transform)).toBe('none');
  const beforeScroll = await popup.boundingBox();
  await page.evaluate(() => window.scrollBy(0, 80));
  await expect.poll(async () => (await popup.boundingBox()).y).not.toBe(beforeScroll.y);
  await page.screenshot({ path: testInfo.outputPath('popup-desktop.png') });
  expect(state.contentReads.map((entry) => entry.category)).toEqual(['monstros']);
  await popup.getByRole('button', { name: /Voltar/ }).click();
  await popup.getByRole('button', { name: /Itens/ }).click();
  await expect(popup.getByRole('link', { name: /Trigo/ })).toHaveAttribute('href', `/campaigns/${campaignId}/items?selected=item.grain`);
  await popup.getByRole('button', { name: /Voltar/ }).click();
  await popup.getByRole('button', { name: /Informações/ }).click();
  await expect(popup).toContainText('Fazenda de trigo e moinho de água.');
  await expect(popup).toContainText('Planície');
  await popup.getByRole('button', { name: 'Fechar popup', exact: true }).click();
  await page.getByRole('button', { name: 'Planícies verdejantes', exact: true }).click();
  const region = page.getByRole('dialog', { name: 'Planícies verdejantes', exact: true });
  await region.getByRole('button', { name: /NPCs/ }).click();
  await expect(region.getByRole('link', { name: /Moleiro/ })).toHaveAttribute('href', `/campaigns/${campaignId}/npcs?selected=npc.miller`);
  expect(state.contentReads.at(-1)).toMatchObject({ boardId: 'general-board', category: 'npcs' });
});

test('menus agrupam os controles e fecham por teclado ou clique fora', async ({ page }) => {
  await setup(page);
  await expect(page.locator('.map-toolbar-actions > .map-toolbar-menu')).toHaveCount(1);
  await expect(page.getByRole('menu')).toHaveCount(0);
  const trigger = page.getByRole('button', { name: 'Mapas', exact: true });
  await trigger.focus(); await page.keyboard.press('ArrowDown');
  const maps = page.getByRole('menu', { name: 'Mapas', exact: true });
  await expect(maps.getByRole('menuitemradio', { name: /^Mapa geral/ })).toBeFocused();
  await expect(maps.getByRole('menuitemradio', { name: /^Mapa das Planícies/ })).toContainText('Andar 1 · Planícies verdejantes');
  await expect(maps.getByRole('menuitem', { name: 'Novo mapa de região' })).toBeVisible();
  await expect(maps.getByRole('menuitem', { name: 'Alterar mapa' })).toBeVisible();
  await expect(maps.getByRole('menuitem', { name: 'Deletar mapa' })).toBeVisible();
  await page.keyboard.press('End');
  await expect(maps.getByRole('menuitem', { name: 'Deletar mapa' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused(); await expect(maps).toHaveCount(0);
  await trigger.click();
  await editorMode(page, 'regions'); await page.getByRole('button', { name: 'Regiões', exact: true }).click();
  await expect(page.getByRole('menu')).toHaveCount(1);
  await expect(page.getByRole('menuitem', { name: 'Calibrar escala' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Editar escala' })).toBeDisabled();
  await expect(page.getByRole('menuitem', { name: 'Delimitar regiões' })).toBeVisible();
  await page.getByRole('heading', { name: 'Mapa geral', exact: true }).click();
  await expect(page.getByRole('menu')).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await trigger.click();
  await expect(maps).toBeVisible();
  const bounds = await maps.boundingBox();
  expect(bounds.x).toBeGreaterThanOrEqual(8); expect(bounds.x + bounds.width).toBeLessThanOrEqual(382);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(836);
  if (process.env.MAP_UI_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.MAP_UI_SCREENSHOT_DIR}/map-menu-mobile.png` });
});

test('botão de edição percorre visualização, pins, caminhos e regiões', async ({ page }) => {
  await setup(page);
  const button = page.getByRole('button', { name: 'Modo de edição', exact: true });
  await expect(button).toHaveAttribute('data-mode', 'view');
  await expect(page.getByRole('button', { name: 'Consultar percurso', exact: true })).toBeVisible();
  await button.click(); await expect(button).toHaveAttribute('data-mode', 'pins');
  const add = page.getByRole('button', { name: /Adicionar pin/ }); await expect(add).toBeVisible();
  await expect(page.getByRole('button', { name: 'Consultar percurso', exact: true })).toHaveCount(0);
  await add.click(); await expect(page.locator('.image-map-pin-tools')).toBeVisible();
  await button.click(); await expect(button).toHaveAttribute('data-mode', 'network');
  await expect(page.locator('.image-map-pin-tools')).toHaveCount(0); await expect(page.getByRole('button', { name: 'Salvar caminhos', exact: true })).toBeVisible();
  await button.click(); await expect(button).toHaveAttribute('data-mode', 'regions');
  await expect(page.getByRole('button', { name: 'Regiões', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Gerenciar limites' })).toBeVisible();
  await button.click(); await expect(button).toHaveAttribute('data-mode', 'view');
  await page.getByRole('button', { name: 'Fazenda Moinho', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Fazenda Moinho', exact: true })).toBeVisible();
});

test('edição de pins salva o arraste sem abrir popup, com conclusão flutuante', async ({ page }) => {
  const state = await setup(page, { scale: { startX: .1, startY: .8, endX: .6, endY: .8, distanceKm: 10, imageWidth: 1200, imageHeight: 600, pixelLength: 600, kmPerPixel: 10 / 600 } });
  const millPin = page.getByRole('button', { name: 'Fazenda Moinho', exact: true });
  await millPin.click();
  await expect(page.getByRole('dialog', { name: 'Fazenda Moinho', exact: true })).toBeVisible();
  await expect(page.locator('.map-selection-chip')).toHaveCount(0);
  await editPins(page);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.map-toolbar').getByRole('button', { name: 'Concluir edição' })).toHaveCount(0);
  const finish = page.locator('.map-edit-finish');
  await expect(finish).toBeVisible();
  expect(await finish.evaluate((element) => getComputedStyle(element).position)).toBe('fixed');
  expect(await finish.evaluate((element) => getComputedStyle(element).animationName)).toBe('map-edit-reminder');
  await millPin.click();
  await page.getByRole('button', { name: 'Planícies verdejantes', exact: true }).click();
  await expect(page.locator('.image-map-pin[aria-pressed="true"]')).toHaveCount(1);
  await expect(page.locator('.map-selection-chip')).toHaveCount(1);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Criar caminho', exact: true })).toHaveCount(0);
  await expect(finish.getByRole('button', { name: 'Concluir edição', exact: true })).toBeEnabled();
  await page.evaluate(() => window.scrollTo(0, 0));
  const image = await page.locator('.image-map-art').boundingBox();
  const bounds = await millPin.boundingBox();
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down(); await page.mouse.move(bounds.x + bounds.width / 2 + image.width * .1, bounds.y + bounds.height / 2, { steps: 8 }); await page.mouse.up();
  await expect.poll(() => state.writes.filter((entry) => entry.path.endsWith('/map/pins/pin-mill')).length).toBe(1);
  await expect(finish.getByRole('button', { name: 'Concluir edição', exact: true })).toBeEnabled();
  expect(state.boards[0].pins[0].x).toBeCloseTo(.35, 2);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(state.contentReads).toEqual([]);
  await page.evaluate(() => window.scrollTo(0, 0));
  if (process.env.MAP_UI_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.MAP_UI_SCREENSHOT_DIR}/map-edit-desktop.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  const finishBounds = await finish.boundingBox();
  expect(finishBounds.x).toBe(16); expect(finishBounds.x + finishBounds.width).toBeLessThan(390);
  expect(finishBounds.y + finishBounds.height).toBeLessThanOrEqual(844);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await finish.evaluate((element) => getComputedStyle(element).animationName)).toBe('none');
  if (process.env.MAP_UI_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.MAP_UI_SCREENSHOT_DIR}/map-edit-mobile.png` });
  await finish.getByRole('button', { name: 'Concluir edição', exact: true }).click();
  await expect(finish).toHaveCount(0); await expect(page.locator('.map-selection-chip')).toHaveCount(0);
  await expect(page.locator('.map-route-editor')).toHaveCount(0);
  await millPin.click();
  await expect(page.getByRole('dialog', { name: 'Fazenda Moinho', exact: true })).toBeVisible();
});

test('jogador acessa mapas salvos e conteúdo dos pins sem ferramentas de administração', async ({ page }) => {
  await setup(page, { role: 'player' });
  await page.getByRole('button', { name: 'Mapas', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'Alterar mapa' })).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: 'Novo mapa de região' })).toHaveCount(0);
  await expect(page.getByRole('menuitem', { name: 'Deletar mapa' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Modo de edição', exact: true })).toHaveAttribute('data-mode', 'view');
  await expect(page.getByRole('button', { name: /Adicionar pin/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Modo de edição', exact: true })).toContainText('Visualização');
  await expect(page.getByRole('button', { name: 'Regiões', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Fazenda Moinho', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Fazenda Moinho', exact: true })).toBeVisible();
});

test('deletar mapa regional exige confirmação, preserva o geral e libera sua região', async ({ page }) => {
  const state = await setup(page);
  await chooseMap(page, 'Mapa das Planícies');
  await editPins(page);
  await mapAction(page, 'Deletar mapa');
  const dialog = page.getByRole('dialog', { name: 'Deletar mapa', exact: true });
  await expect(dialog).toContainText('Mapa das Planícies');
  await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
  expect(state.writes).toEqual([]); expect(state.boards).toHaveLength(2);
  await mapAction(page, 'Deletar mapa');
  if (process.env.MAP_UI_SCREENSHOT_DIR) await page.screenshot({ path: `${process.env.MAP_UI_SCREENSHOT_DIR}/map-delete-dialog.png` });
  await dialog.getByRole('button', { name: 'Deletar mapa', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Mapa geral', exact: true })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`/campaigns/${campaignId}/map$`));
  await expect(page.locator('.map-edit-finish')).toHaveCount(0);
  expect(state.writes).toHaveLength(1);
  expect(state.writes[0]).toMatchObject({ path: `/api/v1/campaigns/${campaignId}/map/boards/region-board`, method: 'DELETE', headers: { 'if-match': '1' } });
  expect(state.boards[0].pins).toHaveLength(2); expect(state.boards.some((entry) => entry.id === 'region-board')).toBe(false);
  await page.reload();
  await page.getByRole('button', { name: 'Mapas', exact: true }).click();
  await expect(page.getByRole('menuitemradio', { name: /^Mapa das Planícies/ })).toHaveCount(0);
  await page.getByRole('menuitem', { name: 'Novo mapa de região', exact: true }).click();
  const create = page.getByRole('dialog', { name: 'Novo mapa de região', exact: true });
  await create.getByLabel('Região do mapa').selectOption('loc.plains');
  await create.getByRole('button', { name: 'Salvar mapa', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Planícies verdejantes', exact: true })).toBeVisible();
});

test('deletar o mapa geral permite adicionar outra imagem e preserva os regionais', async ({ page }) => {
  const state = await setup(page);
  await mapAction(page, 'Deletar mapa');
  const dialog = page.getByRole('dialog', { name: 'Deletar mapa', exact: true });
  await dialog.getByRole('button', { name: 'Deletar mapa', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Adicione a imagem do seu mapa', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Mapa da campanha', exact: true })).toBeVisible();
  expect(state.boards.find((entry) => !entry.regionId)).toMatchObject({ id: 'replacement-general-board', imageUrl: null, pins: [], routes: [] });
  expect(state.boards.find((entry) => entry.regionId)).toMatchObject({ id: 'region-board', pins: [expect.objectContaining({ id: 'pin-grove' })] });
  await chooseMap(page, 'Mapa das Planícies');
  await expect(page.getByRole('button', { name: 'Bosque do Peregrino', exact: true })).toBeVisible();
});

test('conflito ao deletar mantém o mapa e permite revisar antes de tentar novamente', async ({ page }) => {
  const state = await setup(page);
  await chooseMap(page, 'Mapa das Planícies');
  await mapAction(page, 'Deletar mapa');
  const dialog = page.getByRole('dialog', { name: 'Deletar mapa', exact: true });
  state.boards[1].version = 2;
  await dialog.getByRole('button', { name: 'Deletar mapa', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Feche esta janela e revise o mapa');
  expect(state.boards).toHaveLength(2);
  await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await mapAction(page, 'Deletar mapa');
  await dialog.getByRole('button', { name: 'Deletar mapa', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Mapa geral', exact: true })).toBeVisible();
  expect(state.writes.at(-1).headers['if-match']).toBe('2');
});

test('desenho à mão livre vira polígono e só grava ao salvar', async ({ page }) => {
  const state = await setup(page);
  await mapTool(page, 'Delimitar regiões');
  await page.getByLabel('Local ou região do limite').selectOption('loc.plains');
  await expect(page.getByRole('button', { name: 'Mão livre', exact: true })).toHaveAttribute('aria-pressed', 'true');
  const image = page.locator('.image-map-art'); await image.scrollIntoViewIfNeeded();
  const bounds = await image.boundingBox();
  const move = (x, y, steps = 1) => page.mouse.move(bounds.x + bounds.width * x, bounds.y + bounds.height * y, { steps });
  await move(.12, .15); await page.mouse.down();
  await move(.8, .15, 15); await move(.8, .7, 15); await move(.12, .7, 15); await move(.12, .15, 15); await page.mouse.up();
  expect(state.writes).toEqual([]);
  await page.getByRole('button', { name: 'Salvar limite', exact: true }).click();
  await expect(page.locator('.image-map-boundary:not(.draft) polygon')).toHaveCount(1);
  expect(state.writes).toHaveLength(1);
  const points = state.writes[0].body.points;
  expect(points.length).toBeGreaterThanOrEqual(4); expect(points.length).toBeLessThan(15);
  expect(points[0].x).toBeCloseTo(.12, 2); expect(points[0].y).toBeCloseTo(.15, 2);
});

test('limite da região salva um polígono normalizado no mapa geral e permanece após reabrir', async ({ page }) => {
  const state = await setup(page);
  await mapTool(page, 'Delimitar regiões');
  await page.getByLabel('Local ou região do limite').selectOption('loc.plains');
  await page.getByRole('button', { name: 'Por pontos', exact: true }).click();
  await clickMap(page, .12, .15); await clickMap(page, .45, .15); await clickMap(page, .3, .62);
  await page.getByRole('button', { name: 'Salvar limite', exact: true }).click();
  await expect(page.locator('.image-map-boundary:not(.draft) polygon')).toHaveCount(1);
  const saved = state.writes.find((entry) => entry.path.endsWith('/map/boundaries'));
  expect(saved).toMatchObject({ body: { regionId: 'loc.plains', points: expect.any(Array) } });
  expect(saved.body.points).toHaveLength(3);
  for (const point of saved.body.points) {
    expect(point.x).toBeGreaterThanOrEqual(0); expect(point.x).toBeLessThanOrEqual(1);
    expect(point.y).toBeGreaterThanOrEqual(0); expect(point.y).toBeLessThanOrEqual(1);
  }
  expect(saved.body.points[0].x).toBeCloseTo(.12, 2); expect(saved.body.points[2].y).toBeCloseTo(.62, 2);
  expect(state.boards[1].boundaries).toEqual([]);
  await page.reload();
  await expect(page.locator('.image-map-boundary:not(.draft) polygon')).toHaveCount(1);
  await chooseMap(page, 'Mapa das Planícies');
  await expect(page.locator('.image-map-boundary:not(.draft) polygon')).toHaveCount(0);
  await editorMode(page, 'regions'); await page.getByRole('button', { name: 'Regiões', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'Delimitar regiões', exact: true })).toBeVisible();
});

test('ciclo de edição exige salvar ou descartar a rede antes de chegar às regiões', async ({ page }) => {
  const state = await setup(page); await roadsMode(page, 'Editar rede');
  const button = page.getByRole('button', { name: 'Modo de edição', exact: true });
  await drawRoad(page, [[.1, .55], [.8, .55]]); await button.click();
  const dialog = page.getByRole('dialog', { name: 'Caminhos não salvos' });
  await expect(dialog).toBeVisible(); await dialog.getByRole('button', { name: 'Continuar editando' }).click();
  await expect(button).toHaveAttribute('data-mode', 'network'); await expect(page.locator('.map-network-road')).toHaveCount(1);
  await button.click(); await dialog.getByRole('button', { name: 'Descartar rascunho' }).click();
  await expect(button).toHaveAttribute('data-mode', 'regions'); await expect(page.locator('.map-network-node')).toHaveCount(0);
  await button.click(); await expect(button).toHaveAttribute('data-mode', 'view'); expect(state.writes).toEqual([]);
});

test('popup fecha ao clicar fora e conserva navegação interna até então', async ({ page }) => {
  const state = await setup(page);
  await page.getByRole('button', { name: 'Fazenda Moinho', exact: true }).click();
  const popup = page.getByRole('dialog', { name: 'Fazenda Moinho', exact: true });
  await popup.getByRole('button', { name: /Monstros/ }).click();
  await expect(popup.getByRole('link', { name: /Lobo cinzento/ })).toBeVisible();
  await clickMap(page, .9, .85); await expect(popup).toHaveCount(0);
  await page.getByRole('button', { name: 'Planícies verdejantes', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Planícies verdejantes', exact: true })).toBeVisible();
  await page.getByRole('heading', { name: 'Mapa geral', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0); expect(state.writes).toEqual([]);
});

test('nova régua começa com a distância atual e cancelar preserva a calibração', async ({ page }) => {
  const state = await setup(page, { scale: calibratedScale });
  await mapTool(page, 'Calibrar escala'); await clickMap(page, .2, .8); await clickMap(page, .7, .8);
  const dialog = page.getByRole('dialog', { name: 'Definir escala', exact: true });
  await expect(dialog.getByLabel('Distância do trecho (km)')).toHaveValue('10');
  await dialog.getByLabel('Distância do trecho (km)').fill('12');
  await dialog.getByRole('button', { name: 'Cancelar', exact: true }).click();
  await expect(dialog).toHaveCount(0); expect(state.writes).toEqual([]);
  expect(state.boards[0].scale.distanceKm).toBe(10);
  await mapTool(page, 'Editar escala');
  await expect(page.getByRole('dialog', { name: 'Editar escala', exact: true }).getByLabel('Distância do trecho (km)')).toHaveValue('10');
});

test('território à mão livre também aparece no mapa regional sem a antiga lista de pins', async ({ page }) => {
  const state = await setup(page); await chooseMap(page, 'Mapa das Planícies');
  await expect(page.getByRole('heading', { name: 'Pins deste mapa', exact: true })).toHaveCount(0);
  await mapTool(page, 'Delimitar regiões');
  await expect(page.getByLabel('Local ou região do limite')).toHaveValue('loc.plains');
  await expect(page.getByRole('button', { name: 'Mão livre', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await drawRoad(page, [[.12, .15], [.8, .15], [.8, .7], [.12, .7], [.12, .15]]);
  await expect(page.getByRole('button', { name: 'Salvar limite', exact: true })).toBeEnabled(); expect(state.writes).toEqual([]);
  await page.getByRole('button', { name: 'Salvar limite', exact: true }).click();
  await expect(page.locator('.image-map-boundary:not(.draft) polygon')).toHaveCount(1);
  expect(state.writes.at(-1)).toMatchObject({ boardId: 'region-board', body: { regionId: 'loc.plains' } });
  expect(state.boards[0].boundaries).toEqual([]); expect(state.boards[1].boundaries[0].points.length).toBeGreaterThanOrEqual(4);
  if (process.env.MAP_UI_SCREENSHOT_DIR) { await page.evaluate(() => window.scrollTo(0, 0)); await page.screenshot({ path: `${process.env.MAP_UI_SCREENSHOT_DIR}/territory-regional-desktop.png`, fullPage: true }); }
});

test('alternativas de percurso mudam o destaque e clicar num trecho consulta preferência sem salvar', async ({ page }) => {
  const state = await setup(page, { network: alternateRoad, scale: calibratedScale });
  await roadsMode(page, 'Consultar percurso');
  await page.getByRole('button', { name: 'Fazenda Moinho', exact: true }).click(); await page.getByRole('button', { name: 'Planícies verdejantes', exact: true }).click();
  const alternatives = page.locator('.map-distances').getByRole('button', { name: /^Percurso \d/ });
  await expect(alternatives).toHaveCount(2);
  const expectRouteColors = async () => {
    await expect(page.locator('.map-network-path')).toHaveCSS('stroke', 'rgb(59, 130, 246)');
    await expect(page.locator('.map-network-alternative')).toHaveCount(0);
    for (const road of await page.locator('.map-network-road').all()) await expect(road).toHaveCSS('stroke', 'rgb(255, 219, 62)');
  };
  await expectRouteColors();
  const popup = page.getByRole('complementary', { name: 'Percursos possíveis' });
  await expect(popup).toContainText('Percurso 1 de 2');
  const originalPopup = await popup.boundingBox();
  expect(originalPopup.width).toBeLessThanOrEqual(250); expect(originalPopup.height).toBeLessThan(120);
  await expect(popup.locator('.map-route-popup-list')).toHaveCount(0);
  await expect(popup.getByRole('button', { name: '← Anterior', exact: true })).toBeDisabled();
  const shortest = await page.locator('.map-network-path').getAttribute('points');
  await popup.getByRole('button', { name: 'Próximo →', exact: true }).click();
  await expect(page.locator('.map-network-path')).not.toHaveAttribute('points', shortest);
  await expect(popup).toContainText('Percurso 2 de 2');
  await expectRouteColors();
  await expect(popup.getByRole('button', { name: 'Próximo →', exact: true })).toBeDisabled();
  const heading = await popup.locator('.map-route-popup-title').boundingBox();
  await page.mouse.move(heading.x + 10, heading.y + 10); await page.mouse.down();
  await page.mouse.move(heading.x - 190, heading.y - 140, { steps: 6 }); await page.mouse.up();
  const movedPopup = await popup.boundingBox();
  expect(movedPopup.x).toBeLessThan(originalPopup.x - 100); expect(movedPopup.y).toBeLessThan(originalPopup.y - 100);
  await popup.getByRole('button', { name: '← Anterior', exact: true }).click();
  await expect(page.locator('.map-network-path')).toHaveAttribute('points', shortest);
  expect((await popup.boundingBox()).x).toBeCloseTo(movedPopup.x, 0);
  await popup.locator('.map-route-popup-title').focus(); await page.keyboard.press('ArrowLeft');
  expect((await popup.boundingBox()).x).toBeCloseTo(movedPopup.x - 12, 0);
  if (process.env.MAP_UI_SCREENSHOT_DIR) { await page.evaluate(() => window.scrollTo(0, 0)); await page.screenshot({ path: `${process.env.MAP_UI_SCREENSHOT_DIR}/route-alternatives-desktop.png`, fullPage: true }); }
  await alternatives.first().click(); await expect(page.locator('.map-network-path')).toHaveAttribute('points', shortest);
  const bounds = await page.locator('.image-map-art').boundingBox();
  await page.mouse.click(bounds.x + .475 * bounds.width, bounds.y + .2 * bounds.height);
  await expect.poll(() => state.reads.some((entry) => entry.viaEdgeId === 'north-road')).toBe(true);
  await expect(page.locator('.map-network-path')).not.toHaveAttribute('points', shortest);
  await expectRouteColors();
  expect(state.writes).toEqual([]); expect(state.contentReads).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: 'Consultar percurso', exact: true })).toBeVisible();
  await expect(page.locator('.map-network-path')).toBeVisible();
  const mobilePopup = await popup.boundingBox();
  expect(mobilePopup.x).toBeGreaterThanOrEqual(8); expect(mobilePopup.x + mobilePopup.width).toBeLessThanOrEqual(382);
  expect(mobilePopup.y + mobilePopup.height).toBeLessThanOrEqual(836);
  if (process.env.MAP_UI_SCREENSHOT_DIR) { await page.evaluate(() => window.scrollTo(0, 0)); await page.screenshot({ path: `${process.env.MAP_UI_SCREENSHOT_DIR}/route-alternatives-mobile.png`, fullPage: true }); }
});

test('consulta agrupa entradas repetidas da demarcação e mantém uma opção ao escolher um trecho interno', async ({ page }) => {
  const network = { imageWidth: 1200, imageHeight: 600, nodes: [{ id: 'west', x: .15, y: .5 }, { id: 'east', x: .7, y: .5 }, { id: 'inner-north', x: .4, y: .4 }, { id: 'inner-south', x: .4, y: .6 }], edges: [{ id: 'main', from: 'west', to: 'east' }, { id: 'inner', from: 'inner-north', to: 'inner-south' }] };
  const boundaries = [{ id: 'mill-land', regionId: 'loc.mill', name: 'Fazenda Moinho', points: [{ x: .15, y: .35 }, { x: .55, y: .35 }, { x: .55, y: .65 }, { x: .15, y: .65 }] }];
  const state = await setup(page, { network, boundaries, scale: calibratedScale });
  await roadsMode(page, 'Consultar percurso');
  await page.getByRole('button', { name: 'Fazenda Moinho', exact: true }).click(); await page.getByRole('button', { name: 'Planícies verdejantes', exact: true }).click();
  const alternatives = page.locator('.map-distances').getByRole('button', { name: /^Percurso \d/ });
  const popup = page.getByRole('complementary', { name: 'Percursos possíveis' });
  await expect(alternatives).toHaveCount(1); await expect(popup).toContainText('Percurso 1 de 1');
  const direct = await page.locator('.map-network-path').getAttribute('points');
  const bounds = await page.locator('.image-map-art').boundingBox();
  await page.mouse.click(bounds.x + .4 * bounds.width, bounds.y + .55 * bounds.height);
  await expect.poll(() => state.reads.some(entry => entry.viaEdgeId === 'inner')).toBe(true);
  await expect(page.locator('.map-network-path')).not.toHaveAttribute('points', direct);
  await expect(alternatives).toHaveCount(1); await expect(popup).toContainText('Percurso 1 de 1');
  await expect(popup.getByRole('button', { name: 'Próximo →', exact: true })).toBeDisabled();
  await expect(page.locator('.map-network-path')).toHaveCSS('stroke', 'rgb(59, 130, 246)');
  expect(state.writes).toEqual([]);
});

test('consulta não sugere retornos e permite experimentar cada ramal conectado ao clicar nele', async ({ page }) => {
  const nodes = [{ id: 'west', x: .25, y: .45 }, { id: 'fork', x: .475, y: .45 }, { id: 'east', x: .7, y: .45 }];
  const edges = [{ id: 'west-road', from: 'west', to: 'fork' }, { id: 'east-road', from: 'fork', to: 'east' }];
  for (let index = 0; index < 10; index += 1) {
    nodes.push({ id: `branch-${index}`, x: .1 + index * .08, y: .1 });
    edges.push({ id: `branch-road-${index}`, from: 'fork', to: `branch-${index}` });
  }
  const state = await setup(page, { network: { imageWidth: 1200, imageHeight: 600, nodes, edges }, scale: calibratedScale });
  await roadsMode(page, 'Consultar percurso');
  await page.getByRole('button', { name: 'Fazenda Moinho', exact: true }).click(); await page.getByRole('button', { name: 'Planícies verdejantes', exact: true }).click();
  const popup = page.getByRole('complementary', { name: 'Percursos possíveis' }), next = popup.getByRole('button', { name: 'Próximo', exact: false });
  await expect(popup).toContainText('Percurso 1 de 1');
  await expect(next).toBeDisabled();
  await expect(page.locator('.map-distances')).not.toContainText('inclui retorno');
  const highlights = new Set([await page.locator('.map-network-path').getAttribute('points')]);
  for (let index = 0; index < 10; index += 1) {
    const previous = await page.locator('.map-network-path').getAttribute('points');
    const bounds = await page.locator('.image-map-art').boundingBox();
    await page.mouse.click(bounds.x + (.475 + .1 + index * .08) / 2 * bounds.width, bounds.y + .275 * bounds.height);
    await expect.poll(() => state.reads.some(entry => entry.viaEdgeId === `branch-road-${index}`)).toBe(true);
    await expect(page.locator('.map-network-path')).not.toHaveAttribute('points', previous);
    await expect(popup).toContainText('Percurso 2 de 2'); await expect(popup).toContainText('Com retorno');
    highlights.add(await page.locator('.map-network-path').getAttribute('points'));
  }
  expect(highlights.size).toBe(11); await expect(next).toBeDisabled();
  expect(state.writes).toEqual([]);
});

test('conexões e destinos partem da origem escolhida e mostram a medida da rede atual', async ({ page }) => {
  const extra = pin('pin-orchard', 'loc.orchard', 'Pomar do Leste', .5, .45);
  const distances = [
    { id: 'mill-plains', fromLocationId: 'loc.mill', fromName: 'Fazenda Moinho', toLocationId: 'loc.plains', toName: 'Planícies verdejantes', distanceKm: 999, travelMinutes: 1 },
    { id: 'plains-mill', fromLocationId: 'loc.plains', fromName: 'Planícies verdejantes', toLocationId: 'loc.mill', toName: 'Fazenda Moinho', distanceKm: 999, travelMinutes: 1 },
    { id: 'mill-orchard', fromLocationId: 'loc.mill', fromName: 'Fazenda Moinho', toLocationId: 'loc.orchard', toName: 'Pomar do Leste', distanceKm: 999, travelMinutes: 1 }
  ];
  const state = await setup(page, { network: sharedRoad, scale: calibratedScale, extraPins: [extra], distances });
  const panel = page.locator('.map-distances');
  await expect(panel.locator('.map-distance-values > strong').filter({ hasText: '999 km' })).toHaveCount(0);
  const expected = findRoadPath(sharedRoad, state.boards[0].pins[0], state.boards[0].pins[1], calibratedScale.kmPerPixel);
  await expect(panel).toContainText(`${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 }).format(expected.distanceKm)} km`);
  await roadsMode(page, 'Consultar percurso'); await page.getByRole('button', { name: 'Fazenda Moinho', exact: true }).click();
  await expect.poll(() => state.reads.some((entry) => entry.path?.endsWith('/map/network/destinations') && entry.fromPinId === 'pin-mill')).toBe(true);
  const destinations = panel.getByRole('button').filter({ hasText: 'Planícies verdejantes' });
  await expect(destinations).toHaveCount(1); await expect(panel.getByRole('button').filter({ hasText: 'Pomar do Leste' })).toHaveCount(1);
  await expect(panel.getByRole('button').filter({ hasText: /Planícies verdejantes\s*→\s*Fazenda Moinho/ })).toHaveCount(0);
  await destinations.click(); await expect(page.locator('.image-map-pin[aria-pressed="true"]')).toHaveCount(2);
  await expect(panel.getByRole('button', { name: /^Percurso 1/ })).toBeVisible();
  expect(state.writes).toEqual([]);
});

test('pins de jogador, grupo e carroça encaixam na rede e o arraste salva a versão do marcador', async ({ page }) => {
  const state = await setup(page, { network: sharedRoad }); await editPins(page);
  const add = page.getByRole('button', { name: /Adicionar pin/ });
  for (const [type, label, owner, name, x] of [['player', 'Jogador do pin', 'player-ana', 'Ana', .3], ['group', 'Grupo do pin', 'group.explorers', 'Exploradores', .5], ['carriage', null, null, 'Carroça de provisões', .7]]) {
    await add.click(); await page.getByLabel('Tipo do pin').selectOption(type);
    if (label) await page.getByLabel(label).selectOption(owner);
    else await page.getByLabel('Nome do marcador').fill(name);
    await clickMap(page, x, .7); await expect(page.getByRole('button', { name: `Marcador ${name}`, exact: true })).toBeVisible();
    await expect.poll(() => state.boards[0].travelMarkers.length).toBe(type === 'player' ? 1 : type === 'group' ? 2 : 3);
    expect(state.boards[0].travelMarkers.at(-1).y).toBeCloseTo(.5, 4);
  }
  const marker = page.getByRole('button', { name: 'Marcador Carroça de provisões', exact: true });
  const bounds = await marker.boundingBox(), image = await page.locator('.image-map-art').boundingBox();
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2); await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width / 2 + image.width * .05, bounds.y + bounds.height / 2 + image.height * .1, { steps: 8 }); await page.mouse.up();
  await expect.poll(() => state.writes.filter((entry) => entry.path.endsWith('/map/markers/marker-3')).length).toBe(1);
  expect(state.writes.at(-1)).toMatchObject({ method: 'PATCH', headers: { 'if-match': '1' } });
  expect(state.boards[0].travelMarkers[2].x).toBeCloseTo(.75, 2); expect(state.boards[0].travelMarkers[2].y).toBeCloseTo(.5, 4);
  expect(state.boards[0].travelMarkers.map(({ ownerType }) => ownerType)).toEqual(['player', 'group', 'custom']);
  await add.click(); await page.getByLabel('Tipo do pin').selectOption('group');
  await page.getByLabel('Grupo do pin').selectOption('@campaign'); await clickMap(page, .8, .7);
  await expect(page.getByRole('button', { name: 'Marcador Grupo', exact: true })).toBeVisible();
  expect(state.writes.at(-1).body).toMatchObject({ ownerType: 'group', name: 'Grupo' }); expect(state.writes.at(-1).body.ownerId).toBeUndefined();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('visualizar como usa leitura do jogador e retorna ao mestre sem alterar permissões ou pins', async ({ page }) => {
  const state = await setup(page, { network: alternateRoad, scale: calibratedScale, previewHiddenIds: ['pin-plains'] });
  const preview = page.getByLabel('Visualizar como');
  await expect(preview).toBeVisible(); await preview.selectOption('player-ana');
  await expect(page.getByRole('button', { name: 'Planícies verdejantes', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Fazenda Moinho', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Modo de edição', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Regiões', exact: true })).toHaveCount(0);
  await expect.poll(() => state.reads.some((entry) => entry.viewAsUserId === 'player-ana')).toBe(true);
  await page.getByRole('button', { name: 'Fazenda Moinho', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Fazenda Moinho', exact: true })).toBeVisible();
  await preview.selectOption('');
  await expect(page.getByRole('button', { name: 'Planícies verdejantes', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Modo de edição', exact: true })).toBeVisible();
  expect(state.reads.some((entry) => entry.path?.endsWith('/memberships'))).toBe(true);
  expect(state.writes).toEqual([]); expect(state.boards[0].pins).toHaveLength(2);
  if (process.env.MAP_UI_SCREENSHOT_DIR) {
    await roadsMode(page, 'Consultar percurso');
    await page.getByRole('button', { name: 'Fazenda Moinho', exact: true }).click(); await page.getByRole('button', { name: 'Planícies verdejantes', exact: true }).click();
    await expect(page.locator('.map-distances').getByRole('button', { name: /^Percurso \d/ })).toHaveCount(2);
    await page.evaluate(() => window.scrollTo(0, 0)); await page.screenshot({ path: `${process.env.MAP_UI_SCREENSHOT_DIR}/route-choice-padding-desktop.png`, fullPage: true });
  }
});

test('jogador coloca o próprio pin e o move pela rede sem editar locais ou criar caminhos', async ({ page }) => {
  const state = await setup(page, { role: 'player', network: sharedRoad });
  await editPins(page); await page.getByRole('button', { name: /Colocar meu pin/ }).click();
  await clickMap(page, .4, .7);
  const own = page.getByRole('button', { name: 'Marcador Ana', exact: true });
  await expect(own).toBeVisible();
  expect(state.boards[0].travelMarkers[0]).toMatchObject({ ownerType: 'player', ownerId: 'player-ana', y: .5 });
  await expect(page.getByLabel('Tipo do pin')).toHaveCount(0); await expect(page.getByRole('button', { name: 'Regiões', exact: true })).toHaveCount(0);
  const bounds = await own.boundingBox(), image = await page.locator('.image-map-art').boundingBox();
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2); await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width / 2 + image.width * .08, bounds.y + bounds.height / 2 + image.height * .1, { steps: 8 }); await page.mouse.up();
  await expect.poll(() => state.writes.filter((entry) => entry.path.endsWith('/map/markers/marker-1') && entry.method === 'PATCH').length).toBe(1);
  expect(state.boards[0].travelMarkers[0].x).toBeCloseTo(.48, 2); expect(state.boards[0].travelMarkers[0].y).toBeCloseTo(.5, 4);
  expect(state.writes.every((entry) => entry.path.includes('/map/markers'))).toBe(true);
  expect(state.boards[0].pins[0].x).toBe(.25); expect(state.boards[0].roadNetwork).toEqual(sharedRoad);
});
