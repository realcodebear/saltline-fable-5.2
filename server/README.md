# 提示词市集 · API 服务端

零第三方依赖的 Node 服务：静态托管仓库根目录、作品投稿与审核、管理员 SSE 事件流与 webhook 推送。
只使用 Node 内置模块（`node:http` / `node:crypto` / `node:fs/promises` / `node:path` / `node:url`），Node **>= 18**。

## 快速开始

```sh
# 在仓库根目录
node server/server.mjs
```

- 站点：http://localhost:8790/market/ （市集）、http://localhost:8790/ （Saltline 游戏）
- 接口：http://localhost:8790/api/health
- 首次启动会建库、建管理员。没配 `ADMIN_PASSWORD` 时会随机生成，
  写在 `server/data/logs/admin-init.txt`（读到后请改配置并删除该文件）。

推荐启动方式（显式给管理员密码）：

```sh
# Windows PowerShell
$env:ADMIN_USER="admin"; $env:ADMIN_PASSWORD="换成你的强密码"; node server/server.mjs

# Linux / macOS
ADMIN_USER=admin ADMIN_PASSWORD='换成你的强密码' node server/server.mjs
```

自测（起临时实例、跑完整链路、退出即清理）：

```sh
node server/scripts/smoke.mjs
```

## 命令行参数

| 参数 | 说明 | 默认 |
| --- | --- | --- |
| `--port <端口>` | 监听端口（也可用 `PORT`） | 8790 |
| `--host <地址>` | 监听地址（也可用 `HOST`） | 0.0.0.0 |
| `--root <目录>` | 静态根目录（也可用 `STATIC_ROOT`） | 仓库根目录 |
| `--data <目录>` | 数据目录（也可用 `DATA_DIR`） | `server/data` |
| `--config <文件>` | 配置文件路径 | `server/config.json` |
| `--help` | 打印用法 | — |

## 环境变量

| 变量 | 说明 |
| --- | --- |
| `PORT` | 端口，默认 8790 |
| `HOST` | 监听地址，默认 0.0.0.0；反代场景建议 127.0.0.1 |
| `ADMIN_USER` | 初始管理员用户名（库里没有 admin 时创建） |
| `ADMIN_PASSWORD` | 初始管理员密码，至少 8 位；留空则随机生成 |
| `SECRET` | token 签名密钥（HMAC-SHA256）；留空自动生成到 `data/secret.key` |
| `WEBHOOK_URL` | 审核事件外推地址，留空关闭 |
| `SITE_NAME` | 站点名，默认「提示词市集」 |
| `ALLOW_ORIGIN` | CORS 允许来源，默认 `*` |
| `UPLOAD_MAX_MB` | 上传体积上限（MB），默认 3 |
| `STATIC_ROOT` / `DATA_DIR` | 静态根 / 数据目录 |

配置文件：`cp server/config.example.json server/config.json` 后按需修改；
**环境变量优先级高于配置文件**。`config.json` 已加入 `.gitignore`。

## 目录说明

```
server/
├── server.mjs              # 入口：路由、静态托管、启动编排
├── lib/
│   ├── http.mjs            # 请求解析、JSON 响应、静态文件、CORS、限流、路径穿越防护
│   ├── auth.mjs            # scrypt 密码哈希 + HMAC-SHA256 自签 token
│   ├── db.mjs              # JSON 原子存储（tmp + rename）、结构迁移、密钥持久化
│   ├── projects.mjs        # 作品业务：校验、落盘、检索、审核、统计
│   └── push.mjs            # SSE 广播中心 + 外部 webhook 推送
├── scripts/smoke.mjs       # 全链路自测
├── deploy/                 # nginx / systemd / Dockerfile
├── config.example.json     # 配置样例
├── .env.example            # 环境变量样例
└── data/                   # 运行时数据（已 gitignore）
    ├── db.json             # 用户 + 作品
    ├── secret.key          # token 密钥
    ├── uploads/<id>/       # 投稿产物：index.html、cover.png|jpg|webp
    └── logs/
        ├── audit.log       # 审核事件 JSONL
        └── admin-init.txt  # 自动生成的管理员密码（只生成一次）
```

## 接口一览

统一前缀 `/api`，返回 JSON。错误体固定为 `{ "error": { "code": "...", "message": "中文说明" } }`。
鉴权头：`Authorization: Bearer <token>`；token 自签 HMAC-SHA256，有效期 7 天。

### 账号

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/auth/register` | `{username,password}` → `{token,user}`；用户名 3-24 字符，密码 ≥8 位 |
| POST | `/api/auth/login` | `{username,password}` → `{token,user}` |
| GET | `/api/auth/me` | 需登录 → `{user}` |

### 作品

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/projects?q=&model=&type=&author=` | 公开列表，仅 `status=published` → `{items,total}` |
| GET | `/api/projects/:id` | 详情；未公开时仅作者本人或管理员可读 |
| POST | `/api/projects` | 需登录，提交投稿 → `{project}`，`status=pending` |
| GET | `/api/me/projects` | 需登录，我的全部投稿（含 pending/rejected/offline） |

投稿体：

```jsonc
{
  "title": "标题（<=60 字符）",
  "tagline": "一句话简介（<=120）",
  "taglineEn": "英文副标（可选）",
  "type": "game",
  "tags": ["canvas", "零依赖"],
  "accent": "#6ee7ff",
  "model": { "name": "Claude Fable 5.2", "vendor": "Anthropic", "short": "Fable 5.2" },
  "source": { "label": "原始提示词", "href": "https://example.com/p" },
  "authorName": "展示用作者名（可选）",
  "prompt": "提示词正文（<=20000 字符）",
  "promptZh": "中文提示词（可选）",
  "metrics": [{ "k": "构建", "v": "1 轮提示" }],
  "entryHtml": "base64 的 index.html（解码后 <=3MB）",
  "coverDataUrl": "data:image/png;base64,...（<=1.5MB，png/jpeg/webp）"
}
```

