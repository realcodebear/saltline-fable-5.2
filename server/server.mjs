#!/usr/bin/env node
// server.mjs —— 提示词市集 API 入口：路由 + 静态托管 + 启动编排
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve, sep } from 'node:path';
import { randomBytes } from 'node:crypto';

import {
  HttpError,
  sendJson,
  sendError,
  readJsonBody,
  getBearerToken,
  clientIp,
  setCors,
  RateLimiter,
  serveStatic,
} from './lib/http.mjs';
import {
  signToken,
  verifyToken,
  validateUsername,
  validatePassword,
  verifyPassword,
} from './lib/auth.mjs';
import { Store, loadOrCreateSecret } from './lib/db.mjs';
import {
  createProject,
  projectView,
  findProject,
  listPublic,
  listByAuthor,
  listAdmin,
  queue,
  statsOf,
  reviewProject,
  setStatus,
  EVENT_TYPES,
  MAX_ENTRY_BYTES,
  MAX_COVER_BYTES,
} from './lib/projects.mjs';
import { EventHub, postWebhook } from './lib/push.mjs';

const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SERVER_DIR, '..');
const API_VERSION = '1.0';
const JSON_BODY_LIMIT = 6 * 1024 * 1024;

const DEFAULT_CONFIG = {
  port: 8790,
  host: '0.0.0.0',
  siteName: '提示词市集',
  allowOrigin: '*',
  uploadMaxMB: 3,
  admin: { username: 'admin', password: '' },
  webhook: { url: '' },
};

// ---------- 参数与配置 ----------

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg || arg.charAt(0) !== '-') continue;
    const body = arg.replace(/^--?/, '');
    const eq = body.indexOf('=');
    if (eq >= 0) {
      out[body.slice(0, eq)] = body.slice(eq + 1);
      continue;
    }
    const next = argv[i + 1];
    if (next && next.charAt(0) !== '-') {
      out[body] = next;
      i += 1;
    } else {
      out[body] = 'true';
    }
  }
  return out;
}

function pickNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

