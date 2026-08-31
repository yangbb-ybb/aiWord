# aiWord H5

aiWord 的移动端 H5 入口,与 `front/`(桌面端)并列。

## 状态

骨架已就绪,首个业务页面 **AI 生图**(豆包 UI 高保真还原)已完成。

- `/` — 首页:logo + "功能入口"列表
- `/image` — AI 生图:输入描述 → 模拟 1.5s loading → 显示 Lorem Picsum 占位图(纯前端 demo,无真实生图 API)

后续按需添加:文档列表 / 文档编辑器 / AI 对话面板等。

## 技术栈

| 类别 | 选型 |
| --- | --- |
| 框架 | Vue 3 + TypeScript |
| 构建 | Vite 5 |
| 路由 | Vue Router 4 |
| 状态 | Pinia |
| UI | Vant 4(移动端组件库) |
| 自动按需 | unplugin-vue-components + unplugin-auto-import + @vant/auto-import-resolver |
| 移动端适配 | postcss-px-to-viewport(设计稿按 375px 宽) |

## 启动

```bash
npm install          # 或 pnpm install / yarn
npm run dev          # → http://localhost:5174
npm run typecheck    # vue-tsc --noEmit
npm run build        # 类型检查 + 生产构建
```

## 与桌面端共存

| 项目 | 端口 | 目录 |
| --- | --- | --- |
| 桌面端 | 5173 | `../front` |
| 移动端 H5 | 5174 | `.` |

两个项目可同时 `npm run dev`,互不抢占端口。后端 `end/` 服务默认 `http://localhost:8787`,两端共用。

## 目录结构

```
fronth5/
├── index.html
├── package.json
├── tsconfig.json
├── tsconfig.node.json
├── vite.config.ts
└── src/
    ├── main.ts                  # 入口:createApp + router/pinia/Vant
    ├── App.vue                  # 根组件
    ├── auto-imports.d.ts        # unplugin-auto-import 自动生成
    ├── components.d.ts          # unplugin-vue-components 自动生成
    ├── api/
    │   └── index.ts             # axios 实例(指向后端 8787)
    ├── router/
    │   └── index.ts             # /  → home, /image → image-gen
    ├── stores/
    │   └── index.ts             # 空骨架 useAppStore
    ├── styles/
    │   └── index.scss           # 全局样式 + Vant 主题变量
    └── views/
        ├── home/
        │   └── index.vue        # 首页:logo + 功能入口
        └── image-gen/
            ├── index.vue        # 编排层:状态 + 业务事件
            └── components/      # 页面专用子组件
                ├── Navbar.vue          # 顶部双行 NavBar(主标题 + 副标题)
                ├── EmptyState.vue      # 空态欢迎气泡 + 示例 prompt
                ├── MessageBubble.vue   # 用户/AI 气泡(loading / 完成)
                ├── NewTopicButton.vue  # 消息流底部"聊聊新话题"
                ├── ShortcutBar.vue     # 横排胶囊快捷入口
                └── Composer.vue        # 底部大圆角胶囊输入栏(v-model)
```

### 页面拆分约定

- 每个业务页都建 `views/<功能>/index.vue`(已遵循,不再直接放 `Home.vue`)
- 页面专用子组件放 `views/<功能>/components/`,与页面强绑定
- 跨页面通用组件才放 `src/components/`(目前还没有,按需创建)

## 移动端真机调试

```bash
npm run dev -- --host
# Vite 启动后会打印 Network 地址,手机连同一 WiFi 扫码访问
```

桌面浏览器调试时,可用 `@vant/touch-emulator`(已在依赖里)模拟移动端手势。

## 后端 API

复用 `end/` 服务,默认地址 `http://localhost:8787`。当前页面无任何 API 调用(AI 生图为纯前端模拟)。