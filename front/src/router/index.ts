import {
  createRouter,
  createWebHistory,
  type RouteRecordRaw
} from 'vue-router'
import { getAccessToken, setUnauthorizedHandler } from '@/services/api'
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

/**
 * 任何受保护接口收到 401 → 走 router.push 跳登录页（SPA 导航，不硬刷）。
 * 避免 axios 拦截器直接 location.href 引发"批量旧请求 + 重复 fetchMe"的死循环。
 */
setUnauthorizedHandler(() => {
  if (router.currentRoute.value.path !== '/login') {
    const redirect = encodeURIComponent(
      router.currentRoute.value.fullPath
    )
    router.replace({ path: '/login', query: { redirect } })
  }
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
    console.log(1);
    await auth.fetchMe()
    // if (!auth.user) {
    //   return { path: '/login', query: { redirect: to.fullPath } }
    // }
  }
  return true
})

export default router