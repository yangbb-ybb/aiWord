import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { getProvider, getImageProvider } from '~/providers'
import { env } from '~/config/env'
import { AppError } from '~/services/errors'
import type { ContentBlock } from '~/providers/types'

/**
 * AI 生图接口(走 minimax 真 LLM + minimax image-01 真生图)。
 *
 * 流程 —— **并行** LLM 文字 + 图生成(图可能要 5-20s,串行太慢):
 *
 *   [meta]   → { intent, llmProvider, imageProvider }  (不带 url,图要等几秒)
 *              ┌─── A: provider.stream(LLM) ──→ 多个 chunk 事件(流式打字)
 *   [并行触发]┤
 *              └─── B: imageProvider.generate() ──→ 阻塞式 REST,等图 URL
 *
 *   [done]   → 聚合 text + url + 双 provider 名 + 各自 durationMs
 *   [error]  → 任一失败时单独推(图失败不阻塞文字,但 done 里 url=undefined)
 *
 * 设计要点:
 *  - LLM 和图任务独立失败 —— 图失败时仍能返回 AI 文字(text 不丢)
 *  - 自包含日志:image_chat done 带 llmDurationMs / imageDurationMs / totalDurationMs,
 *    看一条就知道"AI 写了什么 + 图来源 + 各自耗时"
 *  - **多轮上下文**(history):上一轮对话的 user/ai 文字 + 上一张图的 OSS URL
 *    会塞到 messages 里 —— LLM 既能看到文字历史,也能看到上一张图(image block),
 *    这样"加太阳"这种请求 LLM 知道是针对上一张雪山图;
 *    image-01 的 prompt 也拼接最近 AI 描述的主题,延续构图/风格。
 */

const chatBody = z.object({
  prompt: z.string().min(1).max(500),
  style: z
    .enum(['realistic', 'illustration', 'watercolor', '3d'])
    .default('realistic'),
  /**
   * 多轮对话历史(不含当前这条)。每条带 imageUrl 时是 ai 轮且成功出图,
   * 后端会把该图的 URL 作为 image block 塞到 messages.content,让 LLM 多模态看图。
   * 上限 20 条(≈10 轮对话)避免 prompt 过长。
   */
  history: z
    .array(
      z.object({
        role: z.enum(['user', 'ai']),
        text: z.string().min(0).max(2000),
        imageUrl: z.string().url().optional()
      })
    )
    .max(20)
    .optional()
    .default([])
})

const STYLE_DESC: Record<string, string> = {
  realistic: '写实摄影',
  illustration: '插画',
  watercolor: '水彩',
  '3d': '3D 渲染'
}

/**
 * history → LLM messages 数组。
 *  - role: 'user' → content 是 string(text)
 *  - role: 'ai' 且带 imageUrl → content 是 ContentBlock[] = [image, text]
 *    让 LLM 先"看"上一张图,再读 AI 的说明文字
 *  - role: 'ai' 不带 imageUrl → content 是 string(text),即失败的轮次
 */
function historyToMessages(
  history: Array<{ role: 'user' | 'ai'; text: string; imageUrl?: string }>
): Array<{ role: 'user' | 'assistant'; content: string | ContentBlock[] }> {
  const out: Array<{
    role: 'user' | 'assistant'
    content: string | ContentBlock[]
  }> = []
  for (const h of history) {
    const role = h.role === 'user' ? 'user' : 'assistant'
    if (role === 'assistant' && h.imageUrl) {
      // 多模态:先图后文
      out.push({
        role,
        content: [
          {
            type: 'image' as const,
            source: { type: 'url' as const, data: h.imageUrl }
          },
          { type: 'text' as const, text: h.text }
        ]
      })
    } else {
      out.push({ role, content: h.text })
    }
  }
  return out
}

/**
 * 从 history 里抽出 ai 文字描述作为"上一张图的主题背景",
 * 拼接到 image-01 的 prompt 前,让新图延续(构图/主体/色调)的概率更大。
 * 只取最近 2 条 AI 描述,避免 prompt 过长被 image-01 截断。
 */
