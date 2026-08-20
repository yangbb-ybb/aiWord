/**
 * 调用后端 SSE 流式接口：POST /api/ai/generate 等。
 * 后端用 Fastify reply.raw.write(...) 按规范输出：
 *   event: chunk | done | error
 *   data: { text: '...' } | { text, tokens } | { message }
 *
 * ⚠️ 这里必须用 fetch —— SSE 的 ReadableStream 流式读取只有 fetch 支持。
 *    axios 会等整个 body 读完才返回，无法做"一边生成一边渲染"。
 *    EventSource 也不行，它只支持 GET，不支持 POST body。
 *    所以这是项目里唯一允许直接调 fetch 的地方，其它业务代码必须走 ./api 的 axios 封装。
 */
import { BASE_URL, getAccessToken, ApiError, refreshTokens, ensureFreshToken } from './api'

export { ApiError }

export interface StreamChunkEvent {
  text: string
}
export interface StreamMetaEvent {
  intent: 'edit' | 'analyze' | 'chat'
  ask: 'none' | 'choice' | 'confirm'
}
export interface StreamDoneEvent {
  text: string
  tokens?: number
}
export interface StreamErrorEvent {
  message: string
}

export interface StreamHandlers {
  onDelta?: (delta: string) => void
  /**
   * 后端在流式 chunk 攒齐头部协议后**立刻**推过来的结构化 meta。
   * - intent: AI 对文档的态度（edit/analyze/chat）
   * - ask: AI 是否在等用户做选择（none/choice/confirm）
   * 只要拿到，前端就能直接显示对应 UI，**不再依赖从 text 文本里正则解析**。
   */
  onMeta?: (meta: StreamMetaEvent) => void
  onDone?: (payload: StreamDoneEvent) => void
  onError?: (payload: StreamErrorEvent) => void
}

/**
 * 发起一次流式 POST。返回 Promise<fullText>。
 * - 如果中途后端发了 `event: error`，抛 ApiError。
 * - 如果网络层就挂了，抛 ApiError('NETWORK_ERROR')。
 */
export async function postStream(
  path: string,
  body: unknown,
  handlers: StreamHandlers = {}
): Promise<string> {
  // 主动 preflight：access 距过期 < 5 分钟就先 refresh，免得 SSE 长流撞上 401 中断。
  await ensureFreshToken()
  const token = getAccessToken()
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'text/event-stream'
  }
  if (token) headers.authorization = `Bearer ${token}`

  let res = await fetch(BASE_URL + path, {
    method: 'POST',
    headers,
    body: JSON.stringify(body ?? {}),
    // 不让 axios/fetch 缓存
    cache: 'no-store'
  })

  // SSE 端点不走 axios 拦截器，所以 access 过期时不会自动 refresh。
  // 拿到 401 时手动触发一次 refresh（内部已含跨 tab 协调 + 同 tab 并发去重），
  // 然后用新 token 重试一次 fetch。
  if (res.status === 401) {
    try {
      const newTokens = await refreshTokens()
      headers.authorization = `Bearer ${newTokens.accessToken}`
      res = await fetch(BASE_URL + path, {
        method: 'POST',
        headers,
        body: JSON.stringify(body ?? {}),
        cache: 'no-store'
      })
    } catch {
      // refresh 失败 —— refreshTokens() 内部已经 clearTokens + onUnauthorized + throw 了，
      // 这里直接抛 ApiError 让上层处理（前端会被踢到 /login）。
      throw new ApiError(401, 401, 'REFRESH_FAILED', 'SSE 401 后 refresh 失败，请重新登录')
    }
  }

  if (!res.ok) {
    // 后端 SSE 在出错时会降级成普通 JSON（其实只有 5xx 才会进 errorHandler）。
    // 这里先尝试读一下 body，给一个友好错误。
    let payload: { code?: number; errorCode?: string; message?: string } | undefined
    try {
      payload = (await res.json()) as typeof payload
    } catch {
      /* 不是 JSON 就忽略 */
    }
    throw new ApiError(
      res.status,
      res.status,
      payload?.errorCode ?? 'STREAM_HTTP_ERROR',
      payload?.message ?? `SSE 请求失败：HTTP ${res.status}`
    )
  }

  if (!res.body) {
    throw new ApiError(0, 0, 'NO_BODY', '响应没有 body')
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''
  let currentEvent = ''
  let fullText = ''

  // SSE 一帧由若干行组成：event: <name>\n data: <json>\n\n
  const flushFrame = (frame: string) => {
    if (!frame) return
    let dataLine: string | null = null
    for (const line of frame.split('\n')) {
      if (line.startsWith('event:')) {
        currentEvent = line.slice(6).trim()
      } else if (line.startsWith('data:')) {
        dataLine = line.slice(5).trim()
      }
    }
    if (dataLine == null) return
    let payload: unknown
    try {
      payload = JSON.parse(dataLine)
    } catch {
      payload = { text: dataLine }
    }
    if (currentEvent === 'chunk') {
      const text = (payload as StreamChunkEvent)?.text ?? ''
      fullText += text
      handlers.onDelta?.(text)
    } else if (currentEvent === 'meta') {
      // 后端解析出头部协议后第一时间推过来的结构化字段
      // 前端不再需要从 text 文本里正则挖 [INTENT]/[ASK]
      handlers.onMeta?.(payload as StreamMetaEvent)
    } else if (currentEvent === 'done') {
      const p = payload as StreamDoneEvent
      // 兜底：若 done 自带 text 但 chunk 没汇齐，用 done.text 补上
      if (p.text && p.text.length > fullText.length) fullText = p.text
      handlers.onDone?.(p)
    } else if (currentEvent === 'error') {
      const p = payload as StreamErrorEvent
      handlers.onError?.(p)
      throw new ApiError(res.status, res.status, 'STREAM_ERROR', p.message ?? 'AI 生成失败')
    }
  }

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    // 按空行（\n\n）切帧，剩下的尾巴塞回 buffer
    let idx = buffer.indexOf('\n\n')
    while (idx !== -1) {
      const frame = buffer.slice(0, idx)
      buffer = buffer.slice(idx + 2)
      flushFrame(frame)
      idx = buffer.indexOf('\n\n')
    }
  }
  // 流关闭后再 flush 一次尾巴
  flushFrame(buffer)

  return fullText
}