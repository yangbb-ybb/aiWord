import { env, pickAiProvider } from '~/config/env'
import { createClaudeProvider } from './claude'
import type { AIProvider } from './types'

/**
 * minimax（Anthropic 协议）。列表里把这个 model 当成"claude-sonnet-*"使用，
 * 实际由 env.MINIMAX_MODEL 决定发给 minimax 的模型名。
 */
const MINIMAX_MODELS = [
  { id: 'claude-sonnet', label: 'minimax · Sonnet（推荐）' },
  { id: 'claude-haiku', label: 'minimax · Haiku（更快）' },
  { id: 'claude-opus', label: 'minimax · Opus（更强）' }
]

const ANTHROPIC_MODELS = [
  { id: 'claude-sonnet-4-5', label: 'Anthropic · Claude Sonnet 4.5' },
  { id: 'claude-haiku-4-5', label: 'Anthropic · Claude Haiku 4.5' },
  { id: 'claude-opus-4-1', label: 'Anthropic · Claude Opus 4.1' }
]

let cached: AIProvider | null = null

/** key 是否"实际可用"——非 undefined 且 trim 后非空 */
function hasUsableKey(v: string | undefined): boolean {
  return typeof v === 'string' && v.trim().length > 0
}

/**
 * 拿到一个真正可用的 API key；如果两个都没配，抛错让上层返回 503。
 * 比 Anthropic SDK 自己抛的 "Could not resolve authentication method" 更友好。
 */
export function resolveApiKey(): { provider: 'minimax' | 'anthropic'; apiKey: string } {
  if (hasUsableKey(env.MINIMAX_API_KEY)) {
    return { provider: 'minimax', apiKey: env.MINIMAX_API_KEY!.trim() }
  }
  if (hasUsableKey(env.ANTHROPIC_API_KEY)) {
    return { provider: 'anthropic', apiKey: env.ANTHROPIC_API_KEY!.trim() }
  }
  throw new Error(
    'AI 服务未配置 API Key：请在 end/.env 里设置 MINIMAX_API_KEY（推荐）或 ANTHROPIC_API_KEY'
  )
}

/**
 * 单例工厂：第一个 provider 选定后缓存，避免每次请求重新构造 SDK 客户端。
 * 切换 provider 需要重启。
 */
export function getProvider(): AIProvider {
  if (cached) return cached
  const { provider, apiKey } = resolveApiKey()

  if (provider === 'minimax') {
    cached = createClaudeProvider({
      name: 'minimax',
      apiKey,
      baseURL: env.MINIMAX_BASE_URL,
      defaultModel: env.MINIMAX_MODEL,
      models: MINIMAX_MODELS
    })
  } else {
    cached = createClaudeProvider({
      name: 'anthropic',
      apiKey,
      baseURL: env.ANTHROPIC_BASE_URL,
      defaultModel: 'claude-sonnet-4-5',
      models: ANTHROPIC_MODELS
    })
  }
  return cached
}

/**
 * 把前端传的 model id（可能是 "claude-sonnet"）映射成实际发给 provider 的 model 名。
 * minimax 现在仍按 id 直传（很多 minimax 模型也叫 claude-sonnet-*）。
 */
export function resolveModel(modelId: string): string {
  return modelId || env.MINIMAX_MODEL
}

export type { AIProvider } from './types'
