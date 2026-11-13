/* market.js — 提示词市集前台（国内版）。
   数据源：优先云端 API（/api），失败自动回退静态清单 data/projects.js，保证纯静态托管也能看。
   功能：筛选/搜索、详情抽屉、复制提示词（中文优先）、云端登录、投稿、我的投稿。 */
(function () {
  'use strict';

  var API = (window.MARKET_API || '/api').replace(/\/$/, '');
  var TOKEN_KEY = 'sl.market.token';
  var META = window.MARKET_META || {};
  var STATIC = Array.isArray(window.MARKET_PROJECTS) ? window.MARKET_PROJECTS.slice() : [];

  var state = {
    mode: 'static',
    items: STATIC.slice(),
    user: null,
    token: null,
    q: '',
    model: 'all',
    type: 'all',
    promptLang: 'zh',
    drawerId: null,
    lastFocus: null
  };

  var TYPE_LABEL = { game: '游戏', tool: '工具', project: '项目' };
  var STATUS_LABEL = { pending: '审核中', published: '已上架', rejected: '已驳回', offline: '已下架' };

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  var norm = function (s) { return String(s || '').toLowerCase(); };
  var words = function (s) { return String(s || '').trim() ? String(s).trim().split(/\s+/).length : 0; };
  var modelKey = function (p) {
    var m = p.model || {};
    return (m.short || m.name || '未知模型').toString();
  };
  var typeOf = function (p) { return p.type || 'project'; };
  var typeLabel = function (t) { return TYPE_LABEL[t] || t; };
  var promptOf = function (p, lang) {
    if (lang === 'en') return p.prompt || p.promptZh || '';
    return p.promptZh || p.prompt || '';
  };
  var authorName = function (p) {
    if (p.author && p.author.name) return p.author.name;
    if (typeof p.author === 'string') return p.author;
    return '匿名';
  };

  /* ---------- 提示 ---------- */
  function toast(msg) {
    var t = $('#toast');
    t.textContent = msg;
    t.classList.add('on');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.classList.remove('on'); }, 2100);
  }

  /* ---------- API ---------- */
  function api(path, opts) {
    opts = opts || {};
    var headers = opts.headers || {};
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(opts.body);
    }
    if (state.token) headers.Authorization = 'Bearer ' + state.token;
    return fetch(API + path, {
      method: opts.method || 'GET',
      headers: headers,
      body: opts.body,
      credentials: 'omit'
    }).then(function (res) {
      return res.text().then(function (text) {
        var data = null;
        try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }
        if (!res.ok) {
          var msg = (data && data.error && data.error.message) || ('请求失败（' + res.status + '）');
          var err = new Error(msg);
          err.status = res.status;
          err.code = data && data.error ? data.error.code : '';
          throw err;
        }
        return data;
      });
    });
  }

  function boot() {
    state.token = localStorage.getItem(TOKEN_KEY) || null;
    renderShell();
    api('/health').then(function (h) {
      state.mode = 'cloud';
      renderShell();
      return loadCloud();
    }).catch(function () {
      state.mode = 'static';
      state.items = STATIC.slice();
      renderShell();
      renderChips();
      renderGrid();
    }).then(function () {
      if (state.token) refreshMe().catch(function () {});
    });
    bind();
    var deep = /^#\/(.+)$/.exec(location.hash);
    if (deep) openDrawer(decodeURIComponent(deep[1]), false);
  }

  function loadCloud() {
    return api('/projects').then(function (data) {
      var list = (data && data.items) || [];
      if (!list.length && STATIC.length) {
        state.items = STATIC.slice();
        state.mode = 'static-fallback';
      } else {
        // 云端是数据权威；静态清单只补展示层字段（编号、主色、精选位、署名补充）
        state.items = list.map(function (p) {
          var st = null;
          for (var i = 0; i < STATIC.length; i++) {
            if (STATIC[i].id === p.id || STATIC[i].title === p.title) { st = STATIC[i]; break; }
          }
          if (!st) return p;
          var merged = Object.assign({}, p);
          merged.no = p.no || st.no;
          merged.featured = st.featured === true;
          merged.accent = p.accent || st.accent;
          merged.shot = p.shot || st.shot;
          merged.credits = p.credits || st.credits;
          merged.promptNote = p.promptNote || st.promptNote;
          return merged;
        }).sort(function (a, b) { return (b.featured ? 1 : 0) - (a.featured ? 1 : 0); });
      }
      renderShell();
      renderChips();
      renderGrid();
    });
  }

  function refreshMe() {
    return api('/auth/me').then(function (data) {
      state.user = data && data.user;
      renderShell();
    }).catch(function () {
      state.user = null;
      state.token = null;
      localStorage.removeItem(TOKEN_KEY);
      renderShell();
    });
  }

  /* ---------- 顶栏 / 清单 ---------- */
  function renderShell() {
    var badge = $('#srcBadge');
    if (badge) {
      var online = state.mode === 'cloud' || state.mode === 'static-fallback';
      badge.textContent = state.mode === 'cloud' ? '云端已连接' : (state.mode === 'static-fallback' ? '云端为空 · 静态清单' : '静态清单');
      badge.classList.toggle('online', online && state.mode === 'cloud');
    }
    var tb = $('#tbStat');
    if (tb) {
      var demos = state.items.filter(function (p) { return p.demo; }).length;
      tb.innerHTML = '作品 <b>' + state.items.length + '</b><br>可试玩 <b>' + demos + '</b>';
    }
    var right = $('.tb-r');
    if (right) {
      var loginBtn = $('#btnLogin');
      if (state.user) {
        if (loginBtn) loginBtn.remove();
        if (!$('#btnMine')) {
          var wrap = document.createElement('div');
          wrap.className = 'tb-user';
          wrap.innerHTML = '<span class="avatar" title="' + esc(state.user.username) + '">' + esc((state.user.username || '?').slice(0, 1)) + '</span>' +
            '<button class="tb-link ghost" id="btnMine" type="button">我的投稿</button>' +
            '<button class="tb-link ghost" id="btnLogout" type="button">退出</button>';
          right.insertBefore(wrap, $('#btnSubmit'));
        }
      } else {
        var mine = $('#btnMine'); if (mine && mine.parentNode) mine.parentNode.remove();
      }
    }
    var manifest = $('#manifest');
    if (manifest) {
      var models = {};
      state.items.forEach(function (p) { models[modelKey(p)] = 1; });
      var rows = [
        ['作品', String(state.items.length), '件'],
        ['模型', String(Object.keys(models).length), '个'],
        ['可试玩', String(state.items.filter(function (p) { return p.demo; }).length), '个'],
        ['数据源', state.mode === 'cloud' ? '云端' : '静态', META.version || 'v2.0']
      ];
      manifest.innerHTML = rows.map(function (r) {
        return '<div><dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '<small>' + esc(r[2]) + '</small></dd></div>';
      }).join('');
    }
    var fv = $('#footVer');
    if (fv) fv.textContent = '市集 ' + (META.version || 'v2.0') + ' · ' + (META.updated || '');
  }

  /* ---------- 筛选 ---------- */
  function chip(label, value, count, group, active) {
    return '<button class="chip" type="button" data-group="' + group + '" data-value="' + esc(value) +
      '" aria-pressed="' + (active ? 'true' : 'false') + '">' + esc(label) +
      (count != null ? '<u>' + count + '</u>' : '') + '</button>';
  }

  function renderChips() {
    var byModel = {}, byType = {};
    state.items.forEach(function (p) {
      byModel[modelKey(p)] = (byModel[modelKey(p)] || 0) + 1;
      byType[typeOf(p)] = (byType[typeOf(p)] || 0) + 1;
    });
    var m = chip('全部模型', 'all', state.items.length, 'model', state.model === 'all');
    Object.keys(byModel).sort().forEach(function (k) { m += chip(k, k, byModel[k], 'model', state.model === k); });
    $('#chipsModel').innerHTML = m;

    var t = chip('全部类型', 'all', state.items.length, 'type', state.type === 'all');
    Object.keys(byType).sort().forEach(function (k) { t += chip(typeLabel(k), k, byType[k], 'type', state.type === k); });
    $('#chipsType').innerHTML = t;
  }

  /* ---------- 网格 ---------- */
  function matches(p) {
    if (state.model !== 'all' && modelKey(p) !== state.model) return false;
    if (state.type !== 'all' && typeOf(p) !== state.type) return false;
    if (!state.q) return true;
    var hay = [p.title, p.tagline, p.taglineEn, p.promptZh, p.prompt, authorName(p),
      (p.tags || []).join(' '), modelKey(p), (p.model && p.model.vendor) || '', typeLabel(typeOf(p))].join(' ');
    return norm(hay).indexOf(state.q) !== -1;
  }

  function card(p) {
    var accent = p.accent || '#ffb347';
    var demo = p.demo && p.status !== 'pending' && p.status !== 'rejected';
    var zh = p.promptZh || p.prompt || '';
    var en = p.prompt && p.promptZh ? p.prompt : '';
    return '<article class="card' + (p.featured ? ' featured' : '') + '" data-id="' + esc(p.id) + '" style="--accent:' + esc(accent) + '">' +
      '<div class="card-shot">' +
        '<span class="plate">编号 <b>' + esc(p.no || '—') + '</b></span>' +
        '<span class="model-badge"><i></i>' + esc(modelKey(p)) + '</span>' +
        (p.cover ? '<img src="' + esc(p.cover) + '" alt="' + esc(p.title) + ' 封面" loading="eager" decoding="async">' : '') +
        '<div class="shot-title">' +
          '<h3>' + esc(p.title) + '</h3>' +
          (p.taglineEn ? '<p>' + esc(p.taglineEn) + '</p>' : '') +
        '</div>' +
      '</div>' +
      '<div class="card-body">' +
        '<p class="card-tag">' + esc(p.tagline) + '</p>' +
        '<div class="card-author">作者 <b>' + esc(authorName(p)) + '</b>' +
          (p.source && p.source.href ? ' · <a href="' + esc(p.source.href) + '" target="_blank" rel="noopener">' + esc(p.source.label || '来源') + '</a>' : '') +
        '</div>' +
        '<div class="tags">' + (p.tags || []).map(function (t) { return '<span>' + esc(t) + '</span>'; }).join('') + '</div>' +
        '<div class="card-meta">' +
          '<span>提示词 ' + (zh ? '中文 ' + words(zh) + ' 词' : '待补') + '</span>' +
          (en ? '<span>原文 ' + words(en) + ' 词</span>' : '') +
          '<span>' + (demo ? '在线试玩' : '暂不可玩') + '</span>' +
        '</div>' +
        '<div class="card-foot">' +
          '<button class="btn solid" type="button" data-copy="' + esc(p.id) + '">复制提示词</button>' +
          (demo
            ? '<a class="btn ghost" href="' + esc(p.demo) + '" target="_blank" rel="noopener">在线试玩 <span aria-hidden="true">↗</span></a>'
            : '<span class="btn ghost" aria-disabled="true">暂不可玩</span>') +
          '<button class="btn ghost" type="button" data-open="' + esc(p.id) + '">详情</button>' +
        '</div>' +
      '</div>' +
    '</article>';
  }

  function renderGrid() {
    var list = state.items.filter(matches);
    var grid = $('#grid');
    if (!list.length) {
      grid.innerHTML = '<div class="grid-empty"><b>没有匹配的作品</b>换个模型或清空搜索关键词再试。</div>';
      return;
    }
    grid.innerHTML = list.map(card).join('') +
      '<article class="card cta"><div class="cta-in">' +
        '<span class="cta-k">下一个位置 · M-05</span>' +
        '<h3>你的作品</h3>' +
        '<p>一条提示词就够了。登录后上传一个单文件 <code>index.html</code>，填上提示词、模型与署名，提交后进入审核队列，通过即上架。</p>' +
        '<button class="btn solid" type="button" data-act="submit">我要投稿 <span aria-hidden="true">↗</span></button>' +
      '</div></article>';
    $$('.card-shot img', grid).forEach(function (img) {
      img.addEventListener('error', function () {
        img.style.display = 'none';
        img.parentNode.style.background = 'linear-gradient(135deg,#12161a,#0a0c0e 60%),#0a0c0e';
      });
    });
  }

  /* ---------- 抽屉 ---------- */
  function byId(id) {
    for (var i = 0; i < state.items.length; i++) if (state.items[i].id === id) return state.items[i];
    return null;
  }

  function drawerHTML(p) {
    var m = p.model || {};
    var zh = p.promptZh || p.prompt || '';
    var en = p.prompt && p.promptZh ? p.prompt : '';
    var shown = promptOf(p, en ? state.promptLang : 'zh');
    var metrics = (p.metrics || []).map(function (x) {
      return '<div><dt>' + esc(x.k) + '</dt><dd>' + esc(x.v) + '</dd></div>';
    }).join('');
    var demo = p.demo;
    return '<div class="d-hero">' + (p.cover ? '<img src="' + esc(p.cover) + '" alt="">' : '') +
        '<h2 id="dTitle">' + esc(p.title) + '</h2></div>' +
      '<p class="d-tag">' + esc(p.tagline) + '</p>' +
      '<ul class="d-where">' +
        '<li>模型 <b>' + esc(m.name || modelKey(p)) + (m.vendor ? ' · ' + esc(m.vendor) : '') + '</b></li>' +
        '<li>作者 <b>' + esc(authorName(p)) + '</b></li>' +
        '<li>类型 <b>' + esc(typeLabel(typeOf(p))) + '</b></li>' +
        (p.source && p.source.href ? '<li>来源 <b><a href="' + esc(p.source.href) + '" target="_blank" rel="noopener">' + esc(p.source.label || '链接') + '</a></b></li>' : '') +
        (p.createdAt ? '<li>提交 <b>' + esc(new Date(p.createdAt).toLocaleDateString('zh-CN')) + '</b></li>' : '') +
      '</ul>' +
      '<div class="d-sec">提示词' + (en ? '' : '（中文）') + '</div>' +
      (en
        ? '<div class="prompt-tabs">' +
            '<button class="chip" type="button" data-plang="zh" aria-pressed="' + (state.promptLang !== 'en') + '">中文</button>' +
            '<button class="chip" type="button" data-plang="en" aria-pressed="' + (state.promptLang === 'en') + '">原文</button>' +
          '</div>'
        : '') +
      '<div class="prompt-box"><pre id="dPrompt">' + esc(shown) + '</pre></div>' +
      (p.promptNote ? '<p class="p-note">' + esc(p.promptNote) + '</p>' : '') +
      '<div class="d-actions">' +
        '<button class="btn solid" type="button" data-copy="' + esc(p.id) + '">复制提示词</button>' +
        (demo ? '<a class="btn" href="' + esc(demo) + '" target="_blank" rel="noopener">打开 demo <span aria-hidden="true">↗</span></a>' : '') +
        (p.source && p.source.href ? '<a class="btn ghost" href="' + esc(p.source.href) + '" target="_blank" rel="noopener">查看来源</a>' : '') +
      '</div>' +
      (metrics ? '<div class="d-sec">制作信息</div><dl class="d-metrics">' + metrics + '</dl>' : '') +
      '<div class="d-sec">标签</div><div class="tags" style="margin-bottom:16px">' +
        (p.tags || []).map(function (t) { return '<span>' + esc(t) + '</span>'; }).join('') + '</div>' +
      '<p class="d-credits">' + esc(p.credits || ('作品与提示词署名：' + authorName(p) + '。')) + '</p>';
  }

  function openDrawer(id, push) {
    var p = byId(id);
    if (!p) return;
    state.drawerId = id;
    state.promptLang = 'zh';
    var d = $('#drawer');
    state.lastFocus = document.activeElement;
    $('#dNo').textContent = p.no || '—';
    d.style.setProperty('--accent', p.accent || '#ffb347');
    $('#dBody').innerHTML = drawerHTML(p);
    $('#dBody').scrollTop = 0;
    d.classList.add('on');
    d.setAttribute('aria-hidden', 'false');
    $('#veil').classList.add('on');
    document.body.style.overflow = 'hidden';
    if (push !== false && history.replaceState) history.replaceState(null, '', '#/' + p.id);
  }

  function closeDrawer() {
    var d = $('#drawer');
    if (!d.classList.contains('on')) return;
    d.classList.remove('on');
    d.setAttribute('aria-hidden', 'true');
    $('#veil').classList.remove('on');
    document.body.style.overflow = '';
    state.drawerId = null;
    if (history.replaceState) history.replaceState(null, '', location.pathname + location.search);
    if (state.lastFocus && state.lastFocus.focus) state.lastFocus.focus();
  }

  /* ---------- 弹窗 ---------- */
  function openModal(id) {
    var m = document.getElementById(id);
    if (!m) return;
    m.classList.add('on');
    m.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    var first = m.querySelector('input, textarea, button');
    if (first) setTimeout(function () { first.focus(); }, 50);
  }

  function closeModal(id) {
    var m = document.getElementById(id);
    if (!m) return;
    m.classList.remove('on');
    m.setAttribute('aria-hidden', 'true');
    if (!$('.modal.on')) document.body.style.overflow = '';
  }

  function closeAll() {
    closeDrawer();
    $$('.modal.on').forEach(function (m) { closeModal(m.id); });
    $('#veil').classList.remove('on');
  }

  /* ---------- 复制 ---------- */
  function legacyCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:0;left:-9999px;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    document.body.removeChild(ta);
    return ok;
  }

  function copyPrompt(id) {
    var p = byId(id);
    if (!p) return;
    var text = promptOf(p, p.promptZh || !p.prompt ? 'zh' : 'zh');
    if (state.drawerId === id && p.prompt && p.promptZh) text = promptOf(p, state.promptLang);
    if (!text) { toast('这条作品的提示词还没填'); return; }
    var done = function () { toast('已复制提示词 · ' + text.length + ' 字'); };
    var fail = function () { toast(legacyCopy(text) ? '已复制提示词 · ' + text.length + ' 字' : '复制失败，请手动选择文本'); };
    if (navigator.clipboard && navigator.clipboard.writeText && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(done, fail);
    } else {
      fail();
    }
  }

  /* ---------- 登录 / 注册 ---------- */
  var authMode = 'login';

  function setAuthMode(mode) {
    authMode = mode;
    $('#authTitle').textContent = mode === 'login' ? '登录' : '注册';
    $('#authGo').textContent = mode === 'login' ? '登录' : '注册并登录';
    $('#authNote').textContent = mode === 'login'
      ? '登录后可投稿作品、查看自己的审核状态。'
      : '注册一个账号即可投稿；作品提交后由管理员审核通过才会公开。';
    $('#authSwap').textContent = mode === 'login' ? '注册一个' : '去登录';
  }

  function authError(msg) {
    var el = $('#authErr');
    el.textContent = msg || '';
    el.classList.toggle('on', !!msg);
  }

  function doAuth() {
    var username = $('#authUser').value.trim();
    var password = $('#authPass').value;
    authError('');
    if (username.length < 3) return authError('账号至少 3 个字符');
    if (password.length < 8) return authError('密码至少 8 位');
    var btn = $('#authGo');
    btn.disabled = true;
    api('/auth/' + (authMode === 'login' ? 'login' : 'register'), { method: 'POST', body: { username: username, password: password } })
      .then(function (data) {
        state.token = data.token;
        state.user = data.user;
        localStorage.setItem(TOKEN_KEY, data.token);
        renderShell();
        closeModal('authModal');
        toast(authMode === 'login' ? '已登录：' + state.user.username : '注册成功，已登录');
        loadCloud().catch(function () {});
      })
      .catch(function (err) { authError(err.message || '请求失败'); })
      .then(function () { btn.disabled = false; });
  }

  function logout() {
    state.user = null;
    state.token = null;
    localStorage.removeItem(TOKEN_KEY);
    var w = $('.tb-user');
    if (w) w.remove();
    if (!$('#btnLogin')) {
      var b = document.createElement('button');
      b.className = 'tb-link ghost';
      b.id = 'btnLogin';
      b.type = 'button';
      b.textContent = '登录';
      $('.tb-r').insertBefore(b, $('#btnSubmit'));
    }
    renderShell();
    toast('已退出登录');
  }

  /* ---------- 投稿 ---------- */
  function readFileText(file) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(String(r.result || '')); };
      r.onerror = reject;
      r.readAsText(file, 'utf-8');
    });
  }

  function readFileDataUrl(file) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(String(r.result || '')); };
      r.onerror = reject;
      r.readAsDataURL(file);
    });
  }

  function b64utf8(text) {
    return btoa(unescape(encodeURIComponent(text)));
  }

  function upErr(msg) {
    var el = $('#upErr');
    el.textContent = msg || '';
    el.classList.toggle('on', !!msg);
  }

  function submitProject() {
    upErr('');
    if (!state.user) { closeModal('uploadModal'); openModal('authModal'); toast('先登录再投稿'); return; }
    var title = $('#upTitle2').value.trim();
    var tagline = $('#upTagline').value.trim();
    var promptZh = $('#upPromptZh').value.trim();
    var prompt = $('#upPrompt').value.trim() || promptZh;
    var file = $('#upEntry').files[0];
    var cover = $('#upCover').files[0];
    if (title.length < 2) return upErr('标题至少 2 个字');
    if (tagline.length < 4) return upErr('请写一句话介绍');
    if (promptZh.length < 20) return upErr('提示词太短，至少 20 个字');
    if (!file) return upErr('请选择作品文件（单文件 index.html）');
    if (file.size > 3 * 1024 * 1024) return upErr('作品文件超过 3MB');

    var btn = $('#upGo');
    btn.disabled = true;
    btn.textContent = '提交中…';

    readFileText(file).then(function (text) {
      var payload = {
        title: title,
        tagline: tagline,
        type: $('#upType').value,
        tags: $('#upTags').value.split(/[,，]/).map(function (s) { return s.trim(); }).filter(Boolean).slice(0, 8),
        model: { name: $('#upModel').value.trim() || '未标注', vendor: $('#upVendor').value.trim() || '', short: '' },
        authorName: $('#upAuthor').value.trim() || state.user.username,
        prompt: prompt,
        promptZh: promptZh,
        entryHtml: b64utf8(text)
      };
      var src = $('#upSource').value.trim();
      if (src) payload.source = { label: src.replace(/^https?:\/\//, '').slice(0, 40), href: src };
      payload.model.short = payload.model.name.slice(0, 16);
      var coverTask = cover ? readFileDataUrl(cover) : Promise.resolve('');
      return coverTask.then(function (dataUrl) {
        if (dataUrl) payload.coverDataUrl = dataUrl;
        return api('/projects', { method: 'POST', body: payload });
      });
    }).then(function () {
      closeModal('uploadModal');
      UP_RESET();
      toast('已提交，等待管理员审核');
    }).catch(function (err) {
      upErr(err.message || '提交失败');
    }).then(function () {
      btn.disabled = false;
      btn.textContent = '提交审核';
    });
  }

  function UP_RESET() {
    ['upTitle2', 'upTagline', 'upPromptZh', 'upPrompt', 'upTags', 'upModel', 'upVendor', 'upAuthor', 'upSource', 'upEntry', 'upCover'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.value = '';
    });
    upErr('');
  }

  /* ---------- 我的投稿 ---------- */
  function openMine() {
    openModal('mineModal');
    var body = $('#mineBody');
    body.innerHTML = '<p class="modal-note">加载中…</p>';
    api('/me/projects').then(function (data) {
      var items = (data && data.items) || [];
      if (!items.length) { body.innerHTML = '<p class="modal-note">还没有投稿。点右上角「投稿」上传你的第一个作品。</p>'; return; }
      body.innerHTML = items.map(function (p) {
        return '<div class="mine-item">' +
          (p.cover ? '<img src="' + esc(p.cover) + '" alt="">' : '') +
          '<div class="mine-main"><h4>' + esc(p.title) + '</h4>' +
            '<p>' + esc(p.tagline) + '</p>' +
            '<p>' + esc(new Date(p.createdAt).toLocaleString('zh-CN')) + (p.reviewNote ? ' · 驳回原因：' + esc(p.reviewNote) : '') + '</p>' +
          '</div>' +
          '<span class="st ' + esc(p.status || 'pending') + '">' + esc(STATUS_LABEL[p.status] || p.status) + '</span>' +
        '</div>';
      }).join('');
    }).catch(function (err) {
      body.innerHTML = '<p class="modal-err on">' + esc(err.message || '加载失败') + '</p>';
    });
  }

  /* ---------- 事件 ---------- */
  function bind() {
    document.addEventListener('click', function (e) {
      var copyBtn = e.target.closest('[data-copy]');
      if (copyBtn) { e.preventDefault(); copyPrompt(copyBtn.getAttribute('data-copy')); return; }

      var openBtn = e.target.closest('[data-open]');
      if (openBtn) { e.preventDefault(); openDrawer(openBtn.getAttribute('data-open')); return; }

      var chipBtn = e.target.closest('.chip[data-group]');
      if (chipBtn) {
        state[chipBtn.getAttribute('data-group')] = chipBtn.getAttribute('data-value');
        renderChips(); renderGrid();
        return;
      }

      var plang = e.target.closest('[data-plang]');
      if (plang) {
        state.promptLang = plang.getAttribute('data-plang');
        var p = byId(state.drawerId);
        if (p) { $('#dBody').innerHTML = drawerHTML(p); }
        return;
      }

      var act = e.target.closest('[data-act="submit"]');
      if (act) {
        if (state.mode === 'static') { toast('当前是静态清单模式，云端服务未连接'); return; }
        if (state.user) openModal('uploadModal'); else { openModal('authModal'); toast('先登录再投稿'); }
        return;
      }

      var cardEl = e.target.closest('.card');
      if (cardEl && !e.target.closest('a,button') && cardEl.getAttribute('data-id')) {
        openDrawer(cardEl.getAttribute('data-id')); return;
      }

      if (e.target.id === 'veil' || e.target.id === 'dClose') closeDrawer();
      var closer = e.target.closest('[data-close]');
      if (closer) closeModal(closer.getAttribute('data-close'));

      if (e.target.id === 'btnLogin') {
        if (state.mode === 'static') { toast('当前是静态清单模式，云端服务未连接'); return; }
        setAuthMode('login'); openModal('authModal');
      }
      if (e.target.id === 'btnSubmit') {
        if (state.mode === 'static') { toast('当前是静态清单模式，云端服务未连接'); return; }
        if (state.user) openModal('uploadModal'); else { setAuthMode('login'); openModal('authModal'); toast('先登录再投稿'); }
      }
      if (e.target.id === 'btnMine') openMine();
      if (e.target.id === 'btnLogout') logout();
      if (e.target.id === 'authGo') doAuth();
      if (e.target.id === 'authSwap') setAuthMode(authMode === 'login' ? 'register' : 'login');
      if (e.target.id === 'upGo') submitProject();
    });

    var q = $('#q');
    q.addEventListener('input', function () { state.q = norm(q.value).trim(); renderGrid(); });

    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { closeAll(); return; }
      if (e.key === '/' && document.activeElement !== q && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) {
        e.preventDefault(); q.focus(); q.select();
      }
      if (e.key === 'Enter' && document.getElementById('authModal').classList.contains('on')) doAuth();
    });

    window.addEventListener('hashchange', function () {
      var m = /^#\/(.+)$/.exec(location.hash);
      if (m) openDrawer(decodeURIComponent(m[1]), false); else closeDrawer();
    });
  }

  boot();
})();
