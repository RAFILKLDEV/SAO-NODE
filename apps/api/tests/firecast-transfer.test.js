import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';

let app;

beforeAll(async () => {
  process.env.SAO_NODE_BRIDGE_TOKEN = 'test-bridge-token';
  app = await buildApp();
});

afterAll(async () => {
  await app.close();
});

describe('Firecast transfer bridge', () => {
  it('does not redeem a ticket without the server-to-server credential', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/firecast/transfers/redeem',
      payload: { ticket: 'not-a-ticket' }
    });
    expect(response.statusCode).toBe(401);
    expect(response.json().error.code).toBe('UNAUTHORIZED');
  });

  it('does not expose arbitrary files through the public image capability route', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/firecast/images/../../secrets.txt'
    });
    expect(response.statusCode).toBe(404);
  });
});
