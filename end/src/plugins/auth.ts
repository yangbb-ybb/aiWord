import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import {
  authError,
  verifyAccessToken,
  type AccessTokenPayload
} from '~/services/auth'
import { findUserById, toPublic } from '~/services/users'

/**
 * 给 request 扩展上 user 字段。挂上 authRequired 后，req.user 即当前登录用户（已公开序列化）。
 */
declare module 'fastify' {
  interface FastifyRequest {
    user?: ReturnType<typeof toPublic>
    tokenPayload?: AccessTokenPayload
  }
}

function extractToken(req: FastifyRequest): string | null {
  const h = req.headers.authorization
  if (!h || typeof h !== 'string') return null
  const m = /^Bearer\s+(.+)$/i.exec(h.trim())
  return m ? m[1].trim() : null
}

export async function registerAuthPlugin(app: FastifyInstance) {
  /** 可选认证：有 token 就挂上 user，没有也不报错 */
  app.decorateRequest('user', null)
  app.decorateRequest('tokenPayload', null)

  app.decorate(
    'authRequired',
    async (req: FastifyRequest, reply: FastifyReply) => {
      const token = extractToken(req)
      if (!token) {
        return reply
          .code(401)
          .send({ code: 'UNAUTHORIZED', message: '缺少 Authorization Bearer token' })
      }
      let payload: AccessTokenPayload
      try {
        payload = verifyAccessToken(token)
      } catch (err) {
        const e = err as ReturnType<typeof authError>
        return reply.code(e.statusCode ?? 401).send({
          code: e.code ?? 'TOKEN_INVALID',
          message: e.message ?? 'token 校验失败'
        })
      }
      const user = await findUserById(Number(payload.sub))
      if (!user) {
        return reply.code(401).send({ code: 'USER_NOT_FOUND', message: '用户不存在' })
      }
      if (user.status !== 'active') {
        return reply.code(403).send({ code: 'USER_BANNED', message: '账号已被禁用' })
      }
      req.user = toPublic(user)
      req.tokenPayload = payload
      // 校验通过后，把 userId 挂到 req.log 的 child 上，
      // 后续"request completed"日志里就会自动带上 userId
      req.log = req.log.child({ userId: req.user.id })
    }
  )
}

declare module 'fastify' {
  interface FastifyInstance {
    authRequired: (
      req: FastifyRequest,
      reply: FastifyReply
    ) => Promise<void>
  }
}