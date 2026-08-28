import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'

/**
 * 路由配置：
 * - 当前有 /（首页占位）+ /image（AI 出图 demo）
 * - 后续按需添加：/documents（列表）、/doc/:id（编辑器）等
 * - 用 lazy import 拆分代码包
 */
const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'home',
    component: () => import('@/views/home/index.vue'),
    meta: { title: 'aiWord' }
  },
  {
    path: '/image',
    name: 'image-gen',
    component: () => import('@/views/image-gen/index.vue'),
    meta: { title: 'AI 出图' }
  }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

// 路由切换时更新 document.title
router.afterEach((to) => {
  const title = (to.meta?.title as string) ?? 'aiWord H5'
  document.title = `${title} · aiWord`
})

export default router
