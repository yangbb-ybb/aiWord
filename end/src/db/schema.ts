import {
  bigint,
  boolean,
  int,
  mysqlTable,
  text,
  timestamp,
  varchar
} from 'drizzle-orm/mysql-core'

/** 用户主表 —— 完整登录体系 */
export const users = mysqlTable('users', {
  id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
  nickname: varchar('nickname', { length: 64 }).notNull(),
  avatar: varchar('avatar', { length: 500 }),
  email: varchar('email', { length: 128 }),
  phone: varchar('phone', { length: 20 }),
  /** bcrypt 哈希后的密码；只走短信登录的用户为 null */
  passwordHash: varchar('password_hash', { length: 255 }),
  /** active / banned */
  status: varchar('status', { length: 16 }).notNull().default('active'),
  /** user / admin */
  role: varchar('role', { length: 16 }).notNull().default('user'),
  /** 第三方平台 openid —— OAuth 登录后回填，本阶段先建字段 */
  wechatOpenid: varchar('wechat_openid', { length: 64 }),
  zhihuOpenid: varchar('zhihu_openid', { length: 64 }),
  csdnOpenid: varchar('csdn_openid', { length: 64 }),
  juejinOpenid: varchar('juejin_openid', { length: 64 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at')
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull()
})

/** 手机号验证码 —— dev 阶段不入短信网关，直接打日志 */
export const smsCodes = mysqlTable('sms_codes', {
  id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
  phone: varchar('phone', { length: 20 }).notNull(),
  code: varchar('code', { length: 6 }).notNull(),
  /** login / register / reset */
  purpose: varchar('purpose', { length: 16 }).notNull().default('login'),
  expiresAt: timestamp('expires_at').notNull(),
  used: boolean('used').notNull().default(false),
  createdAt: timestamp('created_at').defaultNow().notNull()
})

/** Refresh Token —— 哈希存库，支持登出撤销 */
export const refreshTokens = mysqlTable('refresh_tokens', {
  id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
  userId: bigint('user_id', { mode: 'number', unsigned: true })
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: varchar('token_hash', { length: 255 }).notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  revoked: boolean('revoked').notNull().default(false),
  createdAt: timestamp('created_at').defaultNow().notNull()
})

/** 微信扫码登录会话 —— mock 阶段用，记录 scene → openid/user 绑定 */
export const wechatQrSessions = mysqlTable('wechat_qr_sessions', {
  /** uuid，作为二维码的 scene 标识 */
  id: varchar('id', { length: 64 }).primaryKey(),
  /** pending / scanned / confirmed / cancelled / expired */
  status: varchar('status', { length: 16 }).notNull().default('pending'),
  /** mock 模式分配的 openid —— 真实模式下由微信回调写入 */
  openid: varchar('openid', { length: 64 }),
  /** confirm 后绑定的 userId */
  userId: bigint('user_id', { mode: 'number', unsigned: true }).references(
    () => users.id,
    { onDelete: 'set null' }
  ),
  /** confirm 时填的手机号（用于审计/反查） */
  phone: varchar('phone', { length: 20 }),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at')
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull()
})

/** 文档主表 —— 与前端 store 模型强对齐 */
export const documents = mysqlTable('documents', {
  id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
  title: varchar('title', { length: 255 }).notNull(),
  excerpt: varchar('excerpt', { length: 500 }),
  content: text('content'),
  /** 逗号分隔：wechat,zhihu,csdn,juejin */
  platforms: varchar('platforms', { length: 64 }).default(''),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at')
    .defaultNow()
    .$onUpdate(() => new Date())
    .notNull()
})

/** 模板表 */
export const templates = mysqlTable('templates', {
  id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
  name: varchar('name', { length: 64 }).notNull(),
  emoji: varchar('emoji', { length: 8 }),
  description: varchar('description', { length: 255 }),
  content: text('content').notNull(),
  sort: int('sort').default(0)
})

/** 发布任务表 —— 阶段三 publish 用，本阶段只建表不留操作 */
export const publishJobs = mysqlTable('publish_jobs', {
  id: bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey(),
  documentId: bigint('document_id', { mode: 'number', unsigned: true })
    .notNull()
    .references(() => documents.id, { onDelete: 'cascade' }),
  platform: varchar('platform', { length: 32 }).notNull(),
  status: varchar('status', { length: 16 }).notNull().default('pending'),
  error: text('error'),
  remoteUrl: varchar('remote_url', { length: 500 }),
  createdAt: timestamp('created_at').defaultNow().notNull()
})

export type UserRow = typeof users.$inferSelect
export type UserInsert = typeof users.$inferInsert
export type SmsCodeRow = typeof smsCodes.$inferSelect
export type RefreshTokenRow = typeof refreshTokens.$inferSelect
export type WechatQrSessionRow = typeof wechatQrSessions.$inferSelect
export type DocumentRow = typeof documents.$inferSelect
export type DocumentInsert = typeof documents.$inferInsert
export type TemplateRow = typeof templates.$inferSelect
export type TemplateInsert = typeof templates.$inferInsert
export type PublishJobRow = typeof publishJobs.$inferSelect
