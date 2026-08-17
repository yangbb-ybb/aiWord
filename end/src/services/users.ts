import { and, desc, eq } from 'drizzle-orm'
import { db } from '~/db'
import { users, type UserRow } from '~/db/schema'

/**
 * 用户公共序列化：永远不返回 passwordHash / refresh token 等敏感字段
 */
export function toPublic(row: UserRow) {
  return {
    id: String(row.id),
    nickname: row.nickname,
    avatar: row.avatar,
    email: row.email,
    phone: row.phone,
    status: row.status,
    role: row.role,
    wechatBound: !!row.wechatOpenid,
    zhihuBound: !!row.zhihuOpenid,
    csdnBound: !!row.csdnOpenid,
    juejinBound: !!row.juejinOpenid,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  }
}

export async function findUserById(id: number) {
  const rows = await db.select().from(users).where(eq(users.id, id)).limit(1)
  return rows[0]
}

export async function findUserByEmail(email: string) {
  const rows = await db
    .select()
    .from(users)
    .where(eq(users.email, email))
    .limit(1)
  return rows[0]
}

export async function findUserByPhone(phone: string) {
  const rows = await db
    .select()
    .from(users)
    .where(eq(users.phone, phone))
    .limit(1)
  return rows[0]
}

export async function findUserByWechatOpenid(openid: string) {
  const rows = await db
    .select()
    .from(users)
    .where(eq(users.wechatOpenid, openid))
    .limit(1)
  return rows[0]
}

/** 通用：按平台找 openid 对应的用户 */
export async function findUserByOpenid(
  platform: 'wechat' | 'zhihu' | 'csdn' | 'juejin',
  openid: string
) {
  const col =
    platform === 'wechat'
      ? users.wechatOpenid
      : platform === 'zhihu'
      ? users.zhihuOpenid
      : platform === 'csdn'
      ? users.csdnOpenid
      : users.juejinOpenid
  const rows = await db.select().from(users).where(eq(col, openid)).limit(1)
  return rows[0]
}

export async function createUser(input: {
  nickname: string
  email?: string | null
  phone?: string | null
  passwordHash?: string | null
  avatar?: string | null
}): Promise<UserRow> {
  await db.insert(users).values({
    nickname: input.nickname,
    email: input.email ?? null,
    phone: input.phone ?? null,
    passwordHash: input.passwordHash ?? null,
    avatar: input.avatar ?? null
  })
  // drizzle mysql 不返回 insertId，按 id 倒序取最新一条
  const [row] = await db
    .select()
    .from(users)
    .orderBy(desc(users.id))
    .limit(1)
  if (!row) throw new Error('createUser: insert succeeded but row not found')
  return row
}

export async function updateUser(
  id: number,
  patch: Partial<{
    nickname: string
    avatar: string | null
    email: string | null
    phone: string | null
    passwordHash: string | null
    wechatOpenid: string | null
    zhihuOpenid: string | null
    csdnOpenid: string | null
    juejinOpenid: string | null
  }>
) {
  // 仅当确实有 patch 字段才更新
  const set: Record<string, unknown> = {}
  if (patch.nickname !== undefined) set.nickname = patch.nickname
  if (patch.avatar !== undefined) set.avatar = patch.avatar
  if (patch.email !== undefined) set.email = patch.email
  if (patch.phone !== undefined) set.phone = patch.phone
  if (patch.passwordHash !== undefined) set.passwordHash = patch.passwordHash
  if (patch.wechatOpenid !== undefined) set.wechatOpenid = patch.wechatOpenid
  if (patch.zhihuOpenid !== undefined) set.zhihuOpenid = patch.zhihuOpenid
  if (patch.csdnOpenid !== undefined) set.csdnOpenid = patch.csdnOpenid
  if (patch.juejinOpenid !== undefined) set.juejinOpenid = patch.juejinOpenid
  if (Object.keys(set).length === 0) return findUserById(id)
  await db.update(users).set(set).where(eq(users.id, id))
  return findUserById(id)
}

/** 校验 email 或 phone 是否被其他用户占用 */
export async function isContactTaken(
  field: 'email' | 'phone',
  value: string,
  excludeUserId?: number
) {
  const where =
    field === 'email'
      ? excludeUserId
        ? and(eq(users.email, value))
        : eq(users.email, value)
      : eq(users.phone, value)
  const rows = await db.select({ id: users.id }).from(users).where(where).limit(1)
  const taken = rows[0]
  if (!taken) return false
  return excludeUserId ? taken.id !== excludeUserId : true
}