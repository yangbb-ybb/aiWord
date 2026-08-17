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
  charset: 'utf8mb4'
})

/** Drizzle 实例，类型安全 */
export const db = drizzle(pool, { schema, mode: 'default' })

export type Db = typeof db
export { schema }
