declare module 'pino-roll' {
  import type { StreamEntry } from 'pino'

  interface PinoRollOptions {
    /** 文件名前缀（不含日期后缀和扩展名） */
    file: string
    /** 切分频率：'daily' | 'hourly' | number(ms) */
    frequency?: 'daily' | 'hourly' | number
    /** 单文件大小上限（如 '50m'），超过也强制切 */
    size?: string
    /** 自动 mkdir */
    mkdir?: boolean
    /** 切分时是否限制旧文件保留数量 */
    limit?: { count?: number; age?: string }
    /** 日期格式（frequency 为 'daily' 时生效） */
    dateFormat?: string
    /** 后缀名（含点） */
    extension?: string
    /** 切分时调用的回调 */
    onnoarchive?: () => void
  }

  function pinoRoll(opts: PinoRollOptions): NodeJS.WritableStream
  export default pinoRoll

  // 兼容某些调用方
  export const pinoRoll: typeof pinoRoll
}
