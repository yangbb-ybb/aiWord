import crypto from 'node:crypto'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { and, eq, lt, isNull } from 'drizzle-orm'
import { env } from '~/config/env'
import { db } from '~/db'
import { refreshTokens, smsCodes, users, type UserRow } from '~/db/schema'
import { AppError } from './errors'

/**
 * 简化的 ms 解析：支持 '5m' / '2h' / '30d'，够用即可。
 */
function parseTtl(ttl: string): number {
  const m = /^(\d+)([smhd])$/.exec(ttl.trim())
  if (!m) throw new Error(`Invalid TTL: ${ttl}`)
  const n = Number(m[1])
  const unit = m[2]
  const factor =
    unit === 's'
      ? 1000
      : unit === 'm'
      ? 60_000
      : unit === 'h'
      ? 3_600_000
      : 86_400_000
  return n * factor
}

export interface AccessTokenPayload {
  sub: string // user id (string 形式)
  role: string
  type: 'access'
}

export interface RefreshTokenPayload {
  sub: string
  jti: string // unique token id，用于撤销
  type: 'refresh'
}

const ACCESS_SECRET = () => env.JWT_SECRET
const REFRESH_SECRET = () => env.JWT_SECRET + ':refresh'
const ISSUER = () => env.JWT_ISSUER

export function signAccessToken(user: UserRow): string {
  const payload: AccessTokenPayload = {
    sub: String(user.id),
    role: user.role,
    type: 'access'
  }
  return jwt.sign(payload, ACCESS_SECRET(), {
    expiresIn: parseTtl(env.ACCESS_TOKEN_TTL) / 1000,
    issuer: ISSUER()
  })
}

/**
 * Refresh token 是 jwt，但只在数据库存 hash + 撤销位 —— 这样 logout / 全设备踢人可控。
 */
export async function issueRefreshToken(user: UserRow): Promise<string> {
  const jti = crypto.randomBytes(16).toString('hex')
  const payload: RefreshTokenPayload = {
    sub: String(user.id),
    jti,
    type: 'refresh'
  }
  const token = jwt.sign(payload, REFRESH_SECRET(), {
    expiresIn: parseTtl(env.REFRESH_TOKEN_TTL) / 1000,
    issuer: ISSUER()
  })
  const tokenHash = hashToken(token)
  const expiresAt = new Date(Date.now() + parseTtl(env.REFRESH_TOKEN_TTL))
  await db.insert(refreshTokens).values({
    userId: user.id,
    tokenHash,
    expiresAt
  })
  return token
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

export async function rotateRefreshToken(oldToken: string) {
  // 1) 校验 jwt 签名
  let decoded: RefreshTokenPayload
  try {
    decoded = jwt.verify(oldToken, REFRESH_SECRET(), {
      issuer: ISSUER()
    }) as RefreshTokenPayload
  } catch {
    throw authError('REFRESH_INVALID', 'refresh token 无效或已过期')
  }
  if (decoded.type !== 'refresh') throw authError('REFRESH_INVALID', 'token 类型错误')

  // 2) 数据库里要存在、未撤销、未过期
  const tokenHash = hashToken(oldToken)
  const rows = await db
    .select()
    .from(refreshTokens)
    .where(
      and(
        eq(refreshTokens.tokenHash, tokenHash),
        isNull(refreshTokens.revoked)
      )
    )
    .limit(1)
  const row = rows[0]
  if (!row) throw authError('REFRESH_REVOKED', 'refresh token 已失效')
  if (row.expiresAt.getTime() < Date.now()) {
    throw authError('REFRESH_EXPIRED', 'refresh token 已过期')
  }

  // 3) 撤销旧的、签发新的（rotation）
  await db
    .update(refreshTokens)
    .set({ revoked: true })
    .where(eq(refreshTokens.id, row.id))

  const user = await db
    .select()
    .from(users)
    .where(eq(users.id, Number(decoded.sub)))
    .limit(1)
  const u = user[0]
  if (!u) throw authError('USER_NOT_FOUND', '用户不存在')

  return {
    user: u,
    accessToken: signAccessToken(u),
    refreshToken: await issueRefreshToken(u)
  }
}

export async function revokeRefreshToken(token: string): Promise<boolean> {
  const tokenHash = hashToken(token)
  const rows = await db
    .select()
    .from(refreshTokens)
    .where(eq(refreshTokens.tokenHash, tokenHash))
    .limit(1)
  const row = rows[0]
  if (!row) return false
  await db
    .update(refreshTokens)
    .set({ revoked: true })
    .where(eq(refreshTokens.id, row.id))
  return true
}

/** 校验 access token，返回 payload 或抛 authError */
export function verifyAccessToken(token: string): AccessTokenPayload {
  try {
    const decoded = jwt.verify(token, ACCESS_SECRET(), {
      issuer: ISSUER()
    }) as AccessTokenPayload
    if (decoded.type !== 'access') throw new Error('wrong type')
    return decoded
  } catch {
    throw authError('TOKEN_INVALID', 'access token 无效或已过期')
  }
}

// ---------- 密码 ----------

export async function hashPassword(plain: string) {
  return bcrypt.hash(plain, 10)
}

export async function verifyPassword(plain: string, hash: string) {
  return bcrypt.compare(plain, hash)
}

// ---------- 短信验证码 ----------

function genSmsCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000))
}

export async function sendSmsCode(phone: string, purpose: 'login' | 'register') {
  const code = genSmsCode()
  const ttlMs = parseTtl(env.SMS_CODE_TTL)
  const expiresAt = new Date(Date.now() + ttlMs)
  await db.insert(smsCodes).values({ phone, code, purpose, expiresAt })
  // 不再 console.log —— 路由层用 req.log.info 写一条带 reqId / phone / code / purpose / ttl 的完整日志
  return { code, expiresAt, ttlMs }
}

export type ConsumeSmsResult =
  | { ok: true }
  | { ok: false; reason: 'NOT_FOUND' | 'EXPIRED' }

/**
 * 校验短信码并标记为已用。返回 ok + 失败原因，路由层据此写日志 + 转 HTTP code。
 */
export async function consumeSmsCode(
  phone: string,
  code: string,
  purpose: 'login' | 'register'
): Promise<ConsumeSmsResult> {
  const rows = await db
    .select()
    .from(smsCodes)
    .where(
      and(
        eq(smsCodes.phone, phone),
        eq(smsCodes.code, code),
        eq(smsCodes.purpose, purpose),
        eq(smsCodes.used, false)
      )
    )
    .limit(1)
  const row = rows[0]
  if (!row) return { ok: false, reason: 'NOT_FOUND' }
  if (row.expiresAt.getTime() < Date.now()) return { ok: false, reason: 'EXPIRED' }
  await db.update(smsCodes).set({ used: true }).where(eq(smsCodes.id, row.id))
  return { ok: true }
}

/** 清理过期验证码 / refresh token —— 定时任务或路由里偶尔调用 */
export async function purgeExpired() {
  const now = new Date()
  await db.delete(smsCodes).where(lt(smsCodes.expiresAt, now))
  await db
    .delete(refreshTokens)
    .where(lt(refreshTokens.expiresAt, now))
}

// ---------- error ----------

/** 构造一个 401 业务错误，供 service 内部 throw */
export function authError(code: string, message: string): AppError {
  return new AppError(code, message, 401)
}