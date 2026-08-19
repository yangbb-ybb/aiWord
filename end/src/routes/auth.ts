import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import {
  authError,
  consumeSmsCode,
  hashPassword,
  issueRefreshToken,
  revokeRefreshToken,
  rotateRefreshToken,
  sendSmsCode,
  signAccessToken,
  verifyPassword
} from '~/services/auth'
import {
  createUser,
  findUserByEmail,
  findUserByPhone,
  isContactTaken,
  toPublic
} from '~/services/users'
import {
  bindPhoneForUser,
  confirmMockLogin,
  createSession,
  getSession,
  wechatError
} from '~/services/wechat'

const phoneRegex = /^1[3-9]\d{9}$/
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const registerBody = z.object({
  nickname: z.string().min(2).max(64),
  email: z.string().regex(emailRegex),
  password: z.string().min(6).max(64),
  phone: z.string().regex(phoneRegex).optional()
})

const loginBody = z.object({
  email: z.string().regex(emailRegex),
  password: z.string().min(1)
})

const smsSendBody = z.object({
  phone: z.string().regex(phoneRegex),
  purpose: z.enum(['login', 'register']).default('login')
})

const smsLoginBody = z.object({
  phone: z.string().regex(phoneRegex),
  code: z.string().regex(/^\d{6}$/)
})

const refreshBody = z.object({
  refreshToken: z.string().min(10)
})

const logoutBody = z.object({
  refreshToken: z.string().min(10)
})

const wechatConfirmBody = z.object({
  phone: z
    .string()
    .regex(/^1[3-9]\d{9}$/)
    .optional(),
  smsCode: z.string().regex(/^\d{6}$/).optional()
})

const bindPhoneBody = z.object({
  phone: z.string().regex(/^1[3-9]\d{9}$/),
  smsCode: z.string().regex(/^\d{6}$/)
})