function buildImagePromptWithHistory(
  base: string,
  history: Array<{ role: 'user' | 'ai'; text: string; imageUrl?: string }>
): string {
  const recentAi = history
    .filter((h) => h.role === 'ai' && h.imageUrl && h.text)
    .slice(-2)
    .map((h) => h.text.trim())
    .filter(Boolean)
  if (recentAi.length === 0) return base
  return `${base}(延续上文主题:${recentAi.join(' / ')})`
}

/**
 * 同时检查 LLM provider 和 image provider 是否有 API Key。
 * 任一缺都直接 503 + AI_NOT_CONFIGURED(不进 SSE 流,避免半路开流)。
 */
function ensureAiAvailable(req: any, reply: any): boolean {
  try {
    getProvider()
    getImageProvider()
    return true
  } catch (e: any) {
    req.log.error({ aiEvent: 'no_api_key', err: e }, 'AI service not configured')
    reply.code(503).send({
      code: 503,
      errorCode: 'AI_NOT_CONFIGURED',
      message:
        'AI 服务未配置 API Key。请在 end/.env 里设置 MINIMAX_API_KEY 或 ANTHROPIC_API_KEY 后重启后端。'
    })
    return false
  }
}

/**
 * 流式调用 LLM + 并行调 image provider,SSE 输出。
 * event: meta | chunk | done | error
 */
