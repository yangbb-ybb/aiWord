import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import {
  createDocument,
  deleteDocument,
  getDocument,
  listDocuments,
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
  app.get('/', async () => ({ items: await listDocuments() }))

  app.get('/:id', async (req, reply) => {
    const { id } = idParam.parse(req.params)
    const doc = await getDocument(id)
    if (!doc) return reply.code(404).send({ code: 'NOT_FOUND' })
    return doc
  })

  app.post('/', async (req, reply) => {
    const body = createBody.parse(req.body)
    const doc = await createDocument(body)
    reply.code(201)
    return doc
  })

  app.put('/:id', async (req, reply) => {
    const { id } = idParam.parse(req.params)
    const body = updateBody.parse(req.body)
    const doc = await updateDocument(id, body)
    if (!doc) return reply.code(404).send({ code: 'NOT_FOUND' })
    return doc
  })

  app.delete('/:id', async (req, reply) => {
    const { id } = idParam.parse(req.params)
    await deleteDocument(id)
    reply.code(204)
    return null
  })
}
