/* admin.js — 市集管理端 · Saltline Prompt Market
   纯静态 SPA：登录 · 审核队列 · 上下架 · 搜索 · SSE 实时推送 · 桌面通知 · 断线重连。
   接口前缀 API（默认同源 /api，可用 window.MARKET_API 覆盖）。后端缺席时自动进入演示模式（内置假数据）。 */
(function () {
  'use strict';

  var API = String(window.MARKET_API || '/api').replace(/\/+$/, '');
  var K = {
    token: 'sl.market.token',
    notify: 'sl.market.notify',
    sound: 'sl.market.sound',
    mock: 'sl.market.mock.v1'
  };
  var TABS = ['pending', 'published', 'offline', 'rejected'];
  var TAB_LABEL = { pending: '待审核', published: '已上架', offline: '已下架', rejected: '已驳回' };

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  var state = {
    token: null,
    user: null,
    mock: false,
    tab: 'pending',
    q: '',
    stats: null,
    totals: { pending: 0, published: 0, offline: 0, rejected: 0 },
    lists: { pending: [], published: [], offline: [], rejected: [] },
    loaded: {},
    loading: {},
    busy: {},
    freshIds: {},
    es: null,
    retry: 0,
    retryTimer: null,
    reconnectFromTimer: false,
    lastEventAt: 0,
    lastEventType: '',
    bannerCount: 0,
    localEcho: {},
    detailId: null,
    rejectId: null,
    ac: null,
    mockTimer: null,
    mockPumped: false
  };

  var prefs = { notify: false, sound: true };
  var mockUser = { id: 'u-admin', username: 'admin', role: 'admin', createdAt: new Date().toISOString() };

  /* ------------------------------------------------------------------ 工具 */

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function pad(n) { return n < 10 ? '0' + n : String(n); }
  function toDate(v) {
    if (!v) return null;
    var d = (typeof v === 'number') ? new Date(v) : new Date(v);
    return isNaN(d.getTime()) ? null : d;
  }
  function fmtFull(v) {
    var d = toDate(v);
    if (!d) return '—';
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }
  function fmtRel(v) {
    var d = toDate(v);
    if (!d) return '—';
    var diff = Date.now() - d.getTime();
    if (diff < 0) return fmtFull(d);
    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return Math.floor(diff / 60000) + ' 分钟前';
    if (diff < 86400000) return Math.floor(diff / 3600000) + ' 小时前';
    if (diff < 604800000) return Math.floor(diff / 86400000) + ' 天前';
    return fmtFull(d);
  }
  function statusLabel(s) { return TAB_LABEL[s] || '未标注'; }
  function authorName(p) { return (p && p.author && (p.author.name || p.author.username)) || '匿名作者'; }
  function initialOf(s) {
    var t = String(s || '?').trim();
    return (t.charAt(0) || '?').toUpperCase();
  }
  function debounce(fn, ms) {
    var t = null;
    return function () {
      var args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, args); }, ms);
    };
  }
  function flag(name) {
    try { return new URLSearchParams(location.search).has(name); } catch (e) { return false; }
  }
  function flagValue(name) {
    try { return new URLSearchParams(location.search).get(name); } catch (e) { return null; }
  }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  /* ------------------------------------------------------------------ 偏好 */

  function readPrefs() {
    try {
      var n = localStorage.getItem(K.notify);
      var s = localStorage.getItem(K.sound);
      prefs.notify = n === '1';
      prefs.sound = s !== '0';
    } catch (e) { prefs.notify = false; prefs.sound = true; }
  }
  function savePrefs() {
    try {
      localStorage.setItem(K.notify, prefs.notify ? '1' : '0');
      localStorage.setItem(K.sound, prefs.sound ? '1' : '0');
    } catch (e) { /* 隐私模式忽略 */ }
  }
  function readToken() { try { return localStorage.getItem(K.token) || ''; } catch (e) { return ''; } }
  function writeToken(t) { try { localStorage.setItem(K.token, t); } catch (e) {} }
  function clearToken() { try { localStorage.removeItem(K.token); } catch (e) {} }

  /* ------------------------------------------------------------------ 提示条 */

  function toast(kind, title, text, ttl) {
    var box = $('#toasts');
    if (!box) return;
    var el = document.createElement('div');
    el.className = 'toast ' + (kind || '');
    el.innerHTML = '<b>' + esc(title || '') + '</b>' + esc(text || '');
    box.appendChild(el);
    var life = ttl || (kind === 'err' ? 8000 : 4600);
    setTimeout(function () {
      el.classList.add('out');
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 220);
    }, life);
  }
  function fail(err) {
    if (err && err.status === 401) return;
    var title = (err && err.code === 'network') ? '连接失败' : '请求失败';
    toast('err', title, (err && err.message) || '未知错误，请稍后重试');
  }

  /* ------------------------------------------------------------------ 请求 */

  function ApiError(message, status, code) {
    this.name = 'ApiError';
    this.message = message;
    this.status = status || 0;
    this.code = code || '';
  }
  ApiError.prototype = Object.create(Error.prototype);

  async function api(path, opts) {
    opts = opts || {};
    var method = (opts.method || 'GET').toUpperCase();
    if (state.mock) return mockApi(path, method, opts.body);

    var headers = { 'Accept': 'application/json' };
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    if (state.token) headers['Authorization'] = 'Bearer ' + state.token;
    var init = { method: method, headers: headers, cache: 'no-store' };
    if (opts.body !== undefined) init.body = JSON.stringify(opts.body);

    var res;
    try {
      res = await fetch(API + path, init);
    } catch (e) {
      throw new ApiError('网络不通：连不上 ' + API + '，请确认服务端已启动。', 0, 'network');
    }
    var ct = res.headers.get('content-type') || '';
    var data = null;
    if (ct.indexOf('json') >= 0) {
      try { data = await res.json(); } catch (e) { data = null; }
    }
    var msg = (data && data.error && data.error.message) || (data && data.message) || '';
    var code = (data && data.error && data.error.code) || '';
    if (res.status === 401) {
      throw new ApiError(msg || '登录已过期，请重新登录', 401, code || 'unauthorized');
    }
    if (!res.ok || data === null) {
      throw new ApiError(msg || ('接口返回异常（HTTP ' + res.status + '）' + (data === null && ct ? '：' + ct.split(';')[0] : '')), res.status, code || 'http_error');
    }
    return data;
  }

  async function request(path, opts) {
    try {
      return await api(path, opts);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) onUnauthorized(err);
      throw err;
    }
  }

  function onUnauthorized(err) {
    clearToken();
    stopStream();
    stopMockPump();
    state.token = '';
    state.user = null;
    hideApp();
    showGate((err && err.message) || '登录已过期，请重新登录');
    toast('err', '需要重新登录', (err && err.message) || '登录状态已失效');
  }

  async function probeBackend() {
    try {
      var res = await fetch(API + '/admin/stats', { headers: { 'Accept': 'application/json' }, cache: 'no-store' });
      var ct = res.headers.get('content-type') || '';
      return ct.indexOf('json') >= 0 ? 'ok' : 'absent';
    } catch (e) {
      return 'absent';
    }
  }

  /* ------------------------------------------------------------------ 演示后端 */

  function mockDB() {
    var raw = null;
    try { raw = localStorage.getItem(K.mock); } catch (e) { raw = null; }
    if (raw) {
      try {
        var db = JSON.parse(raw);
        if (db && db.projects && db.projects.length) return db;
      } catch (e) { /* 坏数据重新播种 */ }
    }
    var fresh = { seq: 100, projects: mockSeed() };
    mockSave(fresh);
    return fresh;
  }
  function mockSave(db) {
    try { localStorage.setItem(K.mock, JSON.stringify(db)); } catch (e) {}
  }
  function hoursAgo(h) { return new Date(Date.now() - h * 3600000).toISOString(); }

  function mockSeed() {
    return [
      {
        id: 'p-ember-run', title: '余烬奔跑', tagline: '横版自动跑酷：越过板条箱、滑过吊梁，跑进烧尽的黄昏。',
        taglineEn: 'Endless runner on the salt flats.', type: 'game', tags: ['canvas 2D', '跑酷', '零依赖'],
        accent: '#ff6f3c', model: { name: 'DeepSeek', vendor: 'DeepSeek', short: 'DEEPSEEK' }, source: null,
        author: { id: 'u-02', name: '林夜' }, cover: '../assets/covers/ember-run.svg', demo: '../demos/ember-run/index.html',
        prompt: 'Build one self-contained index.html, "EMBER RUN", an endless side-scrolling runner drawn entirely with Canvas 2D. No images, no fonts, no libraries, no network requests.\n\nLayout: a fixed header bar with a left link, the game name centred in uppercase, right-aligned SCORE and BEST in tabular numerals. The canvas fills the rest of the viewport and scales for devicePixelRatio.\n\nMechanics: speed starts at 302 px/s and ramps to about 807 px/s with distance; score equals distance/12. Jump impulse -1010, gravity 2700, slide lasts 0.62 s. Forgiving AABB collision ends the run.',
        promptZh: '做一个单文件 index.html：纯 Canvas 2D 的横版无限跑酷，不用任何图片、字体、库或网络请求。\n\n布局：顶部固定栏，左侧返回链接，中间大写标题，右侧 SCORE / BEST。画布铺满剩余视口并按 devicePixelRatio 缩放。\n\n玩法：速度从 302 px/s 随距离升到约 807 px/s，分数 = 距离/12；跳跃初速 -1010，重力 2700，滑铲 0.62 秒；宽容的 AABB 碰撞即结束，并给出重开浮层。',
        metrics: [{ k: '体积', v: 'index.html · 23.6 KB' }, { k: '外部请求', v: '0' }],
        status: 'pending', note: '', createdAt: hoursAgo(2.4), updatedAt: hoursAgo(2.4),
        files: { entry: 'index.html', dir: 'data/uploads/p-ember-run' }
      },
      {
        id: 'p-atlas-board', title: 'Atlas 监控台', tagline: '给运维看的单页指标面板：折线、热力、告警列表，全部由一条提示词生成。',
        taglineEn: 'One-prompt ops dashboard.', type: 'tool', tags: ['dashboard', 'SVG', '暗色'],
        accent: '#4fd6c8', model: { name: 'Claude Fable 5.2', vendor: 'Anthropic', short: 'FABLE 5.2' }, source: null,
        author: { id: 'u-03', name: '周野' }, cover: '', demo: '',
        prompt: 'Build a single-file ops dashboard in plain HTML/CSS/JS. Dark industrial palette (#0b0d0f / #e8e4da / #ffb347). Three panels: a 24-hour latency line chart drawn with inline SVG, a request-density heatmap grid, and an alert list with severity chips. All numbers seeded by a deterministic PRNG so screenshots are stable.',
        promptZh: '用纯 HTML/CSS/JS 做单文件运维面板，深色工业配色（#0b0d0f / #e8e4da / #ffb347）。三块：24 小时延迟折线（内联 SVG）、请求密度热力网格、带等级标签的告警列表。数据用确定性伪随机数，保证截图稳定。',
        metrics: [{ k: '体积', v: 'index.html · 41 KB' }],
        status: 'pending', note: '', createdAt: hoursAgo(6.2), updatedAt: hoursAgo(6.2),
        files: { entry: 'index.html', dir: 'data/uploads/p-atlas-board' }
      },
      {
        id: 'p-wave-lab', title: '声波实验室', tagline: '麦克风输入的实时频谱墙，滚轮调频段增益。',
        taglineEn: 'Live spectrum wall.', type: 'experiment', tags: ['WebAudio', '可视化'],
        accent: '#8d9aa3', model: { name: 'GPT-5.1', vendor: 'OpenAI', short: 'GPT-5.1' }, source: null,
        author: { id: 'u-04', name: '阿炉' }, cover: '', demo: '',
        prompt: 'Make a WebAudio spectrum wall: getUserMedia microphone input, FFT size 2048, draw 64 bands as stacked rectangles whose heights react to RMS, with a falling-peak marker per band. Add a gain slider per band group and a freeze button.',
        promptZh: '做一个 WebAudio 频谱墙：读麦克风，FFT 2048，64 个频段画成堆叠矩形，高度跟随 RMS，每段带下落峰值。加分段增益滑杆和冻结按钮。',
        metrics: [{ k: '依赖', v: '无' }],
        status: 'pending', note: '', createdAt: hoursAgo(20.5), updatedAt: hoursAgo(20.5),
        files: { entry: 'index.html', dir: 'data/uploads/p-wave-lab' }
      },
      {
        id: 'p-saltline', title: 'Saltline 港口', tagline: '一条提示词产出的雨夜港口 FPS：切断三条上行链路，然后活着上船。',
        taglineEn: 'A one-prompt FPS in a rainy container port.', type: 'game', tags: ['FPS', 'three.js', '单文件'],
        accent: '#ffb347', model: { name: 'Claude Fable 5.2', vendor: 'Anthropic', short: 'FABLE 5.2' },
        source: { label: 'claude.ai/artifact', href: 'https://claude.ai/artifact/BGY1SztrAYcJQHSsnHHGmp' },
        author: { id: 'u-01', name: 'Felix' }, cover: '../assets/covers/saltline.svg', demo: '../../index.html',
        prompt: 'Build a small first-person shooter that runs entirely in the browser from a single HTML file. No external assets of any kind: every model, texture, sound and font fallback must be generated in code at load time.\n\nSetting. A container port at night, forty minutes before dawn. Rain, sodium lamps, wet asphalt, stacked containers, gantry cranes, fog that eats the far end of the quay. The palette is ink black, bone white and one amber signal colour.',
        promptZh: '用单个 HTML 文件做一个完整的浏览器第一人称射击：不允许任何外部资源，模型、贴图、音效、字体全部在加载时用代码生成。\n\n场景：黎明前四十分钟的集装箱港，雨、钠灯、湿沥青、堆叠的箱体、龙门吊，雾把码头尽头吃掉。配色只有墨黑、骨白和一个琥珀信号色。',
        metrics: [{ k: '体积', v: 'index.html · 1.4 MB' }, { k: '预算', v: '1 提示词 · 0 反馈' }],
        status: 'published', note: '', createdAt: hoursAgo(96), updatedAt: hoursAgo(40),
        files: { entry: 'index.html', dir: 'data/uploads/p-saltline' }
      },
      {
        id: 'p-haiku', title: '每日俳句', tagline: '每天零点生成一句五七五，附一张程序化宣纸纹理。',
        taglineEn: 'A daily haiku card.', type: 'website', tags: ['静态', '排版'],
        accent: '#4fd6c8', model: { name: 'DeepSeek', vendor: 'DeepSeek', short: 'DEEPSEEK' }, source: null,
        author: { id: 'u-05', name: '顾青' }, cover: '', demo: '',
        prompt: 'Create a static haiku page: one 5-7-5 line in Chinese, dated, centred on a procedurally generated paper texture (canvas noise + two blotches). Typography: vertical rhythm, generous margins, no images. Text colour #2a2a26 on #e8e4da.',
        promptZh: '做一个静态俳句页：一句五七五中文，带日期，居中在程序化生成的宣纸纹理上（canvas 噪点 + 两处水渍）。竖排节奏、留白充足、不用图片。文字 #2a2a26，底色 #e8e4da。',
        metrics: [], status: 'published', note: '', createdAt: hoursAgo(70), updatedAt: hoursAgo(30),
        files: { entry: 'index.html', dir: 'data/uploads/p-haiku' }
      },
      {
        id: 'p-type-lab', title: '字体试排台', tagline: '同一段文案在中英混排下的六种字号梯度对照。',
        taglineEn: 'Type scale comparison.', type: 'tool', tags: ['排版', '对照'],
        accent: '#8d9aa3', model: { name: 'GPT-5.1', vendor: 'OpenAI', short: 'GPT-5.1' }, source: null,
        author: { id: 'u-02', name: '林夜' }, cover: '', demo: '',
        prompt: 'Build a type-scale lab: a textarea for the sample copy, six preset scales (1.125 to 1.618) rendered side by side, each column showing h1-h4 plus body, with a toggle for 中英混排 and a ruler overlay.',
        promptZh: '做一个字号梯度试验台：一个文本域放样例文案，六组比例（1.125 到 1.618）并排渲染，每列展示 h1–h4 与正文，带中英混排开关和标尺叠加层。',
        metrics: [], status: 'offline', note: '按作者要求临时下架，改版后重新上架。', createdAt: hoursAgo(140), updatedAt: hoursAgo(12),
        files: { entry: 'index.html', dir: 'data/uploads/p-type-lab' }
      },
      {
        id: 'p-bill', title: '分成计算器', tagline: '输入流水与比例，算平台抽成、作者实收与税点。',
        taglineEn: 'Revenue split calculator.', type: 'tool', tags: ['计算', '表单'],
        accent: '#ff6f3c', model: { name: 'DeepSeek', vendor: 'DeepSeek', short: 'DEEPSEEK' }, source: null,
        author: { id: 'u-06', name: '沈迟' }, cover: '', demo: '',
        prompt: 'Build a single page revenue split calculator with three inputs (gross, platform cut %, tax %) and a live breakdown table. No libraries, no rounding surprises: integer cents internally, formatted at the end.',
        promptZh: '做一个单页分成计算器：三个输入（流水、平台抽成%、税点%），实时输出拆分表。不用库，内部用整数分计算避免浮点误差，最后再格式化。',
        metrics: [], status: 'rejected', note: 'demo 打开是空白页，提示词里缺少数据校验要求；补齐后可重投。', createdAt: hoursAgo(54), updatedAt: hoursAgo(22),
        files: { entry: 'index.html', dir: 'data/uploads/p-bill' }
      },
      {
        id: 'p-breathe', title: '呼吸计时器', tagline: '4-7-8 呼吸节律的全屏引导，跟着光圈扩张收束。',
        taglineEn: '4-7-8 breathing guide.', type: 'tool', tags: ['健康', '动效'],
        accent: '#6fdc9a', model: { name: 'Claude Fable 5.2', vendor: 'Anthropic', short: 'FABLE 5.2' }, source: null,
        author: { id: 'u-05', name: '顾青' }, cover: '', demo: '',
        prompt: 'Build a full-screen 4-7-8 breathing guide. One circle expands over 4 s, holds 7 s, contracts 8 s, with a phase label in Chinese and a countdown ring. Space pauses, Esc exits fullscreen. Respect prefers-reduced-motion by swapping the scale animation for opacity.',
        promptZh: '做一个全屏 4-7-8 呼吸引导：光圈 4 秒扩张、7 秒保持、8 秒收束，配中文阶段标签和倒计时圆环。空格暂停，Esc 退全屏。prefers-reduced-motion 下把缩放换成透明度。',
        metrics: [], status: 'published', note: '', createdAt: hoursAgo(210), updatedAt: hoursAgo(200),
        files: { entry: 'index.html', dir: 'data/uploads/p-breathe' }
      }
    ];
  }

  function mockIncoming() {
    return {
      id: 'p-live-' + Date.now(),
      title: '雾中山脊', tagline: '程序化生成的山脊线，随鼠标风向缓慢流动。',
      taglineEn: 'Procedural ridgelines.', type: 'experiment', tags: ['canvas 2D', '程序化'],
      accent: '#ffb347', model: { name: 'DeepSeek', vendor: 'DeepSeek', short: 'DEEPSEEK' }, source: null,
      author: { id: 'u-07', name: '言午' }, cover: '', demo: '',
      prompt: 'Generate a canvas piece: five layered ridgelines from 1D value noise, each scrolling at a different speed, with drifting fog bands and a low amber sun. Mouse X controls wind direction, mouse Y controls fog density. No external assets.',
      promptZh: '用 canvas 画一幅：五层山脊来自一维 value noise，各自不同速度平移，加漂移雾带和低垂的琥珀色太阳。鼠标 X 控制风向，鼠标 Y 控制雾浓度。不用外部资源。',
      metrics: [], status: 'pending', note: '',
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      files: { entry: 'index.html', dir: 'data/uploads/p-live' }
    };
  }

  function mockStats(db) {
    var c = { pending: 0, published: 0, offline: 0, rejected: 0, users: 7, today: 0 };
    var todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    db.projects.forEach(function (p) {
      if (c[p.status] != null && p.status !== 'users' && p.status !== 'today') c[p.status] += 1;
      var d = toDate(p.createdAt);
      if (d && d.getTime() >= todayStart.getTime()) c.today += 1;
    });
    return c;
  }

  async function mockApi(path, method, body) {
    await new Promise(function (r) { setTimeout(r, 120 + Math.random() * 180); });
    var db = mockDB();
    var m;

    if (path === '/auth/login' && method === 'POST') {
      if (!body || !body.username || !body.password) throw new ApiError('请填写用户名和密码', 400, 'bad_request');
      if (body.username !== 'admin' || body.password !== 'admin123') {
        throw new ApiError('账号或密码不对（演示模式账号 admin / admin123）', 401, 'unauthorized');
      }
      return { token: 'mock.admin.token', user: mockUser };
    }
    if (path === '/auth/me') return { user: mockUser };

    if (path === '/admin/stats') return mockStats(db);

    if (path === '/admin/queue') {
      var pend = db.projects.filter(function (p) { return p.status === 'pending'; });
      pend.sort(function (a, b) { return new Date(a.createdAt) - new Date(b.createdAt); });
      return { items: pend, total: pend.length };
    }
    if (path.indexOf('/admin/projects?') === 0) {
      var status = 'all';
      var qm = path.indexOf('status=');
      if (qm >= 0) status = decodeURIComponent(path.slice(qm + 7).split('&')[0]);
      var items = db.projects.filter(function (p) { return status === 'all' || p.status === status; });
      items.sort(function (a, b) {
        if (status === 'pending') return new Date(a.createdAt) - new Date(b.createdAt);
        return new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt);
      });
      return { items: items, total: items.length };
    }

    m = path.match(/^\/admin\/projects\/([^/]+)\/review$/);
    if (m && method === 'POST') {
      var rp = db.projects.filter(function (p) { return p.id === decodeURIComponent(m[1]); })[0];
      if (!rp) throw new ApiError('作品不存在或已被删除', 404, 'not_found');
      var decision = body && body.decision;
      if (decision !== 'approve' && decision !== 'reject') throw new ApiError('decision 只能是 approve 或 reject', 400, 'bad_request');
      rp.status = decision === 'approve' ? 'published' : 'rejected';
      rp.note = (body && body.note) || '';
      rp.updatedAt = new Date().toISOString();
      mockSave(db);
      return { project: rp };
    }

    m = path.match(/^\/admin\/projects\/([^/]+)\/status$/);
    if (m && method === 'POST') {
      var sp = db.projects.filter(function (p) { return p.id === decodeURIComponent(m[1]); })[0];
      if (!sp) throw new ApiError('作品不存在或已被删除', 404, 'not_found');
      var status2 = body && body.status;
      if (status2 !== 'published' && status2 !== 'offline') throw new ApiError('status 只能是 published 或 offline', 400, 'bad_request');
      sp.status = status2;
      sp.updatedAt = new Date().toISOString();
      mockSave(db);
      return { project: sp };
    }

    m = path.match(/^\/projects\/([^/]+)$/);
    if (m) {
      var gp = db.projects.filter(function (p) { return p.id === decodeURIComponent(m[1]); })[0];
      if (!gp) throw new ApiError('作品不存在', 404, 'not_found');
      return { project: gp };
    }

    throw new ApiError('演示模式没有实现：' + method + ' ' + path, 404, 'not_found');
  }

  /* ------------------------------------------------------------------ 登录页 */

  function showGate(message) {
    hideApp();
    var gate = $('#gateScreen');
    gate.hidden = false;
    var msg = $('#loginMsg');
    if (message) { msg.hidden = false; msg.textContent = message; }
    else { msg.hidden = true; msg.textContent = ''; }
    $('#gateHint').textContent = state.mock ? ('演示模式 · admin / admin123') : ('接口 ' + API);
    setTimeout(function () { try { $('#loginUser').focus(); } catch (e) {} }, 60);
  }
  function gateMsg(text) {
    var msg = $('#loginMsg');
    msg.hidden = !text;
    msg.textContent = text || '';
  }
  function hideApp() {
    $('#appScreen').hidden = true;
    closeModal();
    closeReject();
  }

  async function onLogin(ev) {
    ev.preventDefault();
    var username = ($('#loginUser').value || '').trim();
    var password = $('#loginPass').value || '';
    if (!username || !password) { gateMsg('请填写用户名和密码'); return; }
    var btn = $('#loginBtn');
    btn.disabled = true;
    btn.innerHTML = '<span class="spin"></span>登录中…';
    gateMsg('');
    try {
      var data = await api('/auth/login', { method: 'POST', body: { username: username, password: password } });
      if (!data || !data.token) throw new ApiError('登录接口没有返回 token', 500, 'bad_response');
      var user = data.user;
      if (!user) {
        state.token = data.token; writeToken(data.token);
        var me = await request('/auth/me');
        user = me && me.user;
      }
      if (!user) throw new ApiError('登录成功但读不到用户信息', 500, 'bad_response');
      if (user.role !== 'admin') {
        gateMsg('该账号没有管理员权限（当前角色：' + (user.role || '普通用户') + '）');
        return;
      }
      state.token = data.token;
      writeToken(data.token);
      $('#loginPass').value = '';
      enterAdmin(user);
      toast('ok', '已登录', '欢迎回来，' + (user.username || '管理员'));
    } catch (err) {
      gateMsg((err && err.message) || '登录失败');
    } finally {
      btn.disabled = false;
      btn.textContent = '登录管理端';
    }
  }

  /* ------------------------------------------------------------------ 进入后台 */

  function enterAdmin(user) {
    state.user = user;
    $('#gateScreen').hidden = true;
    $('#appScreen').hidden = false;
    $('#whoName').textContent = user.username || 'admin';
    $('#whoRole').textContent = user.role === 'admin' ? '管理员' : (user.role || '—');
    $('#modeNote').hidden = !state.mock;
    $('#factApi').textContent = state.mock ? '内置假数据' : API;
    $('#gateHint').textContent = state.mock ? '演示模式 · admin / admin123' : ('接口 ' + API);
    syncNotifyUI();
    syncSoundUI();
    renderFacts();
    setConn(state.mock ? 'live' : 'idle', state.mock ? '演示通道' : '连接中');

    var forced = flagValue('tab');
    state.tab = TABS.indexOf(forced) >= 0 ? forced : 'pending';
    syncTabs();
    refreshAll(true);
    connect();

    if (flag('event')) {
      setTimeout(function () { simulateIncoming(); }, 900);
    } else if (state.mock) {
      scheduleMockPump(9000);
    }
    var pv = flagValue('preview');
    if (pv) {
      setTimeout(function () {
        var list = state.lists[state.tab] || [];
        var hit = (pv !== '1') ? list.filter(function (p) { return p.id === pv; })[0] : list[0];
        if (hit) openDetail(hit.id);
      }, 1200);
    }
  }

  /* ------------------------------------------------------------------ 数据加载 */

  async function loadStats() {
    var s = await request('/admin/stats');
    state.stats = s || null;
    renderStats();
    renderTabCounts();
  }

  async function loadTab(tab, silent) {
    if (state.loading[tab]) return;
    state.loading[tab] = true;
    if (!silent) render();
    try {
      var data = (tab === 'pending')
        ? await request('/admin/queue')
        : await request('/admin/projects?status=' + encodeURIComponent(tab));
      var items = (data && data.items) || [];
      if (tab === 'pending') {
        items.sort(function (a, b) { return (toDate(a.createdAt) || 0) - (toDate(b.createdAt) || 0); });
      } else {
        items.sort(function (a, b) {
          return (toDate(b.updatedAt || b.createdAt) || 0) - (toDate(a.updatedAt || a.createdAt) || 0);
        });
      }
      state.lists[tab] = items;
      state.totals[tab] = (data && typeof data.total === 'number') ? data.total : items.length;
      state.loaded[tab] = true;
    } catch (err) {
      if (!(err && err.status === 401)) fail(err);
      state.lists[tab] = state.lists[tab] || [];
    } finally {
      state.loading[tab] = false;
      render();
    }
  }

  async function refreshAll(silent) {
    render();
    try {
      await Promise.all([loadStats(), loadTab(state.tab, silent)]);
    } catch (err) {
      fail(err);
    }
  }

  function switchTab(tab) {
    if (TABS.indexOf(tab) < 0 || state.tab === tab) {
      if (state.tab === tab) { syncTabs(); }
      return;
    }
    state.tab = tab;
    state.loaded[tab] = state.loaded[tab] && state.lists[tab].length > 0;
    syncTabs();
    hideBanner();
    if (!state.loaded[tab]) loadTab(tab);
    else render();
  }

  function syncTabs() {
    $$('#tabs .tab').forEach(function (btn) {
      var on = btn.getAttribute('data-tab') === state.tab;
      btn.setAttribute('aria-selected', on ? 'true' : 'false');
    });
  }

  /* ------------------------------------------------------------------ 渲染 */

  function statDefs() {
    var s = state.stats || {};
    return [
      { key: 'pending', label: '待审核', val: s.pending, hot: (s.pending || 0) > 0 },
      { key: 'published', label: '已上架', val: s.published },
      { key: 'offline', label: '已下架', val: s.offline },
      { key: 'rejected', label: '已驳回', val: s.rejected },
      { key: 'users', label: '用户数', val: s.users },
      { key: 'today', label: '今日新增', val: s.today }
    ];
  }

  function renderStats() {
    var html = statDefs().map(function (d) {
      var v = (d.val == null) ? '—' : d.val;
      return '<div class="stat' + (d.hot ? ' hot' : '') + '" data-key="' + d.key + '">' +
        '<b>' + esc(v) + '</b><span>' + esc(d.label) + '</span></div>';
    }).join('');
    $('#stats').innerHTML = html;
    $('#statsAt').textContent = state.stats ? fmtFull(Date.now()).slice(11) : '—';
  }

  function renderTabCounts() {
    var s = state.stats || {};
    TABS.forEach(function (t) {
      var n = (s[t] != null) ? s[t] : (state.lists[t] || []).length;
      var el = $('#tabN-' + t);
      if (el) el.textContent = String(n);
    });
  }

  function filtered(tab) {
    var list = state.lists[tab] || [];
    var q = state.q.trim().toLowerCase();
    if (!q) return list;
    return list.filter(function (p) {
      var hay = [
        p.title, p.tagline, p.taglineEn, p.type, p.note, p.prompt, p.promptZh,
        authorName(p), (p.model && p.model.name), (p.model && p.model.vendor),
        (p.tags || []).join(' '), (p.metrics || []).map(function (m) { return (m.k || '') + ' ' + (m.v || ''); }).join(' ')
      ].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }

  function thumbHTML(p) {
    var cover = p.cover ? '<img loading="lazy" alt="" src="' + esc(p.cover) + '">' : '<span>' + esc(initialOf(p.title)) + '</span>';
    return '<div class="thumb' + (p.cover ? '' : ' blank') + '">' + cover +
      '<i class="stamp">' + esc(p.type || 'entry') + '</i></div>';
  }

  function chipsHTML(p) {
    var out = [];
    if (p.model && (p.model.short || p.model.name)) out.push('<i class="chip accent">' + esc(p.model.short || p.model.name) + '</i>');
    (p.tags || []).slice(0, 5).forEach(function (t) { out.push('<i class="chip">' + esc(t) + '</i>'); });
    if (!out.length) out.push('<i class="chip">未标注标签</i>');
    return '<div class="i-chips">' + out.join('') + '</div>';
  }

  function actionsHTML(p) {
    var id = esc(p.id);
    var b = function (act, cls, label) {
      return '<button class="btn ' + cls + '" type="button" data-act="' + act + '" data-id="' + id + '">' + label + '</button>';
    };
    if (state.busy[p.id]) {
      return '<button class="btn primary" type="button" disabled><span class="spin"></span>处理中…</button>';
    }
    if (p.status === 'pending') {
      return b('approve', 'primary', '通过并上架') + b('reject', 'danger', '驳回') + b('detail', 'ghost', '预览 demo');
    }
    if (p.status === 'published') {
      return b('offline', 'danger', '下架') + b('detail', 'ghost', '预览 demo');
    }
    if (p.status === 'offline') {
      return b('publish', 'primary', '重新上架') + b('detail', 'ghost', '预览 demo');
    }
    return b('approve', 'primary', '通过并上架') + b('detail', 'ghost', '查看详情');
  }

  function itemHTML(p) {
    var status = p.status || 'pending';
    var meta = [
      '作者 <b>' + esc(authorName(p)) + '</b>',
      '模型 <b>' + esc((p.model && p.model.name) || '—') + '</b>',
      '提交 <b>' + esc(fmtRel(p.createdAt)) + '</b>'
    ];
    if (status === 'rejected' && p.note) meta.push('备注 <b>' + esc(String(p.note).slice(0, 26)) + '</b>');
    var peek = (p.prompt || p.tagline || '').replace(/\s+/g, ' ').slice(0, 180);
    return '<article class="item' + (state.freshIds[p.id] ? ' fresh' : '') + '" data-id="' + esc(p.id) + '" data-status="' + esc(status) + '"' +
      (p.accent ? ' style="--accent:' + esc(p.accent) + '"' : '') + '>' +
      thumbHTML(p) +
      '<div class="item-body">' +
        '<div class="i-top"><h3 class="i-title">' + esc(p.title || '未命名作品') + '</h3></div>' +
        '<p class="i-tagline">' + esc(p.tagline || '（没有一句话简介）') + '</p>' +
        '<div class="i-meta">' + meta.join('<span aria-hidden="true">·</span>') + '</div>' +
        chipsHTML(p) +
        '<p class="prompt-peek">' + esc(peek || '（没有提示词）') + '</p>' +
      '</div>' +
      '<div class="item-actions">' + actionsHTML(p) + '</div>' +
    '</article>';
  }

  function emptyText() {
    var q = state.q.trim();
    if (q) {
      return { title: '没有匹配的作品', text: '当前「' + TAB_LABEL[state.tab] + '」里没有包含「' + q + '」的记录，换个关键词试试。' };
    }
    if (state.tab === 'pending') return { title: '队列已清空', text: '暂时没有待审核的作品。新投稿会通过实时推送立刻出现在这里。' };
    if (state.tab === 'published') return { title: '还没有上架作品', text: '审核通过的作品会进入这里，可随时下架。' };
    if (state.tab === 'offline') return { title: '没有下架中的作品', text: '被下架的作品会留在这里，可以一键重新上架。' };
    return { title: '没有驳回记录', text: '驳回理由会写进作品备注，作者修改后可重新投稿。' };
  }

  function render() {
    if ($('#appScreen').hidden) return;
    var tab = state.tab;
    var list = filtered(tab);
    var loading = !!state.loading[tab] && !(state.lists[tab] || []).length;
    var box = $('#list');
    var empty = $('#empty');

    if (loading) {
      box.innerHTML = '<div class="item"><div class="thumb blank"><span>…</span></div>' +
        '<div class="item-body"><h3 class="i-title">正在读取' + esc(TAB_LABEL[tab]) + '列表…</h3>' +
        '<p class="i-tagline">与 ' + esc(state.mock ? '内置假数据' : API) + ' 通讯中。</p></div>' +
        '<div class="item-actions"><span class="mono-sm">加载中</span></div></div>';
      empty.hidden = true;
    } else if (!list.length) {
      box.innerHTML = '';
      var e = emptyText();
      $('#emptyTitle').textContent = e.title;
      $('#emptyText').textContent = e.text;
      empty.hidden = false;
    } else {
      box.innerHTML = list.map(itemHTML).join('');
      empty.hidden = true;
    }

    state.freshIds = {};
    $('#footCount').textContent = '共 ' + list.length + ' 件' + (state.q ? '（已筛选）' : '');
    var total = state.totals[tab];
    $('#footMeta').textContent = (typeof total === 'number' && total !== list.length)
      ? '当前状态合计 ' + total + ' 件 · ' + (state.mock ? '演示数据' : API)
      : (state.mock ? '演示数据 · 本机保存' : API);
    renderTabCounts();
  }

  function renderFacts() {
    $('#factRetry').textContent = String(state.retry);
    $('#factEvent').textContent = state.lastEventType ? (eventLabel(state.lastEventType) + ' · ' + fmtRel(state.lastEventAt)) : '—';
  }

  function eventLabel(t) {
    return ({ 'project.pending': '新投稿', 'project.published': '上架', 'project.rejected': '驳回', 'project.offline': '下架' })[t] || t;
  }

  /* ------------------------------------------------------------------ 连接状态 */

  function setConn(kind, text) {
    var pill = $('#connPill');
    var map = { live: '已连接', idle: '未连接', connecting: '连接中', retry: '重连中', down: '已断开' };
    if (!pill) return;
    pill.setAttribute('data-state', kind);
    $('#connText').textContent = text || map[kind] || '未连接';
    var fact = { live: '正常', idle: '等待中', connecting: '握手中', retry: '正在重连', down: '断开' }[kind] || '未知';
    $('#factConn').textContent = fact + (text && kind !== 'live' ? '（' + text + '）' : '');
    renderFacts();
  }

  /* ------------------------------------------------------------------ 数据操作 */

  function findProject(id) {
    var found = null;
    TABS.forEach(function (t) {
      (state.lists[t] || []).forEach(function (p) { if (p.id === id) found = p; });
    });
    return found;
  }
  function removeFrom(tab, id) {
    state.lists[tab] = (state.lists[tab] || []).filter(function (p) { return p.id !== id; });
    if (state.totals[tab] > 0) state.totals[tab] -= 1;
  }
  function upsert(tab, p) {
    var list = state.lists[tab] || [];
    var idx = -1;
    for (var i = 0; i < list.length; i++) { if (list[i].id === p.id) { idx = i; break; } }
    if (idx >= 0) list[idx] = p;
    else {
      if (tab === 'pending') list.push(p);
      else list.unshift(p);
      state.totals[tab] = (state.totals[tab] || 0) + 1;
    }
    state.lists[tab] = list;
  }
  function markEcho(id) {
    state.localEcho[id] = Date.now();
    setTimeout(function () { delete state.localEcho[id]; }, 6000);
  }
  function echoedLocally(id) {
    return !!(state.localEcho[id] && Date.now() - state.localEcho[id] < 6000);
  }
  function moveTo(p, tab) {
    TABS.forEach(function (t) { removeFrom(t, p.id); });
    upsert(tab, p);
  }

  async function doReview(id, decision, note) {
    if (state.busy[id]) return;
    markEcho(id);
    state.busy[id] = true;
    render();
    try {
      var data = await request('/admin/projects/' + encodeURIComponent(id) + '/review', {
        method: 'POST',
        body: { decision: decision, note: note || undefined }
      });
      var proj = (data && data.project) || findProject(id);
      if (proj) {
        proj.status = decision === 'approve' ? 'published' : 'rejected';
        if (note) proj.note = note;
        proj.updatedAt = new Date().toISOString();
        markEcho(proj.id);
        moveTo(proj, proj.status);
      }
      toast('ok', decision === 'approve' ? '已通过并上架' : '已驳回',
        (proj ? proj.title : id) + (decision === 'approve' ? ' · 已进入已上架列表' : ' · 驳回理由已记录'));
      closeModal();
      render();
      loadStats().catch(fail);
    } catch (err) {
      fail(err);
    } finally {
      delete state.busy[id];
      render();
    }
  }

  async function doStatus(id, status) {
    if (state.busy[id]) return;
    markEcho(id);
    state.busy[id] = true;
    render();
    try {
      var data = await request('/admin/projects/' + encodeURIComponent(id) + '/status', {
        method: 'POST',
        body: { status: status }
      });
      var proj = (data && data.project) || findProject(id);
      if (proj) {
        proj.status = status;
        proj.updatedAt = new Date().toISOString();
        markEcho(proj.id);
        moveTo(proj, status);
      }
      toast('ok', status === 'offline' ? '已下架' : '已重新上架', (proj ? proj.title : id) + ' · 市集前台已同步');
      closeModal();
      render();
      loadStats().catch(fail);
    } catch (err) {
      fail(err);
    } finally {
      delete state.busy[id];
      render();
    }
  }

  /* ------------------------------------------------------------------ 详情模态 */

  function metaHTML(p) {
    var items = [];
    function add(k, v) { items.push('<li><span>' + esc(k) + '</span><b>' + v + '</b></li>'); }
    add('状态', esc(statusLabel(p.status)));
    add('作者', esc(authorName(p)));
    add('模型', esc((p.model && p.model.name) || '—') + (p.model && p.model.vendor ? ' · ' + esc(p.model.vendor) : ''));
    add('类型', esc(p.type || '—'));
    add('提交时间', esc(fmtFull(p.createdAt)));
    add('更新时间', esc(fmtFull(p.updatedAt)));
    if (p.source && p.source.href) {
      add('来源', '<a class="link" href="' + esc(p.source.href) + '" target="_blank" rel="noopener noreferrer">' + esc(p.source.label || '打开链接') + '</a>');
    }
    if (p.files) {
      add('入口文件', esc(p.files.entry || '—'));
      add('存放目录', esc(p.files.dir || '—'));
    }
    (p.metrics || []).forEach(function (m) { if (m && (m.k || m.v)) add(m.k || '指标', esc(m.v || '—')); });
    return items.join('');
  }

  function modalActionsHTML(p) {
    var id = esc(p.id);
    var html = '<span class="spacer">' + esc(p.type || 'entry') + ' · 提交于 ' + esc(fmtRel(p.createdAt)) + '</span>';
    if (p.status === 'pending') {
      html += '<button class="btn danger" type="button" data-mact="reject" data-id="' + id + '">驳回</button>';
      html += '<button class="btn primary" type="button" data-mact="approve" data-id="' + id + '">通过并上架</button>';
    } else if (p.status === 'published') {
      html += '<button class="btn danger" type="button" data-mact="offline" data-id="' + id + '">下架</button>';
    } else if (p.status === 'offline') {
      html += '<button class="btn primary" type="button" data-mact="publish" data-id="' + id + '">重新上架</button>';
    } else {
      html += '<button class="btn primary" type="button" data-mact="approve" data-id="' + id + '">改判为通过</button>';
    }
    html += '<button class="btn ghost" type="button" data-mact="close" data-id="' + id + '">关闭</button>';
    return html;
  }

  function openDetail(id) {
    var p = findProject(id);
    if (!p) { toast('err', '找不到作品', '列表里没有这条记录，正在重新拉取'); refreshAll(true); return; }
    state.detailId = id;

    $('#mTitle').textContent = p.title || '未命名作品';
    $('#mKicker').textContent = '作品详情 · ' + statusLabel(p.status);
    $('#mSub').textContent = [authorName(p), (p.model && p.model.name) || null, p.type || null].filter(Boolean).join(' · ');
    $('#mMeta').innerHTML = metaHTML(p);
    $('#mPrompt').textContent = p.prompt || '（作者没有提供提示词）';

    var zh = p.promptZh || '';
    $('#mPromptZhWrap').hidden = !zh;
    $('#mPromptZh').textContent = zh;

    var note = p.note || '';
    $('#mNote').hidden = !note;
    $('#mNoteText').textContent = note;

    var demo = p.demo || '';
    var frame = $('#mFrame');
    if (demo) {
      $('#mDemoUrl').textContent = demo;
      $('#mDemoOpen').href = demo;
      $('#mDemoOpen').hidden = false;
      frame.hidden = false;
      frame.src = demo;
      $('#mFrameNone').hidden = true;
    } else {
      $('#mDemoUrl').textContent = '（没有 demo 文件）';
      $('#mDemoOpen').hidden = true;
      frame.hidden = true;
      frame.removeAttribute('src');
      $('#mFrameNone').hidden = false;
    }
    $('#mActions').innerHTML = modalActionsHTML(p);
    openModal($('#modal'));
  }

  function openModal(el) {
    $('#veil').hidden = false;
    el.hidden = false;
    document.body.style.overflow = 'hidden';
  }
  function closeModal() {
    var m = $('#modal');
    if (m && !m.hidden) {
      m.hidden = true;
      var frame = $('#mFrame');
      if (frame) frame.removeAttribute('src');
    }
    state.detailId = null;
    if ($('#rejectModal').hidden) {
      $('#veil').hidden = true;
      document.body.style.overflow = '';
    }
  }

  function openReject(id) {
    var p = findProject(id);
    state.rejectId = id;
    $('#rTitle').textContent = '驳回：' + ((p && p.title) || '作品');
    $('#rHint').textContent = '理由会写进作品备注，作者修改后可重新投稿。';
    $('#rNote').value = '';
    closeModal();
    $('#veil').hidden = false;
    $('#rejectModal').hidden = false;
    document.body.style.overflow = 'hidden';
    setTimeout(function () { try { $('#rNote').focus(); } catch (e) {} }, 60);
  }
  function closeReject() {
    var m = $('#rejectModal');
    if (m && !m.hidden) m.hidden = true;
    state.rejectId = null;
    if ($('#modal').hidden) {
      $('#veil').hidden = true;
      document.body.style.overflow = '';
    }
  }
  async function confirmReject() {
    var id = state.rejectId;
    if (!id) return;
    var note = ($('#rNote').value || '').trim();
    var btn = $('#rConfirm');
    btn.disabled = true;
    btn.innerHTML = '<span class="spin"></span>驳回中…';
    closeReject();
    await doReview(id, 'reject', note || '未填写理由');
    btn.disabled = false;
    btn.textContent = '确认驳回';
  }

  /* ------------------------------------------------------------------ 横幅 / 通知 / 声音 */

  function bumpBanner(p) {
    state.bannerCount += 1;
    var banner = $('#pendingBanner');
    $('#bannerText').textContent = '有 ' + state.bannerCount + ' 件新作品待审';
    $('#bannerSub').textContent = '实时推送 · ' + ((p && p.title) ? p.title : '刚刚');
    banner.hidden = false;
  }
  function hideBanner() {
    state.bannerCount = 0;
    $('#pendingBanner').hidden = true;
  }

  function syncNotifyUI() {
    var btn = $('#notifyBtn');
    if (!btn) return;
    var supported = ('Notification' in window);
    var granted = supported && Notification.permission === 'granted';
    var on = prefs.notify && granted;
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    btn.title = !supported ? '当前浏览器不支持桌面通知'
      : (Notification.permission === 'denied' ? '通知权限已被拒绝，请在站点设置里重新允许'
        : (on ? '桌面通知已开启，点击关闭' : '开启桌面通知'));
    btn.querySelector('span').textContent = !supported ? '通知不可用' : (on ? '通知已开' : '桌面通知');
  }
  function syncSoundUI() {
    var btn = $('#soundBtn');
    if (!btn) return;
    btn.setAttribute('aria-pressed', prefs.sound ? 'true' : 'false');
    btn.querySelector('span').textContent = prefs.sound ? '提示音开' : '提示音关';
  }

  async function onNotifyToggle() {
    if (!('Notification' in window)) {
      toast('err', '浏览器不支持', '当前浏览器没有桌面通知能力，实时横幅仍然可用');
      return;
    }
    if (Notification.permission === 'granted') {
      prefs.notify = !prefs.notify;
      savePrefs();
      syncNotifyUI();
      toast('ok', prefs.notify ? '桌面通知已开启' : '桌面通知已关闭', prefs.notify ? '新作品待审时会弹出系统通知' : '只保留页面内横幅提醒');
      return;
    }
    if (Notification.permission === 'denied') {
      toast('err', '通知被浏览器拒绝', '请在地址栏左侧的站点设置里把「通知」改成允许，再回来开一次');
      return;
    }
    try {
      var perm = await Notification.requestPermission();
      prefs.notify = (perm === 'granted');
      savePrefs();
      syncNotifyUI();
      if (prefs.notify) {
        toast('ok', '桌面通知已开启', '新作品待审时会弹出系统通知');
        try { new Notification('通知已开启', { body: '有新作品待审时会在这里提醒你。', icon: '../assets/mark.svg' }); } catch (e) {}
      } else {
        toast('err', '未开启通知', '浏览器返回：' + perm);
      }
    } catch (e) {
      toast('err', '开启失败', (e && e.message) || '浏览器拒绝了通知请求');
    }
  }

  function onSoundToggle() {
    prefs.sound = !prefs.sound;
    savePrefs();
    syncSoundUI();
    if (prefs.sound) beep();
    toast('ok', prefs.sound ? '提示音已开启' : '提示音已关闭', prefs.sound ? '新作品到达时会响两声' : '只保留横幅与通知');
  }

  function beep() {
    if (!prefs.sound) return;
    try {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      state.ac = state.ac || new AC();
      var ac = state.ac;
      if (ac.state === 'suspended') ac.resume();
      var t0 = ac.currentTime + 0.02;
      [880, 1320].forEach(function (freq, i) {
        var osc = ac.createOscillator();
        var gain = ac.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        var start = t0 + i * 0.14;
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(0.1, start + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.13);
        osc.connect(gain);
        gain.connect(ac.destination);
        osc.start(start);
        osc.stop(start + 0.15);
      });
    } catch (e) { /* 声音失败不影响主流程 */ }
  }

  function notifyDesktop(p) {
    if (!prefs.notify) return;
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    try {
      var n = new Notification('有新作品待审', {
        body: (p.title || '未命名作品') + ' · ' + authorName(p),
        tag: 'sl-market-' + p.id,
        icon: '../assets/mark.svg'
      });
      n.onclick = function () {
        try { window.focus(); } catch (e) {}
        switchTab('pending');
        openDetail(p.id);
        n.close();
      };
    } catch (e) { /* 部分浏览器要求 ServiceWorker，忽略 */ }
  }

  /* ------------------------------------------------------------------ SSE */

  function handleEvent(evt) {
    if (!evt || !evt.type) return;
    var at = evt.at ? evt.at * 1000 : Date.now();
    state.lastEventAt = at;
    state.lastEventType = evt.type;
    renderFacts();

    var p = evt.project || null;
    if (evt.type === 'project.pending' && p) {
      upsert('pending', p);
      state.freshIds[p.id] = true;
      bumpBanner(p);
      beep();
      notifyDesktop(p);
      toast('ok', '新作品待审', (p.title || '未命名作品') + ' · ' + authorName(p));
    } else if (evt.type === 'project.published' && p) {
      p.status = 'published';
      moveTo(p, 'published');
      if (!echoedLocally(p.id)) toast('ok', '作品已上架', (p.title || p.id));
    } else if (evt.type === 'project.rejected' && p) {
      p.status = 'rejected';
      moveTo(p, 'rejected');
      if (!echoedLocally(p.id)) toast('ok', '作品已驳回', (p.title || p.id));
    } else if (evt.type === 'project.offline' && p) {
      p.status = 'offline';
      moveTo(p, 'offline');
      if (!echoedLocally(p.id)) toast('ok', '作品已下架', (p.title || p.id));
    }
    render();
    loadStats().catch(function () {});
  }

  function startStream() {
    if (state.mock) {
      startMockPump();
      return;
    }
    if (!state.token) return;
    stopStream();
    var url = API + '/admin/events?token=' + encodeURIComponent(state.token);
    setConn('connecting');
    var es;
    try {
      es = new EventSource(url);
    } catch (e) {
      scheduleReconnect();
      return;
    }
    state.es = es;
    es.onopen = function () {
      state.retry = 0;
      renderFacts();
      setConn('live');
    };
    es.onmessage = function (ev) {
      var data = null;
      try { data = JSON.parse(ev.data); } catch (e) { data = null; }
      if (data) handleEvent(data);
    };
    es.onerror = function () {
      try { es.close(); } catch (e) {}
      if (state.es === es) state.es = null;
      setConn('retry');
      scheduleReconnect();
    };
  }

  function stopStream() {
    if (state.es) {
      try { state.es.close(); } catch (e) {}
      state.es = null;
    }
    clearTimeout(state.retryTimer);
    state.retryTimer = null;
  }

  function scheduleReconnect() {
    clearTimeout(state.retryTimer);
    state.retry += 1;
    var base = Math.min(30000, 1000 * Math.pow(2, state.retry - 1));
    var delay = Math.round(base * (0.7 + Math.random() * 0.6));
    setConn('retry', Math.max(1, Math.round(delay / 1000)) + 's');
    renderFacts();
    state.retryTimer = setTimeout(function () {
      state.retryTimer = null;
      startStream();
    }, delay);
    if (state.retry % 3 === 0) verifySession();
  }

  async function verifySession() {
    if (!state.token) return;
    try {
      var me = await request('/auth/me');
      var user = me && me.user;
      if (!user || user.role !== 'admin') {
        onUnauthorized({ message: '该账号已失去管理员权限，请重新登录' });
      }
    } catch (err) {
      if (!(err && err.status === 401)) { /* 网络抖动，继续退避重连 */ }
    }
  }

  function connect() {
    if (state.mock) {
      setConn('live', '演示通道');
      startMockPump();
      return;
    }
    state.retry = 0;
    startStream();
  }

  /* ------------------------------------------------------------------ 演示推送 */

  function simulateIncoming() {
    var p = mockIncoming();
    var db = mockDB();
    db.projects.push(p);
    mockSave(db);
    handleEvent({ type: 'project.pending', project: p, at: Math.floor(Date.now() / 1000) });
  }
  function scheduleMockPump(delay) {
    if (!state.mock) return;
    clearTimeout(state.mockTimer);
    state.mockTimer = setTimeout(function () {
      if (state.mockPumped) return;
      state.mockPumped = true;
      simulateIncoming();
    }, delay || 9000);
  }
  function startMockPump() {
    if (!state.mock) return;
    if (state.mockPumped) return;
    scheduleMockPump(9000);
  }
  function stopMockPump() {
    clearTimeout(state.mockTimer);
    state.mockTimer = null;
  }

  /* ------------------------------------------------------------------ 事件绑定 */

  function bind() {
    $('#loginForm').addEventListener('submit', onLogin);
    $('#tabs').addEventListener('click', function (ev) {
      var btn = ev.target.closest('.tab');
      if (!btn) return;
      switchTab(btn.getAttribute('data-tab'));
    });
    $('#searchQ') && $('#searchQ').addEventListener('input', function () {});
    $('#q').addEventListener('input', debounce(function (ev) {
      state.q = ev.target.value || '';
      render();
    }, 120));
    document.addEventListener('keydown', function (ev) {
      if (ev.key === '/' && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) {
        ev.preventDefault();
        $('#q').focus();
      }
      if (ev.key === 'Escape') {
        if (!$('#rejectModal').hidden) closeReject();
        else if (!$('#modal').hidden) closeModal();
      }
      if (ev.key === 'Enter' && ev.metaKey && !$('#modal').hidden) {
        var primary = $('#mActions .btn.primary');
        if (primary) primary.click();
      }
    });
    $('#list').addEventListener('click', function (ev) {
      var btn = ev.target.closest('[data-act]');
      if (!btn) return;
      var act = btn.getAttribute('data-act');
      var id = btn.getAttribute('data-id');
      if (act === 'detail') openDetail(id);
      else if (act === 'approve') doReview(id, 'approve');
      else if (act === 'reject') openReject(id);
      else if (act === 'offline') doStatus(id, 'offline');
      else if (act === 'publish') doStatus(id, 'published');
    });
    $('#mActions').addEventListener('click', function (ev) {
      var btn = ev.target.closest('[data-mact]');
      if (!btn) return;
      var act = btn.getAttribute('data-mact');
      var id = btn.getAttribute('data-id');
      if (act === 'close') closeModal();
      else if (act === 'approve') doReview(id, 'approve');
      else if (act === 'reject') openReject(id);
      else if (act === 'offline') doStatus(id, 'offline');
      else if (act === 'publish') doStatus(id, 'published');
    });
    $('#mClose').addEventListener('click', closeModal);
    $('#veil').addEventListener('click', function () { closeReject(); closeModal(); });
    $('#mCopy').addEventListener('click', async function () {
      var text = $('#mPrompt').textContent || '';
      if (!text) return;
      try {
        await navigator.clipboard.writeText(text);
        toast('ok', '已复制', '提示词已在剪贴板');
      } catch (e) {
        toast('err', '复制失败', '浏览器拒绝访问剪贴板，请手动选中复制');
      }
    });
    $('#rConfirm').addEventListener('click', confirmReject);
    $('#rCancel').addEventListener('click', closeReject);
    $('#rClose').addEventListener('click', closeReject);
    $('#bannerView').addEventListener('click', function () {
      switchTab('pending');
      hideBanner();
      document.querySelector('.board').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    $('#bannerDismiss').addEventListener('click', hideBanner);
    $('#notifyBtn').addEventListener('click', onNotifyToggle);
    $('#soundBtn').addEventListener('click', onSoundToggle);
    $('#refreshBtn').addEventListener('click', function () {
      state.loaded = {};
      refreshAll();
      toast('ok', '已刷新', '统计与当前列表已重新拉取');
    });
    $('#logoutBtn').addEventListener('click', function () {
      clearToken();
      stopStream();
      stopMockPump();
      state.token = '';
      state.user = null;
      state.stats = null;
      state.lists = { pending: [], published: [], offline: [], rejected: [] };
      state.loaded = {};
      showGate('已退出登录');
    });
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState !== 'visible') return;
      syncNotifyUI();
      if (state.mock || !state.token) return;
      if (!state.es && !state.retryTimer) startStream();
    });
    document.addEventListener('pointerdown', function prime() {
      if (state.ac && state.ac.state === 'suspended') state.ac.resume();
    }, { once: true });
  }

  /* ------------------------------------------------------------------ 启动 */

  async function boot() {
    bind();
    readPrefs();
    state.token = readToken();

    if (flag('fresh')) {
      try { localStorage.removeItem(K.mock); } catch (e) {}
    }

    var probe = flag('mock') ? 'absent' : await probeBackend();
    if (probe === 'absent') {
      state.mock = true;
      $('#modeNote').hidden = false;
      $('#factApi').textContent = '内置假数据';
      $('#gateHint').textContent = '演示模式 · admin / admin123';
      if (flag('login')) { showGate(); return; }
      var me = await api('/auth/me');
      state.token = state.token || 'mock.token';
      enterAdmin(me.user);
      return;
    }

    if (flag('login') || !state.token) { showGate(); return; }

    try {
      var res = await request('/auth/me');
      var user = res && res.user;
      if (!user) throw new ApiError('接口返回缺少 user 字段', 500, 'bad_response');
      if (user.role !== 'admin') {
        clearToken();
        showGate('该账号没有管理员权限（当前角色：' + (user.role || '普通用户') + '）');
        return;
      }
      enterAdmin(user);
    } catch (err) {
      if (err && err.status === 401) return;
      showGate((err && err.message) || '读取登录状态失败');
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
