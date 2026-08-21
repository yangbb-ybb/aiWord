import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import {
  runGenerate,
  runRewrite,
  runSummarize,
  runTranslate
} from '~/services/ai'
import { resolveApiKey } from '~/providers'
import { env } from '~/config/env'

const generateBody = z.object({
  prompt: z.string().default(''),
  /** 前端下拉的 model id，如 'claude-sonnet' / 'claude-haiku' / 'claude-opus' */
  model: z.string().optional(),
  tone: z.enum(['formal', 'casual', 'marketing', 'technical']).optional(),
  /** 前端滑块值 0/25/50/75/100，对应 short/medium/medium_long/long */
  length: z.number().int().min(0).max(100).optional(),
  language: z.enum(['zh', 'en', 'mixed']).optional(),
  /** 已存在的正文（续写场景） */
  contextText: z.string().optional(),
  /** 对话历史：[{role, content, kind?}] —— AI 用它"记住"之前几轮做过什么
   *  - kind='edit'    → content 是 AI 之前给出的"完整新文档"
   *  - kind='analyze' → content 是 AI 之前给出的"评价/建议"
   *  - kind='chat'    → content 是 AI 之前的聊天回复
   *  - 缺省视为 'edit'，保持向后兼容
   */
  history: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string(),
        kind: z.enum(['edit', 'analyze', 'chat']).optional()
      })
    )
    .optional()
})

const rewriteBody = z.object({
  text: z.string().min(1),
  instruction: z.string().optional(),
  tone: z.enum(['formal', 'casual', 'marketing', 'technical']).optional(),
  model: z.string().optional()
})

const summarizeBody = z.object({
  text: z.string().min(1),
  maxChars: z.number().int().positive().max(2000).optional(),
  model: z.string().optional()
})

const translateBody = z.object({
  text: z.string().min(1),
  targetLang: z.enum(['zh', 'en', 'mixed']),
  model: z.string().optional()
})

/**
 * 在真正走 SSE 流之前拦截无 API Key 的情况：直接返回 503 + 友好提示。
 * 替代之前在 Anthropic SDK 里抛 "Could not resolve authentication method" 的尴尬错误。
 */
