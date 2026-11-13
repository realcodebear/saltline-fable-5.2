// lib/auth.mjs —— 密码 scrypt 哈希 + HMAC-SHA256 自签 token
import { createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { HttpError } from './http.mjs';

const scrypt = promisify(scryptCallback);

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEY_LEN = 64;

export const TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 24;
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 200;

const USERNAME_RE = /^[\p{L}\p{N}_.-]{3,24}$/u;

export function validateUsername(value) {
  if (typeof value !== 'string') throw new HttpError(400, 'invalid_username', '用户名必须是字符串');
  const name = value.trim();
  if (name.length < USERNAME_MIN || name.length > USERNAME_MAX) {
    throw new HttpError(400, 'invalid_username', '用户名长度需在 ' + USERNAME_MIN + '-' + USERNAME_MAX + ' 个字符之间');
  }
  if (!USERNAME_RE.test(name)) {
    throw new HttpError(400, 'invalid_username', '用户名只能包含中英文、数字、下划线、点与短横线');
  }
  return name;
}

export function validatePassword(value) {
  if (typeof value !== 'string') throw new HttpError(400, 'invalid_password', '密码必须是字符串');
  if (value.length < PASSWORD_MIN) {
    throw new HttpError(400, 'invalid_password', '密码至少 ' + PASSWORD_MIN + ' 位');
  }
  if (value.length > PASSWORD_MAX) {
    throw new HttpError(400, 'invalid_password', '密码最长 ' + PASSWORD_MAX + ' 位');
  }
  return value;
}

export async function hashPassword(plain) {
  const salt = randomBytes(16).toString('hex');
  const key = await scrypt(plain, salt, KEY_LEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: 128 * SCRYPT_N * SCRYPT_R * 2,
  });
  return 'scrypt$' + SCRYPT_N + '$' + SCRYPT_R + '$' + SCRYPT_P + '$' + salt + '$' + key.toString('hex');
}

export async function verifyPassword(plain, stored) {
  if (typeof stored !== 'string') return false;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  const salt = parts[4];
  const expected = Buffer.from(parts[5], 'hex');
  if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p) || !salt) return false;
  let actual;
  try {
    actual = await scrypt(plain, salt, expected.length, {
      N: N,
      r: r,
      p: p,
      maxmem: 128 * N * r * 2,
    });
  } catch (err) {
    return false;
  }
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

function b64url(input) {
  return Buffer.from(input).toString('base64url');
}

function hmac(secret, text) {
  return createHmac('sha256', secret).update(text).digest('base64url');
}

export function signToken(claims, secret, ttlSeconds) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = {
    sub: claims.sub,
    role: claims.role,
    username: claims.username || '',
    iat: now,
    exp: now + (ttlSeconds || TOKEN_TTL_SECONDS),
  };
  const head = b64url(JSON.stringify(header));
  const body = b64url(JSON.stringify(payload));
  const signature = hmac(secret, head + '.' + body);
  return head + '.' + body + '.' + signature;
}

// 校验失败一律返回 null，由调用方给出中文错误
export function verifyToken(token, secret) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const head = parts[0];
  const body = parts[1];
  const signature = parts[2];
  const expected = hmac(secret, head + '.' + body);
  const a = Buffer.from(signature, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  let payload;
  try {
    payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch (err) {
    return null;
  }
  if (!payload || typeof payload !== 'object') return null;
  if (typeof payload.exp !== 'number' || payload.exp * 1000 <= Date.now()) return null;
  if (!payload.sub || !payload.role) return null;
  return payload;
}
