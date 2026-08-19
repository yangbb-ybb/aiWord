import { and, desc, eq, isNotNull, isNull, lt } from 'drizzle-orm'
import { db, schema } from '~/db'
import { now } from '~/utils/time'

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

/** 列出指定用户的"未删除"文档（按更新时间倒序） */
export async function listDocuments(userId: number) {
  const rows = await db
    .select()
    .from(documents)
    .where(and(eq(documents.userId, userId), isNull(documents.deletedAt)))
    .orderBy(desc(documents.updatedAt))
  return rows.map(formatDoc)
}

/** 取单个文档；不属于该用户 / 已软删除 → 都视为不存在（避免越权 + 不显示回收站里的） */
export async function getDocument(id: number, userId: number) {
  const [row] = await db
    .select()
    .from(documents)
    .where(
      and(
        eq(documents.id, id),
        eq(documents.userId, userId),
        isNull(documents.deletedAt)
      )
    )
    .limit(1)
  return row ? formatDoc(row) : null
}

/** 列出当前用户的回收站文档（按删除时间倒序，最近删的在前） */
export async function listDeletedDocuments(userId: number) {
  const rows = await db
    .select()
    .from(documents)
    .where(and(eq(documents.userId, userId), isNotNull(documents.deletedAt)))
    .orderBy(desc(documents.deletedAt))
  return rows.map(formatDoc)
}

/** 创建文档并归属到当前用户 */
export async function createDocument(
  input: CreateDocumentInput,
  userId: number
) {
  // title / content 都接受空字符串 —— 新建文档保持真正空白，
  // 视觉提示靠前端 placeholder（无标题文档 / 开始写点什么……）。
  const title = (input.title ?? '').trim()
  const content = input.content ?? ''
  const excerpt = excerptFrom(content)
  const platforms = (input.platforms ?? []).join(',')
  await db.insert(documents).values({
    userId,
    title,
    content,
    excerpt,
    platforms
  })
  const [row] = await db
    .select()
    .from(documents)
    .where(eq(documents.userId, userId))
    .orderBy(desc(documents.id))
    .limit(1)
  return formatDoc(row!)
}

/** 更新文档：先校验归属，不属于该用户直接 404 */
export async function updateDocument(
  id: number,
  input: UpdateDocumentInput,
  userId: number
) {
  const existed = await getDocument(id, userId)
  if (!existed) return null

  const set: Record<string, unknown> = {}
  if (input.title !== undefined) set.title = input.title.trim()
  if (input.content !== undefined) {
    set.content = input.content
    set.excerpt = excerptFrom(input.content)
  }
  if (input.platforms !== undefined)
    set.platforms = input.platforms.join(',')

  if (Object.keys(set).length === 0) return existed

  await db.update(documents).set(set).where(eq(documents.id, id))
  return getDocument(id, userId)
}

/**
 * 软删除文档：标记 deletedAt，不从数据库移除。
 * - 校验归属 + 当前未在回收站里（幂等：二次软删 no-op）
 * - 返回 false 表示根本没找到或不属于当前用户
 */
export async function deleteDocument(id: number, userId: number) {
  const existed = await getDocument(id, userId)
  if (!existed) return false
  await db
    .update(documents)
    .set({ deletedAt: now() })
    .where(
      and(
        eq(documents.id, id),
        eq(documents.userId, userId),
        isNull(documents.deletedAt)
      )
    )
  return true
}

/**
 * 从回收站恢复文档：清掉 deletedAt。
 * - 校验归属 + 当前确实在回收站里（避免把别人的正常文档改掉）
 */
export async function restoreDocument(id: number, userId: number) {
  const [row] = await db
    .select()
    .from(documents)
    .where(
      and(
        eq(documents.id, id),
        eq(documents.userId, userId),
        isNotNull(documents.deletedAt)
      )
    )
    .limit(1)
  if (!row) return null
  await db
    .update(documents)
    .set({ deletedAt: null, updatedAt: now() })
    .where(eq(documents.id, id))
  return getDocument(id, userId)
}

/**
 * 物理删除一篇回收站文档（用户主动"彻底删除"按钮）。
 * - 校验归属 + 必须在回收站里（普通接口不会到这里，避免误删）
 */
export async function purgeDocument(id: number, userId: number) {
  const [row] = await db
    .select()
    .from(documents)
    .where(
      and(
        eq(documents.id, id),
        eq(documents.userId, userId),
        isNotNull(documents.deletedAt)
      )
    )
    .limit(1)
  if (!row) return false
  await db.delete(documents).where(eq(documents.id, id))
  return true
}

/**
 * 清理超过 daysOld 天的回收站文档（30 天自动清理）。
 * - 返回被清掉的数量；启动时 + 定时跑
 */
export async function purgeOldDocuments(daysOld = 30): Promise<number> {
  const cutoff = new Date(Date.now() - daysOld * 24 * 60 * 60 * 1000)
  const rows = await db
    .select({ id: documents.id })
    .from(documents)
    .where(and(isNotNull(documents.deletedAt), lt(documents.deletedAt, cutoff)))
  if (!rows.length) return 0
  await db
    .delete(documents)
    .where(and(isNotNull(documents.deletedAt), lt(documents.deletedAt, cutoff)))
  return rows.length
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
    updatedAt: row.updatedAt,
    /** null = 未删除；非 null = 已进回收站的时间戳（前端展示"X 天后清理"） */
    deletedAt: row.deletedAt ?? null
  }
}
