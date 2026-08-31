import { AppError } from '~/services/errors'
import { env } from '~/config/env'

/**
 * minimax image-01 真生图 provider。
 *
 * 与现有 claude.ts 平级(独立 ImageProvider 类型,因为 image 是阻塞式 REST,
 * 跟 LLM 的流式接口形态完全不同,不混入 AIProvider.stream())。
 *
 * 协议:
 *  - endpoint: POST {baseURL}/v1/image_generation
 *  - 鉴权: Authorization: Bearer ${MINIMAX_API_KEY}(复用同一个 key)
 *  - request_format: url(24h 过期,不落本地缓存)
 *  - prompt_optimizer: true(让 minimax 自动润色)
 *
 * 错误:网络/超时/4xx/5xx 都抛 AppError;route 层 catch 后写到 SSE error 事件。
 */

export interface MinimaxImageRequest {
  model: string
  prompt: string
  aspect_ratio?: string
  response_format?: 'url' | 'base64'
  prompt_optimizer?: boolean
}

/**
 * minimax 实际响应 key 是 `data.image_urls`(不是 `data.images`),
 * 文档和实测有出入 —— 以 curl 实测为准,这里用 type 兼容两种:
 *  1. { data: { image_urls: string[] } }     ← 主路径
 *  2. { data: [{ url }] }                    ← OpenAI 兼容兜底
 */
export interface MinimaxImageResponse {
  data?:
    | { image_urls?: string[]; image_base64?: string[] }
    | Array<{ url?: string; b64_json?: string }>
  metadata?: Record<string, unknown>
  base_resp?: { status_code?: number; status_msg?: string }
}

export interface ImageProvider {
  name: string
  listModels(): ImageModelInfo[]
  generate(input: {
    prompt: string
    style?: 'realistic' | 'illustration' | 'watercolor' | '3d'
  }): Promise<{
    url: string
    revisedPrompt?: string
    upstreamMs: number
  }>
}

export interface ImageModelInfo {
  id: string
  label: string
}

const STYLE_PROMPT_SUFFIX: Record<string, string> = {
  realistic: '写实摄影风格,真实光影',
  illustration: '插画风格,扁平或半写实',
  watercolor: '水彩画风格,通透晕染',
  '3d': '3D 渲染,立体感强'
}

/**
 * factory:返回一个 minimax image-01 provider。
 * 失败抛 AppError(让 route 层统一转 503 / 502)。
 */
export function createMinimaxImageProvider(opts: {
  apiKey: string
  baseURL: string
  model: string
  timeoutMs: number
}): ImageProvider {
  // baseURL 一般是 https://api.minimaxi.com,endpoint 拼上 /v1/image_generation
  const endpoint = `${opts.baseURL.replace(/\/$/, '')}/v1/image_generation`

  return {
    name: 'minimax-image-01',

    listModels() {
      return [{ id: opts.model, label: `minimax · ${opts.model}` }]
    },

    async generate(input) {
      // 在 prompt 末尾追加风格提示(prompt_optimizer=true 会自动润色,
      // 但加显式风格后缀能提升一致性和出图质量)
      const styleSuffix = input.style ? STYLE_PROMPT_SUFFIX[input.style] : ''
      const prompt = styleSuffix
        ? `${input.prompt},${styleSuffix}`
        : input.prompt

      const body: MinimaxImageRequest = {
        model: opts.model,
        prompt,
        aspect_ratio: '1:1',
        response_format: 'url',
        prompt_optimizer: true
      }

      const start = Date.now()
      let resp: Response
      try {
        resp = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${opts.apiKey}`
          },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(opts.timeoutMs)
        })
      } catch (err: any) {
        if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
          throw new AppError(
            'IMAGE_TIMEOUT',
            `minimax image 请求超时(${opts.timeoutMs}ms)`,
            504
          )
        }
        throw new AppError(
          'IMAGE_UPSTREAM_ERROR',
          `minimax image 网络错误:${err?.message ?? err}`,
          502
        )
      }

      if (!resp.ok) {
        const text = await resp.text().catch(() => '')
        throw new AppError(
          'IMAGE_UPSTREAM_ERROR',
          `minimax image HTTP ${resp.status}: ${text.slice(0, 300)}`,
          resp.status >= 500 ? 502 : 400
        )
      }

      let json: MinimaxImageResponse
      try {
        json = (await resp.json()) as MinimaxImageResponse
      } catch (err: any) {
        throw new AppError(
          'IMAGE_UPSTREAM_ERROR',
          `minimax image 响应不是 JSON:${err?.message ?? err}`,
          502
        )
      }

      // 业务码检查:minimax 返回 base_resp.status_code,非 0 表示业务失败
      if (json.base_resp?.status_code && json.base_resp.status_code !== 0) {
        throw new AppError(
          'IMAGE_INVALID_PROMPT',
          json.base_resp.status_msg ?? 'minimax image 业务失败',
          400
        )
      }

      // 兼容两种响应结构
      let url: string | undefined
      if (json.data && !Array.isArray(json.data)) {
        url = json.data.image_urls?.[0]
        if (!url && json.data.image_base64?.[0]) {
          // 理论上选了 url format 就不会走这,但兜底一下
          url = `data:image/jpeg;base64,${json.data.image_base64[0]}`
        }
      } else if (Array.isArray(json.data)) {
        url = json.data[0]?.url
      }

      if (!url) {
        throw new AppError(
          'IMAGE_UPSTREAM_ERROR',
          'minimax image 响应里没有 image_urls / url 字段',
          502
        )
      }

      return {
        url,
        upstreamMs: Date.now() - start
      }
    }
  }
}

/**
 * 检查 image provider 是否可用(有 API key)。
 * 抛错时由 route 层 ensureImageAvailable 转 503。
 */
export function ensureImageApiKey(): string {
  if (!env.MINIMAX_API_KEY) {
    throw new AppError(
      'AI_NOT_CONFIGURED',
      'AI 服务未配置 API Key。请在 end/.env 里设置 MINIMAX_API_KEY 后重启后端。',
      503
    )
  }
  return env.MINIMAX_API_KEY
}