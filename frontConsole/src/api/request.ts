import axios, { type AxiosInstance, type AxiosRequestConfig } from 'axios'
import { ElMessage } from 'element-plus'

/**
 * axios 实例:统一 baseURL / 拦截器 / 错误处理。
 *
 * - baseURL 走 vite 代理(/api -> localhost:8787)
 * - 自动从 localStorage 读 token,塞到 Authorization header
 * - 401 强制跳登录页(后端 JWT 失效)
 * - 业务错误(后端返回 { code, errorCode, message })弹 ElMessage
 */

const TOKEN_KEY = 'aiword_console_token'

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token)
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY)
}

// 实例叫 `http`,避免和下面的 helper `request()` 同名冲突
const http: AxiosInstance = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL ?? '/api',
  timeout: 15_000
})

// 请求拦截:自动加 token
http.interceptors.request.use((config) => {
  const token = getToken()
  if (token) {
    config.headers = config.headers ?? {}
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// 响应拦截:统一弹错 + 401 处理
http.interceptors.response.use(
  (resp) => {
    const data = resp.data
    if (data && typeof data === 'object' && 'code' in data && 'errorCode' in data) {
      if (data.code !== 200 && data.code !== 0) {
        ElMessage.error(data.message ?? '请求失败')
        return Promise.reject(data)
      }
    }
    return resp
  },
  (err) => {
    const status = err?.response?.status
    if (status === 401) {
      clearToken()
      if (location.pathname !== '/login') {
        location.href = '/login'
      }
      ElMessage.error('登录已过期,请重新登录')
    } else {
      const msg = err?.response?.data?.message ?? err?.message ?? '网络错误'
      ElMessage.error(msg)
    }
    return Promise.reject(err)
  }
)

/**
 * 简化请求方法,业务层直接调:request<T>('GET', '/users')
 */
export async function request<T = unknown>(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  url: string,
  data?: unknown,
  config?: AxiosRequestConfig
): Promise<T> {
  const resp = await http.request<T>({
    method,
    url,
    data: method === 'GET' || method === 'DELETE' ? undefined : data,
    params: method === 'GET' || method === 'DELETE' ? data : undefined,
    ...config
  })
  return resp.data
}

export default http