async function readConfigFile(path) {
  if (!path) return null;
  try {
    const raw = await readFile(path, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') throw new Error('配置必须是 JSON 对象');
    return parsed;
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw new Error('读取配置文件 ' + path + ' 失败：' + err.message);
  }
}

async function loadConfig(args) {
  const config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  const configPath = args.config ? resolve(args.config) : join(SERVER_DIR, 'config.json');
  const fileConfig = await readConfigFile(configPath);
  if (fileConfig) {
    Object.assign(config, fileConfig);
    config.admin = Object.assign({}, DEFAULT_CONFIG.admin, fileConfig.admin || {});
    config.webhook = Object.assign({}, DEFAULT_CONFIG.webhook, fileConfig.webhook || {});
  }
  const env = process.env;
  if (env.PORT) config.port = pickNumber(env.PORT, config.port);
  if (env.HOST) config.host = env.HOST;
  if (env.SITE_NAME) config.siteName = env.SITE_NAME;
  if (env.ALLOW_ORIGIN) config.allowOrigin = env.ALLOW_ORIGIN;
  if (env.UPLOAD_MAX_MB) config.uploadMaxMB = pickNumber(env.UPLOAD_MAX_MB, config.uploadMaxMB);
  if (env.ADMIN_USER) config.admin.username = env.ADMIN_USER;
  if (env.ADMIN_PASSWORD) config.admin.password = env.ADMIN_PASSWORD;
  if (env.WEBHOOK_URL) config.webhook.url = env.WEBHOOK_URL;
  if (args.port) config.port = pickNumber(args.port, config.port);
  if (args.host) config.host = args.host;
  config.secret = env.SECRET || config.secret || '';
  config.staticRoot = resolve(args.root || env.STATIC_ROOT || REPO_ROOT);
  config.dataDir = resolve(args.data || env.DATA_DIR || join(SERVER_DIR, 'data'));
  config.configPath = configPath;
  return config;
}

// ---------- 通用小工具 ----------

function publicUser(user) {
  return { id: user.id, username: user.username, role: user.role, createdAt: user.createdAt };
}

function decodeParam(value) {
  try {
    return decodeURIComponent(value);
  } catch (err) {
    return value;
  }
}

function guardRate(limiter, key, message) {
  const result = limiter.hit(key);
  if (result.ok) return result;
  const err = new HttpError(429, 'rate_limited', message + '，请 ' + result.retryAfter + ' 秒后再试');
  err.retryAfter = result.retryAfter;
  throw err;
}

function currentUser(ctx, options) {
  const opts = options || {};
  let token = getBearerToken(ctx.req);
  if (!token && opts.allowQuery) token = ctx.url.searchParams.get('token') || '';
  if (!token) return null;
  const payload = verifyToken(token, ctx.secret);
  if (!payload) return null;
  const user = ctx.store.findUserById(payload.sub);
  return user || null;
}

function requireUser(ctx) {
  const user = currentUser(ctx);
  if (!user) throw new HttpError(401, 'unauthorized', '未登录或登录状态已失效，请重新登录');
  return user;
}

function requireAdmin(ctx, options) {
  const user = currentUser(ctx, options);
  if (!user) throw new HttpError(401, 'unauthorized', '未登录或登录状态已失效，请重新登录');
  if (user.role !== 'admin') throw new HttpError(403, 'forbidden', '需要管理员权限');
  return user;
}

// ---------- 路由表 ----------

const ROUTES = [];

function route(method, pattern, handler, options) {
  ROUTES.push({ method: method, pattern: pattern, handler: handler, raw: !!(options && options.raw) });
}

// 账号
route('POST', /^\/api\/auth\/register$/, async function (ctx) {
  guardRate(ctx.limiter.auth, 'ip:' + ctx.ip, '注册过于频繁');
  const body = await readJsonBody(ctx.req, 64 * 1024);
  const username = validateUsername(body.username);
  const password = validatePassword(body.password);
  if (ctx.store.findUserByName(username)) {
    throw new HttpError(409, 'username_taken', '该用户名已被占用');
  }
  const user = await ctx.store.createUser({ username: username, password: password, role: 'user' });
  await ctx.store.save();
  const token = signToken({ sub: user.id, role: user.role, username: user.username }, ctx.secret);
  ctx.log('注册新用户：' + user.username);
  return { status: 200, body: { token: token, user: publicUser(user) } };
});

route('POST', /^\/api\/auth\/login$/, async function (ctx) {
  guardRate(ctx.limiter.auth, 'ip:' + ctx.ip, '登录尝试过于频繁');
  const body = await readJsonBody(ctx.req, 64 * 1024);
  const username = typeof body.username === 'string' ? body.username.trim() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  if (!username || !password) throw new HttpError(400, 'missing_field', '请填写用户名与密码');
  const user = ctx.store.findUserByName(username);
  if (!user) throw new HttpError(401, 'invalid_credentials', '用户名或密码错误');
  const ok = await verifyPassword(password, user.passwordHash);
  if (!ok) throw new HttpError(401, 'invalid_credentials', '用户名或密码错误');
  const token = signToken({ sub: user.id, role: user.role, username: user.username }, ctx.secret);
  return { status: 200, body: { token: token, user: publicUser(user) } };
});

route('GET', /^\/api\/auth\/me$/, function (ctx) {
  const user = requireUser(ctx);
  return { status: 200, body: { user: publicUser(user) } };
});

// 健康探测（无需鉴权，前端探测云端可用性）
route('GET', /^\/api\/health$/, function (ctx) {
  const counts = statsOf(ctx.store);
  return {
    status: 200,
    body: {
      ok: true,
      name: 'market-api',
      version: API_VERSION,
      time: Date.now(),
      counts: { pending: counts.pending, published: counts.published, users: counts.users },
    },
  };
});

// 公开作品列表
route('GET', /^\/api\/projects$/, function (ctx) {
  const items = listPublic(ctx.store, {
    q: ctx.url.searchParams.get('q') || '',
    model: ctx.url.searchParams.get('model') || '',
    type: ctx.url.searchParams.get('type') || '',
    author: ctx.url.searchParams.get('author') || '',
  });
  return { status: 200, body: { items: items, total: items.length } };
});

// 我的投稿（含全部状态）
route('GET', /^\/api\/me\/projects$/, function (ctx) {
  const user = requireUser(ctx);
  const items = listByAuthor(ctx.store, user.id);
  return { status: 200, body: { items: items } };
});

// 投稿
route('POST', /^\/api\/projects$/, async function (ctx) {
  const user = requireUser(ctx);
  guardRate(ctx.limiter.submit, 'user:' + user.id + ':submit', '投稿过于频繁');
  const body = await readJsonBody(ctx.req, JSON_BODY_LIMIT);
  const uploadMax = pickNumber(ctx.config.uploadMaxMB, 3) * 1024 * 1024;
  const project = await createProject({
    store: ctx.store,
    user: user,
    body: body,
    entryMaxBytes: Math.min(MAX_ENTRY_BYTES, uploadMax),
    coverMaxBytes: Math.min(MAX_COVER_BYTES, uploadMax),
  });
  await emitEvent(ctx, EVENT_TYPES.pending, project, { actor: user, note: '' });
  ctx.log('新投稿：' + project.title + '（作者 ' + user.username + '）');
  return { status: 200, body: { project: projectView(project) } };
});

// 单个作品
route('GET', /^\/api\/projects\/([^/]+)$/, function (ctx) {
  const id = ctx.params[0];
  const project = findProject(ctx.store, id);
  if (!project) throw new HttpError(404, 'not_found', '作品不存在');
  if (project.status !== 'published') {
    const user = currentUser(ctx);
    const isOwner = user && (user.id === project.ownerId || (project.author && user.id === project.author.id));
    const isAdmin = user && user.role === 'admin';
    if (!isOwner && !isAdmin) throw new HttpError(403, 'forbidden', '该作品尚未公开');
  }
  return { status: 200, body: { project: projectView(project) } };
});

// 管理端：待审队列
route('GET', /^\/api\/admin\/queue$/, function (ctx) {
  requireAdmin(ctx);
  const items = queue(ctx.store);
  return { status: 200, body: { items: items } };
});

// 管理端：作品列表
route('GET', /^\/api\/admin\/projects$/, function (ctx) {
  requireAdmin(ctx);
  const status = ctx.url.searchParams.get('status') || 'all';
  const items = listAdmin(ctx.store, status);
  return { status: 200, body: { items: items, total: items.length } };
});

// 管理端：统计
route('GET', /^\/api\/admin\/stats$/, function (ctx) {
  requireAdmin(ctx);
  return { status: 200, body: statsOf(ctx.store) };
});

// 管理端：审核
route('POST', /^\/api\/admin\/projects\/([^/]+)\/review$/, async function (ctx) {
  const admin = requireAdmin(ctx);
  const project = findProject(ctx.store, ctx.params[0]);
  if (!project) throw new HttpError(404, 'not_found', '作品不存在');
  const body = await readJsonBody(ctx.req, 64 * 1024);
  const result = reviewProject(ctx.store, project, body.decision, body.note, admin);
  await ctx.store.save();
  await emitEvent(ctx, result.eventType, project, { actor: admin, note: project.note });
  ctx.log('审核' + (body.decision === 'approve' ? '通过' : '驳回') + '：' + project.title + '（管理员 ' + admin.username + '）');
  return { status: 200, body: { project: projectView(project) } };
});

// 管理端：上架 / 下架
route('POST', /^\/api\/admin\/projects\/([^/]+)\/status$/, async function (ctx) {
  const admin = requireAdmin(ctx);
  const project = findProject(ctx.store, ctx.params[0]);
  if (!project) throw new HttpError(404, 'not_found', '作品不存在');
  const body = await readJsonBody(ctx.req, 64 * 1024);
  const result = setStatus(ctx.store, project, body.status);
  await ctx.store.save();
  await emitEvent(ctx, result.eventType, project, { actor: admin, note: '' });
  ctx.log('状态变更（' + body.status + '）：' + project.title + '（管理员 ' + admin.username + '）');
  return { status: 200, body: { project: projectView(project) } };
});

// 管理端：SSE 事件流（支持 ?token= 与 Authorization）
route('GET', /^\/api\/admin\/events$/, function (ctx) {
  const admin = requireAdmin(ctx, { allowQuery: true });
  ctx.hub.attach(ctx.req, ctx.res, { userId: admin.id, username: admin.username });
  return null;
}, { raw: true });

// ---------- 事件推送 ----------

async function emitEvent(ctx, eventType, project, meta) {
  const view = projectView(project);
  const event = { type: eventType, project: view, at: Math.floor(Date.now() / 1000) };
  const delivered = ctx.hub.broadcast(event);
  await ctx.store.appendAudit({
    at: new Date().toISOString(),
    type: eventType,
    projectId: project.id,
    title: project.title,
    status: project.status,
    by: meta && meta.actor ? meta.actor.username : '',
    note: meta && meta.note ? meta.note : '',
    sseClients: delivered,
  });
  const url = ctx.config.webhook && ctx.config.webhook.url;
  if (url) {
    postWebhook({ url: url, eventType: eventType, project: view }).then(function (result) {
      if (result && result.ok) {
        ctx.log('[webhook] 推送成功 ' + eventType);
      } else if (result && !result.skipped) {
        console.error('[webhook] 推送失败：' + (result.error || ('HTTP ' + result.status)));
      }
    }).catch(function (err) {
      console.error('[webhook] 推送异常：' + err.message);
    });
  }
  return event;
}

// ---------- 静态托管 ----------

const HIDDEN_PREFIXES = ['server'];

function isBlockedStaticPath(pathname) {
  const segments = pathname.split('/').filter(Boolean);
  if (segments.length === 0) return false;
  if (HIDDEN_PREFIXES.indexOf(segments[0]) >= 0) return true;
  for (const segment of segments) {
    if (segment.charAt(0) === '.') return true;
  }
  return false;
}

async function handleStatic(ctx) {
  const req = ctx.req;
  const res = ctx.res;
  const pathname = ctx.pathname;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    throw new HttpError(405, 'method_not_allowed', '该资源只支持 GET / HEAD');
  }
  if (pathname === '/uploads' || pathname.indexOf('/uploads/') === 0) {
    const rel = pathname.slice('/uploads'.length) || '/';
    const served = await serveStatic(req, res, {
      rootDir: ctx.store.uploadsDir,
      relPath: rel,
      cacheControl: 'public, max-age=300',
    });
    if (!served) throw new HttpError(404, 'not_found', '文件不存在');
    return null;
  }
  if (isBlockedStaticPath(pathname)) {
    throw new HttpError(404, 'not_found', '页面不存在');
  }
  const served = await serveStatic(req, res, {
    rootDir: ctx.config.staticRoot,
    relPath: pathname,
    cacheControl: 'public, max-age=60',
  });
  if (!served) throw new HttpError(404, 'not_found', '页面不存在：' + pathname);
  return null;
}

