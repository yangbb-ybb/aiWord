# aiWord · End（后端）

> aiWord 项目说明（产品愿景 / 路线图 / 设计规范）见 [../front/README.md](../front/README.md)。

本目录是 **Fastify + TypeScript** 后端，包含：

- AI 路由（生成 / 改写 / 摘要 / 翻译），走 Anthropic 兼容协议，默认指向 **minimax** (`https://api.minimaxi.com/anthropic`)
- 文档 CRUD + 模板
- Markdown → `.docx` 导出（直接返回二进制下载）

---

## ⚠️ Node 版本要求

后端依赖 `@anthropic-ai/sdk` ≥ 0.30 / Fastify 5 等，**要求 Node ≥ 20**。

升级命令（如果装了 nvm）：

```bash
nvm install 20
nvm use 20
# 或者全局默认：
nvm alias default 20
```

> 可选：用 fnm 或 volta 都可以 —— 任何能在 `node -v` 返回 ≥ 20 的方式都行。

---

## 🚀 快速开始

```bash
# 1. 准备数据库（首次）
mysql -uroot -p -e "CREATE DATABASE aiword DEFAULT CHARSET utf8mb4;"

# 2. 复制 .env 并填值（特别要填 MINIMAX_API_KEY）
cp .env.example .env

# 3. 装依赖
npm install

# 4. 跑 migration 建表 + 写入种子模板
npm run db:migrate
npm run db:seed        # 可选 —— 注入 4 条常用模板

# 5. 启动
npm run dev
# → http://localhost:8787/health
```

> 用 `npm run db:push` 跳过 migration 直接同步 schema（仅用于 hack 阶段）。`npm run db:studio` 启 Drizzle Studio 可视化查看。

---

## 🧰 命令一览

| 脚本 | 作用 |
| --- | --- |
| `npm run dev` | `tsx watch` 跑 TypeScript，文件改动自动重启 |
| `npm run build` | `tsc` 编译到 `dist/` |
| `npm start` | `node dist/server.js` 跑生产构建 |
| `npm run typecheck` | `tsc --noEmit` 严格类型检查 |
| `npm run db:generate` | 根据 `src/db/schema.ts` 生成 SQL 迁移文件 |
| `npm run db:migrate` | 把 migration 应用到 MySQL |
| `npm run db:push` | 不走 migration 直接同步 schema |
| `npm run db:studio` | 打开 Drizzle Studio |

---

## 📁 目录速查

```
src/
├── server.ts           # 入口：建 app、连 DB、监听端口
├── app.ts              # Fastify 实例 + 插件注册 + 错误处理
├── config/env.ts       # 环境变量 zod 校验
├── db/
│   ├── index.ts        # mysql2 pool + drizzle
│   ├── schema.ts       # documents / templates / publish_jobs 三表
│   └── migrations/     # drizzle-kit 生成
├── providers/
│   ├── types.ts        # AIProvider 接口
│   ├── claude.ts       # Anthropic 兼容实现（承载 minimax）
│   └── index.ts        # 工厂：单例 + 模型解析
├── services/
│   ├── ai.ts           # 4 个 AI 业务方法 + tone/length/lang 映射
│   ├── documents.ts    # CRUD（含 excerpt 自动生成）
│   └── docx.ts         # markdown → .docx 转换
└── routes/
    ├── ai.ts           # /api/ai/*（SSE 流式）
    ├── documents.ts    # /api/documents
    ├── templates.ts    # /api/templates
    └── export.ts       # /api/export/docx
```

---

## 🔌 接口列表

### 健康检查

```http
GET /health
→ { "status": "ok", "provider": "https://api.minimaxi.com/anthropic" }
```

### AI 路由（SSE 流式）

所有 `/api/ai/*` 接口返回 `text/event-stream`，事件类型：

- `event: chunk` → `{ text: string }`（增量内容，可出现多次）
- `event: done` → `{ text: string, tokens: number }`（完整结果，结尾各发一次）
- `event: error` → `{ message: string }`（出错时）

接口：

