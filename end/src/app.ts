import Fastify, { type FastifyBaseLogger } from 'fastify'
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
import { AppError, isDbError } from './services/errors'
import { createLogger } from './utils/logger'
import path from 'node:path'

export async function buildApp() {
  // 日志：按天写文件 + dev 同时打 console
  const logger = await createLogger()

  // 启动 banner
  const logDir = path.isAbsolute(env.LOG_DIR)
    ? env.LOG_DIR
    : path.resolve(process.cwd(), env.LOG_DIR)
  logger.info(
    {
      nodeEnv: env.NODE_ENV,
      logLevel: env.LOG_LEVEL,
      logDir,
      logFile: `${env.LOG_FILE}-${new Date().toISOString().slice(0, 10)}.log`
    },
    'logger initialized'
  )

  // Fastify v4 的 FastifyLoggerOptions 不支持 base/timestamp/formatters，
  // 直接把 pino logger 实例当 logger 传进去（pino Logger 本身就是 FastifyBaseLogger）。
  const app = Fastify({
    logger: logger as unknown as FastifyBaseLogger,
    // 给每个请求生成一个短的 requestId（出现在所有日志里）
    genReqId: (req) => {
      const incoming =
        (req.headers['x-request-id'] as string | undefined) ?? ''
      if (incoming) return incoming
      // 8 字节 = 16 hex 字符
      return (
        Date.now().toString(36) +
        Math.random().toString(36).slice(2, 10)
      )
    }
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

  // 全局错误处理：
  // - ZodError → 400 VALIDATION_ERROR
  // - AppError（业务异常）→ 透传它的 code / message / statusCode
  // - DB 驱动错误（mysql2 ER_xxx / 网络错） → 503 DB_ERROR（不暴露内部细节）
  // - 其他 → 500 INTERNAL_ERROR
  // ⚠️ 不要把未知 err.code 原样透传给前端，否则会把 ER_ACCESS_DENIED_ERROR 这种
  //   内部 mysql 错误码暴露给客户端。
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({
        code: 'VALIDATION_ERROR',
        message: '请求参数不合法',
        details: err.flatten()
      })
    }
    if (err instanceof AppError) {
      // 业务错误也写一条日志（warn 级别，状态码 4xx —— 不算异常）
      req.log.warn(
        { code: err.code, statusCode: err.statusCode },
        err.message
      )
      return reply.code(err.statusCode).send({
        code: err.code,
        message: err.message,
        details: err.details
      })
    }
    if (isDbError(err)) {
      req.log.error({ err }, 'database error')
      return reply.code(503).send({
        code: 'DB_ERROR',
        message: '数据库服务暂时不可用'
      })
    }
    req.log.error(err)
    return reply.code(500).send({
      code: 'INTERNAL_ERROR',
      message: 'Internal Server Error'
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

  // 退出时优雅关 stream
  app.addHook('onClose', async () => {
    logger.info('server closing')
  })

  return app
}
