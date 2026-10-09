import { test, expect } from '@playwright/test';

async function setup(page) {
  const state = { writes: [], conflict: false, entry: {
    id: 'own-progress', questId: 'quest.hunt', questName: 'Caçada', ownerType: 'player', ownerId: 'ana', state: 'active', version: 1, percentage: 20,
    objectives: [
      { objectiveId: 'hunt', text: 'Derrote javalis', value: 1, requiredQuantity: 5, editable: true },
      { objectiveId: 'gm', text: 'Converse com o guia', value: 0, requiredQuantity: 1, editable: true },
      { objectiveId: 'blocked', text: 'Relate a caçada', value: 0, requiredQuantity: 2, editable: false }
    ]
  } };
  await page.route('**/api/v1/**', route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    const json = (body, status = 200) => route.fulfill({ json: body, status });
    if (path.endsWith('/auth/me')) return json({ id: 'ana-id', login: 'ana', name: 'Ana' });
    if (path.endsWith('/auth/csrf')) return json({ csrfToken: 'test' });
    if (path.endsWith('/campaigns/progress-ui')) return json({ id: 'progress-ui', name: 'Teste', role: 'player' });
    if (path.endsWith('/groups')) return json([]);
    if (path.endsWith('/progress/players')) return json([{ id: 'ana-id', login: 'ana', name: 'Ana' }]);
    if (path.endsWith('/progress')) return json([state.entry]);
    if (request.method() === 'PATCH') {
      const body = request.postDataJSON(); state.writes.push({ path, body });
      if (state.conflict) {
        state.entry.version++; state.entry.objectives[0].value = 4;
        return json({ error: { code: 'VERSION_CONFLICT', message: 'O progresso foi alterado por outra pessoa.' } }, 409);
      }
      state.entry.objectives.find(objective => objective.objectiveId === path.split('/').at(-1)).value = body.value; state.entry.version++;
      return json(state.entry);
    }
    return json({ items: [] });
  });
  await page.goto('/campaigns/progress-ui/progress');
  await expect(page.getByRole('heading', { name: 'Progresso e decisões' })).toBeVisible();
  await expect(page.getByRole('spinbutton', { name: 'Progresso de Derrote javalis' })).toHaveValue('1');
  return state;
}
test('jogador atualiza todos os objetivos visíveis da própria missão e respeita dependências', async ({ page }) => {
  const state = await setup(page), input = page.getByRole('spinbutton', { name: 'Progresso de Derrote javalis' });
  await expect(input).toBeEnabled();
  const guide = page.getByRole('spinbutton', { name: 'Progresso de Converse com o guia' });
  await expect(guide).toBeEnabled();
  await expect(page.getByRole('spinbutton', { name: 'Progresso de Relate a caçada' })).toBeDisabled();
  await input.fill('3'); await page.locator('.objective-progress').filter({ has: input }).getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect.poll(() => state.entry.version).toBe(2);
  expect(state.writes[0]).toMatchObject({ path: '/api/v1/campaigns/progress-ui/progress/own-progress/objectives/hunt', body: { value: 3, version: 1 } });
  await expect(input).toHaveValue('3');
  await guide.fill('1'); await page.locator('.objective-progress').filter({ has: guide }).getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect.poll(() => state.entry.version).toBe(3);
  expect(state.writes[1]).toMatchObject({ body: { value: 1, version: 2 } });
  await expect(page.getByRole('button', { name: 'Concluir missão', exact: true })).toHaveCount(0);
  await page.reload(); await expect(input).toHaveValue('3');
});
test('conflito de versão atualiza os valores exibidos sem sobrescrever a missão', async ({ page }) => {
  const state = await setup(page); state.conflict = true;
  const input = page.getByRole('spinbutton', { name: 'Progresso de Derrote javalis' });
  await input.fill('2'); await page.locator('.objective-progress').filter({ has: input }).getByRole('button', { name: 'Salvar', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('alterado por outra pessoa');
  await expect(input).toHaveValue('4'); expect(state.writes).toHaveLength(1);
});
