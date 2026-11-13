// lib/projects.mjs —— 作品业务：校验、落盘、查询、审核、统计
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { HttpError } from './http.mjs';
import { newId } from './db.mjs';

export const MAX_ENTRY_BYTES = 3 * 1024 * 1024;
export const MAX_COVER_BYTES = 1.5 * 1024 * 1024;

export const COVER_TYPES = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

export const LIMITS = {
  title: 60,
  tagline: 120,
  taglineEn: 120,
  prompt: 20000,
  promptZh: 20000,
  type: 24,
  tag: 24,
  tags: 12,
  metricKey: 24,
  metricValue: 40,
  metrics: 8,
  authorName: 24,
  sourceLabel: 40,
  sourceHref: 500,
  modelName: 40,
  modelVendor: 24,
  modelShort: 16,
  accent: 9,
};

export const STATUSES = ['pending', 'published', 'rejected', 'offline'];

export const EVENT_TYPES = {
  pending: 'project.pending',
  published: 'project.published',
  rejected: 'project.rejected',
  offline: 'project.offline',
};

const ACCENT_RE = /^#[0-9a-fA-F]{3,8}$/;
const HREF_RE = /^(https?:\/\/|\/)[^\s]*$/;

function text(value, field, options) {
  const opts = options || {};
  if (value === undefined || value === null || value === '') {
    if (opts.required) throw new HttpError(400, 'missing_field', '缺少必填字段：' + field);
    return opts.fallback === undefined ? '' : opts.fallback;
  }
  if (typeof value !== 'string') throw new HttpError(400, 'invalid_field', '字段 ' + field + ' 必须是字符串');
  const trimmed = value.trim();
  if (!trimmed) {
    if (opts.required) throw new HttpError(400, 'missing_field', '缺少必填字段：' + field);
    return opts.fallback === undefined ? '' : opts.fallback;
  }
  const max = opts.max || 200;
  if (Array.from(trimmed).length > max) {
    throw new HttpError(400, 'field_too_long', '字段 ' + field + ' 超过长度上限（最多 ' + max + ' 个字符）');
  }
  return trimmed;
}

function optionalText(value, field, max) {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw new HttpError(400, 'invalid_field', '字段 ' + field + ' 必须是字符串');
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (Array.from(trimmed).length > max) {
    throw new HttpError(400, 'field_too_long', '字段 ' + field + ' 超过长度上限（最多 ' + max + ' 个字符）');
  }
  return trimmed;
}

function decodeBase64(value, field, maxBytes, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new HttpError(400, 'missing_field', '缺少必填字段：' + field);
  }
  const cleaned = value.replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/=_-]+$/.test(cleaned)) {
    throw new HttpError(400, 'invalid_base64', '字段 ' + field + ' 不是合法的 base64 数据');
  }
  const buf = Buffer.from(cleaned, 'base64');
  if (buf.length === 0) {
    throw new HttpError(400, 'invalid_base64', '字段 ' + field + ' 解码后为空');
  }
  if (buf.length > maxBytes) {
    throw new HttpError(413, 'file_too_large', label + '体积超过上限（最大 ' + Math.round(maxBytes / 1024 / 1024 * 10) / 10 + ' MB）');
  }
  return buf;
}

function parseCover(dataUrl, maxBytes) {
  if (dataUrl === undefined || dataUrl === null || dataUrl === '') return null;
  if (typeof dataUrl !== 'string') throw new HttpError(400, 'invalid_cover', '封面必须是 data URL 字符串');
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=\s]+)$/.exec(dataUrl.trim());
  if (!match) {
    throw new HttpError(400, 'invalid_cover', '封面仅支持 image/png、image/jpeg、image/webp 的 base64 data URL');
  }
  const mime = match[1];
  const buf = Buffer.from(match[2].replace(/\s+/g, ''), 'base64');
  if (buf.length === 0) throw new HttpError(400, 'invalid_cover', '封面数据解码后为空');
  if (buf.length > maxBytes) {
    throw new HttpError(413, 'cover_too_large', '封面体积超过上限（最大 ' + Math.round(maxBytes / 1024 / 1024 * 100) / 100 + ' MB）');
  }
  return { mime: mime, ext: COVER_TYPES[mime], buffer: buf };
}

