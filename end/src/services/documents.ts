import { and, desc, eq } from 'drizzle-orm'
import { db, schema } from '~/db'

const { documents } = schema

export interface CreateDocumentInput {
  title?: string
  content?: string
  platforms?: string[]
}

export interface UpdateDocumentInput {
  title?: string
  content?: string
  platforms?: string[]
}

function excerptFrom(content: string | null | undefined): string {
  if (!content) return ''
  const cleaned = content
    .replace(/[#>`*_~\-\[\]()>]/g, '')
    .split(/\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(1) // 跳过首个 H1
    .join(' ')
  return cleaned.slice(0, 120)
}

export async function listDocuments() {
  const rows = await db
    .select()
    .from(documents)
    .orderBy(desc(documents.updatedAt))
  return rows.map(formatDoc)
}

export async function getDocument(id: number) {
  const [row] = await db
    .select()
    .from(documents)
    .where(eq(documents.id, id))
    .limit(1)
  return row ? formatDoc(row) : null
}

export async function createDocument(input: CreateDocumentInput) {
  const title = (input.title ?? '未命名文档').trim() || '未命名文档'
  const content = input.content ?? `# ${title}\n\n开始写点什么吧……\n`
  const excerpt = excerptFrom(content)
  const platforms = (input.platforms ?? []).join(',')
  await db.insert(documents).values({
    title,
    content,
    excerpt,
    platforms
  })
  const [row] = await db
    .select()
    .from(documents)
    .orderBy(desc(documents.id))
    .limit(1)
  return formatDoc(row!)
}

export async function updateDocument(
  id: number,
  input: UpdateDocumentInput
) {
  const set: Record<string, unknown> = {}
  if (input.title !== undefined) set.title = input.title.trim() || '未命名文档'
  if (input.content !== undefined) {
    set.content = input.content
    set.excerpt = excerptFrom(input.content)
  }
  if (input.platforms !== undefined)
    set.platforms = input.platforms.join(',')

  if (Object.keys(set).length === 0) return getDocument(id)

  await db.update(documents).set(set).where(eq(documents.id, id))
  return getDocument(id)
}

export async function deleteDocument(id: number) {
  await db.delete(documents).where(eq(documents.id, id))
}

/* ---------- 模板 ---------- */

export async function listTemplates() {
  const rows = await db
    .select()
    .from(schema.templates)
    .orderBy(schema.templates.sort)
  return rows.map((t) => ({
    id: String(t.id),
    name: t.name,
    emoji: t.emoji ?? '📄',
    description: t.description ?? '',
    content: t.content
  }))
}

/* ---------- helpers ---------- */

function formatDoc(row: typeof documents.$inferSelect) {
  return {
    id: String(row.id),
    title: row.title,
    excerpt: row.excerpt ?? '',
    content: row.content ?? '',
    platforms: row.platforms ? row.platforms.split(',').filter(Boolean) : [],
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  }
}

// 抑制 and 未使用警告 —— 阶段二做组合查询会用
void and
