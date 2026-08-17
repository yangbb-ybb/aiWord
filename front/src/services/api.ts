/**
 * axios 封装：
 * - 自动从 localStorage 读 token 注入 Authorization
 * - 收到 401 自动清 token 并跳 /login?redirect=...
 * - refresh 接口走第二个实例，避免全局拦截器在 refresh 失败时递归跳登录
 * - 后端基础 URL 通过 VITE_API_BASE_URL 配置，默认 http://localhost:8787
 */

import axios, { AxiosError, type AxiosInstance, type AxiosResponse } from 'axios'

const BASE_URL =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ??
  'http://localhost:8787'

const TOKEN_KEY = 'aiword.accessToken'
const REFRESH_KEY = 'aiword.refreshToken'

export function getAccessToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}
export function getRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_KEY)
}
export function setTokens(access: string, refresh: string) {
  localStorage.setItem(TOKEN_KEY, access)
  localStorage.setItem(REFRESH_KEY, refresh)
}
export function clearTokens() {
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(REFRESH_KEY)
}

export class ApiError extends Error {
  status: number
  code: string
  details?: unknown
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message)
    this.status = status
    this.code = code
    this.details = details
  }
}

interface BackendError {
  code?: string
  message?: string
  details?: unknown
}

function toApiError(err: AxiosError<BackendError>): ApiError {
  const status = err.response?.status ?? 0
  const data = err.response?.data
  return new ApiError(
    status,
    data?.code ?? 'NETWORK_ERROR',
    data?.message ?? err.message ?? '网络请求失败',
    data?.details
  )
}

/** 创建 axios 实例并统一错误处理 */
function createHttp(opts: { on401Redirect?: boolean }): AxiosInstance {
  const inst = axios.create({
    baseURL: BASE_URL,
    timeout: 30_000,
    headers: { 'content-type': 'application/json' }
  })

  inst.interceptors.request.use((config) => {
    const token = getAccessToken()
    if (token) config.headers.Authorization = `Bearer ${token}`
    return config
  })

  inst.interceptors.response.use(
    (res) => res,
    (err: AxiosError<BackendError>) => {
      if (opts.on401Redirect && err.response?.status === 401) {
        clearTokens()
        if (location.pathname !== '/login') {
          const redirect = encodeURIComponent(
            location.pathname + location.search
          )
          location.href = `/login?redirect=${redirect}`
        }
      }
      throw toApiError(err)
    }
  )

  return inst
}

const http = createHttp({ on401Redirect: true })
const refreshHttp = createHttp({ on401Redirect: false })

async function unwrap<T>(p: Promise<AxiosResponse<T>>): Promise<T> {
  const res = await p
  return res.data
}

export const api = {
  get: <T>(path: string) => unwrap(http.get<T>(path)),
  post: <T>(path: string, body?: unknown) => unwrap(http.post<T>(path, body)),
  put: <T>(path: string, body?: unknown) => unwrap(http.put<T>(path, body)),
  delete: <T>(path: string) => unwrap(http.delete<T>(path)),
  /** refresh 接口专用：失败不跳 /login，避免死循环 */
  refresh: <T>(path: string, body?: unknown) =>
    unwrap(refreshHttp.post<T>(path, body))
}

export { BASE_URL }