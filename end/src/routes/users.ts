import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import {
  authError,
  hashPassword,
  verifyPassword
} from '~/services/auth'
import {
  findUserById,
  isContactTaken,
  toPublic,
  updateUser
} from '~/services/users'

const phoneRegex = /^1[3-9]\d{9}$/
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const updateMeBody = z.object({
  nickname: z.string().min(2).max(64).optional(),
  avatar: z.string().url().max(500).nullable().optional(),
  email: z.string().regex(emailRegex).nullable().optional(),
  phone: z.string().regex(phoneRegex).nullable().optional()
})

const changePasswordBody = z.object({
  oldPassword: z.string().min(1),
  newPassword: z.string().min(6).max(64)
})

export default async function usersRoutes(app: FastifyInstance) {
  /** 当前用户信息 —— 走 authRequired */
  app.get('/me', { preHandler: app.authRequired }, async (req) => {
    return { user: req.user }
  })

  /** 更新当前用户资料 */
  app.put('/me', { preHandler: app.authRequired }, async (req, reply) => {
    if (!req.user) return reply.code(401).send({ code: 'UNAUTHORIZED' })
    const body = updateMeBody.parse(req.body)
    const userId = Number(req.user.id)

    if (body.email !== undefined && body.email !== null) {
      if (await isContactTaken('email', body.email, userId)) {
        return reply.code(409).send({ code: 'EMAIL_TAKEN', message: '邮箱已被占用' })
      }
    }
    if (body.phone !== undefined && body.phone !== null) {
      if (await isContactTaken('phone', body.phone, userId)) {
        return reply.code(409).send({ code: 'PHONE_TAKEN', message: '手机号已被占用' })
      }
    }

    const updated = await updateUser(userId, {
      nickname: body.nickname,
      avatar: body.avatar,
      email: body.email,
      phone: body.phone
    })
    if (!updated) return reply.code(404).send({ code: 'NOT_FOUND' })
    return { user: toPublic(updated) }
  })

  /** 修改密码（需旧密码） */
  app.put('/me/password', { preHandler: app.authRequired }, async (req, reply) => {
    if (!req.user) return reply.code(401).send({ code: 'UNAUTHORIZED' })
    const body = changePasswordBody.parse(req.body)
    const userId = Number(req.user.id)

    const row = await findUserById(userId)
    if (!row) return reply.code(404).send({ code: 'NOT_FOUND' })
    if (!row.passwordHash) {
      return reply
        .code(400)
        .send({ code: 'NO_PASSWORD', message: '该账号未设置密码（请用短信登录）' })
    }
    const ok = await verifyPassword(body.oldPassword, row.passwordHash)
    if (!ok) {
      const e = authError('INVALID_OLD_PASSWORD', '旧密码错误')
      return reply.code(e.statusCode).send({ code: e.code, message: e.message })
    }
    await updateUser(userId, {
      passwordHash: await hashPassword(body.newPassword)
    })
    return { ok: true }
  })
}