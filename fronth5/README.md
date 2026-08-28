# aiWord H5

aiWord 的移动端 H5 入口,与 `front/`(桌面端)并列。

## 状态

**项目骨架,首页为占位 —— 无任何业务功能**。

后续按需添加:文档列表 / 文档编辑器 / AI 对话面板等页面。

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
```

## 与桌面端共存

| 项目 | 端口 | 目录 |
| --- | --- | --- |
| 桌面端 | 5173 | `../front` |
| 移动端 H5 | 5174 | `.` |

两个项目可同时 `npm run dev`,互不抢占端口。

## 目录

```
fronth5/
├── src/
│   ├── main.ts          # 入口:createApp + router/pinia/Vant
│   ├── App.vue          # 根组件
│   ├── router/          # 路由配置(只一个 / 路由)
│   ├── stores/          # Pinia 状态(空骨架)
│   ├── api/             # axios 实例(指向后端 8787)
│   ├── styles/          # 全局样式
│   └── views/
│       └── Home.vue     # 首页占位
├── vite.config.ts
├── tsconfig.json
└── package.json
```

## 后端 API

复用 `end/` 服务,默认地址 `http://localhost:8787`。当前首页占位无任何 API 调用。

## 移动端真机调试

```bash
npm run dev -- --host
# Vite 启动后会打印 Network 地址,手机连同一 WiFi 扫码访问
```

桌面浏览器调试时,可用 `@vant/touch-emulator`(已在依赖里)模拟移动端手势。
