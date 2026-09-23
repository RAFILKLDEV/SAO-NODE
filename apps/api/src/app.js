import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { ZodError } from 'zod';
import { config } from './lib/config.js';
import { prisma } from './lib/prisma.js';
import { apiError } from '@sao/shared';
import { authRoutes } from './routes/auth.js';
import { campaignRoutes } from './routes/campaigns.js';
import { entityRoutes } from './routes/entities.js';
import { groupRoutes } from './routes/groups.js';
import { grantRoutes } from './routes/grants.js';
import { progressRoutes } from './routes/progress.js';
import { searchRoutes } from './routes/search.js';
import { dropRoutes } from './routes/drops.js';
import { auditRoutes } from './routes/audit.js';
import { jsonRoutes } from './routes/json.js';
import { characterRoutes } from './routes/characters.js';
import { mediaRoutes } from './routes/media.js';

export async function buildApp() {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
      redact: ['req.headers.cookie', 'req.headers.authorization', 'res.headers.set-cookie']
    },
    bodyLimit: config.maxJsonBytes + 1024 * 1024
  });

  app.decorate('realtime', null);
  app.decorate('importPreviews', new Map());
  app.decorateRequest('viewerContext', null);
  app.decorateRequest('backlinkIndex', null);

  await app.register(cookie);
  await app.register(cors, {
    origin: config.webOrigin,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['content-type', 'x-csrf-token', 'if-match']
  });
  await app.register(helmet, {
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' }
  });
  await app.register(rateLimit, { global: false });
  await app.register(multipart, {
    limits: { fileSize: config.maxImageBytes, files: 1, fields: 10 }
  });
  await app.register(swagger, {
    openapi: {
      info: { title: 'SAO RPG Database API', version: '1.0.0' },
      servers: [{ url: '/api/v1' }]
    }
  });
  await app.register(swaggerUi, { routePrefix: '/docs' });

  app.get('/health', async (_request, reply) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      return { ok: true, database: 'up' };
    } catch {
      return reply.code(503).send({ ok: false, database: 'down' });
    }
  });

  // Register the handler before route plugins so Fastify's encapsulated route
  // contexts inherit it.
  app.setErrorHandler((error, _request, reply) => {
    // Workspaces/containers can load more than one Zod module instance, which
    // makes instanceof alone unreliable for otherwise valid ZodError objects.
    if (error instanceof ZodError || error?.name === 'ZodError')
      return reply.code(400).send(
        apiError('INVALID_INPUT', 'Dados inválidos', {
          issues: error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message
          }))
        })
      );
    if (error.code === 'INVALID_ENTITY_ID')
      return reply.code(400).send(apiError('INVALID_INPUT', error.message));
    if (error.code === 'INVALID_REMOTE_URL')
      return reply.code(400).send(apiError('INVALID_INPUT', error.message));
    if (error.code === 'INVALID_VIEWER')
      return reply.code(400).send(apiError('INVALID_VIEWER', error.message));
    if (error.code === 'INVALID_CONTENT') return reply.code(400).send(apiError('INVALID_CONTENT', error.message));
    if (error.code === 'P2034') return reply.code(409).send(apiError('VERSION_CONFLICT', 'A campanha mudou. Atualize a pr?via.'));
    if (error.code === 'VERSION_CONFLICT')
      return reply.code(409).send(apiError('VERSION_CONFLICT', error.message));
    if (error.code === 'P2002')
      return reply
        .code(409)
        .send(apiError('CONFLICT', 'A record with this unique key already exists'));
    if (error.code === 'FST_REQ_FILE_TOO_LARGE')
      return reply
        .code(413)
        .send(apiError('FILE_TOO_LARGE', 'Uploaded file exceeds the configured limit'));
    if (Number.isInteger(error.statusCode) && error.statusCode >= 400 && error.statusCode < 500)
      return reply
        .code(error.statusCode)
        .send(apiError(error.code ?? 'BAD_REQUEST', error.message));
    app.log.error({ err: error }, 'request failed');
    return reply.code(500).send(apiError('INTERNAL_ERROR', 'Internal server error'));
  });

  await app.register(authRoutes);
  await app.register(campaignRoutes);
  await app.register(entityRoutes);
  await app.register(groupRoutes);
  await app.register(grantRoutes);
  await app.register(progressRoutes);
  await app.register(searchRoutes);
  await app.register(dropRoutes);
  await app.register(auditRoutes);
  await app.register(jsonRoutes);
  await app.register(characterRoutes);
  await app.register(mediaRoutes);

  return app;
}