// ---------- 服务实例 ----------

function buildContext(req, res, config, store, hub, limiters, secret, ip) {
  let url;
  try {
    url = new URL(req.url, 'http://localhost');
  } catch (err) {
    throw new HttpError(400, 'bad_request', '请求地址不合法');
  }
  return {
    req: req,
    res: res,
    url: url,
    pathname: url.pathname,
    method: req.method,
    params: [],
    config: config,
    store: store,
    hub: hub,
    limiter: limiters,
    secret: secret,
    ip: ip,
    log: function (message) {
      console.log('[api] ' + message);
    },
  };
}

async function dispatchApi(ctx) {
  for (const entry of ROUTES) {
    if (entry.method !== ctx.method) continue;
    const match = entry.pattern.exec(ctx.pathname);
    if (!match) continue;
    ctx.params = match.slice(1).map(decodeParam);
    const result = await entry.handler(ctx);
    if (entry.raw) return null;
    return result;
  }
  throw new HttpError(404, 'not_found', '接口不存在：' + ctx.method + ' ' + ctx.pathname);
}

export async function createMarketServer(options) {
  const config = options.config;
  const store = options.store;
  const secret = options.secret;
  const hub = options.hub || new EventHub();
  const limiters = options.limiters || createLimiters();

  const handler = async function (req, res) {
    const started = Date.now();
    const ip = clientIp(req);
    let ctx = null;
    try {
      ctx = buildContext(req, res, config, store, hub, limiters, secret, ip);
      setCors(req, res, config.allowOrigin);

      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'access-control-allow-origin': config.allowOrigin || '*',
          'access-control-allow-headers': 'authorization, content-type, x-requested-with',
          'access-control-allow-methods': 'GET, POST, OPTIONS',
          'access-control-max-age': '86400',
        });
        res.end();
        return;
      }

      let result = null;
      if (ctx.pathname === '/api' || ctx.pathname.indexOf('/api/') === 0) {
        result = await dispatchApi(ctx);
      } else {
        result = await handleStatic(ctx);
      }
      if (result && !res.headersSent) {
        sendJson(res, result.status || 200, result.body || {}, result.headers || null);
      } else if (!res.headersSent) {
        res.end();
      }
    } catch (err) {
      if (res.headersSent) {
        try { res.end(); } catch (e) { /* 忽略 */ }
        return;
      }
      if (err instanceof HttpError) {
        const headers = err.retryAfter ? { 'retry-after': String(err.retryAfter) } : null;
        sendError(res, err.status, err.code, err.message, headers);
      } else {
        console.error('[error] ' + (err && err.stack ? err.stack : err));
        sendError(res, 500, 'internal_error', '服务器内部错误，请稍后重试');
      }
    } finally {
      const isApi = req.url && req.url.indexOf('/api/') >= 0;
      if (isApi || res.statusCode >= 400) {
        const ms = Date.now() - started;
        console.log('[http] ' + req.method + ' ' + (ctx ? ctx.pathname : req.url) + ' ' + res.statusCode + ' ' + ms + 'ms');
      }
    }
  };

  const server = createServer(function (req, res) {
    handler(req, res).catch(function (err) {
      console.error('[fatal] 请求处理异常：' + (err && err.stack ? err.stack : err));
      if (!res.headersSent) sendError(res, 500, 'internal_error', '服务器内部错误，请稍后重试');
      else res.end();
    });
  });

  server.on('clientError', function (err, socket) {
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
  });

  return { server: server, hub: hub, limiters: limiters };
}

