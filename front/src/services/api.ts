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

import axios, {
  AxiosError,
  AxiosHeaders,
  type AxiosInstance,
  type AxiosResponse,
  type InternalAxiosRequestConfig
} from 'axios'

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

/** /api/auth/refresh 返回结构（和后端 AuthSuccess 对齐，user 字段本拦截器不用） */
interface RefreshResponse {
  user: unknown
  accessToken: string
  refreshToken: string
}

/** 给 config 挂一个 _retry 标记，防止 refresh 后重发还 401 时再次进入 refresh 分支 */
type RetryableConfig = InternalAxiosRequestConfig & { _retry?: boolean }

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

/**
 * 并发去重：多个请求同时 401 时只发一次 /api/auth/refresh。
 * 后端 rotateRefreshToken 会撤销旧 refresh token 并签发新的（rotation 机制），
 * 所以并发 N 次 refresh 会让 N-1 次拿到 REFRESH_REVOKED —— 必须串行。
 *
 * ⚠️ 单 tab 内 `refreshing` 已经够了，但**多 tab 同时 refresh** 会绕过这个 singleton：
 *   - Tab A 看到 401，调 refresh，rotation 撤销旧 token、签发新 token
 *   - Tab B 也看到 401，**它不知道 Tab A 在 refresh**，自己再调一次
 *   - Tab B 拿到 REFRESH_REVOKED → clearTokens → 跳 /login
 *
 * 修法：用 BroadcastChannel 跨 tab 协调。
 *   - 当前 tab 发起 refresh：postMessage('refresh:start', id) 并开始干活
 *   - 其他 tab 收到 'refresh:start'：订阅 'refresh:done' / 'refresh:failed'，等结果
 *   - 当前 tab 干完：postMessage('refresh:done', id, tokens) 或 'refresh:failed', id
 *   - 其他 tab 拿到 done：从消息里直接拿 tokens（不用再发请求）→ localStorage 已同步写入
 */
const REFRESH_CHANNEL = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('aiword-auth-refresh') : null

type RefreshMsg =
  | { type: 'refresh:start'; id: string }
  | { type: 'refresh:done'; id: string; tokens: { accessToken: string; refreshToken: string } }
  | { type: 'refresh:failed'; id: string }

let refreshing: Promise<{ accessToken: string; refreshToken: string }> | null = null

/** 跨 tab 协调：当前 tab 拿到 401 时，先广播看有没有别人已经在 refresh。 */
async function waitForOtherTabRefresh(id: string): Promise<{ accessToken: string; refreshToken: string } | null> {
  if (!REFRESH_CHANNEL) return null
  return new Promise((resolve) => {
    const handler = (e: MessageEvent<RefreshMsg>) => {
      const msg = e.data
      if (msg.type === 'refresh:done' && msg.id === id) {
        REFRESH_CHANNEL.removeEventListener('message', handler)
        resolve(msg.tokens)
      } else if (msg.type === 'refresh:failed' && msg.id === id) {
        REFRESH_CHANNEL.removeEventListener('message', handler)
        resolve(null)
      }
    }
    REFRESH_CHANNEL!.addEventListener('message', handler)
    // 1.5s 后还没收到结果，说明没别的 tab 在 refresh（或者别的 tab 也死了），
    // 自己接管。超过这个时间还没动静的情况：所有 tab 都没启动 refresh → 当前 tab 来做。
    setTimeout(() => {
      REFRESH_CHANNEL!.removeEventListener('message', handler)
      resolve(null)
    }, 1500)
  })
}

/**
 * 公开：触发一次 token 轮换。SSE（fetch）端点不走 axios 拦截器，
 * 收到 401 时需要主动调用本函数拿到新 token 再 retry fetch。
 *
 * - 同 tab 内并发去重 + 跨 tab BroadcastChannel 协调（见上方注释）
 * - 成功：localStorage 已写入新 token，返回 { accessToken, refreshToken }
 * - 失败：localStorage 已清空，触发 onUnauthorized，抛 ApiError
 */
export async function refreshTokens(): Promise<{ accessToken: string; refreshToken: string }> {
  return doRefresh()
}

/**
 * 解析 JWT payload 里的 exp 字段（秒 → 毫秒）。失败返回 null。
 *
 * JWT 是 `header.payload.signature`，payload 是 base64url 编码的 JSON。
 * 不验证签名 —— 这里只读 exp，不做信任决策（最终所有受保护接口都会再被后端校验）。
 */
function decodeJwtExp(token: string): number | null {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4)
    const json = atob(padded)
    const obj = JSON.parse(json) as { exp?: number }
    return typeof obj.exp === 'number' ? obj.exp * 1000 : null
  } catch {
    return null
  }
}

/**
 * 主动 preflight：如果当前 access token 距过期 < threshold（默认 5 分钟），
 * 就提前 refresh。用户连续写 2+ 小时时，永远不会撞上 401 + retry 那一瞬间的延迟。
 *
 * ⚠️ refresh 失败时不抛 —— 让原请求继续走，最后由 axios 拦截器或 fetch 的 401 路径兜底。
 * 否则 preflight 自己抛会破坏所有业务请求的正常错误流。
 */
const PREFLIGHT_REFRESH_THRESHOLD_MS = 5 * 60 * 1000
export async function ensureFreshToken(): Promise<void> {
  const token = getAccessToken()
  if (!token) return
  const exp = decodeJwtExp(token)
  if (exp == null) return
  if (exp - Date.now() > PREFLIGHT_REFRESH_THRESHOLD_MS) return
  // 距过期 < 5 分钟 → 主动 refresh
  try {
    await refreshTokens()
  } catch {
    // 静默吞掉；后续 401 → refreshTokens() 的路径会再次尝试 + 触发 onUnauthorized
  }
}

