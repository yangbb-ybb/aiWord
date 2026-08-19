import mysql from 'mysql2/promise'
import { drizzle } from 'drizzle-orm/mysql2'
import { env } from '~/config/env'
import * as schema from './schema'

/** mysql2 连接池 —— 全部 routes 共享 */
export const pool = mysql.createPool({
  uri: env.MYSQL_URL,
  connectionLimit: 10,
  waitForConnections: true,
  // 解析成字符串，否则 mysql2 默认会把所有字段都转 Buffer
  dateStrings: true,
  // 锁北京时间（UTC+8）：所有 JS Date → MySQL 字符串的转换都按 +08:00 走
  // 配合下面 pool.on('connection') 设的 session time_zone，整个链路统一 UTC+8
  // ⚠️ 数据库里看到的时间就是北京时间，导表 / 排查都直接看，不需要再 +8 / -8 转换
  timezone: '+08:00',
  charset: 'utf8mb4'
})

/**
 * 新连接建立后强制把 MySQL session 时区设为 UTC+8（北京时间）。
 *
 * 背景：之前 schema 里
 *   - created_at 用 Drizzle 的 defaultNow() → MySQL DEFAULT CURRENT_TIMESTAMP
 *     按 **MySQL session time_zone** 解释
 *   - updated_at 用 $onUpdate(() => new Date()) → JS 端 new Date()
 *     按 **mysql2 driver timezone** 解释
 * 两个时区不一致（一个跟 MySQL 容器，一个跟 Node 进程）就会导致 created_at 和 updated_at
 * 相差几小时甚至几天。统一锁 UTC+8（北京时间）的优势：
 *   - 看表 / 导表 / 排查问题直接读，不用再做时区转换
 *   - 单时区项目（中国用户为主）使用本地时间最直观
 */
pool.on('connection', (conn) => {
  // ⚠️ 这里 conn 是 pool 暴露的底层 mysql2 连接（不是 promise 包装版本），
  // 直接 conn.query() 返回的是 Query 对象，不能 await。
  // 必须先 .promise() 转成 promise 版才能用 await / .catch。
  conn.promise().query("SET time_zone = '+08:00'").catch((err: unknown) => {
    console.error('[db] failed to set session time_zone to UTC+8:', err)
  })
})

/** Drizzle 实例，类型安全 */
export const db = drizzle(pool, { schema, mode: 'default' })

export type Db = typeof db
export { schema }
