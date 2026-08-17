import type { FastifyInstance } from 'fastify'
import { listTemplates } from '~/services/documents'

export default async function templatesRoutes(app: FastifyInstance) {
  app.get('/', async () => ({ items: await listTemplates() }))
}
