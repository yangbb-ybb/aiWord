import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { markdownToDocx } from '~/services/docx'

const body = z.object({
  title: z.string().min(1).max(255),
  content: z.string().default('')
})

/**
 * POST /api/export/docx —— markdown → .docx 二进制流下载。
 */
export default async function exportRoutes(app: FastifyInstance) {
  app.post('/docx', async (req, reply) => {
    const { title, content } = body.parse(req.body)
    const buffer = await markdownToDocx({ title, content })

    reply
      .header(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      )
      .header(
        'Content-Disposition',
        `attachment; filename="${encodeURIComponent(title)}.docx"`
      )
      .header('Content-Length', String(buffer.length))

    return reply.send(buffer)
  })
}