async function streamImageChat(
  req: any,
  reply: any,
  body: {
    prompt: string
    style: 'realistic' | 'illustration' | 'watercolor' | '3d'
    history?: Array<{ role: 'user' | 'ai'; text: string; imageUrl?: string }>
  }
) {
  // reply.raw.write() 绕过 @fastify/cors,需手动补 CORS 头,否则浏览器看不到 chunk
  const origin = req.headers.origin ?? req.headers.Origin
  if (origin) {
    reply.raw.setHeader('Access-Control-Allow-Origin', origin)
    reply.raw.setHeader('Vary', 'Origin')
  }
  reply.raw.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  reply.raw.setHeader('Cache-Control', 'no-cache, no-transform')
  reply.raw.setHeader('Connection', 'keep-alive')
  reply.raw.setHeader('X-Accel-Buffering', 'no')
  reply.raw.flushHeaders?.()

  const send = (e: string, data: unknown) => {
    reply.raw.write(`event: ${e}\ndata: ${JSON.stringify(data)}\n\n`)
  }

  const llmProvider = getProvider()
  const imageProvider = getImageProvider()
  const history = body.history ?? []

  // 先发 meta(不带 url,因为图要等几秒;只告诉前端"AI 在跑,用哪个 provider")
  send('meta', {
    intent: 'chat',
    llmProvider: llmProvider.name,
    imageProvider: imageProvider.name,
    style: body.style,
    historyLen: history.length
  })

  const llmStart = Date.now()
  let llmText = ''
  let llmTokens = 0
  let llmCacheRead = 0
  let llmCacheWrite = 0
  let llmError: unknown = null

  const llmSignal = AbortSignal.timeout(env.LLM_TIMEOUT_MS)
  const llmPromise = llmProvider
    .stream(
      {
        model: env.MINIMAX_MODEL,
        system: [
          '你是 aiWord 的 AI 图像生成助手。',
          history.length
            ? '如果上文里有图(image block),那张图是你之前画的;用户的最新请求通常是对那张图的延续/修改/重画,请在回复中呼应上下文,不要当作全新请求。'
            : '用户描述了一张图,你会看到 prompt + style 信息。',
          '请用 1~2 句中文回应,描述你"画了"什么,语气亲切生动,不要提及具体的图片 URL 或技术细节。',
          '不要使用 markdown / 列表 / emoji,直接给一段话。'
        ].join('\n'),
        messages: [
          // 多轮上下文:把之前的 user/ai 拼进来;有图的多模态消息也会带上
          ...historyToMessages(history),
          {
            role: 'user',
            content: `[用户请求]\n描述:${body.prompt}\n风格:${STYLE_DESC[body.style] ?? body.style}`
          }
        ],
        maxTokens: 200,
        temperature: 0.8,
        signal: llmSignal
      },
      (delta) => {
        // 流式:每个 token 推一个 chunk 事件,前端能逐字渲染
        llmText += delta
        send('chunk', { text: delta })
      }
    )
    .then((res) => {
      llmTokens = res.tokens ?? 0
      llmCacheRead = res.cacheRead ?? 0
      llmCacheWrite = res.cacheWrite ?? 0
    })
    .catch((err) => {
      llmError = err
    })

  // 图片任务:阻塞式 REST。prompt 拼上最近 AI 描述作"延续主题",构图/风格更连贯
  const imagePromise = imageProvider
    .generate({
      prompt: buildImagePromptWithHistory(body.prompt, history),
      style: body.style
    })
    .catch((err) => {
      throw err
    })

  // 等两边 —— 用 allSettled 而不是 all,这样 LLM 失败不会阻塞 image 结果
  const [llmResult, imageResult] = await Promise.allSettled([
    llmPromise,
    imagePromise
  ])

  const totalStart = llmStart
  const llmDurationMs = Date.now() - llmStart

  // 收集图结果
  let url: string | undefined
  let imageUpstreamMs: number | undefined
  let imageError: AppError | null = null
  if (imageResult.status === 'fulfilled') {
    url = imageResult.value.url
    imageUpstreamMs = imageResult.value.upstreamMs
  } else {
    imageError =
      imageResult.reason instanceof AppError
        ? imageResult.reason
        : new AppError(
            'IMAGE_UPSTREAM_ERROR',
            String(imageResult.reason?.message ?? imageResult.reason),
            502
          )
  }

  // 如果 LLM 失败也包一层(之前 llmPromise 已经 catch 但保存到 llmError)
  if (llmError) {
    send('error', {
      message: (llmError as any)?.message ?? 'LLM error',
      code: 'LLM_ERROR'
    })
  }

  // 如果图失败,推 error 事件(图失败不阻塞 LLM 文字)
  if (imageError) {
    send('error', {
      message: imageError.message,
      code: imageError.code
    })
  }

  // done 事件:聚合两边结果
  send('done', {
    text: llmText,
    url, // undefined 时前端知道图加载失败
    style: body.style,
    prompt: body.prompt,
    llmProvider: llmProvider.name,
    imageProvider: imageProvider.name,
    llmTokens,
    llmCacheRead,
    llmCacheWrite,
    llmDurationMs,
    imageUpstreamMs,
    totalDurationMs: Date.now() - totalStart
  })

  // 自包含日志:看一条就知道完整结果 + 耗时拆分
  req.log.info(
    {
      aiEvent: 'image_chat',
      method: req.method,
      route: req.routerPath ?? req.url,
      prompt: body.prompt,
      style: body.style,
      promptChars: body.prompt.length,
      historyLen: history.length,
      historyWithImage: history.filter((h) => h.imageUrl).length,
      url,
      llmProvider: llmProvider.name,
      imageProvider: imageProvider.name,
      llmTokens,
      llmCacheRead,
      llmCacheWrite,
      outputChars: llmText.length,
      llmDurationMs,
      imageUpstreamMs,
      totalDurationMs: Date.now() - totalStart,
      ...(imageError
        ? { imageErrorCode: imageError.code, imageErrorMessage: imageError.message }
        : {}),
      ...(llmError
        ? { llmError: (llmError as any)?.message ?? String(llmError) }
        : {})
    },
    'image chat done'
  )

  // 整个流结束
  reply.raw.end()
}

export default async function imageRoutes(app: FastifyInstance) {
  app.post('/chat', async (req, reply) => {
    if (!ensureAiAvailable(req, reply)) return
    const body = chatBody.parse(req.body)
    await streamImageChat(req, reply, body)
  })
}