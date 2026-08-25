import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';

let app;

beforeAll(async () => {
  app = await buildApp();
});

afterAll(async () => {
  await app.close();
});

describe('API security envelope', () => {
  it('rejects unauthenticated campaign access before touching campaign data', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/campaigns' });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('UNAUTHENTICATED');
  });

  it('rejects protected entity routes without a session', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/campaigns/fake/items' });
    expect(response.statusCode).toBe(401);
  });
});
