import { defineStore } from 'pinia'
import { ref } from 'vue'
import { getMe, login, type LoginReq } from '@/api/auth'
import { clearToken, setToken } from '@/api/request'

/**
 * 登录态 + 当前用户。
 *
 * - 路由守卫 beforeEach 会调 ensureAuth() 兜底
 * - 登录后 user 存在内存 + token 存 localStorage
 */

export const useAuthStore = defineStore('auth', () => {
  const token = ref<string | null>(null)
  const user = ref<{
    id: number
    nickname: string
    role: 'user' | 'admin'
    avatar?: string
  } | null>(null)

  async function doLogin(req: LoginReq) {
    const resp = await login(req)
    token.value = resp.accessToken
    user.value = resp.user
    setToken(resp.accessToken)
    return resp.user
  }

  /** 已有 token 时拉一次 /me 确认有效性;返回 user(成功)或 null(失败) */
  async function ensureAuth(): Promise<typeof user.value> {
    if (user.value) return user.value
    try {
      const u = await getMe()
      user.value = u
      return u
    } catch {
      user.value = null
      token.value = null
      clearToken()
      return null
    }
  }

  function doLogout() {
    token.value = null
    user.value = null
    clearToken()
  }

  return { token, user, doLogin, doLogout, ensureAuth }
})