产物落到 `data/uploads/<id>/`，返回 `demo=/uploads/<id>/index.html`、`cover=/uploads/<id>/cover.<ext>`。

### 管理端（role=admin）

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/admin/queue` | 待审队列，按 createdAt 升序 |
| GET | `/api/admin/projects?status=all\|pending\|published\|rejected\|offline` | 全量列表 |
| POST | `/api/admin/projects/:id/review` | `{decision:"approve"\|"reject", note?}` |
| POST | `/api/admin/projects/:id/status` | `{status:"published"\|"offline"}` |
| GET | `/api/admin/stats` | `{pending,published,offline,rejected,users,today}`（today = 今日新增投稿） |
| GET | `/api/admin/events` | SSE 事件流，token 可用 `?token=` 或请求头 |

### 其它

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | 免鉴权探测：`{ok,name,version,time,counts:{pending,published,users}}` |

静态托管：`/` 与 `/market/**` 直接来自仓库根目录（同域，无 CORS 问题）；
`/uploads/**` 来自 `data/uploads`；`/server/**` 与隐藏路径不对外暴露。

## 事件与推送

审核 / 上架 / 下架都会做三件事：

1. SSE 广播给所有管理员连接：
   `data: {"type":"project.pending|project.published|project.rejected|project.offline","project":{...},"at":1700000000}`
   心跳：每 25 秒一行 `: ping`。
2. 追加 `data/logs/audit.log`（JSONL，含操作人、备注、当时在线的 SSE 连接数）。
3. 配了 `WEBHOOK_URL` 时 POST `{title,text,event,project,at}`，兼容企业微信 / 钉钉 / Server酱 的 `text` 字段。

前端订阅示例：

```js
const es = new EventSource('/api/admin/events?token=' + encodeURIComponent(token));
es.onmessage = (e) => {
  const payload = JSON.parse(e.data);
  if (payload.type === 'project.published') refreshQueue();
};
```

## 安全与限制

- 密码：`scrypt(N=16384,r=8,p=1)` + 16 字节随机盐，存 `scrypt$N$r$p$salt$hash`。
- token：`header.payload.sig`，base64url + HMAC-SHA256，载荷含 `sub/role/exp`，7 天过期。
- 限流：登录 / 注册每 IP 每 10 分钟 20 次；投稿每用户每小时 10 次 → 429 + `Retry-After`。
- 体积：JSON body 上限 6MB；`entryHtml` 解码后 ≤3MB；封面 ≤1.5MB 且仅 png/jpeg/webp。
- 路径穿越：所有静态请求解析后必须落在根目录内，`..`、`%2e%2e`、`\0` 一律拒绝。
- 管理接口：`role` 不等于 `admin` 直接 403；SSE 支持 query token，仅该接口。

## 备份与迁移

数据全在 `server/data/`（或 `--data` 指定目录）：

```sh
# 热备份：db.json 是 tmp+rename 原子写，直接复制不会读到半个文件
tar czf market-$(date +%F).tar.gz -C server data

# 恢复
tar xzf market-2026-11-13.tar.gz -C server
```

`data/secret.key` 决定 token 签名，换机器时一起带走，否则所有人都要重新登录。
库结构带 `version` 字段，启动时自动做向前兼容迁移（补默认字段、补缺失的 `files`/`status`）。

## 部署

```sh
# nginx 反代（同一台机器，Node 只监听 127.0.0.1:8790）
sudo cp server/deploy/nginx.conf /etc/nginx/conf.d/market.conf
sudo nginx -t && sudo systemctl reload nginx

# systemd
sudo cp server/deploy/market.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now market
sudo journalctl -u market -f

# Docker（构建上下文是仓库根目录，静态文件要一起打进去）
docker build -f server/deploy/Dockerfile -t market-api .
docker run -d --name market -p 8790:8790 \
  -e ADMIN_USER=admin -e ADMIN_PASSWORD='换成你的强密码' \
  -v market-data:/data market-api
```

## 常见问题

**Q：启动后 `/market/` 404？**
静态根默认是仓库根目录（`server/` 的上一级）。用 `--root` 指到含 `market/` 的目录。

**Q：忘了管理员密码？**
两种办法：① 停服后删掉 `data/db.json` 里该用户，重启让 `ADMIN_USER/ADMIN_PASSWORD` 重新建；
② 临时改 `ADMIN_USER` 换个新名字启动，会自动追加一个管理员。

**Q：SSE 连不上 / 事件延迟？**
反代必须关缓冲：`proxy_buffering off`、`proxy_cache off`、`gzip off`、`proxy_read_timeout` 拉长。
Nginx 默认 60 秒断流，本服务的 25 秒心跳能保活；若前面还有 CDN，同样要关缓冲。

**Q：投稿报 `file_too_large`？**
`entryHtml` 解码后超过 3MB 或封面超过 1.5MB。压缩封面、拆掉内嵌字体/纹理再传；
确需放宽时改 `UPLOAD_MAX_MB`（硬上限仍是 3MB / 1.5MB 按契约）。

**Q：token 换机器后全部失效？**
`data/secret.key` 没跟着迁移。带上它，或显式设 `SECRET` 固定密钥。

**Q：数据库坏了怎么办？**
启动会报「数据库文件已损坏」。恢复到最近备份即可；`data/uploads/` 里的产物不受影响。
