import { createRouter, createWebHistory, type RouteRecordRaw } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { ElMessage } from 'element-plus'

/**
 * 路由 + 守卫。
 *
 * - /login 不需要鉴权
 * - 其它路由 beforeEach 拉 ensureAuth()
 *   - 没 token 或后端 401 → 跳 /login
 *   - 已登录但 role !== admin → 弹错 + 跳 /login
 */

const routes: RouteRecordRaw[] = [
  {
    path: '/login',
    name: 'login',
    component: () => import('@/views/login/Index.vue'),
    meta: { public: true }
  },
  {
    path: '/',
    component: () => import('@/layouts/AdminLayout.vue'),
    redirect: '/dashboard',
    children: [
      {
        path: 'dashboard',
        name: 'dashboard',
        component: () => import('@/views/dashboard/Index.vue'),
        meta: { title: '总览' }
      },
      {
        path: 'users',
        name: 'users',
        component: () => import('@/views/users/Index.vue'),
        meta: { title: '用户管理' }
      },
      {
        path: 'documents',
        name: 'documents',
        component: () => import('@/views/documents/Index.vue'),
        meta: { title: '文档管理' }
      },
      {
        path: 'templates',
        name: 'templates',
        component: () => import('@/views/templates/Index.vue'),
        meta: { title: '模板管理' }
      },
      {
        path: 'ai-logs',
        name: 'ai-logs',
        component: () => import('@/views/ai-logs/Index.vue'),
        meta: { title: 'AI 调用日志' }
      }
    ]
  }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

router.beforeEach(async (to) => {
  if (to.meta.public) return true

  const auth = useAuthStore()
  const u = await auth.ensureAuth()
  if (!u) {
    return { path: '/login', query: { redirect: to.fullPath } }
  }
  if (u.role !== 'admin') {
    ElMessage.error('仅管理员账号可登录控制台')
    auth.doLogout()
    return { path: '/login' }
  }
  return true
})

export default router