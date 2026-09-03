# aiWord 控制台(frontConsole)

aiWord 的运营 / 管理后台 —— 给项目管理员用的 PC 端 web 入口。

## 技术栈

- **Vue 3** (`<script setup>` + Composition API + TypeScript)
- **Vite 5**(dev server 端口 5175)
- **Element Plus 2.x**(按需自动注册,无需手动 import)
- **Pinia**(状态:登录态 / 用户信息)
- **Vue Router 4**
- **Axios**(走 `/api` 代理到 end 后端 8787)

## 启动

```bash
cd frontConsole
npm install
npm run dev
# 打开 http://localhost:5175
```

需先启动 end 后端(8787),不然登录拉取用户列表会 404。

## 页面

| 路径 | 功能 | 状态 |
| --- | --- | --- |
| `/login` | 管理员登录(账号 + 密码) | ✅ |
| `/dashboard` | 总览:用户数、文档数、今日调用量 | ✅(部分 mock)|
| `/users` | 用户列表(搜索 / 分页 / 角色调整) | ✅ |
| `/documents` | 文档列表(管理员视角,看所有用户文档) | ✅ |
| `/templates` | 模板列表 + 增删改 | ✅ |
| `/ai-logs` | AI 调用日志(读后端 `image_chat` 日志) | 🟡 占位,后续做 |

## 后端接口依赖

- `POST /api/auth/login` — 已有,管理员账号 `role=admin` 才能进
- `GET /api/admin/stats` — Dashboard 统计(本次新增)
- `GET /api/admin/users` — 用户列表(本次新增)
- `GET /api/admin/documents` — 管理员查所有文档(本次新增)
- `GET /api/admin/templates` — 模板列表(本次新增)

## 目录

```
src/
├── api/         # axios 接口层(每个资源一个文件)
├── stores/      # pinia 状态
├── router/      # 路由 + 守卫
├── layouts/     # AdminLayout(侧边栏 + 顶部 + 主区)
├── views/       # 业务页面
├── styles/      # 全局样式
├── App.vue
└── main.ts
```