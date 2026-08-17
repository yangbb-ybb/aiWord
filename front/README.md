# aiWord

> AI 驱动的写作与多平台发布工作台 —— 一句话主题，一键成稿 + 多渠道分发。

![stage](https://img.shields.io/badge/stage-MVP%20%E9%AA%A8%E6%9E%B6-6366f1)
![frontend](https://img.shields.io/badge/frontend-Vue%203%20%2B%20Vite-42b883)
![ui](https://img.shields.io/badge/UI-Element%20Plus-409eff)

---

## ✨ 项目愿景

让"写一篇文章"变成"说一句需求"：

1. **AI 草稿**：自然语言描述 → 大模型生成可编辑稿
2. **Word 落地**：一键导出 `.docx`，排版还原 Word 视觉
3. **一键分发**：同时推送到微信公众号 / 知乎 / CSDN / 掘金

> 当前仓库处于 **阶段一：主页骨架**，AI 调用、.docx 导出、多平台发布尚未接入，UI / 交互 / 状态层已经就绪。

---

## 🖼️ 主页面预览

主页面（AI 写作工作台）—— 顶栏 + 三栏布局：

```
┌──────────────────────────────────────────────────────────────────┐
│  Ai  aiWord      工作台 / AI 写作        [分享][设置] [Avatar]    │
├──────────┬────────────────────────────────────┬──────────────────┤
│ + 新建   │  标题输入框             [复制][导出] │  AI 生成配置      │
│          │  Toolbar: H1 H2 B I code | 列表…   │  模型 / 风格…     │
│ 最近 5   │  ┌───────── 编辑 | 预览 ────────┐  │  Prompt 输入框    │
│ 模板 4   │  │                              │  │  [✦ 一键生成]    │
│          │  │   Markdown 编辑区            │  │                  │
│          │  │   （白底"纸张"+阴影）        │  │  发布渠道 chips    │
└──────────┴────────────────────────────────────┴──────────────────┘
```

---

## 🧱 技术栈

| 层 | 选型 |
| --- | --- |
| 前端框架 | Vue 3 (Composition API + `<script setup>`) |
| 构建工具 | Vite 4（兼容 Node 16+） |
| 语言 | TypeScript 5 |
| UI 库 | Element Plus 2 |
| 状态管理 | Pinia |
| 路由 | vue-router 4 |
| Markdown | markdown-it |
| 图标 | @element-plus/icons-vue |
| 样式 | 原生 CSS + CSS 变量（无 Tailwind，便于主题切换） |

> 后续阶段会补：后端（BFF / Worker）、AI 模型适配层、`docx` 渲染 / 导出、各平台 OpenAPI SDK。

---

## 🚀 快速开始

环境要求：

- Node.js ≥ **16.15**（推荐 18+，vite 5 才能启用）
- npm ≥ 8（或 pnpm / yarn 均可）

```bash
npm install
npm run dev          # http://localhost:5173/
```

更多命令：

| 脚本 | 作用 |
| --- | --- |
| `npm run dev` | 启动 Vite 开发服务器（端口 5173，host 已开 0.0.0.0） |
| `npm run build` | 生产构建到 `dist/`（已跳过类型检查以兼容 Node 16） |
| `npm run preview` | 预览构建产物 |
| `npm run typecheck` | 可选：跑 `vue-tsc --noEmit` 严格类型检查（需 Node ≥ 18） |

---

## 📁 目录速查

```
src/
├── main.ts                       # 入口：注册 Pinia / router / ElementPlus / 全部图标
├── App.vue                       # 仅留 <RouterView />
├── router/index.ts               # 路由（暂只 / → WorkspaceView）
├── stores/document.ts            # 全部业务状态（文档 / 模板 / 平台 / Mock 生成）
├── styles/
│   ├── reset.css                 # 极简 reset + 自定义滚动条
│   └── variables.css             # 颜色 / 间距 / 字号 / 圆角 CSS 变量
├── layout/                       # 跨视图通用：顶栏 / Logo / 全局浮层等
│   └── BrandLogo.vue
└── views/
    └── workspace/                # 一个视图 = 一个文件夹，自己管自己的子组件
        ├── WorkspaceView.vue     # 入口：三栏布局
        └── components/           # 仅该视图使用，不外露
            ├── LeftSidebar.vue   # 新建 / 最近 / 模板
            ├── CenterEditor.vue  # 标题 + 工具条 + Markdown 编辑 / 预览
            ├── EmptyState.vue    # 中央空态
            ├── RightPanel.vue    # AI 配置 + 发布渠道
            └── PlatformChips.vue # 公众号 / 知乎 / CSDN / 掘金
```

## 🔄 数据流

```
LeftSidebar ──▶ store.open(id) / store.createNew() / store.applyTemplate()
                                                       │
                                                       ▼
                                     store.current ◀──┤
                                                       │
                                                       ▼
CenterEditor ◀── store.updateContent() ◀── textarea 输入

RightPanel ──▶ store.generate(prompt) ──▶ 追加到 current.content
            ──▶ store.togglePlatform(p) ──▶ selectedPlatforms[]
```

---

## 🧭 路线图

### ✅ 阶段一：主页骨架（当前）
- 三栏布局、响应式断点（≤1280px 右栏折下）
- 文档新建 / 切换 / 重命名
- 模板套用（周报 / 会议纪要 / 项目总结 / 公众号模板）
- Markdown 编辑 + 实时预览
- 工具条（B / I / H1 / H2 / code / 列表 / 链接 / 图片 / 复制 / 导出占位）
- AI 配置面板（模型 / 风格 / 长度 / 语言 / Prompt + 4 个一键预设）
- 多平台渠道 chips（公众号 / 知乎 / CSDN / 掘金，全默认选中）
- 顶栏折叠按钮

### 🚧 阶段二：核心能力
- [ ] **真实 AI 生成**：接 Claude Sonnet / GPT-4o / DeepSeek / 通义 / 文心，Markdown 流式输出
- [ ] **对话形态**：左下角加 AI 对话抽屉，支持"续写 / 改写 / 翻译 / 摘要"四件套
- [ ] **.docx 导出**：选用 `docx` 库（或后端 LibreOffice / Puppeteer）还原 Word 视觉
- [ ] **多平台发布**：OAuth 授权 → 调用各平台发文 API
  - 微信公众号（素材管理 + 群发）
  - 知乎（专栏文章 API）
  - CSDN（blog 客户端）
  - 掘金（开放平台）

### 🔮 阶段三：协同与沉淀
- [ ] 历史 / 草稿管理页
- [ ] 个人知识库、向量化检索
- [ ] 团队协同（共享文档 / 评论 / 版本）
- [ ] 数据看板（生成次数 / 字数 / 平台表现）

### 🛡️ 安全 / 工程
- [ ] 后端抽象：API key 不落前端
- [ ] 速率限制、Prompt 注入防护
- [ ] E2E（Playwright）、单元测试、CI

---

## 🎨 设计规范速查

| 维度 | 值 |
| --- | --- |
| 主色 | `#4F46E5`（靛紫） |
| 强调渐变 | `linear-gradient(135deg, #6366F1, #8B5CF6)` |
| 平台色 | 微信 `#07C160` · 知乎 `#0084FF` · CSDN `#C9394A` · 掘金 `#1E80FF` |
| 圆角 | 8 / 12 / 16 px |
| 字号 | 12 / 13 / 14 / 15 / 18 px |
| 顶栏 | 56 px · 左栏 260 px · 右栏 320 px |

完整变量见 [src/styles/variables.css](src/styles/variables.css)。

---

## 🛠️ 已实现交互一览

| 位置 | 操作 | 效果 |
| --- | --- | --- |
| 顶栏 | Logo / 面包屑 / 头像 | 站位（设置入口待补） |
| 顶栏 | 左侧折叠按钮 | 收起 / 展开左栏 |
| 左栏 | `+ 新建文档` | 创建草稿并跳到中央 |
| 左栏 | 点击历史项 | 切换当前文档（淡入） |
| 左栏 | 点击模板项 | 新建文档并套用模板 |
| 中央 | 标题输入 | 直接在位重命名 |
| 中央 | 工具条 H1 / H2 / B / I / code / 列表 / 链接 / 图片 | 选中区被包裹（无选中时插入占位"文本"） |
| 中央 | `复制 Markdown` | 复制整文到剪贴板 |
| 中央 | `导出 .docx` | 占位，提示将在阶段二接入 |
| 中央 | Tab 切换 编辑 / 预览 | markdown-it 渲染，标题 / 列表 / 引用 / 代码块 / 表格 / 图片全部美化 |
| 右栏 | AI 配置 | 模型 / 风格 / 长度 / 语言 全部可用，**生成走 mock（1.5s 模拟）** |
| 右栏 | 4 个预设 Prompt | 一键填充 |
| 右栏 | `一键生成` | 追加 mock 段落（含 H2 / 列表 / 代码块）到文档末尾 |
| 右栏 | 渠道 chips | toggle 选中，默认全选 |
| 右栏 | `一键发布` | 弹确认框，提示阶段二接入 |

---

## 📝 开发约定

- **组件目录就近**：每个 view 自己一个目录，私有子组件放自己的 `components/` 子包，**禁止全局 `components/`**。
  - `views/workspace/WorkspaceView.vue` 私有组件放 `views/workspace/components/`
  - 跨视图复用的（顶栏、Logo、面包屑、全局浮层）放 `src/layout/` 或 `src/shared/`
  - 这样新增一个 view 不会污染别处；删除一个 view 直接 `rm -rf views/<name>/`
- **样式**：scoped + CSS 变量，全局 reset 放在 `styles/reset.css`，变量集中在 `variables.css`
- **Pinia**：用 setup-style（`defineStore('x', () => { ... })`）
- **TODO 标记**：阶段二待办写 `// TODO[stage2]: ...`，方便后续 grep
- **提交**：参考 Conventional Commits（`feat:` / `fix:` / `chore:` / `docs:`）

---

## ⌨️ 调试速查

- 想看 store 当前值：`main.ts` 里加 `import { useDocumentStore } from '@/stores/document'` → `window.__store = useDocumentStore`
- 想看 Markdown 渲染：中央 `编辑` tab 切到 `预览`
- 想强制回到新文档：刷新页面，左栏 `+ 新建文档`
- 想验证手机 / 平板：dev 已开 `0.0.0.0`，用同网段 IP 在终端查 `ipconfig getifaddr en0`

---

## 🐞 已踩过的坑 / 兼容性

- **Node 16 + Vite 5** → `crypto.getRandomValues is not a function`，已锁定 vite 4
- **Element Plus icons 2.3** 没有 `Bold / Italic / Heading`，工具条 B / I 用纯文字按钮
- **vue-tsc 1.x + TS 5.5** 解析失败 → 用 2.x；本机 Node 16 仍跑不了，所以 `build` 跳过类型检查，独立出 `typecheck` 命令

## 📦 后续计划

- 升级 Node 18+ 后，把 `vite build` 改回 `vue-tsc --noEmit && vite build`
- 拆 vendor chunk，把 Element Plus 按需引入（`unplugin-vue-components`）
- 接入 Storybook 或 Histoire 写组件级预览

---

## 🤝 贡献

欢迎 PR / Issue。建议先看路线图，避免与正在推进的工作重复。

## License

暂未声明，后续补 `MIT`。
