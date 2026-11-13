// lib/push.mjs —— SSE 广播 + 外部 webhook 推送
export const HEARTBEAT_MS = 25000;

export class EventHub {
  constructor(options) {
    const opts = options || {};
    this.heartbeatMs = opts.heartbeatMs || HEARTBEAT_MS;
    this.clients = new Set();
    this.timer = null;
    this.sent = 0;
  }

  get size() {
    return this.clients.size;
  }

  // 挂载一个 SSE 连接（调用方已完成鉴权）
  attach(req, res, meta) {
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      'connection': 'keep-alive',
      'x-accel-buffering': 'no',
    });
    if (typeof res.flushHeaders === 'function') res.flushHeaders();
    res.write(': connected\n\n');

    const client = { res: res, meta: meta || {}, at: Date.now() };
    this.clients.add(client);
    this.ensureTimer();

    const self = this;
    const cleanup = function () {
      self.remove(client);
    };
    req.on('close', cleanup);
    req.on('error', cleanup);
    res.on('error', cleanup);
    return client;
  }

  remove(client) {
    if (!this.clients.has(client)) return;
    this.clients.delete(client);
    try {
      client.res.end();
    } catch (err) {
      // 连接已断开，忽略
    }
    if (this.clients.size === 0) this.stopTimer();
  }

  ensureTimer() {
    if (this.timer) return;
    const self = this;
    this.timer = setInterval(function () {
      self.ping();
    }, this.heartbeatMs);
    if (typeof this.timer.unref === 'function') this.timer.unref();
  }

  stopTimer() {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  ping() {
    const self = this;
    for (const client of Array.from(this.clients)) {
      try {
        client.res.write(': ping\n\n');
      } catch (err) {
        self.remove(client);
      }
    }
  }

  // 广播事件：data: {"type","project","at"}\n\n
  broadcast(event) {
    if (this.clients.size === 0) return 0;
    const payload = 'data: ' + JSON.stringify(event) + '\n\n';
    let delivered = 0;
    for (const client of Array.from(this.clients)) {
      try {
        client.res.write(payload);
        delivered += 1;
        this.sent += 1;
      } catch (err) {
        this.remove(client);
      }
    }
    return delivered;
  }

  closeAll() {
    for (const client of Array.from(this.clients)) {
      try {
        client.res.end();
      } catch (err) {
        // 忽略
      }
      this.clients.delete(client);
    }
    this.stopTimer();
  }
}

function webhookCopy(eventType, project) {
  const title = project && project.title ? project.title : '未命名作品';
  const author = project && project.author && project.author.name ? project.author.name : '匿名';
  if (eventType === 'project.pending') {
    return { title: '新投稿待审核', text: '《' + title + '》由 ' + author + ' 提交，等待审核。' };
  }
  if (eventType === 'project.published') {
    return { title: '作品已上架', text: '《' + title + '》已上架到提示词市集。' };
  }
  if (eventType === 'project.rejected') {
    return { title: '作品被驳回', text: '《' + title + '》未通过审核：' + (project && project.note ? project.note : '无备注') };
  }
  if (eventType === 'project.offline') {
    return { title: '作品已下架', text: '《' + title + '》已从市集下架。' };
  }
  return { title: '市集事件', text: eventType + '：' + title };
}

// 外部 webhook：企业微信 / 钉钉 / Server酱 通用 text 字段
export async function postWebhook(options) {
  const url = options && options.url;
  if (!url) return { ok: false, skipped: true };
  const eventType = options.eventType || 'market.event';
  const project = options.project || null;
  const copy = webhookCopy(eventType, project);
  const body = {
    title: copy.title,
    text: copy.text,
    event: eventType,
    project: project,
    at: Math.floor(Date.now() / 1000),
  };
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
    return { ok: response.ok, status: response.status };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}
