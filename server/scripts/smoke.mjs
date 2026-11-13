#!/usr/bin/env node
// scripts/smoke.mjs —— 全链路自测：起服 -> 注册 -> 登录 -> 投稿 -> 审核 -> 公开 -> 下架 -> SSE
import { spawn } from 'node:child_process';
import { request } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = resolve(SCRIPT_DIR, '..');
const SERVER_ENTRY = join(SERVER_DIR, 'server.mjs');

const PORT = Number(process.env.SMOKE_PORT || 8791);
const BASE_PATH = '/api';
const ADMIN_USER = 'smokeadmin';
const ADMIN_PASSWORD = 'Smoke-admin#2024';
const USER_PASSWORD = 'Smoke-user#2024';
const STAMP = Date.now().toString(36);
const USER_A = 'alice_' + STAMP;
const USER_B = 'bob_' + STAMP;
const PROJECT_TITLE = '冒烟测试作品 ' + STAMP;

const PNG_1X1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const ENTRY_HTML = '<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>smoke</title></head><body><h1>冒烟测试</h1></body></html>';

let passed = 0;
let failed = 0;
const failures = [];
const serverLog = [];

function check(name, ok, detail) {
  if (ok) {
    passed += 1;
    console.log('PASS  ' + name);
  } else {
    failed += 1;
    failures.push(name + (detail ? ' -> ' + detail : ''));
    console.log('FAIL  ' + name + (detail ? ' -> ' + detail : ''));
  }
}

function section(title) {
  console.log('');
  console.log('-- ' + title);
}

function httpJson(method, path, options) {
  const opts = options || {};
  const payload = opts.body === undefined ? null : Buffer.from(JSON.stringify(opts.body), 'utf8');
  const headers = {};
  if (payload) {
    headers['content-type'] = 'application/json';
    headers['content-length'] = payload.length;
  }
  if (opts.token) headers['authorization'] = 'Bearer ' + opts.token;
  if (opts.rawText) {
    headers['content-type'] = 'text/plain';
    headers['content-length'] = Buffer.byteLength(opts.rawText);
  }
  return new Promise(function (done, fail) {
    const req = request({ host: '127.0.0.1', port: PORT, path: path, method: method, headers: headers }, function (res) {
      const chunks = [];
      res.on('data', function (c) { chunks.push(c); });
      res.on('end', function () {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try { json = JSON.parse(text); } catch (err) { json = null; }
        done({ status: res.statusCode, headers: res.headers, text: text, json: json });
      });
    });
    req.on('error', fail);
    if (opts.rawText) req.write(opts.rawText);
    if (payload) req.write(payload);
    req.end();
  });
}

function httpHeadOrGet(method, path) {
  return new Promise(function (done, fail) {
    const req = request({ host: '127.0.0.1', port: PORT, path: path, method: method }, function (res) {
      const chunks = [];
      res.on('data', function (c) { chunks.push(c); });
      res.on('end', function () {
        done({ status: res.statusCode, headers: res.headers, length: Buffer.concat(chunks).length });
      });
    });
    req.on('error', fail);
    req.end();
  });
}

