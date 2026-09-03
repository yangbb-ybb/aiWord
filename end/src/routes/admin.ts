import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { and, desc, eq, like, or, sql } from 'drizzle-orm'
import { db } from '~/db'
import {
  documents,
  templates,
  users
} from '~/db/schema'
import { AppError } from '~/services/errors'

/**
 * 管理员路由(运营/管理后台用)。
 *
 * - 所有接口走 `app.adminRequired` 前置钩子:
 *   先 authRequired 校验 JWT,再确认 role === 'admin'
 * - 不写 services,直接在本文件用 drizzle 查 —— 这些接口是管理员专属,
 *   业务代码里不会复用,放在 services 反而污染通用接口
 *
 * 注册: app.register(adminRoutes, { prefix: '/admin' })
 */

// ============ 用户列表 ============

const listUsersQuery = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(10),
  keyword: z.string().optional(),
  role: z.enum(['user', 'admin']).optional()
})

const patchUserBody = z.object({
  status: z.enum(['active', 'banned']).optional(),
  role: z.enum(['user', 'admin']).optional()
})

// ============ Dashboard 统计 ============

// ============ 文档列表(管理员) ============

const listDocsQuery = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(10),
  keyword: z.string().optional(),
  userId: z.coerce.number().int().positive().optional(),
  includeDeleted: z.coerce.boolean().default(false)
})

// ============ 模板管理 ============

const upsertTemplateBody = z.object({
  id: z.coerce.number().int().positive().optional(),
  name: z.string().min(1).max(64),
  emoji: z.string().max(8).optional(),
  description: z.string().max(255).optional(),
  content: z.string().min(1),
  sort: z.coerce.number().int().default(0)
})

