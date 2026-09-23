import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { buildApp } from '../src/app.js';

let app;

beforeAll(async () => {
  process.env.DISABLE_LOGIN = 'true';
  process.env.LOCAL_ADMIN_LOGIN = 'Rafilkl';
  process.env.LOCAL_ADMIN_PASSWORD = 'asadasan123';
  process.env.LOCAL_ADMIN_NAME = 'Rafilkl';

  app = await buildApp();
  await app.register(async (scope) => {
    scope.get('/test/validation-error', async () => z.number().min(1).parse(0));
  });
});

afterAll(async () => {
  await app.close();
});

describe('API security envelope', () => {
  it('maps validation errors thrown inside route plugins to 400', async () => {
    const response = await app.inject({ method: 'GET', url: '/test/validation-error' });
    expect(response.statusCode).toBe(400);
    expect(response.json().error).toMatchObject({
      code: 'INVALID_INPUT',
      message: 'Dados inválidos',
      details: { issues: [{ path: '', message: expect.any(String) }] }
    });
  });

  it('rejects unauthenticated campaign access before touching campaign data', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/campaigns' });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('UNAUTHENTICATED');
  });

  it('rejects protected entity routes without a session', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/campaigns/fake/items' });
    expect(response.statusCode).toBe(401);
  });

  it('rejects unauthenticated image access', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/campaigns/fake/media/00000000-0000-0000-0000-000000000000.gif'
    });
    expect(response.statusCode).toBe(401);
  });

  it.runIf(Boolean(process.env.TEST_DATABASE_URL))('accepts the local admin bypass credentials when login is disabled', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { login: 'Rafilkl', password: 'asadasan123' }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      user: { login: 'Rafilkl', name: 'Rafilkl' }
    });
  });

  it.runIf(Boolean(process.env.TEST_DATABASE_URL))('creates a player account and joins the campaign from the GM players menu', async () => {
    const loginResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { login: 'Rafilkl', password: 'asadasan123' }
    });
    const csrfToken = loginResponse.json().csrfToken;
    const cookieHeader = loginResponse.headers['set-cookie'];
    const cookies = (Array.isArray(cookieHeader) ? cookieHeader[0] : cookieHeader)?.split(';')[0] ?? '';

    const campaignResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/campaigns',
      headers: { cookie: cookies, 'x-csrf-token': csrfToken },
      payload: { slug: `players-menu-test-${Date.now()}`, name: 'Players Menu Test' }
    });
    expect(campaignResponse.statusCode).toBe(201);
    const campaignId = campaignResponse.json().id;

    const createPlayerResponse = await app.inject({
      method: 'POST',
      url: `/api/v1/campaigns/${campaignId}/players`,
      headers: { cookie: cookies, 'x-csrf-token': csrfToken },
      payload: { login: 'jogador-menu', name: 'Jogador Menu', password: 'senha-123' }
    });

    expect(createPlayerResponse.statusCode).toBe(201);
    expect(createPlayerResponse.json()).toMatchObject({
      user: { login: 'jogador-menu', name: 'Jogador Menu' },
      role: 'player'
    });

    const membershipsResponse = await app.inject({
      method: 'GET',
      url: `/api/v1/campaigns/${campaignId}/memberships`,
      headers: { cookie: cookies }
    });
    expect(membershipsResponse.statusCode).toBe(200);
    expect(membershipsResponse.json().some((entry) => entry.user.login === 'jogador-menu')).toBe(true);
    const { prisma } = await import('../src/lib/prisma.js');
    await prisma.campaign.delete({ where: { id: campaignId } });
  });
});
