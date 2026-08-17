import {
  createRouter,
  createWebHistory,
  type RouteRecordRaw
} from 'vue-router'
import { getAccessToken } from '@/services/api'
import { useAuthStore } from '@/stores/auth'

const routes: RouteRecordRaw[] = [
  {
    path: '/login',
    name: 'login',
    component: () => import('@/views/auth/LoginView.vue'),
    meta: { public: true }
  },
  {
    path: '/',
    name: 'workspace',
    component: () => import('@/views/workspace/WorkspaceView.vue')
  }
]

const router = createRouter({
  history: createWebHistory(),
  routes
})

router.beforeEach(async (to) => {
  const isPublic = to.meta.public === true
  const hasToken = !!getAccessToken()

  if (isPublic) {
    // 已登录用户访问登录页 → 跳回工作台
    if (hasToken && to.path === '/login') return { path: '/' }
    return true
  }

  // 受保护页面：没 token 跳登录
  if (!hasToken) {
    return {
      path: '/login',
      query: { redirect: to.fullPath }
    }
  }

  // 有 token 但 store 里还没有 user：尝试拉一次
  const auth = useAuthStore()
  if (!auth.user) {
    await auth.fetchMe()
    if (!auth.user) {
      return { path: '/login', query: { redirect: to.fullPath } }
    }
  }
  return true
})

export default router