export function createLimiters() {
  return {
    // 登录 / 注册：每 IP 每 10 分钟 20 次
    auth: new RateLimiter({ limit: 20, windowMs: 10 * 60 * 1000 }),
    // 投稿：每用户每小时 10 次
    submit: new RateLimiter({ limit: 10, windowMs: 60 * 60 * 1000 }),
  };
}

async function ensureAdmin(store, config) {
  const hasAdmin = store.data.users.some(function (user) { return user.role === 'admin'; });
  if (hasAdmin) return null;
  const baseName = config.admin.username || 'admin';
  let password = config.admin.password || '';
  let generated = false;
  if (!password) {
    password = randomBytes(9).toString('base64url');
    generated = true;
  }
  let username = baseName;
  let index = 1;
  while (store.findUserByName(username)) {
    username = baseName + index;
    index += 1;
  }
  const user = await store.createUser({ username: username, password: password, role: 'admin' });
  await store.save();
  if (generated) {
    const note = [
      '初始管理员账号：' + username,
      '初始密码：' + password,
      '生成时间：' + new Date().toISOString(),
      '登录后台后请通过 ADMIN_PASSWORD 环境变量修改密码，并删除本文件。',
      '',
    ].join('\n');
    await writeFile(join(store.logsDir, 'admin-init.txt'), note, 'utf8');
    console.warn('[auth] 已自动生成管理员密码，见 data/logs/admin-init.txt');
  } else {
    console.log('[auth] 已创建管理员账号：' + username);
  }
  return user;
}

