import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import {
  runGenerate,
  runRewrite,
  runSummarize,
  runTranslate
} from '~/services/ai'

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
  /** 对话历史：[{role, content}] —— AI 用它"记住"之前几轮生成过什么 */
  history: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string()
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
 * 通用：流式调用 AI 服务并把每个 chunk 写成 SSE。
 * event: chunk | done | error
 *
 * runner 是 (onChunk) => Promise<{text, tokens}>；这里再套一层日志和计时。
 */
async function streamAi(
  req: any,
  reply: any,
  event: string,
  runner: (
    onChunk: (delta: string) => void
  ) => Promise<{ text: string; tokens?: number }>
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
  try {
    const result = await runner((delta) => {
      chunkCount++
      send('chunk', { text: delta })
    })
    send('done', { text: result.text, tokens: result.tokens })
    req.log.info(
      {
        aiEvent: event,
        tokens: result.tokens ?? 0,
        chunks: chunkCount,
        outputChars: result.text.length,
        durationMs: Date.now() - start
      },
      `ai ${event} done`
    )
  } catch (err: any) {
    req.log.error(
      {
        aiEvent: event,
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

export default async function aiRoutes(app: FastifyInstance) {
  app.post('/generate', async (req, reply) => {
    const body = generateBody.parse(req.body)
    // 单独写一条"开始生成"的日志，方便排查
    req.log.info(
      {
        aiEvent: 'generate_start',
        model: body.model ?? '(default)',
        tone: body.tone ?? '(default)',
        length: body.length ?? '(default)',
        language: body.language ?? '(default)',
        promptChars: body.prompt.length,
        contextChars: body.contextText?.length ?? 0
      },
      'ai generate start'
    )
    await streamAi(req, reply, 'generate', (onChunk) =>
      runGenerate(body, onChunk)
    )
  })

  app.post('/rewrite', async (req, reply) => {
    const body = rewriteBody.parse(req.body)
    req.log.info(
      {
        aiEvent: 'rewrite_start',
        model: body.model ?? '(default)',
        tone: body.tone ?? '(default)',
        textChars: body.text.length,
        instructionChars: body.instruction?.length ?? 0
      },
      'ai rewrite start'
    )
    await streamAi(req, reply, 'rewrite', (onChunk) => runRewrite(body, onChunk))
  })

  app.post('/summarize', async (req, reply) => {
    const body = summarizeBody.parse(req.body)
    req.log.info(
      {
        aiEvent: 'summarize_start',
        model: body.model ?? '(default)',
        textChars: body.text.length,
        maxChars: body.maxChars ?? '(default)'
      },
      'ai summarize start'
    )
    await streamAi(req, reply, 'summarize', (onChunk) =>
      runSummarize(body, onChunk)
    )
  })

  app.post('/translate', async (req, reply) => {
    const body = translateBody.parse(req.body)
    req.log.info(
      {
        aiEvent: 'translate_start',
        model: body.model ?? '(default)',
        targetLang: body.targetLang,
        textChars: body.text.length
      },
      'ai translate start'
    )
    await streamAi(req, reply, 'translate', (onChunk) =>
      runTranslate(body, onChunk)
    )
  })

  // 列出 provider 模型 —— 前端 select 直接渲染这里的 list
  app.get('/models', async (req) => {
    const { getProvider } = await import('~/providers')
    const p = getProvider()
    req.log.info(
      { aiEvent: 'list_models', provider: p.name, modelCount: p.listModels().length },
      'ai list models'
    )
    return { provider: p.name, models: p.listModels() }
  })
}