function normalizeTags(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new HttpError(400, 'invalid_tags', 'tags 必须是字符串数组');
  if (value.length > LIMITS.tags) {
    throw new HttpError(400, 'invalid_tags', '标签最多 ' + LIMITS.tags + ' 个');
  }
  const out = [];
  for (const raw of value) {
    if (typeof raw !== 'string') throw new HttpError(400, 'invalid_tags', 'tags 必须是字符串数组');
    const tag = raw.trim();
    if (!tag) continue;
    if (Array.from(tag).length > LIMITS.tag) {
      throw new HttpError(400, 'invalid_tags', '单个标签最多 ' + LIMITS.tag + ' 个字符');
    }
    if (out.indexOf(tag) < 0) out.push(tag);
  }
  return out;
}

function normalizeMetrics(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw new HttpError(400, 'invalid_metrics', 'metrics 必须是 {k,v} 数组');
  if (value.length > LIMITS.metrics) {
    throw new HttpError(400, 'invalid_metrics', 'metrics 最多 ' + LIMITS.metrics + ' 项');
  }
  const out = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') throw new HttpError(400, 'invalid_metrics', 'metrics 每项必须是 {k,v} 对象');
    const k = text(raw.k, 'metrics.k', { required: true, max: LIMITS.metricKey });
    const v = text(raw.v, 'metrics.v', { required: true, max: LIMITS.metricValue });
    out.push({ k: k, v: v });
  }
  return out;
}

function normalizeModel(value) {
  if (!value || typeof value !== 'object') {
    throw new HttpError(400, 'invalid_model', '缺少模型信息 model{name,vendor,short}');
  }
  return {
    name: text(value.name, 'model.name', { required: true, max: LIMITS.modelName }),
    vendor: optionalText(value.vendor, 'model.vendor', LIMITS.modelVendor),
    short: optionalText(value.short, 'model.short', LIMITS.modelShort),
  };
}

function normalizeSource(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'object') throw new HttpError(400, 'invalid_source', 'source 必须是 {label,href} 对象或空');
  const label = optionalText(value.label, 'source.label', LIMITS.sourceLabel);
  const href = optionalText(value.href, 'source.href', LIMITS.sourceHref);
  if (!label && !href) return null;
  if (!href) throw new HttpError(400, 'invalid_source', 'source.href 不能为空');
  if (!HREF_RE.test(href)) throw new HttpError(400, 'invalid_source', 'source.href 只允许 http(s) 链接或站内路径');
  return { label: label || '来源', href: href };
}

function normalizeAccent(value) {
  const accent = optionalText(value, 'accent', LIMITS.accent);
  if (!accent) return '#6ee7ff';
  if (!ACCENT_RE.test(accent)) throw new HttpError(400, 'invalid_accent', 'accent 必须是合法的十六进制颜色，如 #6ee7ff');
  return accent;
}

