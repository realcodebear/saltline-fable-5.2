// lib/http.mjs —— HTTP 工具：JSON 读写、静态文件、CORS、限流、路径安全
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';

export const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
  '.wasm': 'application/wasm',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

export const DEFAULT_JSON_LIMIT = 6 * 1024 * 1024;

// 业务异常：统一转成 { error: { code, message } }
export class HttpError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.code = code;
  }
}

export function sendJson(res, status, payload, headers) {
  const body = Buffer.from(JSON.stringify(payload), 'utf8');
  const base = {
    'content-type': 'application/json; charset=utf-8',
    'content-length': body.length,
    'cache-control': 'no-store',
  };
  res.writeHead(status, Object.assign(base, headers || {}));
  res.end(body);
}

export function sendError(res, status, code, message, headers) {
  sendJson(res, status, { error: { code: code, message: message } }, headers);
}

export async function readJsonBody(req, limitBytes) {
  const limit = limitBytes || DEFAULT_JSON_LIMIT;
  const declared = Number(req.headers['content-length'] || 0);
  if (declared && declared > limit) {
    throw new HttpError(413, 'payload_too_large', '请求体超过上限（最大 ' + Math.round(limit / 1024 / 1024) + ' MB）');
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) {
      throw new HttpError(413, 'payload_too_large', '请求体超过上限（最大 ' + Math.round(limit / 1024 / 1024) + ' MB）');
    }
    chunks.push(chunk);
  }
  if (size === 0) return {};
  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new HttpError(400, 'invalid_json', '请求体必须是 JSON 对象');
    }
    return parsed;
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(400, 'invalid_json', '请求体不是合法的 JSON');
  }
}

export function getBearerToken(req) {
  const raw = req.headers['authorization'];
  if (!raw || typeof raw !== 'string') return '';
  const m = /^Bearer\s+(.+)$/i.exec(raw.trim());
  return m ? m[1].trim() : '';
}

export function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    const first = forwarded.split(',')[0].trim();
    if (first) return first;
  }
  const real = req.headers['x-real-ip'];
  if (typeof real === 'string' && real.trim()) return real.trim();
  const socket = req.socket || {};
  return socket.remoteAddress || 'unknown';
}

export function setCors(req, res, allowOrigin) {
  const origin = allowOrigin || '*';
  res.setHeader('access-control-allow-origin', origin);
  res.setHeader('vary', 'origin');
  res.setHeader('access-control-allow-headers', 'authorization, content-type, x-requested-with');
  res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
  res.setHeader('access-control-max-age', '86400');
  if (origin !== '*') res.setHeader('access-control-allow-credentials', 'true');
}

// 简易滑动窗口限流（内存态，单进程）
export class RateLimiter {
  constructor(options) {
    this.limit = options.limit;
    this.windowMs = options.windowMs;
    this.hits = new Map();
  }

  hit(key) {
    const now = Date.now();
    const bucket = this.hits.get(key);
    if (!bucket || bucket.resetAt <= now) {
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
      this.sweep(now);
      return { ok: true, remaining: this.limit - 1, retryAfter: 0 };
    }
    bucket.count += 1;
    if (bucket.count > this.limit) {
      return { ok: false, remaining: 0, retryAfter: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)) };
    }
    return { ok: true, remaining: this.limit - bucket.count, retryAfter: 0 };
  }

  sweep(now) {
    if (this.hits.size < 1000) return;
    for (const entry of this.hits) {
      if (entry[1].resetAt <= now) this.hits.delete(entry[0]);
    }
  }

  reset() {
    this.hits.clear();
  }
}

// 路径穿越防护：把 URL 路径解析到 root 之内
export function safeResolve(rootDir, unsafePath) {
  let decoded = unsafePath;
  try {
    decoded = decodeURIComponent(unsafePath);
  } catch (err) {
    throw new HttpError(400, 'bad_path', '路径编码不合法');
  }
  if (decoded.indexOf('\0') >= 0) {
    throw new HttpError(400, 'bad_path', '路径包含非法字符');
  }
  const root = resolve(rootDir);
  const withSlash = decoded.startsWith('/') ? decoded : '/' + decoded;
  const target = resolve(root, '.' + withSlash);
  if (target !== root && !target.startsWith(root + sep)) {
    throw new HttpError(403, 'forbidden_path', '禁止访问该路径');
  }
  return target;
}

// 静态文件；返回 true 表示已经响应
export async function serveStatic(req, res, options) {
  const rootDir = options.rootDir;
  const cacheControl = options.cacheControl || 'public, max-age=60';
  let target = safeResolve(rootDir, options.relPath || '/');
  let info = await stat(target).catch(function () { return null; });
  if (info && info.isDirectory()) {
    target = resolve(target, 'index.html');
    info = await stat(target).catch(function () { return null; });
  }
  if (!info || !info.isFile()) return false;

  const ext = extname(target).toLowerCase();
  const etag = 'W/"' + info.size.toString(16) + '-' + Math.floor(info.mtimeMs).toString(16) + '"';
  const headers = {
    'content-type': MIME_TYPES[ext] || 'application/octet-stream',
    'cache-control': cacheControl,
    etag: etag,
    'last-modified': info.mtime.toUTCString(),
  };
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, headers);
    res.end();
    return true;
  }
  headers['content-length'] = info.size;
  res.writeHead(200, headers);
  if (req.method === 'HEAD') {
    res.end();
    return true;
  }
  await new Promise(function (done, fail) {
    const stream = createReadStream(target);
    stream.on('error', fail);
    stream.on('close', function () { done(); });
    res.on('close', function () { stream.destroy(); done(); });
    stream.pipe(res);
  });
  return true;
}
