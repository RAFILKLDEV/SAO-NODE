import crypto from 'node:crypto';
import { config } from './config.js';

export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function sessionCookieOptions() {
  return {
    path: '/',
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: 'lax',
    maxAge: config.sessionTtlHours * 60 * 60
  };
}

export function assertSafeRemoteUrl(value) {
  if (!value) return value;
  if (/^\/api\/v1\/campaigns\/[^/]+\/media\/[a-f0-9-]+\.(?:png|jpe?g|gif|webp|avif|bmp)$/i.test(value))
    return value;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol))
      throw new Error('A URL da imagem deve usar HTTP ou HTTPS.');
    if (url.username || url.password) throw new Error('A URL da imagem não pode ter credenciais.');
    return url.toString();
  } catch (cause) {
    const error = new Error(
      cause.message === 'Invalid URL' ? 'URL de imagem inválida.' : cause.message
    );
    error.code = 'INVALID_REMOTE_URL';
    throw error;
  }
}
