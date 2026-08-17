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
  model: z.string().optional(),
  tone: z.enum(['formal', 'casual', 'marketing', 'technical']).optional(),
  length: z.enum(['short', 'medium', 'medium_long', 'long']).optional(),
  language: z.enum(['zh', 'en', 'mixed']).optional(),
  contextText: z.string().optional()
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
 */
async function streamAi(
  reply: any,
  runner: (
    onChunk: (delta: string) => void
  ) => Promise<{ text: string; tokens?: number }>
) {
  reply.raw.setHeader('Content-Type', 'text/event-stream; charset=utf-8')
  reply.raw.setHeader('Cache-Control', 'no-cache, no-transform')
  reply.raw.setHeader('Connection', 'keep-alive')
  reply.raw.setHeader('X-Accel-Buffering', 'no')
  reply.raw.flushHeaders?.()

  const send = (event: string, data: unknown) => {
    reply.raw.write(`event: ${event}\n`)
    reply.raw.write(`data: ${JSON.stringify(data)}\n\n`)
  }

  try {
    const result = await runner((delta) => send('chunk', { text: delta }))
    send('done', { text: result.text, tokens: result.tokens })
  } catch (err: any) {
    reply.log.error(err)
    send('error', { message: err?.message ?? 'unknown error' })
  } finally {
    reply.raw.end()
  }
}

export default async function aiRoutes(app: FastifyInstance) {
  app.post('/generate', async (req, reply) => {
    const body = generateBody.parse(req.body)
    await streamAi(reply, (onChunk) => runGenerate(body, onChunk))
  })

  app.post('/rewrite', async (req, reply) => {
    const body = rewriteBody.parse(req.body)
    await streamAi(reply, (onChunk) => runRewrite(body, onChunk))
  })

  app.post('/summarize', async (req, reply) => {
    const body = summarizeBody.parse(req.body)
    await streamAi(reply, (onChunk) => runSummarize(body, onChunk))
  })

  app.post('/translate', async (req, reply) => {
    const body = translateBody.parse(req.body)
    await streamAi(reply, (onChunk) => runTranslate(body, onChunk))
  })

  // 列出 provider 模型
  app.get('/models', async () => {
    const { getProvider } = await import('~/providers')
    const p = getProvider()
    return { provider: p.name, models: p.listModels() }
  })
}
