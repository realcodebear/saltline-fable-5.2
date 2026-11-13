# Saltline · 提示词市集（国内版）

一个跑在浏览器里的雨夜港口第一人称射击游戏，外加一个用提示词作品串起来的市集：每条作品都能看到**原封不动的提示词**、**作者与来源署名**、**做出它的原生模型**，以及挂在静态资源或云端上传目录上的**在线 demo**。

市集带完整后台：云端注册登录、用户投稿、管理端审核（通过/驳回）、上架下架统一走 API，审核事件通过 SSE + 浏览器通知 + 可选 webhook 实时推送。

## 目录

```
index.html              游戏本体（单文件，1.4 MB）
market/                 提示词市集（前台）
  index.html            市集页：筛选/搜索/详情抽屉/登录/投稿/我的投稿
  market.js             数据源切换（云端 API ⇄ 静态清单）、渲染、交互
  market.css            深色工业风样式（系统中文字体栈，零境外资源）
  data/projects.js      静态回退清单（4 条内置作品：提示词中英双版 + 署名）
  assets/covers/        封面图（SVG 海报 + 盐线实机截图 WebP）
  demos/<slug>/         三个自包含可玩 demo（含 PROMPT.md 中英提示词）
  admin/                管理端：审核队列、上下架、SSE 实时提醒、浏览器通知
server/                 API 服务端（零第三方依赖，Node >= 18）
  server.mjs            入口：路由 + 静态托管 + 管理员引导
  lib/                  auth / db / http / projects / push
  scripts/smoke.mjs     63 项端到端自测
  deploy/               nginx.conf / market.service / Dockerfile
  README.md             接口、环境变量、备份、常见问题（中文）
```

## 本地跑起来

```bash
# 1) 起 API + 静态站点（默认 0.0.0.0:8790，同时托管仓库根目录）
cd saltline-fable-5.2
ADMIN_USER=admin ADMIN_PASSWORD="换成你的密码" node server/server.mjs

# 2) 打开
#    游戏    http://127.0.0.1:8790/
#    市集    http://127.0.0.1:8790/market/
#    管理端  http://127.0.0.1:8790/market/admin/
```

首次启动会在 `server/data/` 建库并把 `ADMIN_USER` 建成管理员；不传密码会随机生成，写入 `server/data/logs/admin-init.txt`。

纯静态预览（没有后端时，市集自动回退到 `market/data/projects.js`，登录/投稿会提示"云端服务未连接"）：

```bash
python -m http.server 8731
# http://127.0.0.1:8731/market/
```

## 部署到国内服务器

最短路径（Linux + Nginx + systemd，详见 `server/README.md` 与 `server/deploy/`）：

```bash
git clone <你的仓库> /opt/saltline && cd /opt/saltline
cp server/.env.example server/.env      # 填 PORT / ADMIN_USER / ADMIN_PASSWORD / SECRET / WEBHOOK_URL
sudo cp server/deploy/market.service /etc/systemd/system/market.service
sudo cp server/deploy/nginx.conf /etc/nginx/conf.d/saltline.conf   # 改成你的域名，SSE 已关缓冲
sudo systemctl daemon-reload && sudo systemctl enable --now market
sudo nginx -t && sudo systemctl reload nginx
```

要点：

- 同域部署（Nginx 把 `/api` 反代到 `127.0.0.1:8790`，其余静态直出），前端不需要改任何地址。
- `location = /api/admin/events` 必须 `proxy_buffering off`，否则审核推送会积压；`nginx.conf` 已处理。
- 备案：国内公网域名需完成 ICP 备案；未备案可先用 IP + 端口或内网环境。
- 数据全在 `server/data/`（`db.json`、`secret.key`、`uploads/`），迁移整机一起带走；`secret.key` 换了会导致所有 token 失效。
- 备份：`tar czf backup.tgz server/data`，建议 cron 每日一次。

## 账号、投稿与审核

1. 用户在 `/market/` 右上角注册/登录（scrypt 密码 + HMAC 签名 token，7 天有效）。
2. 登录后点「投稿」：填标题、一句话、模型、提示词（中文必填，英文可选）、上传单文件 `index.html`（≤3 MB）与封面图（≤1.5 MB），提交进入 `pending`。
3. 管理端 `/market/admin/` 登录管理员账号：待审队列实时弹出（SSE），可预览 demo、读完整提示词，然后「通过并上架」或「驳回（可写原因）」。
4. 通过后立刻出现在首页与搜索；「下架」即时从公开列表消失，作者在「我的投稿」里能看到状态与驳回原因。
5. 推送：管理端开启桌面通知后，新投稿/上架都会弹系统通知；服务端同时写 `server/data/logs/audit.log`，配置 `webhook.url` 后还会往企业微信/钉钉/Server酱推一条消息。

## 接口速览

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/health` | 前端探测云端是否可用 |
| POST | `/api/auth/register`、`/api/auth/login` | 注册 / 登录 |
| GET | `/api/auth/me`、`/api/me/projects` | 当前用户 / 我的投稿 |
| GET | `/api/projects` | 公开作品列表（支持 q / model / type / author） |
| POST | `/api/projects` | 投稿（登录） |
| GET | `/api/admin/queue`、`/api/admin/stats` | 待审队列 / 统计（管理员） |
| POST | `/api/admin/projects/:id/review` | 通过或驳回 |
| POST | `/api/admin/projects/:id/status` | 上架 / 下架 |
| GET | `/api/admin/events` | SSE 事件流（审核推送） |

完整字段、错误码、限流规则见 `server/README.md`。

## 署名与来源

- **盐线 SALTLINE**：Claude Fable 5.2 在 Anthropic 的一次 run（Felix Rieseberg 设定并发布于 X，2026-11-09），单条提示词、约 8 小时、零人工反馈。原始可玩产物见 <https://claude.ai/artifact/BGY1SztrAYcJQHSsnHHGmp>；本仓库是它的可本地运行镜像，游戏代码与版权归原作者。
- **余烬奔跑 / 流光漂移 / 叠线**：本仓库自制，作者 YG，提示词与实现出自同一会话，各自目录下的 `PROMPT.md` 保留中英双版提示词。
- 每张卡片都会展示作者与来源链接；投稿表单里的署名默认取账号名，可改。

## 上游出处（原文保留）

> Built by **Claude Fable 5.2**. The run was set up by Felix Rieseberg (Anthropic) and shared on X on 2026-11-09.
> Per his post: one prompt, no human feedback, about 8 hours, about 2.7M output and 445M input tokens, about $550 at API pricing.
> All credit for the game goes to its original author. This repo is a mirror so people can run it locally.

## 变更记录

- 2026-11-13：新增提示词市集（前台 + 管理端 + API 服务端）；全站中文化；字体改为系统中文栈并异步加载境外字体；游戏标题屏新增「提示词市集」入口。
- 更早：镜像原始 artifact（移除 claude.ai 运行时脚本，补 doctype/charset/viewport）。

## 许可

游戏本体版权归原作者；市集与 `server/` 为本仓库新增内容。若要下架游戏本体，开 issue 即可。
