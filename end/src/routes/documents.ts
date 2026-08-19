import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import {
  createDocument,
  deleteDocument,
  getDocument,
  listDeletedDocuments,
  listDocuments,
  purgeDocument,
  restoreDocument,
  updateDocument
} from '~/services/documents'

const idParam = z.object({ id: z.coerce.number().int().positive() })

const createBody = z.object({
  title: z.string().optional(),
  content: z.string().optional(),
  platforms: z.array(z.string()).optional()
})

const updateBody = z.object({
  title: z.string().optional(),
  content: z.string().optional(),
  platforms: z.array(z.string()).optional()
})

export default async function documentsRoutes(app: FastifyInstance) {
  // 所有文档接口都要求登录；req.user 由 authRequired 注入
  app.addHook('preHandler', app.authRequired)

  /**
   * 列出当前用户**未删除**的文档（左侧"最近"用）。
   * 注意：必须先于 `/:id` 注册，否则 `/trash` 会被当成 `id='trash'` 报 400。
   */
  app.get('/', async (req) => {
    const items = await listDocuments(Number(req.user!.id))
    return { items }
  })

  /** 回收站列表（按删除时间倒序）。 */
  app.get('/trash', async (req) => {
    const items = await listDeletedDocuments(Number(req.user!.id))
    return { items }
  })

  app.get('/:id', async (req, reply) => {
    const { id } = idParam.parse(req.params)
    const doc = await getDocument(id, Number(req.user!.id))
    if (!doc) return reply.code(404).send({ code: 404, errorCode: 'NOT_FOUND', message: '文档不存在' })
    return doc
  })

  app.post('/', async (req, reply) => {
    const body = createBody.parse(req.body)
    const doc = await createDocument(body, Number(req.user!.id))
    reply.code(201)
    return doc
  })

  app.put('/:id', async (req, reply) => {
    const { id } = idParam.parse(req.params)
    const body = updateBody.parse(req.body)
    const doc = await updateDocument(id, body, Number(req.user!.id))
    if (!doc) return reply.code(404).send({ code: 404, errorCode: 'NOT_FOUND', message: '文档不存在' })
    return doc
  })

  /**
   * 软删除：只标记 deletedAt，**不会**真从数据库抹掉。
   * 物理删除只在：
   *   1. 用户主动点"彻底删除" → DELETE /:id/permanent
   *   2. 回收站超过 30 天 → 启动时 + 定时 purgeOldDocuments()
   */
  app.delete('/:id', async (req, reply) => {
    const { id } = idParam.parse(req.params)
    const ok = await deleteDocument(id, Number(req.user!.id))
    if (!ok) return reply.code(404).send({ code: 404, errorCode: 'NOT_FOUND', message: '文档不存在' })
    reply.code(204)
    return null
  })

  /** 从回收站恢复（清掉 deletedAt）。 */
  app.post('/:id/restore', async (req, reply) => {
    const { id } = idParam.parse(req.params)
    const doc = await restoreDocument(id, Number(req.user!.id))
    if (!doc) return reply.code(404).send({ code: 404, errorCode: 'NOT_FOUND', message: '文档不存在' })
    return doc
  })

  /** 物理删除一篇回收站文档（用户主动"彻底删除"按钮）。 */
  app.delete('/:id/permanent', async (req, reply) => {
    const { id } = idParam.parse(req.params)
    const ok = await purgeDocument(id, Number(req.user!.id))
    if (!ok) return reply.code(404).send({ code: 404, errorCode: 'NOT_FOUND', message: '文档不存在' })
    reply.code(204)
    return null
  })
}