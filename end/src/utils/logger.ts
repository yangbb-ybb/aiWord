/**
 * 日志系统：
 * - 每一条接口默认就会被 Fastify 记录（req.log 自动带 requestId/方法/路径/状态码/耗时）
 * - 所有日志同时落到 ./logs/app-YYYY-MM-DD.log（按天 + 大小双条件切分 by pino-roll）
 * - dev 模式：额外打印到 stdout（轻量 pretty transform）
 * - 通过 env.LOG_TO_CONSOLE=false 可关掉 stdout
 */
import fs from 'node:fs'
import path from 'node:path'
import pino, { multistream, type StreamEntry } from 'pino'
import pinoroll from 'pino-roll'
import { env } from '~/config/env'

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

/** 构造 pino 实例。Fastify 启动时通过 logger 选项接收（pino 自身就是 FastifyBaseLogger）。 */
export async function createLogger() {
  const logDir = path.isAbsolute(env.LOG_DIR)
    ? env.LOG_DIR
    : path.resolve(process.cwd(), env.LOG_DIR)
  ensureDir(logDir)

  // pino-roll v4 返回 Promise<SonicBoom>，要 await 才能拿到 stream
  const fileStream = await pinoroll({
    file: path.join(logDir, env.LOG_FILE),
    frequency: 'daily',
    size: '50m',
    mkdir: true,
    dateFormat: 'yyyy-MM-dd',
    extension: '.log'
  })

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

  return pino(
    {
      level: env.LOG_LEVEL,
      base: { service: 'aiword-end', pid: process.pid },
      timestamp: pino.stdTimeFunctions.isoTime,
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
}

/** 极简 dev 终端格式化（避免再启 pino-pretty worker 进程）。 */
function formatPretty(obj: Record<string, unknown>): string {
  const ts = (obj.time as string) ?? new Date().toISOString()
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