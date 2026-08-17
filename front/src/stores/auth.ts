import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import {
  api,
  clearTokens,
  getAccessToken,
  setTokens,
  ApiError
} from '@/services/api'

export interface UserPublic {
  id: string
  nickname: string
  avatar: string | null
  email: string | null
  phone: string | null
  status: string
  role: string
  wechatBound: boolean
  zhihuBound: boolean
  csdnBound: boolean
  juejinBound: boolean
  createdAt: string
  updatedAt: string
}

interface AuthSuccess {
  user: UserPublic
  accessToken: string
  refreshToken: string
}

export const useAuthStore = defineStore('auth', () => {
  const user = ref<UserPublic | null>(null)
  /** token 只在 localStorage 里存；store 不再单独留一份，避免状态漂移 */
  const hasToken = ref(!!getAccessToken())

  const isAuthenticated = computed(() => hasToken.value && !!user.value)

  function applyAuth(payload: AuthSuccess) {
    setTokens(payload.accessToken, payload.refreshToken)
    user.value = payload.user
    hasToken.value = true
  }

  /** 手机号 + 验证码登录（首次自动注册） */
  async function loginSms(phone: string, code: string) {
    const data = await api.post<AuthSuccess>('/api/auth/sms/login', { phone, code })
    applyAuth(data)
    return data.user
  }

  /** 发短信验证码 */
  async function sendSmsCode(phone: string, purpose: 'login' | 'register' = 'login') {
    await api.post('/api/auth/sms/send', { phone, purpose })
  }

  /** 拿当前用户 —— 启动时如果有 token 就调一次 */
  async function fetchMe() {
    if (!getAccessToken()) {
      user.value = null
      hasToken.value = false
      return null
    }
    try {
      const { user: u } = await api.get<{ user: UserPublic }>('/api/users/me')
      user.value = u
      hasToken.value = true
      return u
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
        clearTokens()
        user.value = null
        hasToken.value = false
      }
      return null
    }
  }

  async function logout() {
    const refresh = localStorage.getItem('aiword.refreshToken')
    if (refresh) {
      try {
        await api.post('/api/auth/logout', { refreshToken: refresh })
      } catch {
        // 即便后端 logout 失败也继续清本地
      }
    }
    clearTokens()
    user.value = null
    hasToken.value = false
  }

  return {
    user,
    hasToken,
    isAuthenticated,
    loginSms,
    sendSmsCode,
    fetchMe,
    logout
  }
})