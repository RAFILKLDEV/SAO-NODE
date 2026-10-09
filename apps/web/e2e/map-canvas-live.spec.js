import { randomUUID } from 'node:crypto';
import { test, expect } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { hashToken } from '../../api/src/lib/security.js';

test.skip(!process.env.E2E_DATABASE_URL, 'Requires an isolated E2E database');

test('duas sessões reais recebem traços em andamento, desenhos salvos, pings e desfazer', async ({ browser }) => {
  const prisma = new PrismaClient({ datasourceUrl: process.env.E2E_DATABASE_URL });
  const accounts = [], contexts = [];
  let campaign;
  try {
    campaign = await prisma.campaign.create({ data: { slug: `canvas-live-${randomUUID()}`, name: 'Mapa ao vivo' } });
    for (const [name, role] of [['Mestre', 'owner'], ['Ana', 'player']]) {
      const user = await prisma.user.create({ data: { login: `canvas-live-${randomUUID()}`, name, passwordHash: 'unused' } });
      const token = randomUUID();
      await prisma.membership.create({ data: { campaignId: campaign.id, userId: user.id, role } });
      await prisma.session.create({ data: { userId: user.id, tokenHash: hashToken(token), csrfToken: randomUUID(), expiresAt: new Date(Date.now() + 3600000) } });
      accounts.push({ ...user, token });
    }
    const board = await prisma.mapBoard.create({ data: { campaignId: campaign.id, name: 'Desenhos ao vivo', imageUrl: 'https://canvas.test/live.svg', createdByUserId: accounts[0].id } });
    const pages = [], sent = [], received = [];
    for (const account of accounts) {
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 } }); contexts.push(context);
      await context.addCookies([{ name: 'sao_session', value: account.token, url: process.env.E2E_WEB_URL }]);
      const page = await context.newPage(); pages.push(page);
      page.on('websocket', socket => {
        socket.on('framesent', frame => { if (String(frame.payload).startsWith('42')) sent.push(`${account.name}:${JSON.parse(String(frame.payload).slice(2))[0]}`); });
        socket.on('framereceived', frame => { if (String(frame.payload).startsWith('42')) received.push(`${account.name}:${JSON.parse(String(frame.payload).slice(2))[0]}`); });
      });
      await page.route('https://canvas.test/**', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="600"><rect width="1200" height="600" fill="#224c68"/></svg>' }));
      await page.goto(`${process.env.E2E_WEB_URL}/campaigns/${campaign.id}/map`);
      await expect(page.locator('.map-drawing-toolbar')).toBeVisible();
      await page.locator('.map-drawing-summary button[aria-expanded]').click();
      await expect(page.locator('.map-drawing-options')).toContainText('Ao vivo');
    }
    const [gm, player] = pages;
    await gm.getByRole('button', { name: 'Lápis', exact: true }).click();
    const bounds = await gm.locator('.image-map-art').boundingBox();
    await gm.mouse.move(bounds.x + bounds.width * .2, bounds.y + bounds.height * .65);
    await gm.mouse.down(); await gm.mouse.move(bounds.x + bounds.width * .6, bounds.y + bounds.height * .8, { steps: 12 });
    await expect(gm.locator('[data-drawing-id]')).toHaveCount(1);
    expect(sent).toContain('Mestre:map.drawing.preview');
    await expect(player.locator('[data-drawing-id]')).toHaveCount(1);
    expect(received).toContain('Ana:map.drawing.preview');
    expect(await prisma.mapDrawing.count({ where: { boardId: board.id } })).toBe(0);
    await gm.mouse.up();
    await expect(gm.getByRole('button', { name: 'Desfazer desenho ou ping' })).toBeEnabled();
    await expect.poll(() => prisma.mapDrawing.count({ where: { boardId: board.id, active: true } })).toBe(1);
    await expect(player.locator('[data-drawing-id]')).toHaveCount(1);
    await gm.keyboard.press('Control+z'); await expect(player.locator('[data-drawing-id]')).toHaveCount(0);
    await expect(gm.getByRole('button', { name: 'Refazer desenho ou ping' })).toBeEnabled();
    await gm.keyboard.press('Control+y'); await expect(player.locator('[data-drawing-id]')).toHaveCount(1);
    await gm.reload(); await expect(gm.locator('[data-drawing-id]')).toHaveCount(1);
    await player.getByRole('button', { name: 'Ping', exact: true }).click();
    const playerBounds = await player.locator('.image-map-art').boundingBox();
    await player.mouse.click(playerBounds.x + playerBounds.width * .55, playerBounds.y + playerBounds.height * .7);
    await expect(gm.locator('.map-ping')).toHaveText('Ana');
    await expect(player.getByRole('button', { name: 'Desfazer desenho ou ping' })).toBeEnabled();
    await player.keyboard.press('Control+z'); await expect(gm.locator('.map-ping')).toHaveCount(0); await expect(player.locator('.map-ping')).toHaveCount(0);
    await expect(player.getByRole('button', { name: 'Refazer desenho ou ping' })).toBeEnabled();
    await player.keyboard.press('Control+y'); await expect(gm.locator('.map-ping')).toHaveText('Ana');
    await expect(gm.locator('.map-ping')).toHaveCount(0, { timeout: 6500 });
    await gm.locator('.map-drawing-summary button[aria-expanded]').click(); await gm.getByRole('button', { name: 'Limpar todos', exact: true }).click();
    await expect(player.locator('[data-drawing-id]')).toHaveCount(0);
    await expect(gm.getByRole('button', { name: 'Desfazer desenho ou ping' })).toBeEnabled();
    await gm.keyboard.press('Control+z'); await expect(player.locator('[data-drawing-id]')).toHaveCount(1);
    await gm.locator('.map-drawing-summary button[aria-expanded]').click();
    await gm.screenshot({ path: '.tmp/map-canvas/live-desktop.png' });
  } finally {
    for (const context of contexts) await context.close();
    if (campaign) await prisma.campaign.delete({ where: { id: campaign.id } });
    for (const user of accounts) await prisma.user.delete({ where: { id: user.id } });
    await prisma.$disconnect();
  }
});
