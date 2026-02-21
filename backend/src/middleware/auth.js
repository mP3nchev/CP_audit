'use strict';
const crypto = require('crypto');

const INTERNAL_API_KEY = process.env.INTERNAL_API_KEY;
const KEY_PADDED_LENGTH = 256; // pad both sides to same length for timingSafeEqual

function log(data) {
  process.stdout.write(JSON.stringify({ ts: new Date().toISOString(), service: 'auth', ...data }) + '\n');
}

/**
 * X-API-Key middleware. Timing-safe comparison.
 * OPTIONS preflight requests are always passed through — browsers never
 * include custom headers in preflights, authentication happens on the
 * actual request that follows.
 */
function authMiddleware(req, res, next) {
  // Pass OPTIONS preflights through — cors handles them, not auth
  if (req.method === 'OPTIONS') return next();

  const provided = (req.headers['x-api-key'] || '').trim();

  if (!provided) {
    log({ level: 'warn', event: 'auth_missing_key', ip: req.ip, path: req.path, method: req.method });
    return res.status(401).json({ error: 'Unauthorized', code: 'E401' });
  }

  if (!INTERNAL_API_KEY) {
    log({ level: 'error', event: 'auth_key_not_configured' });
    return res.status(500).json({ error: 'Server misconfigured', code: 'E500' });
  }

  // Timing-safe comparison — pad to fixed length before compare
  const a = Buffer.alloc(KEY_PADDED_LENGTH);
  const b = Buffer.alloc(KEY_PADDED_LENGTH);
  a.write(provided.slice(0, KEY_PADDED_LENGTH));
  b.write(INTERNAL_API_KEY.slice(0, KEY_PADDED_LENGTH));

  if (!crypto.timingSafeEqual(a, b)) {
    log({ level: 'warn', event: 'auth_invalid_key', ip: req.ip, path: req.path, prefix: provided.slice(0, 8) });
    return res.status(401).json({ error: 'Unauthorized', code: 'E401' });
  }

  next();
}

/**
 * HMAC-SHA256 signature verifier — reserved for future webhook/signing use.
 */
function verifyHmacSignature(payload, signature, secret) {
  if (!signature || !secret) return false;
  const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  const a = Buffer.from(signature.replace(/^sha256=/, ''), 'hex');
  const b = Buffer.from(expected, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

module.exports = { authMiddleware, verifyHmacSignature };