export default async function adminRoutes(app: FastifyInstance) {
  // 所有路由统一加 adminRequired
  app.addHook('preHandler', app.adminRequired)

  // ---------------- Dashboard 统计 ----------------
  app.get('/stats', async () => {
    const now = new Date()
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)

    const [{ userTotal }] = (await db
      .select({ userTotal: sql<number>`count(*)`.mapWith(Number) })
      .from(users)) as Array<{ userTotal: number }>

    const [{ userTodayNew }] = (await db
      .select({ userTodayNew: sql<number>`count(*)`.mapWith(Number) })
      .from(users)
      .where(sql`${users.createdAt} >= ${sql.raw(`'${formatDateTime(todayStart)}'`)}`)) as Array<{ userTodayNew: number }>

    const [{ documentTotal }] = (await db
      .select({ documentTotal: sql<number>`count(*)`.mapWith(Number) })
      .from(documents)) as Array<{ documentTotal: number }>

    const [{ documentTodayNew }] = (await db
      .select({ documentTodayNew: sql<number>`count(*)`.mapWith(Number) })
      .from(documents)
      .where(sql`${documents.createdAt} >= ${sql.raw(`'${formatDateTime(todayStart)}'`)}`)) as Array<{ documentTodayNew: number }>

    const [{ templateTotal }] = (await db
      .select({ templateTotal: sql<number>`count(*)`.mapWith(Number) })
      .from(templates)) as Array<{ templateTotal: number }>

    return {
      userTotal,
      userTodayNew,
      documentTotal,
      documentTodayNew,
      templateTotal,
      // image 调用统计需要 image_chat_logs 表,目前没建,先返回 0 占位
      imageSuccess7d: 0,
      imageFail7d: 0,
      imageStatsNote: 'image_success_7d / image_fail_7d 需要 image_chat_logs 表(规划中)'
    }
  })

  // ---------------- 用户列表 ----------------
  app.get('/users', async (req) => {
    const q = listUsersQuery.parse(req.query)
    const offset = (q.page - 1) * q.pageSize

    const conds = []
    if (q.keyword) {
      const kw = `%${q.keyword}%`
      conds.push(
        or(
          like(users.nickname, kw),
          like(users.phone, kw),
          like(users.email, kw)
        )
      )
    }
    if (q.role) conds.push(eq(users.role, q.role))

    const whereExpr = conds.length ? and(...conds) : undefined

    const [{ total }] = (await db
      .select({ total: sql<number>`count(*)`.mapWith(Number) })
      .from(users)
      .where(whereExpr ?? sql`1=1`)) as Array<{ total: number }>

    const items = await db
      .select({
        id: users.id,
        nickname: users.nickname,
        avatar: users.avatar,
        email: users.email,
        phone: users.phone,
        status: users.status,
        role: users.role,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt
      })
      .from(users)
      .where(whereExpr ?? sql`1=1`)
      .orderBy(desc(users.createdAt))
      .limit(q.pageSize)
      .offset(offset)

    return { items, total }
  })

  // 修改用户状态
  app.patch<{ Params: { id: string } }>('/users/:id/status', async (req, reply) => {
    const id = Number(req.params.id)
    if (!Number.isInteger(id) || id <= 0) {
      throw new AppError('BAD_ID', 'id 必须为正整数', 400)
    }
    const body = patchUserBody.parse(req.body)
    if (!body.status) {
      throw new AppError('MISSING_FIELD', 'status 必填', 400)
    }
    await db.update(users).set({ status: body.status }).where(eq(users.id, id))
    req.log.info({ adminOp: 'updateUserStatus', targetUserId: id, status: body.status }, 'admin updated user status')
    return { ok: true }
  })

  // 修改用户角色
  app.patch<{ Params: { id: string } }>('/users/:id/role', async (req, reply) => {
    const id = Number(req.params.id)
    if (!Number.isInteger(id) || id <= 0) {
      throw new AppError('BAD_ID', 'id 必须为正整数', 400)
    }
    const body = patchUserBody.parse(req.body)
    if (!body.role) {
      throw new AppError('MISSING_FIELD', 'role 必填', 400)
    }
    await db.update(users).set({ role: body.role }).where(eq(users.id, id))
    req.log.info({ adminOp: 'updateUserRole', targetUserId: id, role: body.role }, 'admin updated user role')
    return { ok: true }
  })

  // ---------------- 文档列表(管理员) ----------------
  app.get('/documents', async (req) => {
    const q = listDocsQuery.parse(req.query)
    const offset = (q.page - 1) * q.pageSize

    const conds = []
    if (q.keyword) conds.push(like(documents.title, `%${q.keyword}%`))
    if (q.userId) conds.push(eq(documents.userId, q.userId))
    if (!q.includeDeleted) conds.push(sql`${documents.deletedAt} IS NULL`)

    const whereExpr = conds.length ? and(...conds) : undefined

    const [{ total }] = (await db
      .select({ total: sql<number>`count(*)`.mapWith(Number) })
      .from(documents)
      .where(whereExpr ?? sql`1=1`)) as Array<{ total: number }>

    const rows = await db
      .select({
        id: documents.id,
        userId: documents.userId,
        title: documents.title,
        excerpt: documents.excerpt,
        platforms: documents.platforms,
        deletedAt: documents.deletedAt,
        createdAt: documents.createdAt,
        updatedAt: documents.updatedAt,
        userNickname: users.nickname
      })
      .from(documents)
      .leftJoin(users, eq(documents.userId, users.id))
      .where(whereExpr ?? sql`1=1`)
      .orderBy(desc(documents.updatedAt))
      .limit(q.pageSize)
      .offset(offset)

    return { items: rows, total }
  })

  // 管理员强制删除文档
  app.delete<{ Params: { id: string } }>('/documents/:id', async (req) => {
    const id = Number(req.params.id)
    if (!Number.isInteger(id) || id <= 0) {
      throw new AppError('BAD_ID', 'id 必须为正整数', 400)
    }
    // 硬删除(管理员权限,不走回收站)
    await db.delete(documents).where(eq(documents.id, id))
    req.log.info({ adminOp: 'deleteDocument', targetDocId: id }, 'admin deleted document')
    return { ok: true }
  })

  // ---------------- 模板管理 ----------------
  app.get('/templates', async () => {
    const items = await db
      .select()
      .from(templates)
      .orderBy(desc(templates.sort), desc(templates.id))
    return { items }
  })

  app.post('/templates', async (req, reply) => {
    const body = upsertTemplateBody.parse(req.body)
    if (body.id) {
      // update
      await db
        .update(templates)
        .set({
          name: body.name,
          emoji: body.emoji,
          description: body.description,
          content: body.content,
          sort: body.sort
        })
        .where(eq(templates.id, body.id))
      const updated = (await db.select().from(templates).where(eq(templates.id, body.id))).at(0)
      req.log.info({ adminOp: 'upsertTemplate', templateId: body.id, mode: 'update' }, 'admin updated template')
      return updated
    }
    // insert
    const inserted = await db.insert(templates).values({
      name: body.name,
      emoji: body.emoji,
      description: body.description,
      content: body.content,
      sort: body.sort
    })
    const newId = Number((inserted as any).insertId ?? 0)
    const created = (await db.select().from(templates).where(eq(templates.id, newId))).at(0)
    req.log.info({ adminOp: 'upsertTemplate', templateId: newId, mode: 'create' }, 'admin created template')
    reply.code(201)
    return created
  })

  app.delete<{ Params: { id: string } }>('/templates/:id', async (req) => {
    const id = Number(req.params.id)
    if (!Number.isInteger(id) || id <= 0) {
      throw new AppError('BAD_ID', 'id 必须为正整数', 400)
    }
    await db.delete(templates).where(eq(templates.id, id))
    req.log.info({ adminOp: 'deleteTemplate', templateId: id }, 'admin deleted template')
    return { ok: true }
  })
}

/**
 * 把 Date 转成 'YYYY-MM-DD HH:mm:ss' 字符串 —— 跟 db/index.ts 里 mysql2 timezone='+08:00' 配合,
 * 直接拼到 SQL 字面量里做时间比较(避免 Date 对象在 drizzle/mysql2 里时区漂移)。
 */
function formatDateTime(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}