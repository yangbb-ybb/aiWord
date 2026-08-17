import Fastify from 'fastify'
import cors from '@fastify/cors'
import rateLimit from '@fastify/rate-limit'
import { ZodError } from 'zod'
import { env } from '~/config/env'
import { registerAuthPlugin } from '~/plugins/auth'
import aiRoutes from '~/routes/ai'
import authRoutes from '~/routes/auth'
import documentsRoutes from '~/routes/documents'
import templatesRoutes from '~/routes/templates'
import usersRoutes from '~/routes/users'
import exportRoutes from '~/routes/export'

export async function buildApp() {
  const app = Fastify({
    logger:
      env.NODE_ENV === 'development'
        ? {
            level: env.LOG_LEVEL,
            transport: {
              target: 'pino-pretty',
              options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' }
            }
          }
        : { level: env.LOG_LEVEL }
  })

  // CORS —— 默认放行前端 dev 地址；生产收紧
  await app.register(cors, {
    origin: env.CORS_ORIGIN.split(',').map((s) => s.trim()),
    credentials: false,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS']
  })

  // 速率限制（默认 60 req/min，AI 路由在注册时自己再覆盖）
  await app.register(rateLimit, {
    max: 60,
    timeWindow: '1 minute'
  })

  // 全局错误处理：把 zod 错误统一转 400
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({
        code: 'VALIDATION_ERROR',
        message: '请求参数不合法',
        details: err.flatten()
      })
    }
    req.log.error(err)
    const status = (err as { statusCode?: number }).statusCode ?? 500
    return reply.code(status).send({
      code: (err as { code?: string }).code ?? 'INTERNAL_ERROR',
      message: err.message ?? 'Internal Server Error'
    })
  })

  // 简单 API key 校验中间件（写操作）
  app.addHook('preHandler', async (req, reply) => {
    if (!env.AUTH_TOKEN) return // 没设置就不校验
    if (req.method === 'GET' || req.method === 'OPTIONS') return
    const got = req.headers['x-api-key']
    if (got !== env.AUTH_TOKEN) {
      return reply.code(401).send({ code: 'UNAUTHORIZED' })
    }
  })

  // 健康检查
  app.get('/health', async () => ({ status: 'ok', provider: env.MINIMAX_BASE_URL }))

  // JWT 鉴权插件（authRequired 装饰器 + req.user 扩展）—— 必须在业务路由之前注册
  await registerAuthPlugin(app)

  // 业务路由
  await app.register(
    async (api) => {
      await api.register(authRoutes, { prefix: '/auth' })
      await api.register(usersRoutes, { prefix: '/users' })
      await api.register(aiRoutes, { prefix: '/ai' })
      await api.register(documentsRoutes, { prefix: '/documents' })
      await api.register(templatesRoutes, { prefix: '/templates' })
      await api.register(exportRoutes, { prefix: '/export' })
    },
    { prefix: '/api' }
  )

  return app
}
