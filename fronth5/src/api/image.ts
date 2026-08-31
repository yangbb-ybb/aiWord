import { api } from './index'

/**
 * AI 生图 API 调用层(流式 SSE)。
 *
 * - 后端 endpoint: POST /api/image/chat(走 minimax Claude 真对话 + picsum 占位图)
 * - 走 fetch + ReadableStream 解析 SSE 事件流(event: meta/chunk/done/error)
 * - 不用 axios:axios 默认按 JSON 解,不会按 event 分发,需要手动读 reader 才能拿到流式增量
 * - baseURL 复用 axios 实例配置(import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8787')
 *
 * 当前后端是 picsum-placeholder(根据 prompt+style 生成稳定随机图);
 * 后续接入真生图模型时**前端无感知**,因为 SSE event 形状不变。
 */

export type ImageStyle = 'realistic' | 'illustration' | 'watercolor' | '3d'

/**
 * 多轮对话的历史回合(不含当前这条 user 请求)。
 *  - role: 'user' 来自用户输入
 *  - role: 'ai' 来自 AI 上一轮回复
 *  - imageUrl: 仅 ai 轮且成功出图时存在;后端会把它作为 image block 喂给 LLM,
 *    让 LLM 多模态看到上一张图,延续/修改/重画时构图更连贯
 */
export interface HistoryTurn {
  role: 'user' | 'ai'
  text: string
  imageUrl?: string
}

export interface ImageChatRequest {
  prompt: string
  style?: ImageStyle
  /**
   * 之前几轮对话历史,后端会拼进 LLM messages;失败轮次(无 imageUrl 或标记失败)
   * 不传,避免污染上下文。
   */
  history?: HistoryTurn[]
}

/**
 * meta 事件:后端最先发出,告诉前端"AI 在跑 + 用哪个 provider"。
 * url 可选 —— 真生图模式下,图要等 5-20s 才到位,url 在 done 事件里才出现;
 * 老占位图模式下 url 会立即出现(已废弃)。
 */
export interface ImageMeta {
  intent: 'chat'
  llmProvider: string
  imageProvider: string
  style: string
  /** 已废弃:旧版 picsum 占位图模式会立即发;真生图模式下 done 才出 url */
  url?: string
}

/** chunk 事件:每个 AI 文字增量 */
export interface ImageChunk {
  text: string
}

/** done 事件:流结束,带完整文本 + 图片 URL + 元信息 */
export interface ImageDone {
  text: string
  url: string
  style: string
  prompt: string
  provider: string
  tokens: number
  cacheRead: number
  cacheWrite: number
  durationMs: number
}

export interface ImageChatHandlers {
  onMeta?: (meta: ImageMeta) => void
  onChunk?: (chunk: ImageChunk) => void
  onDone?: (done: ImageDone) => void
  onError?: (err: Error) => void
}

/**
 * 流式调用 /api/image/chat。
 *
 * 返回的 Promise 在 done 或 error 时 resolve,handler 用于接收中间事件。
 * 如果只想等最终结果,可以只传 onDone。
 */
export async function chatImage(
  req: ImageChatRequest,
  handlers: ImageChatHandlers = {}
): Promise<void> {
  const baseURL = api.defaults.baseURL ?? ''
  const url = `${baseURL.replace(/\/$/, '')}/api/image/chat`

  let resp: Response
  try {
    resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream'
      },
      body: JSON.stringify({
        prompt: req.prompt,
        style: req.style ?? 'realistic',
        history: req.history ?? []
      })
    })
  } catch (err) {
    handlers.onError?.(err instanceof Error ? err : new Error(String(err)))
    return
  }

  if (!resp.ok || !resp.body) {
    handlers.onError?.(new Error(`HTTP ${resp.status}`))
    return
  }

  const reader = resp.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      // SSE 用空行(\n\n)分隔 event,pop 最后一个不完整的留到下一轮
      const events = buffer.split('\n\n')
      buffer = events.pop() ?? ''

      for (const evt of events) {
        const lines = evt.split('\n')
        let eventName = ''
        let dataStr = ''
        for (const line of lines) {
          if (line.startsWith('event:')) eventName = line.slice(6).trim()
          else if (line.startsWith('data:')) dataStr += line.slice(5).trim()
        }
        if (!dataStr) continue
        try {
          const data = JSON.parse(dataStr)
          if (eventName === 'meta') handlers.onMeta?.(data)
          else if (eventName === 'chunk') handlers.onChunk?.(data)
          else if (eventName === 'done') handlers.onDone?.(data)
          else if (eventName === 'error') {
            handlers.onError?.(new Error(data.message ?? 'AI error'))
          }
        } catch {
          // 非 JSON 行忽略
        }
      }
    }
  } catch (err) {
    handlers.onError?.(err instanceof Error ? err : new Error(String(err)))
  }
}