// SSE 订阅：token 走 query，与前端一致
function openSse(token) {
  const sink = { events: [], pings: 0, status: 0, closed: false };
  return new Promise(function (done, fail) {
    const path = BASE_PATH + '/admin/events?token=' + encodeURIComponent(token || '');
    const req = request({ host: '127.0.0.1', port: PORT, path: path, method: 'GET', headers: { accept: 'text/event-stream' } }, function (res) {
      sink.status = res.statusCode;
      if (res.statusCode !== 200) {
        const chunks = [];
        res.on('data', function (c) { chunks.push(c); });
        res.on('end', function () {
          done({ req: req, sink: sink, body: Buffer.concat(chunks).toString('utf8') });
        });
        return;
      }
      res.setEncoding('utf8');
      let buffer = '';
      res.on('data', function (chunk) {
        buffer += chunk;
        let index = buffer.indexOf('\n\n');
        while (index >= 0) {
          const frame = buffer.slice(0, index);
          buffer = buffer.slice(index + 2);
          const lines = frame.split('\n');
          for (const line of lines) {
            if (line.indexOf('data:') === 0) {
              const payload = line.slice(5).trim();
              try { sink.events.push(JSON.parse(payload)); } catch (err) { /* 忽略非 JSON */ }
            } else if (line.indexOf(':') === 0 && line.toLowerCase().indexOf('ping') >= 0) {
              sink.pings += 1;
            }
          }
          index = buffer.indexOf('\n\n');
        }
      });
      done({ req: req, sink: sink, body: '' });
    });
    req.on('error', function (err) { fail(err); });
    req.end();
  });
}

function waitFor(fn, timeoutMs, label) {
  const deadline = Date.now() + (timeoutMs || 3000);
  return new Promise(function (done) {
    (function tick() {
      let value = false;
      try { value = fn(); } catch (err) { value = false; }
      if (value) { done(true); return; }
      if (Date.now() > deadline) { done(false); return; }
      setTimeout(tick, 80);
    })();
  });
}

async function waitForHealth(timeoutMs) {
  const deadline = Date.now() + (timeoutMs || 15000);
  while (Date.now() < deadline) {
    try {
      const res = await httpJson('GET', BASE_PATH + '/health');
      if (res.status === 200) return res;
    } catch (err) {
      // 服务还没起，继续等
    }
    await new Promise(function (r) { setTimeout(r, 150); });
  }
  return null;
}

