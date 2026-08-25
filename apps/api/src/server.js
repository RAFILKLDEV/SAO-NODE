import { Server as SocketIOServer } from 'socket.io';
import { buildApp } from './app.js';
import { config } from './lib/config.js';
import { prisma } from './lib/prisma.js';
import { hashToken } from './lib/security.js';

function parseCookies(header = '') {
  return Object.fromEntries(
    header
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf('=');
        if (index < 0) return [part, ''];
        return [decodeURIComponent(part.slice(0, index)), decodeURIComponent(part.slice(index + 1))];
      })
  );
}

const app = await buildApp();
await app.ready();

const io = new SocketIOServer(app.server, {
  cors: { origin: config.webOrigin, credentials: true }
});
app.realtime = io;

io.use(async (socket, next) => {
  try {
    const cookies = parseCookies(socket.handshake.headers.cookie);
    const token = cookies[config.sessionCookieName];
    const campaignId = socket.handshake.auth?.campaignId;
    if (!token || !campaignId) return next(new Error('unauthorized'));
    const session = await prisma.session.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { user: true }
    });
    if (!session || session.expiresAt <= new Date()) return next(new Error('unauthorized'));
    const membership = await prisma.membership.findUnique({
      where: { campaignId_userId: { campaignId, userId: session.userId } }
    });
    if (!membership) return next(new Error('unauthorized'));
    socket.data.userId = session.userId;
    socket.data.campaignId = campaignId;
    socket.data.role = membership.role;
    return next();
  } catch {
    return next(new Error('unauthorized'));
  }
});

io.on('connection', (socket) => {
  socket.join(`campaign:${socket.data.campaignId}`);
});

const shutdown = async () => {
  io.close();
  await app.close();
  await prisma.$disconnect();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

await app.listen({ port: config.port, host: '0.0.0.0' });