function ensureAiAvailable(req: any, reply: any): boolean {
  try {
    resolveApiKey()
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
 * 通用：流式调用 AI 服务并把每个 chunk 写成 SSE。
 * event: meta | chunk | done | error
 *
 * meta 事件承载 AI 头部声明 [INTENT]/[ASK]/[CONTENT] 的结构化字段（一旦拿到就立刻发），
 * 这样前端不需要靠正则从文本里挖协议位，能直接拿到干净的 { intent, ask }。
 *
 * done 事件附带 cacheRead/cacheWrite：来自 Anthropic prompt cache 命中/写入 tokens，
 * 前端可在 UI 上展示"本次命中 cache X tokens"，让用户感知 prompt caching 的省钱效果。
 *
 * `input` 是本次请求的**结构化入参快照**（端点、model、tone、字数、文本长度等），会同时写进
 * 服务端日志（done/failed 两条都带）。这样排查时一条日志就能看到"调用了哪个端点 + 带了什么参数
 * + 消耗多少 token + 花了多久"，不用再去 grep _start 拼上下文。各 route 负责挑出自己关心的字段。
 *
 * runner 是 (onChunk, onMeta) => Promise<{text, tokens, cacheRead?, cacheWrite?}>；这里再套一层日志和计时。
 */
async function streamAi(
  req: any,
  reply: any,
  event: string,
  input: Record<string, unknown>,
  runner: (
    onChunk: (delta: string) => void,
    onMeta: (meta: { intent: 'edit' | 'analyze' | 'chat'; ask: 'none' | 'choice' | 'confirm' }) => void
  ) => Promise<{ text: string; tokens?: number; cacheRead?: number; cacheWrite?: number }>
) {
  // reply.raw.write() 会绕过 @fastify/cors 的 reply.send 自动注入，
  // 所以这里手动把 CORS 头带上，否则浏览器会判定跨域失败、看不到任何 chunk。
  const origin = (req.headers.origin ?? req.headers.Origin) as string | undefined
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
    reply.raw.write(`event: ${e}\n`)
    reply.raw.write(`data: ${JSON.stringify(data)}\n\n`)
  }

  const start = Date.now()
  let chunkCount = 0
  let metaSent = false
  try {
    const result = await runner(
      (delta) => {
        chunkCount++
        send('chunk', { text: delta })
      },
      // meta 一旦确定立刻 push 给前端，前端不再依赖正则从 text 解析协议
      (meta) => {
        if (metaSent) return
        metaSent = true
        send('meta', meta)
      }
    )
    send('done', {
      text: result.text,
      tokens: result.tokens,
      cacheRead: result.cacheRead ?? 0,
      cacheWrite: result.cacheWrite ?? 0
    })
    // 默认把 AI 完整回复原文写进日志（最长 ~16k 字符），方便本地调试和回溯。
    // 想关掉就在 end/.env 里设 LOG_AI_OUTPUT=false —— output 字段就不会出现在日志里。
    req.log.info(
      {
        aiEvent: event,
        // HTTP 上下文：让 done 日志自包含，看一条就知道 method+route+body 摘要+指标，
        // 不用再回去 grep incoming request / _start 拼上下文
        method: req.method,
        route: req.routerPath ?? req.url,
        // 入参快照：端点(model/tone/lang/target...) + 文本长度，避免事后排查时去 grep 上一条 _start
        input,
        tokens: result.tokens ?? 0,
        cacheRead: result.cacheRead ?? 0,
        cacheWrite: result.cacheWrite ?? 0,
        chunks: chunkCount,
        outputChars: result.text.length,
        durationMs: Date.now() - start,
        ...(env.LOG_AI_OUTPUT ? { output: result.text } : {})
      },
      `ai ${event} done`
    )
  } catch (err: any) {
    req.log.error(
      {
        aiEvent: event,
        // 失败也带 method/route/input —— 失败日志的价值 80% 在于能复现"用户当时发了啥"
        method: req.method,
        route: req.routerPath ?? req.url,
        input,
        err,
        durationMs: Date.now() - start
      },
      `ai ${event} failed`
    )
    send('error', { message: err?.message ?? 'unknown error' })
  } finally {
    reply.raw.end()
  }
}

// ai 接口
export default async function aiRoutes(app: FastifyInstance) {
  app.post('/generate', async (req, reply) => {
    if (!ensureAiAvailable(req, reply)) return
    const body = generateBody.parse(req.body)
    await streamAi(
      req,
      reply,
      'generate',
      {
        model: body.model ?? '(default)',
        tone: body.tone ?? '(default)',
        length: body.length ?? '(default)',
        language: body.language ?? '(default)',
        promptChars: body.prompt.length,
        contextChars: body.contextText?.length ?? 0,
        historyLen: body.history?.length ?? 0
      },
      (onChunk, onMeta) => runGenerate(body, onChunk, onMeta)
    )
  })

  app.post('/rewrite', async (req, reply) => {
    if (!ensureAiAvailable(req, reply)) return
    const body = rewriteBody.parse(req.body)
    await streamAi(
      req,
      reply,
      'rewrite',
      {
        model: body.model ?? '(default)',
        tone: body.tone ?? '(default)',
        textChars: body.text.length,
        instructionChars: body.instruction?.length ?? 0
      },
      (onChunk, onMeta) => runRewrite(body, onChunk, onMeta)
    )
  })

  app.post('/summarize', async (req, reply) => {
    if (!ensureAiAvailable(req, reply)) return
    const body = summarizeBody.parse(req.body)
    await streamAi(
      req,
      reply,
      'summarize',
      {
        model: body.model ?? '(default)',
        maxChars: body.maxChars ?? '(default)',
        textChars: body.text.length
      },
      (onChunk, onMeta) => runSummarize(body, onChunk, onMeta)
    )
  })

  app.post('/translate', async (req, reply) => {
    if (!ensureAiAvailable(req, reply)) return
    const body = translateBody.parse(req.body)
    await streamAi(
      req,
      reply,
      'translate',
      {
        model: body.model ?? '(default)',
        targetLang: body.targetLang,
        textChars: body.text.length
      },
      (onChunk, onMeta) => runTranslate(body, onChunk, onMeta)
    )
  })

  // 列出 provider 模型 —— 前端 select 直接渲染这里的 list
  // 注意：getProvider() 会在缺 key 时抛错，这里捕获并返回 provider=null，让前端走降级
  app.get('/models', async (req, reply) => {
    const { getProvider } = await import('~/providers')
    try {
      const p = getProvider()
      req.log.info(
        { aiEvent: 'list_models', provider: p.name, modelCount: p.listModels().length },
        'ai list models'
      )
      return { provider: p.name, models: p.listModels(), configured: true }
    } catch (e: any) {
      req.log.warn(
        { aiEvent: 'list_models_failed', err: e?.message },
        'AI not configured; returning empty model list'
      )
      // 返回 200 + 空列表 + configured=false，前端能据此给降级提示
      return { provider: null, models: [], configured: false }
    }
  })
}
