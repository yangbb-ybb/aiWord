/**
 * axios 封装：
 * - 自动从 localStorage 读 token 注入 Authorization
 * - 收到 401 只清 token + 触发 onUnauthorized 回调，跳转交给 router（避免 location.href 硬刷导致请求堆积/重复触发 fetchMe）
 * - refresh 接口走第二个实例，避免全局拦截器在 refresh 失败时递归跳登录
 * - 后端基础 URL 通过 VITE_API_BASE_URL 配置，默认 http://localhost:8787
 *
 * 响应统一信封（由后端 onSend hook 包装）：
 *   成功 → { code: <number>, data: T }
 *   错误 → { code: <number>, message: string, errorCode?: string, details? }
 * 本文件 `unwrap` 只把 `data` 字段透出给业务调用方，错误仍走 `ApiError` 抛出。
 *
 * ⚠️ 业务代码统一从这里导出的 `api` / `ApiError` 发起请求。
 * ⚠️ 不要直接写 axios(...) 或 fetch(...)。唯一例外是 ./stream.ts —— SSE 流式必须用 fetch + ReadableStream，axios 不支持。
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

/**
 * ApiError：保留 HTTP status（response.status）+ 后端 errorCode（机器可读字符串）
 * + 后端 message（人类可读）+ details（可选，如 Zod 校验明细）。
 *
 * 设计要点：
 * - `status` 永远是 HTTP 状态码（0 表示网络层失败，没有响应回来）
 * - `errorCode` 是后端定义的机器可读错误码（如 'INVALID_CREDENTIALS'），用于业务分支
 * - `code` 字段名保留以兼容历史用法，但语义现在等同 `status`（数字 HTTP 状态）
 * - `message` 是给人看的，UI 直接 toast / ElMessage.error(e.message) 即可
 */
export class ApiError extends Error {
  status: number
  /** 后端 envelope 里的数字 code，等同 HTTP 状态码 */
  code: number
  /** 后端 envelope 里的 errorCode（机器可读字符串）；网络错误时为 'NETWORK_ERROR' */
  errorCode: string
  details?: unknown
  constructor(
    status: number,
    code: number,
    errorCode: string,
    message: string,
    details?: unknown
  ) {
    super(message)
    this.status = status
    this.code = code
    this.errorCode = errorCode
    this.details = details
  }
}

interface BackendEnvelopeError {
  code?: number
  message?: string
  errorCode?: string
  details?: unknown
}

function toApiError(err: AxiosError<BackendEnvelopeError>): ApiError {
  const status = err.response?.status ?? 0
  const data = err.response?.data
  return new ApiError(
    status,
    data?.code ?? status,
    data?.errorCode ?? 'NETWORK_ERROR',
    data?.message ?? err.message ?? '网络请求失败',
    data?.details
  )
}

/** 全局 401 监听：路由/业务层订阅后自行决定跳不跳 /login */
type UnauthorizedHandler = () => void
let onUnauthorized: UnauthorizedHandler | null = null
export function setUnauthorizedHandler(fn: UnauthorizedHandler | null) {
  onUnauthorized = fn
}

/** 创建 axios 实例并统一错误处理 */
function createHttp(_opts: { on401Redirect?: boolean }): AxiosInstance {
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
    (err: AxiosError<BackendEnvelopeError>) => {
      if (err.response?.status === 401) {
        // 只清 token + 通知订阅者。不要在这里 location.href，会触发硬刷新导致旧请求堆积。
        clearTokens()
        if (onUnauthorized) onUnauthorized()
      }
      throw toApiError(err)
    }
  )

  return inst
}

const http = createHttp({ on401Redirect: true })
const refreshHttp = createHttp({ on401Redirect: false })

/**
 * 拆信封：axios 返回的 AxiosResponse.data 是 { code, data, ... }，
 * 这里把 data 字段透出给业务调用方。如果后端没按信封返回（理论上不应发生），
 * 就兜底返回原对象，避免直接崩溃。
 */
async function unwrap<T>(p: Promise<AxiosResponse<unknown>>): Promise<T> {
  const res = await p
  const body = res.data as unknown
  if (
    body &&
    typeof body === 'object' &&
    'data' in (body as Record<string, unknown>)
  ) {
    return (body as { data: T }).data
  }
  // 兜底：老接口 / 调试期返回非信封结构 → 原样返回
  return body as T
}

export const api = {
  get: <T>(path: string) => unwrap<T>(http.get(path)),
  post: <T>(path: string, body?: unknown) => unwrap<T>(http.post(path, body)),
  put: <T>(path: string, body?: unknown) => unwrap<T>(http.put(path, body)),
  delete: <T>(path: string) => unwrap<T>(http.delete(path)),
  /** refresh 接口专用：失败不跳 /login，避免死循环 */
  refresh: <T>(path: string, body?: unknown) =>
    unwrap<T>(refreshHttp.post(path, body))
}

export { BASE_URL }