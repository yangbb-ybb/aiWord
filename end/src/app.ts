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
  //
  // 统一响应信封（envelope）：
  //   成功 → { code: <http_status>, data: T }
  //   错误 → { code: <http_status>, message, errorCode?: string, details? }
  // `code` 始终是数字 HTTP 状态码；前端可以从这里直接判断网络层是否成功，
  // 不必再读 response.status。`errorCode` 是机器可读字符串（保留给业务分支用）。
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({
        code: 400,
        errorCode: 'VALIDATION_ERROR',
        message: '请求参数不合法',
        details: err.flatten()
      })
    }
    if (err instanceof AppError) {
      // 业务错误也写一条日志（warn 级别，状态码 4xx —— 不算异常）
      req.log.warn(
        { errorCode: err.code, statusCode: err.statusCode },
        err.message
      )
      return reply.code(err.statusCode).send({
        code: err.statusCode,
        errorCode: err.code,
        message: err.message,
        details: err.details
      })
    }
    if (isDbError(err)) {
      req.log.error({ err }, 'database error')
      return reply.code(503).send({
        code: 503,
        errorCode: 'DB_ERROR',
        message: '数据库服务暂时不可用'
      })
    }
    req.log.error(err)
    return reply.code(500).send({
      code: 500,
      errorCode: 'INTERNAL_ERROR',
      message: 'Internal Server Error'
    })
  })

  /**
   * 全局响应包装：所有非 SSE / 非错误的 JSON 响应都包成 { code, data }。
   * - 已经带 `code` 字段（错误响应）→ 不重复包装
   * - content-type 是 text/event-stream（SSE）→ 不包装（保持原始事件流；且 SSE 走
   *   reply.raw.write()，根本不会进入 preSerialization / onSend 链路，这里无需判断）
   * - 二进制响应（Buffer）→ 不动
   * - 否则包成 { code: <http_status>, data: <原 payload> }
   *
   * 注意：必须用 **preSerialization** 而不是 onSend！
   *   - Fastify v4 的 onSend 收到的是**已经序列化**的 string/Buffer，hook 返回对象
   *     不会再被 JSON.stringify，会直接报 `FST_ERR_REP_INVALID_PAYLOAD_TYPE`。
   *   - preSerialization 在序列化之前运行，可以返回对象，Fastify 会用默认 JSON
   *     serializer 把返回的对象字符串化。
   */
  app.addHook('preSerialization', async (req, reply, payload) => {
    // 二进制响应（如 /export 返回的 Buffer）→ 不动，让 Fastify 原样发送
    if (Buffer.isBuffer(payload)) return payload
    // 已经是 envelope（错误响应）→ 透传
    if (payload && typeof payload === 'object' && 'code' in payload) {
      // 兼容旧格式：string code → 转成新格式（数字 code + errorCode）
      const obj = payload as Record<string, unknown>
      if (typeof obj.code === 'string') {
        return {
          code: reply.statusCode || 500,
          errorCode: obj.code,
          message: obj.message ?? obj.code,
          details: obj.details
        }
      }
      return payload
    }
    // null / undefined payload（204 等）：包成 { code, data: null }（保留 HTTP 状态）
    if (payload == null) {
      return { code: reply.statusCode || 200, data: null }
    }
    // 普通对象 / 其它 payload：包成 { code, data }
    return { code: reply.statusCode || 200, data: payload }
  })

  // 简单 API key 校验中间件（写操作）
  app.addHook('preHandler', async (req, reply) => {
    if (!env.AUTH_TOKEN) return // 没设置就不校验
    if (req.method === 'GET' || req.method === 'OPTIONS') return
    const got = req.headers['x-api-key']
    if (got !== env.AUTH_TOKEN) {
      return reply.code(401).send({
        code: 401,
        errorCode: 'UNAUTHORIZED',
        message: 'API Key 无效'
      })
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