// 创建投稿：校验 -> 写文件 -> 落库记录（返回 project，status=pending）
export async function createProject(options) {
  const store = options.store;
  const user = options.user;
  const body = options.body || {};
  const entryMax = options.entryMaxBytes || MAX_ENTRY_BYTES;
  const coverMax = options.coverMaxBytes || MAX_COVER_BYTES;

  const payload = {
    title: text(body.title, 'title', { required: true, max: LIMITS.title }),
    tagline: text(body.tagline, 'tagline', { required: true, max: LIMITS.tagline }),
    taglineEn: optionalText(body.taglineEn, 'taglineEn', LIMITS.taglineEn),
    type: text(body.type, 'type', { required: true, max: LIMITS.type }),
    tags: normalizeTags(body.tags),
    accent: normalizeAccent(body.accent),
    model: normalizeModel(body.model),
    source: normalizeSource(body.source),
    prompt: text(body.prompt, 'prompt', { required: true, max: LIMITS.prompt }),
    promptZh: optionalText(body.promptZh, 'promptZh', LIMITS.promptZh),
    metrics: normalizeMetrics(body.metrics),
  };
  const authorName = optionalText(body.authorName, 'authorName', LIMITS.authorName) || user.username;

  const entryBuffer = decodeBase64(body.entryHtml, 'entryHtml', entryMax, '作品入口 HTML');
  const entryText = entryBuffer.toString('utf8');
  if (entryText.indexOf('<') < 0) {
    throw new HttpError(400, 'invalid_entry', 'entryHtml 解码后不是 HTML 内容');
  }
  const cover = parseCover(body.coverDataUrl, coverMax);

  const id = newId('p');
  const dir = join(store.uploadsDir, id);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'index.html'), entryBuffer);
  let coverPath = '';
  if (cover) {
    const fileName = 'cover.' + cover.ext;
    await writeFile(join(dir, fileName), cover.buffer);
    coverPath = '/uploads/' + id + '/' + fileName;
  }

  const now = new Date().toISOString();
  const project = {
    id: id,
    title: payload.title,
    tagline: payload.tagline,
    taglineEn: payload.taglineEn,
    type: payload.type,
    tags: payload.tags,
    accent: payload.accent,
    model: payload.model,
    source: payload.source,
    author: { id: user.id, name: authorName },
    cover: coverPath,
    demo: '/uploads/' + id + '/index.html',
    prompt: payload.prompt,
    promptZh: payload.promptZh,
    metrics: payload.metrics,
    status: 'pending',
    note: '',
    reviewNote: '',
    createdAt: now,
    updatedAt: now,
    files: {
      entry: 'data/uploads/' + id + '/index.html',
      dir: 'data/uploads/' + id + '/',
    },
    ownerId: user.id,
  };
  store.data.projects.push(project);
  await store.save();
  return project;
}

// 对外展示的对象（去掉密码、内部字段），reviewNote 与 note 同步
export function projectView(project) {
  if (!project) return null;
  return {
    id: project.id,
    title: project.title,
    tagline: project.tagline,
    taglineEn: project.taglineEn || '',
    type: project.type,
    tags: Array.isArray(project.tags) ? project.tags.slice() : [],
    accent: project.accent || '#6ee7ff',
    model: {
      name: project.model && project.model.name ? project.model.name : '',
      vendor: project.model && project.model.vendor ? project.model.vendor : '',
      short: project.model && project.model.short ? project.model.short : '',
    },
    source: project.source || null,
    author: {
      id: project.author && project.author.id ? project.author.id : '',
      name: project.author && project.author.name ? project.author.name : '',
    },
    cover: project.cover || '',
    demo: project.demo || '',
    prompt: project.prompt || '',
    promptZh: project.promptZh || '',
    metrics: Array.isArray(project.metrics) ? project.metrics.map(function (m) { return { k: m.k, v: m.v }; }) : [],
    status: project.status,
    note: project.note || '',
    reviewNote: project.note ? project.note : null,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    files: {
      entry: project.files && project.files.entry ? project.files.entry : '',
      dir: project.files && project.files.dir ? project.files.dir : '',
    },
  };
}

export function findProject(store, id) {
  for (const project of store.data.projects) {
    if (project.id === id) return project;
  }
  return null;
}

function haystack(project) {
  const parts = [
    project.title,
    project.tagline,
    project.taglineEn,
    project.type,
    project.prompt,
    project.promptZh,
    project.author && project.author.name,
    project.model && project.model.name,
    project.model && project.model.vendor,
    project.model && project.model.short,
    Array.isArray(project.tags) ? project.tags.join(' ') : '',
  ];
  return parts.filter(Boolean).join(' ').toLowerCase();
}

