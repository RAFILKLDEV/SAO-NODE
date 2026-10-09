import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('argon2', () => ({ default: { verify: vi.fn(), hash: vi.fn() } }));
vi.mock('../src/lib/prisma.js', () => ({ prisma: {
  $transaction: vi.fn(),
  user: { findUnique: vi.fn(), update: vi.fn() },
  membership: { findUnique: vi.fn(), update: vi.fn() },
  session: { deleteMany: vi.fn() }
} }));
vi.mock('../src/lib/auth.js', () => ({
  authenticate: async (request) => { request.auth = { user: { id: 'user-1', login: 'old-login', name: 'Jogador', passwordHash: 'old-hash' }, session: { id: 'session-current' } }; },
  requireCampaign: async (request) => { request.campaign = { id: request.params.campaignId }; request.membership = { userId: 'user-1', role: 'player' }; },
  requireCsrf: async () => {},
  requireGm: async (request, reply) => { if (request.membership.role !== 'gm') return reply.code(403).send({ error: 'Forbidden' }); }
}));
vi.mock('../src/lib/audit.js', () => ({ audit: vi.fn() }));
import argon2 from 'argon2';
import { prisma } from '../src/lib/prisma.js';
import { campaignRoutes } from '../src/routes/campaigns.js';

let app;
beforeEach(async () => {
  vi.clearAllMocks();
  app = Fastify();
  await app.register(campaignRoutes);
  prisma.$transaction.mockImplementation((callback) => callback(prisma));
  prisma.user.findUnique.mockResolvedValue({ id: 'user-1', name: 'Jogador', login: 'old-login', passwordHash: 'old-hash' });
  prisma.user.update.mockImplementation(async ({ data }) => ({ id: 'user-1', name: data.name ?? 'Jogador', login: data.login ?? 'old-login' }));
  prisma.membership.findUnique.mockResolvedValue({ id: 'membership-1', userId: 'user-1', role: 'player', characterImageUrl: null });
  prisma.membership.update.mockImplementation(async ({ data }) => ({ id: 'membership-1', userId: 'user-1', role: 'player', characterImageUrl: data.characterImageUrl }));
  prisma.session.deleteMany.mockResolvedValue({ count: 2 });
  argon2.verify.mockResolvedValue(true);
  argon2.hash.mockResolvedValue('new-hash');
});
afterEach(async () => { await app.close(); });
const request = (payload) => app.inject({ method: 'PUT', url: '/api/v1/campaigns/camp-1/me/profile', payload });

describe('self profile', () => {
  it('allows a member to change their display name without receiving a userId', async () => {
    const response = await request({ name: 'Nome novo' });
    expect(response.statusCode, response.body).toBe(200);
    expect(prisma.user.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'user-1' }, data: { name: 'Nome novo' } }));
  });

  it('rejects attempts to choose another account through the request body', async () => {
    const response = await request({ userId: 'user-2', name: 'Outro jogador' });
    expect(response.statusCode).toBe(400);
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('requires the current password for login changes and invalidates other sessions for password changes', async () => {
    expect((await request({ login: 'new-login' })).statusCode).toBe(400);
    expect((await request({ currentPassword: 'senha', newPassword: 'nova-senha' })).statusCode).toBe(200);
    expect(prisma.session.deleteMany).toHaveBeenCalledWith({ where: { userId: 'user-1', id: { not: 'session-current' } } });
    expect(argon2.hash).toHaveBeenCalledWith('nova-senha');
  });

  it('rejects an incorrect current password and permits only HTTPS photo URLs', async () => {
    argon2.verify.mockResolvedValue(false);
    expect((await request({ login: 'new-login', currentPassword: 'errada' })).statusCode).toBe(403);
    expect((await request({ characterImageUrl: 'http://insecure.example/avatar.png' })).statusCode).toBe(400);
    expect((await request({ characterImageUrl: 'https://example.com/avatar.png' })).statusCode).toBe(200);
  });
});