function printUsage() {
  console.log('提示词市集 API');
  console.log('用法：node server/server.mjs [选项]');
  console.log('  --port <端口>    监听端口，默认 8790（也可用 PORT）');
  console.log('  --host <地址>    监听地址，默认 0.0.0.0');
  console.log('  --root <目录>    静态根目录，默认仓库根目录');
  console.log('  --data <目录>    数据目录，默认 server/data');
  console.log('  --config <文件>  配置文件路径，默认 server/config.json');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || args.h) {
    printUsage();
    return;
  }
  const config = await loadConfig(args);
  const store = new Store(config.dataDir);
  const init = await store.init();
  const secret = await loadOrCreateSecret(config.dataDir, config.secret || process.env.SECRET || '');
  await ensureAdmin(store, config);

  const app = await createMarketServer({ config: config, store: store, secret: secret });

  await new Promise(function (done, fail) {
    app.server.once('error', fail);
    app.server.listen(config.port, config.host, function () { done(); });
  });

  console.log('');
  console.log('  提示词市集 API 已启动');
  console.log('  监听地址：http://' + config.host + ':' + config.port);
  console.log('  静态根目录：' + config.staticRoot);
  console.log('  数据目录：' + config.dataDir);
  console.log('  数据库：' + (init.fresh ? '新建' : '已加载') + '，用户 ' + store.data.users.length + ' 个，作品 ' + store.data.projects.length + ' 个');
  console.log('  管理端事件流：/api/admin/events');
  console.log('');

  let closing = false;
  const shutdown = function (signal) {
    if (closing) return;
    closing = true;
    console.log('[server] 收到 ' + signal + '，正在关闭……');
    app.hub.closeAll();
    app.server.close(function () {
      console.log('[server] 已停止');
      process.exit(0);
    });
    setTimeout(function () { process.exit(0); }, 3000).unref();
  };
  process.on('SIGINT', function () { shutdown('SIGINT'); });
  process.on('SIGTERM', function () { shutdown('SIGTERM'); });
}

const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  main().catch(function (err) {
    console.error('[启动失败] ' + (err && err.stack ? err.stack : err));
    process.exit(1);
  });
}