// 公开列表：仅 published
export function listPublic(store, query) {
  const q = (query.q || '').trim().toLowerCase();
  const model = (query.model || '').trim().toLowerCase();
  const type = (query.type || '').trim().toLowerCase();
  const author = (query.author || '').trim().toLowerCase();

  const items = store.data.projects.filter(function (project) {
    if (project.status !== 'published') return false;
    if (type && String(project.type || '').toLowerCase() !== type) return false;
    if (author) {
      const id = String(project.author && project.author.id || '').toLowerCase();
      const name = String(project.author && project.author.name || '').toLowerCase();
      if (id !== author && name !== author) return false;
    }
    if (model) {
      const names = [
        project.model && project.model.name,
        project.model && project.model.vendor,
        project.model && project.model.short,
      ].filter(Boolean).map(function (s) { return String(s).toLowerCase(); });
      let hit = false;
      for (const candidate of names) {
        if (candidate === model || candidate.indexOf(model) >= 0 || model.indexOf(candidate) >= 0) { hit = true; break; }
      }
      if (!hit) return false;
    }
    if (q && haystack(project).indexOf(q) < 0) return false;
    return true;
  });

  items.sort(function (a, b) {
    return a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0;
  });
  return items.map(projectView);
}

export function listByAuthor(store, userId) {
  const items = store.data.projects.filter(function (project) {
    return project.ownerId === userId || (project.author && project.author.id === userId);
  });
  items.sort(function (a, b) {
    return a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0;
  });
  return items.map(projectView);
}

export function listAdmin(store, status) {
  const filter = status && status !== 'all' ? status : '';
  const items = store.data.projects.filter(function (project) {
    if (!filter) return true;
    return project.status === filter;
  });
  items.sort(function (a, b) {
    return a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0;
  });
  return items.map(projectView);
}

export function queue(store) {
  const items = store.data.projects.filter(function (project) {
    return project.status === 'pending';
  });
  items.sort(function (a, b) {
    return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
  });
  return items.map(projectView);
}

function localDateKey(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = function (n) { return n < 10 ? '0' + n : String(n); };
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}

export function statsOf(store) {
  const counts = { pending: 0, published: 0, offline: 0, rejected: 0, users: store.data.users.length, today: 0 };
  const todayKey = localDateKey(new Date().toISOString());
  for (const project of store.data.projects) {
    if (counts[project.status] === undefined) counts.pending += 1;
    else counts[project.status] += 1;
    if (localDateKey(project.createdAt) === todayKey) counts.today += 1;
  }
  return counts;
}

// 审核：approve -> published，reject -> rejected
export function reviewProject(store, project, decision, note, actor) {
  if (decision !== 'approve' && decision !== 'reject') {
    throw new HttpError(400, 'invalid_decision', 'decision 只能取 approve 或 reject');
  }
  if (project.status === 'offline') {
    throw new HttpError(409, 'invalid_state', '该作品已下架，无法审核');
  }
  const text0 = typeof note === 'string' ? note.trim() : '';
  if (Array.from(text0).length > 500) {
    throw new HttpError(400, 'note_too_long', '审核备注最多 500 个字符');
  }
  const now = new Date().toISOString();
  if (decision === 'approve') {
    project.status = 'published';
    project.note = '';
  } else {
    project.status = 'rejected';
    project.note = text0 || '未通过审核';
  }
  project.reviewNote = project.note;
  project.updatedAt = now;
  project.reviewedBy = actor ? actor.id : '';
  project.reviewedAt = now;
  return { project: project, eventType: decision === 'approve' ? EVENT_TYPES.published : EVENT_TYPES.rejected };
}

// 上架 / 下架
export function setStatus(store, project, status) {
  if (status !== 'published' && status !== 'offline') {
    throw new HttpError(400, 'invalid_status', 'status 只能取 published 或 offline');
  }
  const now = new Date().toISOString();
  project.status = status;
  project.updatedAt = now;
  if (status === 'offline') project.note = project.note || '';
  return { project: project, eventType: status === 'published' ? EVENT_TYPES.published : EVENT_TYPES.offline };
}
