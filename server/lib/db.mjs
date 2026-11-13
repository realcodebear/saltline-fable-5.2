// lib/db.mjs —— JSON 原子存储 + 结构迁移
import { appendFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { HttpError } from './http.mjs';
import { hashPassword, validatePassword, validateUsername } from './auth.mjs';

export const SCHEMA_VERSION = 1;

export function emptyDb() {
  return {
    version: SCHEMA_VERSION,
    users: [],
    projects: [],
    meta: { createdAt: new Date().toISOString() },
  };
}

export function newId(prefix) {
  return prefix + '_' + Date.now().toString(36) + randomBytes(5).toString('hex');
}

async function atomicWrite(targetPath, text) {
  const tmpPath = targetPath + '.' + process.pid + '.' + randomBytes(4).toString('hex') + '.tmp';
  await writeFile(tmpPath, text, 'utf8');
  await rename(tmpPath, targetPath);
}

export function migrate(input) {
  const source = input && typeof input === 'object' ? input : {};
  const data = Object.assign(emptyDb(), source);
  if (!Array.isArray(data.users)) data.users = [];
  if (!Array.isArray(data.projects)) data.projects = [];
  if (!data.meta || typeof data.meta !== 'object') data.meta = { createdAt: new Date().toISOString() };
  for (const user of data.users) {
    if (!user.role) user.role = 'user';
    if (!user.createdAt) user.createdAt = new Date().toISOString();
  }
  for (const project of data.projects) {
    if (!Array.isArray(project.tags)) project.tags = [];
    if (!Array.isArray(project.metrics)) project.metrics = [];
    if (!project.files || typeof project.files !== 'object') {
      project.files = {
        entry: 'data/uploads/' + project.id + '/index.html',
        dir: 'data/uploads/' + project.id + '/',
      };
    }
    if (typeof project.note !== 'string') project.note = '';
    if (typeof project.reviewNote !== 'string') project.reviewNote = project.note || '';
    if (typeof project.status !== 'string') project.status = 'published';
  }
  data.version = SCHEMA_VERSION;
  return data;
}

export class Store {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.dbPath = join(dataDir, 'db.json');
    this.uploadsDir = join(dataDir, 'uploads');
    this.logsDir = join(dataDir, 'logs');
    this.auditPath = join(this.logsDir, 'audit.log');
    this.data = emptyDb();
    this.writeChain = Promise.resolve();
  }

  async init() {
    await mkdir(this.dataDir, { recursive: true });
    await mkdir(this.uploadsDir, { recursive: true });
    await mkdir(this.logsDir, { recursive: true });
    let raw = null;
    try {
      raw = await readFile(this.dbPath, 'utf8');
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
    if (raw === null) {
      this.data = emptyDb();
      await this.save();
      return { fresh: true };
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new Error('数据库文件已损坏，无法解析 JSON：' + err.message);
    }
    this.data = migrate(parsed);
    return { fresh: false };
  }

  // 原子写：先写临时文件再 rename，串行化避免互相覆盖
  save() {
    const text = JSON.stringify(this.data, null, 2);
    const target = this.dbPath;
    this.writeChain = this.writeChain.then(function () {
      return atomicWrite(target, text);
    }).catch(function (err) {
      console.error('[db] 数据库写入失败：' + err.message);
    });
    return this.writeChain;
  }

  async appendAudit(entry) {
    try {
      await appendFile(this.auditPath, JSON.stringify(entry) + '\n', 'utf8');
    } catch (err) {
      console.error('[audit] 审计日志写入失败：' + err.message);
    }
  }

  findUserByName(name) {
    if (typeof name !== 'string') return null;
    const key = name.trim().toLowerCase();
    for (const user of this.data.users) {
      if (String(user.username).toLowerCase() === key) return user;
    }
    return null;
  }

  findUserById(id) {
    if (typeof id !== 'string') return null;
    for (const user of this.data.users) {
      if (user.id === id) return user;
    }
    return null;
  }

  async createUser(input) {
    const username = validateUsername(input.username);
    const password = validatePassword(input.password);
    if (this.findUserByName(username)) {
      throw new HttpError(409, 'username_taken', '该用户名已被占用');
    }
    const user = {
      id: newId('u'),
      username: username,
      role: input.role === 'admin' ? 'admin' : 'user',
      createdAt: new Date().toISOString(),
      passwordHash: await hashPassword(password),
    };
    this.data.users.push(user);
    return user;
  }
}

// 进程内共享密钥：优先环境变量，其次 data/secret.key（自动生成并持久化）
export async function loadOrCreateSecret(dataDir, fromEnv) {
  if (fromEnv && String(fromEnv).length >= 16) return String(fromEnv);
  const path = join(dataDir, 'secret.key');
  try {
    const existing = (await readFile(path, 'utf8')).trim();
    if (existing.length >= 32) return existing;
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  const secret = randomBytes(32).toString('hex');
  await writeFile(path, secret + '\n', { encoding: 'utf8', mode: 0o600 });
  return secret;
}