| 路径 | 方法 | 入参 |
| --- | --- | --- |
| `/api/ai/generate` | POST | `{ prompt, model?, tone?, length?, language?, contextText? }` |
| `/api/ai/rewrite` | POST | `{ text, instruction?, tone?, model? }` |
| `/api/ai/summarize` | POST | `{ text, maxChars?, model? }` |
| `/api/ai/translate` | POST | `{ text, targetLang: "zh"\|"en"\|"mixed", model? }` |
| `/api/ai/models` | GET | （列出当前 provider 支持的模型） |

### 文档 CRUD

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/documents` | 列表（按 updatedAt 倒序） |
| `GET` | `/api/documents/:id` | 详情 |
| `POST` | `/api/documents` | 新建 `{ title?, content?, platforms?[] }` |
| `PUT` | `/api/documents/:id` | 更新 `{ title?, content?, platforms? }` |
| `DELETE` | `/api/documents/:id` | 删除 |

### 模板 & Word 导出

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| `GET` | `/api/templates` | 模板列表 |
| `POST` | `/api/export/docx` | `{ title, content }` → 二进制 `.docx` |

---

## 🤖 AI Provider 切换

通过环境变量切：

```bash
# minimax（默认）
MINIMAX_API_KEY=ey...
MINIMAX_BASE_URL=https://api.minimaxi.com/anthropic
MINIMAX_MODEL=claude-sonnet-4-5

# 改用 Anthropic 官方
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_BASE_URL=https://api.anthropic.com
```

只要 `MINIMAX_API_KEY` 没填而 `ANTHROPIC_API_KEY` 填了，工厂会自动切到官方。

> 后续加 OpenAI / DeepSeek / 通义：新建 `providers/openai.ts` 实现 `AIProvider` 接口，在 `providers/index.ts` 加一行分叉即可。

---

## 🔐 鉴权

非 `GET` / `OPTIONS` 请求会在 `preHandler` 中校验 `x-api-key` 头。

```bash
# .env 里设置
AUTH_TOKEN=your-secret
```

前端 fetch 示例：

```ts
fetch('http://localhost:8787/api/documents', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'x-api-key': 'your-secret'
  },
  body: JSON.stringify({ title: '测试' })
})
```

`AUTH_TOKEN` 留空 = 不校验。**生产务必设上**。

---

## 🐞 已知要点

- **MySQL 8+**：`utf8mb4` 默认支持 emoji；如果用 5.7，`my.cnf` 要设 `character-set-server = utf8mb4`
- **首次 migration**：先确保 MySQL 实例在运行，否则 `db:migrate` 会报错
- **AI 流式被打断**：前端 fetch 应该支持 `AbortController`，否则用户切走聊天内容仍会继续写
- **.docx 复杂语法**：当前支持标题/段落/列表/引用/代码/水平线；表格/图片/嵌套列表留 TODO，复杂文档可能丢结构

---

## 🧪 调试 / 常用 curl

```bash
# 健康检查
curl -s http://localhost:8787/health

# 新建文档
curl -X POST http://localhost:8787/api/documents \
  -H 'content-type: application/json' \
  -H 'x-api-key: your-secret' \
  -d '{"title":"Hello"}'

# 流式生成（不展开）
curl -N -X POST http://localhost:8787/api/ai/generate \
  -H 'content-type: application/json' \
  -d '{"prompt":"一句话介绍春天","model":"claude-sonnet"}'

# 导出 Word
curl -X POST http://localhost:8787/api/export/docx \
  -H 'content-type: application/json' \
  -d '{"title":"测试","content":"# 你好\n\n世界"}' \
  -o test.docx && file test.docx
```

---

## 🗺️ 阶段二预留

- AI providers 增加 OpenAI / DeepSeek / 通义
- publish_jobs 表已建，OAuth 授权 + 各平台发文 API 接入留给阶段三
- Markdown→docx 补表格/图片
- Drizzle Studio 用作"文档管理后台"
- 接 Prometheus / OpenTelemetry 做请求时长 / Token 用量打点
