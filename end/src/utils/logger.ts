/**
 * 日志系统：
 * - 所有日志落到 ./logs/app.YYYY-MM-DD.log（按本地日切分）
 * - dev 模式额外打印到 stdout（轻量 pretty transform，避免起 pino-pretty worker）
 * - 通过 env.LOG_TO_CONSOLE=false 可关掉 stdout
 *
 * 为什么不用 pino-roll：
 *   pino-roll v4 用 `frequency + size` 双旋钮 + birthtime 过滤来定位"今天的 .N.log"。
 *   跨午夜 + tsx watch 重启组合下，会把刚创建的 `.1.log` 当作"昨天的"过滤掉，
 *   下次 reopen 时跳到 `.2.log`，于是同一天出现多个空 `.N.log`。
 *   自己写 daily rotation：用本地日期直接拼路径，永远是单文件
 *   `app.YYYY-MM-DD.log`，跨午夜 + 任意次重启都自然 append，零边界 case。
 */
import fs from 'node:fs'
import path from 'node:path'
import pino, { multistream, type StreamEntry } from 'pino'
import SonicBoom from 'sonic-boom'
import { env } from '~/config/env'
import { now } from '~/utils/time'

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

/** 用本地日期 YYYY-MM-DD 拼日志路径（每天单文件，无 .N 后缀） */
function logPathForDate(logDir: string, baseName: string, date: Date): string {
  const yyyy = date.getFullYear()
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  return path.join(logDir, `${baseName}.${yyyy}-${mm}-${dd}.log`)
}

/** 下一个本地午夜（00:00:00.000）的 ms 时间戳。setHours(24) 自动跨天到下一天 00:00 */
function nextLocalMidnightMs(at: Date = new Date()): number {
  const d = new Date(at)
  d.setHours(24, 0, 0, 0)
  return d.getTime()
}

/**
 * 自写 daily rotation：
 * - 启动时 SonicBoom 打开今天的文件（append，不存在则 mkdir+create）
 * - setTimeout 排到下一个本地午夜，触发时 reopen 到明天的文件
 * - SonicBoom 'close' 时清理定时器（tsx watch 重启时老实例会先关）
 * - setTimeout.unref() 保证定时器不会拖住进程退出
 */
function createDailyFileStream(logDir: string, baseName: string): SonicBoom {
  ensureDir(logDir)
  const initialPath = logPathForDate(logDir, baseName, new Date())
  const stream = new SonicBoom({ dest: initialPath, mkdir: true })

  let timeout: NodeJS.Timeout | null = null
  let closed = false

  function scheduleRotate() {
    if (closed) return
    const delay = Math.max(0, nextLocalMidnightMs() - Date.now())
    timeout = setTimeout(() => {
      if (closed) return
      const tomorrow = new Date()
      const newPath = logPathForDate(logDir, baseName, tomorrow)
      try {
        stream.reopen(newPath)
      } catch (err) {
        stream.emit('error', err)
      }
      scheduleRotate()
    }, delay).unref()
  }

  stream.once('close', () => {
    closed = true
    if (timeout) {
      clearTimeout(timeout)
      timeout = null
    }
  })

  scheduleRotate()
  return stream
}

/**
 * 自定义 timestamp —— 把 UTC ISO 字符串(末尾 `Z`)转成北京时间(+08:00)。
 *
 * 为什么不用 pino.stdTimeFunctions.isoTime：默认输出 `2026-08-31T07:22:41.262Z`，
 * 末尾 `Z` 是 UTC 标记。国内看日志要 +8 小时换算，容易误判"夜间请求"。
 * 这里直接吐出 `2026-08-31T15:22:41.262+08:00`，肉眼即读。
 *
 * 注意：daily rotation 的本地日期逻辑(getFullYear/getMonth/getDate)保持不变，
 * 这俩本来就是本地时间，所以跨天切分不会受影响。
 */
function beijingIsoTime(): string {
  const now = new Date()
  // 把 UTC 时间拨到东八区，再格式化掉时区标记
  const beijing = new Date(now.getTime() + 8 * 60 * 60 * 1000)
  // toISOString 永远返回 `...Z`,我们替换 Z 为 `+08:00`
  return beijing.toISOString().replace('Z', '+08:00')
}

/** 构造 pino 实例。Fastify 启动时通过 logger 选项接收（pino 自身就是 FastifyBaseLogger）。 */
export async function createLogger() {
  const logDir = path.isAbsolute(env.LOG_DIR)
    ? env.LOG_DIR
    : path.resolve(process.cwd(), env.LOG_DIR)

  const fileStream = createDailyFileStream(logDir, env.LOG_FILE)
  const todayPath = logPathForDate(logDir, env.LOG_FILE, new Date())

  const streams: StreamEntry[] = [{ stream: fileStream }]

  if (env.LOG_TO_CONSOLE) {
    if (env.NODE_ENV === 'development') {
      // dev 终端轻量 pretty（避免再启 pino-pretty worker 进程）
      streams.push({
        stream: {
          write(chunk: Buffer | string) {
            const line = chunk.toString().trim()
            if (!line) return
            try {
              const obj = JSON.parse(line)
              // eslint-disable-next-line no-console
              console.log(formatPretty(obj))
            } catch {
              // eslint-disable-next-line no-console
              console.log(line)
            }
          }
        }
      })
    } else {
      // prod: stdout 写 JSON（容器化部署由宿主收集）
      streams.push({ stream: process.stdout })
    }
  }

  const logger = pino(
    {
      level: env.LOG_LEVEL,
      base: { service: 'aiword-end', pid: process.pid },
      timestamp: beijingIsoTime,
      formatters: {
        level: (label: string) => ({ level: label })
      },
      redact: {
        paths: [
          'req.headers.authorization',
          'req.headers.cookie',
          'res.headers["set-cookie"]',
          '*.password',
          '*.passwordHash',
          '*.token',
          '*.refreshToken'
        ],
        censor: '[REDACTED]'
      }
    },
    multistream(streams, { dedupe: false })
  )

  // 启动 banner（用 logger 输出，绕过 self-reference 死锁）
  logger.info(
    {
      nodeEnv: env.NODE_ENV,
      logLevel: env.LOG_LEVEL,
      logDir,
      logFile: path.basename(todayPath)
    },
    'logger initialized'
  )

  return logger
}

/** 极简 dev 终端格式化（避免再启 pino-pretty worker 进程）。 */
function formatPretty(obj: Record<string, unknown>): string {
  const ts = (obj.time as string) ?? now().toISOString()
  const lvl = String(obj.level ?? 'info').toUpperCase().padEnd(5)
  const reqId = obj.reqId ? `[${String(obj.reqId).slice(0, 8)}] ` : ''
  const msg = obj.msg ?? ''
  const rest = { ...obj }
  delete rest.time
  delete rest.level
  delete rest.msg
  delete rest.reqId
  delete rest.pid
  delete rest.service
  const extras = Object.keys(rest).length ? ' ' + JSON.stringify(rest) : ''
  return `${ts} ${lvl} ${reqId}${msg}${extras}`
}