async function main() {
  const dataDir = await mkdtemp(join(tmpdir(), 'market-smoke-'));
  console.log('提示词市集 · 冒烟自测');
  console.log('端口：' + PORT);
  console.log('临时数据目录：' + dataDir);

  const child = spawn(process.execPath, [SERVER_ENTRY, '--port', String(PORT), '--data', dataDir], {
    cwd: SERVER_DIR,
    env: Object.assign({}, process.env, {
      ADMIN_USER: ADMIN_USER,
      ADMIN_PASSWORD: ADMIN_PASSWORD,
      SECRET: 'smoke-secret-' + STAMP,
      PORT: String(PORT),
    }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', function (chunk) { serverLog.push(chunk); });
  child.stderr.on('data', function (chunk) { serverLog.push(chunk); });

  let exitCode = 1;
  let sseReq = null;
  try {
    const health = await waitForHealth(15000);
    check('服务在 ' + PORT + ' 端口启动并通过 /api/health', !!health, health ? '' : '启动超时');
    if (!health) {
      console.error(serverLog.join('').slice(-2000));
      throw new Error('服务未能启动');
    }

    section('健康检查与静态托管');
    check('health.ok 为 true', health.json && health.json.ok === true);
    check('health.name 为 market-api', health.json && health.json.name === 'market-api');
    check('health.version 为 1.0', health.json && health.json.version === '1.0');
    check('health.time 为时间戳', health.json && typeof health.json.time === 'number' && health.json.time > 1600000000000);
    check('health.counts 字段完整', health.json && health.json.counts && typeof health.json.counts.pending === 'number' && typeof health.json.counts.published === 'number' && typeof health.json.counts.users === 'number');

    const marketPage = await httpHeadOrGet('GET', '/market/index.html');
    check('静态托管 /market/index.html 返回 200', marketPage.status === 200 && marketPage.length > 100, 'status=' + marketPage.status);
    const rootHead = await httpHeadOrGet('HEAD', '/');
    check('静态托管 / 返回 200', rootHead.status === 200, 'status=' + rootHead.status);
    const svg = await httpHeadOrGet('GET', '/market/assets/mark.svg');
    check('静态资源 /market/assets/mark.svg 返回 200', svg.status === 200, 'status=' + svg.status);

    section('账号：注册 / 登录 / me');
    const regA = await httpJson('POST', BASE_PATH + '/auth/register', { body: { username: USER_A, password: USER_PASSWORD } });
    check('注册用户 A 成功', regA.status === 200 && regA.json && typeof regA.json.token === 'string', 'status=' + regA.status);
    check('注册返回 user.role 为 user', regA.json && regA.json.user && regA.json.user.role === 'user');
    check('注册返回 user 不含密码字段', regA.json && regA.json.user && regA.json.user.passwordHash === undefined);
    const tokenA = regA.json ? regA.json.token : '';

    const dup = await httpJson('POST', BASE_PATH + '/auth/register', { body: { username: USER_A, password: USER_PASSWORD } });
    check('重复用户名注册返回 409', dup.status === 409 && dup.json && dup.json.error && dup.json.error.code === 'username_taken', 'status=' + dup.status);

    const weak = await httpJson('POST', BASE_PATH + '/auth/register', { body: { username: 'weak_' + STAMP, password: '123' } });
    check('弱密码注册返回 400', weak.status === 400 && weak.json && weak.json.error && weak.json.error.code === 'invalid_password', 'status=' + weak.status);

    const loginA = await httpJson('POST', BASE_PATH + '/auth/login', { body: { username: USER_A, password: USER_PASSWORD } });
    check('用户 A 登录成功并拿到 token', loginA.status === 200 && loginA.json && typeof loginA.json.token === 'string', 'status=' + loginA.status);

    const badLogin = await httpJson('POST', BASE_PATH + '/auth/login', { body: { username: USER_A, password: 'wrong-password' } });
    check('错误密码登录返回 401', badLogin.status === 401 && badLogin.json && badLogin.json.error && badLogin.json.error.code === 'invalid_credentials', 'status=' + badLogin.status);

    const me = await httpJson('GET', BASE_PATH + '/auth/me', { token: tokenA });
    check('GET /api/auth/me 返回当前用户', me.status === 200 && me.json && me.json.user && me.json.user.username === USER_A, 'status=' + me.status);

    const meNoToken = await httpJson('GET', BASE_PATH + '/auth/me');
    check('无 token 访问 me 返回 401', meNoToken.status === 401 && meNoToken.json && meNoToken.json.error.code === 'unauthorized', 'status=' + meNoToken.status);

    const regB = await httpJson('POST', BASE_PATH + '/auth/register', { body: { username: USER_B, password: USER_PASSWORD } });
    check('注册用户 B 成功', regB.status === 200 && regB.json && typeof regB.json.token === 'string', 'status=' + regB.status);
    const tokenB = regB.json ? regB.json.token : '';

    const adminLogin = await httpJson('POST', BASE_PATH + '/auth/login', { body: { username: ADMIN_USER, password: ADMIN_PASSWORD } });
    check('管理员登录成功且 role=admin', adminLogin.status === 200 && adminLogin.json && adminLogin.json.user && adminLogin.json.user.role === 'admin', 'status=' + adminLogin.status);
    const adminToken = adminLogin.json ? adminLogin.json.token : '';

    section('投稿与鉴权边界');
    const anonSubmit = await httpJson('POST', BASE_PATH + '/projects', { body: { title: 'x' } });
    check('未登录投稿返回 401', anonSubmit.status === 401 && anonSubmit.json.error.code === 'unauthorized', 'status=' + anonSubmit.status);

    const userQueue = await httpJson('GET', BASE_PATH + '/admin/queue', { token: tokenA });
    check('普通用户访问 admin/queue 返回 403', userQueue.status === 403 && userQueue.json.error.code === 'forbidden', 'status=' + userQueue.status);

    const userStats = await httpJson('GET', BASE_PATH + '/admin/stats', { token: tokenA });
    check('普通用户访问 admin/stats 返回 403', userStats.status === 403, 'status=' + userStats.status);

    // SSE：先连上，再触发事件
    const sse = await openSse(adminToken);
    sseReq = sse.req;
    check('管理员 SSE 连接建立 (200)', sse.sink.status === 200, 'status=' + sse.sink.status);
    if (sse.sink.status !== 200) console.log('SSE 响应体：' + sse.body);
    await new Promise(function (r) { setTimeout(r, 120); });

    const badSse = await openSse('');
    check('无 token 的 SSE 返回 401', badSse.sink.status === 401, 'status=' + badSse.sink.status);
    if (badSse.req && badSse.req.destroy) badSse.req.destroy();

    const createBody = {
      title: PROJECT_TITLE,
      tagline: '自动化冒烟测试投稿，验证全链路。',
      taglineEn: 'Smoke test submission for the full pipeline.',
      type: 'game',
      tags: ['冒烟', 'canvas'],
      accent: '#6ee7ff',
      model: { name: 'Claude Fable 5.2', vendor: 'Anthropic', short: 'Fable 5.2' },
      source: { label: '原始提示词', href: 'https://example.com/prompt' },
      authorName: '冒烟作者',
      prompt: '用 canvas 写一个可玩的冒烟测试小游戏，单文件，无依赖。',
      promptZh: '用 canvas 写一个可玩的冒烟测试小游戏，单文件，无依赖。',
      metrics: [{ k: '构建', v: '1 轮提示' }, { k: '体积', v: '12 KB' }],
      entryHtml: Buffer.from(ENTRY_HTML, 'utf8').toString('base64'),
      coverDataUrl: 'data:image/png;base64,' + PNG_1X1,
    };
    const created = await httpJson('POST', BASE_PATH + '/projects', { token: tokenA, body: createBody });
    check('登录用户投稿成功', created.status === 200 && created.json && created.json.project, 'status=' + created.status);
    const project = created.json ? created.json.project : null;
    check('投稿后 status=pending', project && project.status === 'pending', project ? project.status : 'no project');
    check('demo 指向 /uploads/<id>/index.html', project && project.demo === '/uploads/' + project.id + '/index.html', project ? project.demo : '');
    check('cover 指向 /uploads/<id>/cover.png', project && project.cover === '/uploads/' + project.id + '/cover.png', project ? project.cover : '');
    check('files.entry 记录落盘路径', project && project.files && project.files.entry === 'data/uploads/' + project.id + '/index.html', project && project.files ? project.files.entry : '');
    check('reviewNote 未驳回时为 null', project && project.reviewNote === null, project ? String(project.reviewNote) : '');
    check('author.name 使用自定义作者名', project && project.author && project.author.name === '冒烟作者');
    const projectId = project ? project.id : '';

    const longTitle = await httpJson('POST', BASE_PATH + '/projects', {
      token: tokenA,
      body: Object.assign({}, createBody, { title: '超'.repeat(61) }),
    });
    check('标题超长返回 400', longTitle.status === 400 && longTitle.json.error.code === 'field_too_long', 'status=' + longTitle.status);

    const badJson = await httpJson('POST', BASE_PATH + '/auth/login', { rawText: '{not json}' });
    check('非法 JSON 返回 400', badJson.status === 400 && badJson.json.error.code === 'invalid_json', 'status=' + badJson.status);

    section('审核与公开可见性');
    const pendingEvent = await waitFor(function () {
      return sse.sink.events.some(function (e) { return e.type === 'project.pending' && e.project && e.project.id === projectId; });
    }, 3000);
    check('SSE 收到 project.pending 事件', pendingEvent, '已收到 ' + sse.sink.events.length + ' 条事件');

    const publicListBefore = await httpJson('GET', BASE_PATH + '/projects?q=' + encodeURIComponent('冒烟测试'));
    check('待审作品不出现在公开列表', publicListBefore.status === 200 && publicListBefore.json.items.every(function (p) { return p.id !== projectId; }), 'count=' + (publicListBefore.json ? publicListBefore.json.items.length : '?'));

    const ownerDetail = await httpJson('GET', BASE_PATH + '/projects/' + projectId, { token: tokenA });
    check('作者可读取自己的待审作品', ownerDetail.status === 200 && ownerDetail.json.project.id === projectId, 'status=' + ownerDetail.status);

    const strangerDetail = await httpJson('GET', BASE_PATH + '/projects/' + projectId, { token: tokenB });
    check('其他用户读取待审作品返回 403', strangerDetail.status === 403, 'status=' + strangerDetail.status);

    const queueRes = await httpJson('GET', BASE_PATH + '/admin/queue', { token: adminToken });
    const inQueue = queueRes.json && queueRes.json.items.some(function (p) { return p.id === projectId; });
    check('待审队列包含新投稿', queueRes.status === 200 && inQueue, 'status=' + queueRes.status);

    const approve = await httpJson('POST', BASE_PATH + '/admin/projects/' + projectId + '/review', { token: adminToken, body: { decision: 'approve' } });
    check('审核通过返回 status=published', approve.status === 200 && approve.json.project.status === 'published', 'status=' + approve.status);

    const publishedEvent = await waitFor(function () {
      return sse.sink.events.some(function (e) { return e.type === 'project.published' && e.project.id === projectId; });
    }, 3000);
    check('SSE 收到 project.published 事件', publishedEvent);

    const publicListAfter = await httpJson('GET', BASE_PATH + '/projects?q=' + encodeURIComponent('冒烟测试'));
    check('审核后公开列表可见', publicListAfter.status === 200 && publicListAfter.json.items.some(function (p) { return p.id === projectId; }), 'count=' + (publicListAfter.json ? publicListAfter.json.items.length : '?'));

    const filtered = await httpJson('GET', BASE_PATH + '/projects?model=' + encodeURIComponent('Fable') + '&type=game');
    check('模型 + 类型筛选命中', filtered.status === 200 && filtered.json.items.some(function (p) { return p.id === projectId; }), 'count=' + (filtered.json ? filtered.json.items.length : '?'));

    const publicDetail = await httpJson('GET', BASE_PATH + '/projects/' + projectId);
    check('公开详情无需登录可读', publicDetail.status === 200 && publicDetail.json.project.id === projectId, 'status=' + publicDetail.status);
    check('公开详情带完整 prompt', publicDetail.json && publicDetail.json.project.prompt === createBody.prompt);

    const demoFile = await httpHeadOrGet('GET', '/uploads/' + projectId + '/index.html');
    check('上传的 demo 可直接访问', demoFile.status === 200 && demoFile.length > 20, 'status=' + demoFile.status);
    check('demo 返回 text/html', demoFile.headers['content-type'] && demoFile.headers['content-type'].indexOf('text/html') === 0, demoFile.headers['content-type']);
    const coverFile = await httpHeadOrGet('GET', '/uploads/' + projectId + '/cover.png');
    check('上传的封面可直接访问', coverFile.status === 200 && coverFile.headers['content-type'] === 'image/png', 'status=' + coverFile.status);

    section('我的投稿');
    const mine = await httpJson('GET', BASE_PATH + '/me/projects', { token: tokenA });
    check('GET /api/me/projects 返回本人作品', mine.status === 200 && mine.json.items.some(function (p) { return p.id === projectId && p.status === 'published'; }), 'status=' + mine.status);
    const mineB = await httpJson('GET', BASE_PATH + '/me/projects', { token: tokenB });
    check('他人 /api/me/projects 不含该作品', mineB.status === 200 && mineB.json.items.every(function (p) { return p.id !== projectId; }), 'status=' + mineB.status);

    section('下架与统计');
    const offline = await httpJson('POST', BASE_PATH + '/admin/projects/' + projectId + '/status', { token: adminToken, body: { status: 'offline' } });
    check('下架返回 status=offline', offline.status === 200 && offline.json.project.status === 'offline', 'status=' + offline.status);

    const offlineEvent = await waitFor(function () {
      return sse.sink.events.some(function (e) { return e.type === 'project.offline' && e.project.id === projectId; });
    }, 3000);
    check('SSE 收到 project.offline 事件', offlineEvent);

    const publicListOffline = await httpJson('GET', BASE_PATH + '/projects?q=' + encodeURIComponent('冒烟测试'));
    check('下架后公开列表不可见', publicListOffline.status === 200 && publicListOffline.json.items.every(function (p) { return p.id !== projectId; }));

    const stats = await httpJson('GET', BASE_PATH + '/admin/stats', { token: adminToken });
    check('stats 下架数 >= 1', stats.status === 200 && stats.json.offline >= 1, 'offline=' + (stats.json ? stats.json.offline : '?'));
    check('stats 用户数为 3', stats.json && stats.json.users === 3, 'users=' + (stats.json ? stats.json.users : '?'));
    check('stats today >= 1', stats.json && stats.json.today >= 1, 'today=' + (stats.json ? stats.json.today : '?'));

    const adminAll = await httpJson('GET', BASE_PATH + '/admin/projects?status=all', { token: adminToken });
    check('admin/projects?status=all 含该作品', adminAll.status === 200 && adminAll.json.items.some(function (p) { return p.id === projectId; }), 'status=' + adminAll.status);

    section('安全边界');
    const traversal = await httpHeadOrGet('GET', '/market/../server/data/db.json');
    check('路径穿越 /market/../server/... 被拒绝', traversal.status === 403 || traversal.status === 404, 'status=' + traversal.status);
    const traversalUploads = await httpHeadOrGet('GET', '/uploads/../db.json');
    check('/uploads/../db.json 被拒绝', traversalUploads.status === 403 || traversalUploads.status === 404, 'status=' + traversalUploads.status);
    const serverDir = await httpHeadOrGet('GET', '/server/server.mjs');
    check('/server/* 不对外暴露', serverDir.status === 404, 'status=' + serverDir.status);
    const unknownApi = await httpJson('GET', BASE_PATH + '/nope');
    check('未知接口返回 404 JSON', unknownApi.status === 404 && unknownApi.json && unknownApi.json.error.code === 'not_found', 'status=' + unknownApi.status);

    section('限流');
    let rateLimited = false;
    for (let i = 0; i < 25; i += 1) {
      const attempt = await httpJson('POST', BASE_PATH + '/auth/login', { body: { username: USER_A, password: 'bad-' + i } });
      if (attempt.status === 429) {
        rateLimited = true;
        check('登录失败触发限流 429', attempt.json && attempt.json.error.code === 'rate_limited', 'status=' + attempt.status);
        break;
      }
    }
    check('连续失败登录最终被限流', rateLimited);

    exitCode = failed === 0 ? 0 : 1;
  } catch (err) {
    console.error('');
    console.error('自测异常中断：' + (err && err.stack ? err.stack : err));
    exitCode = 1;
  } finally {
    if (sseReq && sseReq.destroy) sseReq.destroy();
    try { child.kill(); } catch (err) { /* 忽略 */ }
    await new Promise(function (r) { setTimeout(r, 300); });
    try { await rm(dataDir, { recursive: true, force: true }); } catch (err) { /* 忽略 */ }
  }

  console.log('');
  console.log('====================================');
  console.log('结果：' + passed + ' PASS / ' + failed + ' FAIL');
  if (failed > 0) {
    console.log('失败项：');
    for (const item of failures) console.log('  - ' + item);
    console.log('');
    console.log('服务端日志尾部：');
    console.log(serverLog.join('').slice(-3000));
  }
  console.log('====================================');
  process.exit(exitCode);
}

main().catch(function (err) {
  console.error('冒烟脚本崩溃：' + (err && err.stack ? err.stack : err));
  process.exit(1);
});
