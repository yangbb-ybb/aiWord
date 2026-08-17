import crypto from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { env } from '~/config/env'
import { db } from '~/db'
import {
  wechatQrSessions,
  users,
  type WechatQrSessionRow
} from '~/db/schema'
import { issueRefreshToken, signAccessToken, consumeSmsCode } from '~/services/auth'
import { AppError } from './errors'
import {
  createUser,
  findUserByOpenid,
  findUserByPhone,
  toPublic,
  updateUser
} from '~/services/users'

const SESSION_TTL_MS = 5 * 60 * 1000 // 5 分钟

/** mock 模式下二维码要跳转的"模拟微信"页面，由前端实现 */
export function buildQrUrl(sceneId: string): string {
  // 真实模式下这里会是微信返回的 ticket 对应的二维码图片 URL；
  // mock 阶段直接拼前端路由，省去图片生成
  const base = env.FRONTEND_ORIGIN ?? 'http://localhost:5173'
  return `${base}/wechat-mock?scene=${sceneId}`
}

/** mock 模式：随机生成一个伪 openid；真实模式换成微信回调写入 */
function mockOpenid(): string {
  return 'mock_' + crypto.randomBytes(8).toString('hex')
}

export interface CreateSessionResult {
  sceneId: string
  qrUrl: string
  expiresAt: Date
}

export async function createSession(): Promise<CreateSessionResult> {
  const id = crypto.randomUUID()
  const openid = mockOpenid() // mock 阶段预生成；真实模式下不预生成，等回调
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS)
  await db.insert(wechatQrSessions).values({
    id,
    status: 'pending',
    openid,
    expiresAt
  })
  return {
    sceneId: id,
    qrUrl: buildQrUrl(id),
    expiresAt
  }
}

export async function getSession(sceneId: string) {
  const [row] = await db
    .select()
    .from(wechatQrSessions)
    .where(eq(wechatQrSessions.id, sceneId))
    .limit(1)
  if (!row) return null
  // 已过期但还是 pending → 视作 expired（不写回 DB，留个轻量判定）
  const isExpired = row.expiresAt.getTime() < Date.now()
  return { ...row, status: isExpired && row.status === 'pending' ? 'expired' : row.status }
}

/**
 * Mock 确认登录：
 * 1) 如果该 scene 关联的 mock openid 已被某个用户绑定 → 该用户直接登录（信任设备）
 * 2) 否则要求传 phone + smsCode：
 *    - 用 smsCode 验证手机号
 *    - 查 users by phone
 *    - 已存在 → 把 openid 绑到这个用户（处理 openid 冲突）
 *    - 不存在 → 创建新用户，phone 必填，nickname 默认 wx_<scene前6位>
 *    - 签发 token
 *    - 更新 session.status = 'confirmed'
 */
export interface ConfirmInput {
  sceneId: string
  phone?: string
  smsCode?: string
}

export interface ConfirmResult {
  user: ReturnType<typeof toPublic>
  accessToken: string
  refreshToken: string
}

export async function confirmMockLogin(input: ConfirmInput): Promise<ConfirmResult> {
  const [session] = await db
    .select()
    .from(wechatQrSessions)
    .where(eq(wechatQrSessions.id, input.sceneId))
    .limit(1)
  if (!session) throw wechatError('SCENE_NOT_FOUND', '二维码不存在', 404)
  if (session.status === 'confirmed')
    throw wechatError('ALREADY_CONFIRMED', '二维码已确认，请勿重复操作', 409)
  if (session.status === 'cancelled')
    throw wechatError('SCENE_CANCELLED', '二维码已取消', 410)
  if (session.status === 'expired' || session.expiresAt.getTime() < Date.now())
    throw wechatError('SCENE_EXPIRED', '二维码已过期，请刷新重试', 410)
  if (!session.openid) throw wechatError('NO_OPENID', '二维码未关联 openid', 500)

  // 路径 A：openid 已被绑定 → 直接登录该用户（设备信任）
  const existing = await findUserByOpenid('wechat', session.openid)
  if (existing) {
    return await finalizeLogin(session, existing)
  }

  // 路径 B：要求手机号 + 短信码
  if (!input.phone || !input.smsCode) {
    throw wechatError(
      'PHONE_REQUIRED',
      '首次微信登录需要手机号 + 短信验证码',
      400
    )
  }
  const result = await consumeSmsCode(input.phone, input.smsCode, 'login')
  if (!result.ok) {
    throw wechatError('SMS_INVALID', '验证码错误或已过期', 400)
  }

  // 手机号查用户
  let user = await findUserByPhone(input.phone)
  if (!user) {
    // 创建新用户 —— nickname 用 scene 前 6 位
    user = await createUser({
      nickname: `wx_${session.id.slice(0, 6)}`,
      phone: input.phone,
      passwordHash: null
    })
  }
  // 绑 openid（处理冲突：openid 已存在会由 findUserByOpenid 上面检测过，这里 user 是新拿到的）
  if (user.wechatOpenid && user.wechatOpenid !== session.openid) {
    throw wechatError(
      'WECHAT_OPENID_TAKEN',
      '该手机号已绑定其他微信号，请先解绑',
      409
    )
  }
  await updateUser(user.id, { wechatOpenid: session.openid })

  // 重新拿一次带最新 openid 的 user
  const updated = await findUserByPhone(input.phone)
  return await finalizeLogin(session, updated ?? user)
}

async function finalizeLogin(
  session: WechatQrSessionRow,
  user: typeof users.$inferSelect
) {
  const accessToken = signAccessToken(user)
  const refreshToken = await issueRefreshToken(user)
  await db
    .update(wechatQrSessions)
    .set({
      status: 'confirmed',
      userId: user.id,
      phone: user.phone ?? session.phone ?? null,
      updatedAt: new Date()
    })
    .where(eq(wechatQrSessions.id, session.id))
  return { user: toPublic(user), accessToken, refreshToken }
}

/** 已登录用户主动绑手机号（账号设置场景） */
export async function bindPhoneForUser(userId: number, phone: string, smsCode: string) {
  const result = await consumeSmsCode(phone, smsCode, 'login')
  if (!result.ok) {
    throw wechatError('SMS_INVALID', '验证码错误或已过期', 400)
  }
  await updateUser(userId, { phone })
  return { ok: true }
}

// ---------- error ----------

export function wechatError(code: string, message: string, statusCode = 400): AppError {
  return new AppError(code, message, statusCode)
}

// 抑制未使用警告
void and