export default async function authRoutes(app: FastifyInstance) {
  /** 邮箱 + 密码注册 */
  app.post('/register', async (req, reply) => {
    const body = registerBody.parse(req.body)
    if (await isContactTaken('email', body.email)) {
      return reply.code(409).send({ code: 409, errorCode: 'EMAIL_TAKEN', message: '邮箱已被注册' })
    }
    if (body.phone && (await isContactTaken('phone', body.phone))) {
      return reply.code(409).send({ code: 409, errorCode: 'PHONE_TAKEN', message: '手机号已被注册' })
    }
    const user = await createUser({
      nickname: body.nickname,
      email: body.email,
      phone: body.phone ?? null,
      passwordHash: await hashPassword(body.password)
    })
    return reply.code(201).send({
      user: toPublic(user),
      accessToken: signAccessToken(user),
      refreshToken: await issueRefreshToken(user)
    })
  })

  /** 邮箱 + 密码登录 */
  app.post('/login', async (req, reply) => {
    const body = loginBody.parse(req.body)
    const user = await findUserByEmail(body.email)
    if (!user || !user.passwordHash) {
      return reply.code(401).send({ code: 401, errorCode: 'INVALID_CREDENTIALS', message: '邮箱或密码错误' })
    }
    const ok = await verifyPassword(body.password, user.passwordHash)
    if (!ok) {
      return reply.code(401).send({ code: 401, errorCode: 'INVALID_CREDENTIALS', message: '邮箱或密码错误' })
    }

    if (user.status !== 'active') {
      return reply.code(403).send({ code: 403, errorCode: 'USER_BANNED', message: '账号已被禁用' })
    }
    return {
      user: toPublic(user),
      accessToken: signAccessToken(user),
      refreshToken: await issueRefreshToken(user)
    }
  })

  /** 发短信验证码 —— dev 阶段打日志，不接网关 */
  app.post('/sms/send', async (req, reply) => {
    const body = smsSendBody.parse(req.body)
    const { code, expiresAt, ttlMs } = await sendSmsCode(body.phone, body.purpose)
    // 完整业务日志：phone / 验证码明文 / 用途 / 过期时间
    req.log.info(
      {
        event: 'sms_code_sent',
        phone: body.phone,
        code,
        purpose: body.purpose,
        ttlMs,
        expiresAt: expiresAt.toISOString(),
        // dev 阶段模拟发送的"短信正文"
        message: `【aiWord】您的验证码是 ${code}，${Math.round(ttlMs / 60000)} 分钟内有效。`
      },
      'sms code generated and queued (dev: not actually sent)'
    )
    return reply.code(202).send({ ok: true, hint: 'dev: 看后端日志文件' })
  })

  /** 手机号 + 验证码登录；不存在则自动注册 */
  app.post('/sms/login', async (req, reply) => {
    const body = smsLoginBody.parse(req.body)
    const result = await consumeSmsCode(body.phone, body.code, 'login')
    if (!result.ok) {
      req.log.warn(
        {
          event: 'sms_login_failed',
          phone: body.phone,
          submittedCode: body.code,
          purpose: 'login',
          reason: result.reason
        },
        result.reason === 'EXPIRED'
          ? 'sms login failed: code expired'
          : 'sms login failed: code not found / mismatch / already used'
      )
      return reply
        .code(400)
        .send({ code: 400, errorCode: 'SMS_INVALID', message: '验证码错误或已过期' })
    }
    let user = await findUserByPhone(body.phone)
    let isNewUser = false
    if (!user) {
      // 自动注册：nickname 默认用手机号后 4 位
      user = await createUser({
        nickname: `用户${body.phone.slice(-4)}`,
        phone: body.phone,
        passwordHash: null
      })
      isNewUser = true
    }
    if (user.status !== 'active') {
      req.log.warn(
        {
          event: 'sms_login_banned',
          phone: body.phone,
          userId: user.id
        },
        'sms login blocked: user banned'
      )
      return reply.code(403).send({ code: 403, errorCode: 'USER_BANNED', message: '账号已被禁用' })
    }
    const tokens = {
      accessToken: signAccessToken(user),
      refreshToken: await issueRefreshToken(user)
    }
    req.log.info(
      {
        event: 'sms_login_success',
        phone: body.phone,
        userId: user.id,
        isNewUser,
        nickname: user.nickname
      },
      isNewUser
        ? 'sms login success: new user auto-registered'
        : 'sms login success: existing user'
    )
    return {
      user: toPublic(user),
      ...tokens
    }
  })

  /** 用 refresh 换新 access + 新 refresh（rotation） */
  app.post('/refresh', async (req, reply) => {
    const body = refreshBody.parse(req.body)
    try {
      const { user, accessToken, refreshToken } = await rotateRefreshToken(
        body.refreshToken
      )
      return {
        user: toPublic(user),
        accessToken,
        refreshToken
      }
    } catch (err) {
      const e = err as ReturnType<typeof authError>
      return reply.code(e.statusCode ?? 401).send({
        code: e.statusCode ?? 401,
        errorCode: e.code ?? 'REFRESH_INVALID',
        message: e.message ?? 'refresh 失败'
      })
    }
  })

  /** 撤销 refresh token */
  app.post('/logout', async (req, reply) => {
    const body = logoutBody.parse(req.body)
    await revokeRefreshToken(body.refreshToken)
    return { ok: true }
  })

  // ---------- 微信扫码登录（mock 阶段） ----------

  /** 生成二维码 session —— 前端拿到 sceneId + qrUrl 后开始轮询 */
  app.post('/wechat/qrcode', async () => {
    const s = await createSession()
    return {
      sceneId: s.sceneId,
      qrUrl: s.qrUrl,
      expiresAt: s.expiresAt.toISOString()
    }
  })

  /** 轮询二维码状态 */
  app.get<{ Params: { sceneId: string } }>(
    '/wechat/qrcode/:sceneId',
    async (req, reply) => {
      const session = await getSession(req.params.sceneId)
      if (!session) return reply.code(404).send({ code: 404, errorCode: 'SCENE_NOT_FOUND', message: '二维码不存在或已过期' })
      const base = {
        sceneId: session.id,
        status: session.status,
        expiresAt: session.expiresAt.toISOString()
      }
      // confirmed 状态：返回完整登录信息
      if (session.status === 'confirmed' && session.userId) {
        const user = await import('~/db').then(async ({ db }) => {
          const { users } = await import('~/db/schema')
          const { eq } = await import('drizzle-orm')
          const rows = await db.select().from(users).where(eq(users.id, session.userId!)).limit(1)
          return rows[0]
        })
        if (!user) return reply.code(500).send({ code: 500, errorCode: 'USER_GONE', message: '用户已不存在' })
        return {
          ...base,
          user: toPublic(user),
          accessToken: signAccessToken(user),
          refreshToken: await issueRefreshToken(user)
        }
      }
      return base
    }
  )

  /** mock 确认 —— 用户在 /wechat-mock 页面触发 */
  app.post<{ Params: { sceneId: string } }>(
    '/wechat/qrcode/:sceneId/confirm',
    async (req, reply) => {
      const body = wechatConfirmBody.parse(req.body)
      try {
        const result = await confirmMockLogin({
          sceneId: req.params.sceneId,
          phone: body.phone,
          smsCode: body.smsCode
        })
        return result
      } catch (err) {
        const e = err as ReturnType<typeof wechatError>
        return reply.code(e.statusCode ?? 400).send({
          code: e.statusCode ?? 400,
          errorCode: e.code ?? 'CONFIRM_FAILED',
          message: e.message ?? '确认失败'
        })
      }
    }
  )

  /** 已登录用户主动绑手机号（账号设置场景） */
  app.post(
    '/wechat/bind-phone',
    { preHandler: app.authRequired },
    async (req, reply) => {
      if (!req.user) return reply.code(401).send({ code: 401, errorCode: 'UNAUTHORIZED', message: '请先登录' })
      const body = bindPhoneBody.parse(req.body)
      try {
        await bindPhoneForUser(Number(req.user.id), body.phone, body.smsCode)
        return { ok: true }
      } catch (err) {
        const e = err as ReturnType<typeof wechatError>
        return reply.code(e.statusCode ?? 400).send({
          code: e.statusCode ?? 400,
          errorCode: e.code ?? 'BIND_FAILED',
          message: e.message ?? '绑定失败'
        })
      }
    }
  )
}