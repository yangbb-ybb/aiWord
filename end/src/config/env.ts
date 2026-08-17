import 'dotenv/config'
import { z } from 'zod'

/**
 * 环境变量集中解析。启动时若缺关键值直接抛错，避免运行时再炸。
 */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(8787),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace'])
    .default('info'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  AUTH_TOKEN: z.string().optional(),

  MYSQL_URL: z
    .string()
    .default('mysql://root:root@localhost:3306/aiword'),

  // AI Provider —— minimax 走 Anthropic 协议
  MINIMAX_API_KEY: z.string().optional(),
  MINIMAX_BASE_URL: z
    .string()
    .default('https://api.minimaxi.com/anthropic'),
  MINIMAX_MODEL: z.string().default('claude-sonnet-4-5'),

  // 官方 Anthropic 作为兜底
  ANTHROPIC_API_KEY: z.string().optional(),
  ANTHROPIC_BASE_URL: z.string().default('https://api.anthropic.com'),

  // JWT
  JWT_SECRET: z.string().min(16).default('aiword-dev-secret-change-in-production'),
  JWT_ISSUER: z.string().default('aiword'),
  ACCESS_TOKEN_TTL: z.string().default('2h'),
  REFRESH_TOKEN_TTL: z.string().default('30d'),
  SMS_CODE_TTL: z.string().default('5m'),

  // 前端 origin —— 用于微信扫码二维码跳转的 mock 确认页
  FRONTEND_ORIGIN: z.string().default('http://localhost:5173'),

  // 微信开放平台 —— mock 阶段可不填；真实接入时填 AppID/Secret/回调
  WECHAT_APP_ID: z.string().optional(),
  WECHAT_APP_SECRET: z.string().optional(),
  WECHAT_REDIRECT_URI: z.string().optional()
})

const parsed = schema.safeParse(process.env)
if (!parsed.success) {
  console.error('❌ 环境变量校验失败：', parsed.error.flatten().fieldErrors)
  process.exit(1)
}

export const env = parsed.data
export type Env = typeof env

/** 选 AI provider：minimax 优先，否则官方 Anthropic */
export function pickAiProvider(): 'minimax' | 'anthropic' {
  if (env.MINIMAX_API_KEY) return 'minimax'
  if (env.ANTHROPIC_API_KEY) return 'anthropic'
  return 'minimax' // 没 key 也默认走 minimax（路由会返回 401/503 友好提示）
}
