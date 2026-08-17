/**
 * 业务级错误：所有 throw 出去的错误都用这个类。
 * 全局错误处理器（app.ts）会识别它并把 code/message/statusCode 透传到响应体。
 * 路径/services 里有一个 authError / wechatError 帮助生成它。
 */
export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number = 400,
    public readonly details?: unknown
  ) {
    super(message)
    this.name = 'AppError'
  }
}

/**
 * 识别 mysql/driver 错误 —— 这些错误的 .code 都是 ER_xxx / 网络 socket 错误。
 * 识别后返回 DB_ERROR 业务码，避免把 ER_ACCESS_DENIED_ERROR 这类内部码暴露给前端。
 */
export function isDbError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const e = err as {
    code?: string
    errno?: number
    sqlMessage?: string
    sqlState?: string
  }
  if (typeof e.code === 'string') {
    // mysql2 驱动错误码
    if (e.code.startsWith('ER_')) return true
    // node 网络层错误
    if (
      e.code === 'ECONNREFUSED' ||
      e.code === 'ETIMEDOUT' ||
      e.code === 'ENOTFOUND' ||
      e.code === 'EHOSTUNREACH' ||
      e.code === 'PROTOCOL_CONNECTION_LOST' ||
      e.code === 'POOL_CLOSED'
    ) {
      return true
    }
  }
  // 直接有 sqlMessage / errno 的一般也是 DB 错误
  if (typeof e.sqlMessage === 'string' || typeof e.errno === 'number') return true
  return false
}