async function doRefresh(): Promise<{ accessToken: string; refreshToken: string }> {
  // 0) 同 tab 内已经 in-flight → 直接复用（防止同 tab 多 401 并发触发出 N 次 refresh 请求）
  if (refreshing) return refreshing

  const rt = getRefreshToken()
  if (!rt) {
    const e = new ApiError(401, 401, 'NO_REFRESH_TOKEN', 'localStorage 里没有 refresh token')
    clearTokens()
    if (onUnauthorized) onUnauthorized()
    throw e
  }

  // 关键：把 refreshing 提前占位（singleton），后续同 tab 再有 401 都复用同一个 promise。
  // 不能等到 peer wait 完再设 —— 否则 wait 期间同 tab 并发 401 会绕过 singleton，重复发 refresh。
  const id = Math.random().toString(36).slice(2)
  refreshing = (async () => {
    // 1) 跨 tab 协调：广播问一句"有没有人在 refresh"，等最多 1.5s
    if (REFRESH_CHANNEL) REFRESH_CHANNEL.postMessage({ type: 'refresh:start', id } as RefreshMsg)
    const peerResult = await waitForOtherTabRefresh(id)
    if (peerResult) {
      // 别的 tab 已经刷完了，tokens 已经在 localStorage 里
      return peerResult
    }

    // 2) 当前 tab 自己刷新
    try {
      const data = await api.refresh<RefreshResponse>('/api/auth/refresh', {
        refreshToken: rt
      })
      setTokens(data.accessToken, data.refreshToken)
      const tokens = { accessToken: data.accessToken, refreshToken: data.refreshToken }
      if (REFRESH_CHANNEL) REFRESH_CHANNEL.postMessage({ type: 'refresh:done', id, tokens } as RefreshMsg)
      return tokens
    } catch (err) {
      // refresh 自身失败（含网络错误）—— 一律踢登录
      clearTokens()
      if (onUnauthorized) onUnauthorized()
      if (REFRESH_CHANNEL) REFRESH_CHANNEL.postMessage({ type: 'refresh:failed', id } as RefreshMsg)
      throw err instanceof ApiError
        ? err
        : toApiError(err as AxiosError<BackendEnvelopeError>)
    }
  })()
  // 不论成功失败都要清空 singleton，否则一次失败会导致后续所有 401 都拿到同一个 rejected promise
  // —— 表现为"refresh 之后再也不能 refresh"，看起来 refresh token 完全失效。
  refreshing.finally(() => {
    refreshing = null
  })
  return refreshing
}

/** 创建 axios 实例并统一错误处理 */
function createHttp(_opts: { on401Redirect?: boolean }): AxiosInstance {
  const inst = axios.create({
    baseURL: BASE_URL,
    timeout: 30_000,
    headers: { 'content-type': 'application/json' }
  })

  inst.interceptors.request.use(async (config) => {
    // 主动 preflight：access 距过期 < 5 分钟就先 refresh 一次，
    // 让用户连续写 2h+ 都不会撞上 401 → refresh → retry 的瞬间延迟。
    // ensureFreshToken 内部自带跨 tab + 同 tab 去重，不会重复触发。
    await ensureFreshToken()
    const token = getAccessToken()
    if (token) config.headers.Authorization = `Bearer ${token}`
    return config
  })

  inst.interceptors.response.use(
    (res) => res,
    async (err: AxiosError<BackendEnvelopeError>) => {
      const status = err.response?.status
      const config = err.config as RetryableConfig | undefined
      const url = config?.url ?? ''

      // 1) 非 401：原样抛
      if (status !== 401) {
        throw toApiError(err)
      }

      // 2) refresh 端点自己 401 —— 不能再 refresh，否则死循环；直接踢
      if (url.includes('/api/auth/refresh')) {
        clearTokens()
        if (onUnauthorized) onUnauthorized()
        throw toApiError(err)
      }

      // 3) 普通端点 401 但本地没 refresh token —— 没法续期，直接踢
      if (!getRefreshToken()) {
        clearTokens()
        if (onUnauthorized) onUnauthorized()
        throw toApiError(err)
      }

      // 4) 已经被 retry 过一次还 401 —— 兜底防死循环，直接踢
      if (config?._retry) {
        clearTokens()
        if (onUnauthorized) onUnauthorized()
        throw toApiError(err)
      }

      // 5) 走 refresh + retry
      await doRefresh()

      const newToken = getAccessToken()
      if (!newToken || !config) {
        // 极端：setTokens 没生效（不应该发生）—— 兜底踢出
        clearTokens()
        if (onUnauthorized) onUnauthorized()
        throw toApiError(err)
      }

      // axios v1：headers 是 AxiosHeaders 实例，必须用 .set()，直接赋值会静默失败
      if (
        config.headers &&
        typeof (config.headers as AxiosHeaders).set === 'function'
      ) {
        ;(config.headers as AxiosHeaders).set('Authorization', `Bearer ${newToken}`)
      } else {
        ;(config.headers as Record<string, string>).Authorization = `Bearer ${newToken}`
      }
      config._retry = true

      try {
        // 用同一实例的 request 触发完整链路（包含请求拦截器）
        const retryRes = await inst.request(config)
        // 关键：返回成功响应，业务代码看不到 401
        return retryRes
      } catch (retryErr) {
        // 重发还 401 —— 极小概率（刚拿到的 token 立刻失效 / 路由级权限变更）。
        // fail-closed：清 token + 踢登录，抛重试的错误更具诊断价值。
        clearTokens()
        if (onUnauthorized) onUnauthorized()
        throw toApiError(retryErr as AxiosError<BackendEnvelopeError>)
      }
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