import crypto from 'node:crypto';
import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { authenticate, requireCampaign, requireCsrf, requireGm } from '../lib/auth.js';
import { config } from '../lib/config.js';
import { apiError } from '@sao/shared';

const mediaTypes = {
  'image/png': {
    extension: 'png',
    signature: (buffer) => buffer.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))
  },
  'image/jpeg': {
    extension: 'jpg',
    signature: (buffer) => buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff
  },
  'image/gif': {
    extension: 'gif',
    signature: (buffer) => ['GIF87a', 'GIF89a'].includes(buffer.subarray(0, 6).toString('ascii'))
  },
  'image/webp': {
    extension: 'webp',
    signature: (buffer) =>
      buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
      buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  },
  'image/avif': {
    extension: 'avif',
    signature: (buffer) =>
      buffer.subarray(4, 8).toString('ascii') === 'ftyp' &&
      ['avif', 'avis'].includes(buffer.subarray(8, 12).toString('ascii'))
  },
  'image/bmp': {
    extension: 'bmp',
    signature: (buffer) => buffer.subarray(0, 2).toString('ascii') === 'BM'
  },
};
const filePattern = /^[a-f0-9-]+\.(png|jpg|gif|webp|avif|bmp)$/;
const infiniteLoopExtension = Buffer.from([
  0x21,
  0xff,
  0x0b,
  ...Buffer.from('NETSCAPE2.0', 'ascii'),
  0x03,
  0x01,
  0x00,
  0x00,
  0x00
]);

export function ensureGifLoops(source) {
  const buffer = Buffer.from(source);
  let foundLoopExtension = false;
  for (const identifier of ['NETSCAPE2.0', 'ANIMEXTS1.0']) {
    let offset = buffer.indexOf(identifier, 0, 'ascii');
    while (offset >= 0) {
      if (buffer[offset + 11] === 0x03 && buffer[offset + 12] === 0x01) {
        buffer[offset + 13] = 0x00;
        buffer[offset + 14] = 0x00;
        foundLoopExtension = true;
      }
      offset = buffer.indexOf(identifier, offset + identifier.length, 'ascii');
    }
  }
  if (foundLoopExtension) return buffer;

  if (
    buffer.length < 13 ||
    !['GIF87a', 'GIF89a'].includes(buffer.subarray(0, 6).toString('ascii'))
  ) {
    const error = new Error('GIF inválido.');
    error.code = 'INVALID_GIF';
    throw error;
  }
  const packedFields = buffer[10];
  const colorTableBytes = packedFields & 0x80 ? 3 * 2 ** ((packedFields & 0x07) + 1) : 0;
  const insertionPoint = 13 + colorTableBytes;
  if (insertionPoint > buffer.length) {
    const error = new Error('GIF inválido.');
    error.code = 'INVALID_GIF';
    throw error;
  }
  return Buffer.concat([
    buffer.subarray(0, insertionPoint),
    infiniteLoopExtension,
    buffer.subarray(insertionPoint)
  ]);
}

function campaignUploadDir(campaignId) {
  return path.join(config.uploadDir, campaignId);
}

export async function mediaRoutes(app) {
  app.post(
    '/api/v1/campaigns/:campaignId/media',
    { preHandler: [authenticate, requireCampaign, requireGm, requireCsrf] },
    async (request, reply) => {
      try {
        const part = await request.file({
          limits: { fileSize: config.maxImageBytes, files: 1 }
        });
        const mediaType = part && mediaTypes[part.mimetype];
        if (!part || !mediaType)
          return reply
            .code(400)
            .send(apiError('INVALID_IMAGE', 'Envie uma imagem PNG, JPEG, GIF, WebP, AVIF ou BMP.'));
        let buffer = await part.toBuffer();
        if (!buffer.length || buffer.length > config.maxImageBytes || part.file.truncated)
          return reply
            .code(413)
            .send(apiError('IMAGE_TOO_LARGE', 'A imagem excede o limite de 50 MB.'));
        if (!mediaType.signature(buffer))
          return reply
            .code(400)
            .send(
              apiError(
                'INVALID_IMAGE',
                'O conteúdo do arquivo não corresponde ao formato informado.'
              )
            );
        if (part.mimetype === 'image/gif') buffer = ensureGifLoops(buffer);

        const fileName = `${crypto.randomUUID()}.${mediaType.extension}`;
        const directory = campaignUploadDir(request.campaign.id);
        await mkdir(directory, { recursive: true });
        await writeFile(path.join(directory, fileName), buffer, { flag: 'wx' });
        return reply.code(201).send({
          url: `/api/v1/campaigns/${request.campaign.id}/media/${fileName}`,
          mimeType: part.mimetype,
          animated: part.mimetype === 'image/gif'
        });
      } catch (error) {
        if (error.code === 'INVALID_GIF')
          return reply.code(400).send(apiError('INVALID_IMAGE', error.message));
        if (error.code === 'FST_REQ_FILE_TOO_LARGE')
          return reply
            .code(413)
            .send(apiError('IMAGE_TOO_LARGE', 'A imagem excede o limite de 50 MB.'));
        throw error;
      }
    }
  );

  app.get(
    '/api/v1/campaigns/:campaignId/media/:fileName',
    { preHandler: [authenticate, requireCampaign] },
    async (request, reply) => {
      const { fileName } = request.params;
      if (!filePattern.test(fileName))
        return reply.code(404).send(apiError('NOT_FOUND', 'Imagem não encontrada.'));
      try {
        const buffer = await readFile(path.join(campaignUploadDir(request.campaign.id), fileName));
        const extension = path.extname(fileName).slice(1);
        const mimeType =
          extension === 'jpg'
            ? 'image/jpeg'
            : extension === 'gif'
              ? 'image/gif'
              : extension === 'avif'
                ? 'image/avif'
                : extension === 'bmp'
                  ? 'image/bmp'
                  : `image/${extension}`;
        return reply
          .type(mimeType)
          .header('Cache-Control', 'private, max-age=31536000, immutable')
          .send(buffer);
      } catch (error) {
        if (error.code === 'ENOENT')
          return reply.code(404).send(apiError('NOT_FOUND', 'Imagem não encontrada.'));
        throw error;
      }
    }
  );
}
