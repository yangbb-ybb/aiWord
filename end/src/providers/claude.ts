import Anthropic from '@anthropic-ai/sdk'
import type { AIProvider, GenerateOptions, ModelInfo } from './types'

/**
 * Anthropic 兼容实现 —— 同时承载 minimax（Anthropic 协议）
 * 和 Anthropic 官方，通过环境变量决定 baseURL/apiKey。
 */

/**
 * 把 {content, cacheControl} 转成 Anthropic 接受的 content block 数组。
 * Anthropic 的 cache_control 必须挂在 block 上（不能挂在 string 形式的 content 上），
 * 所以即使我们内部用 string content 存储消息，到了 SDK 调用层也要包一层。
 *
 * cache_control: { type: 'ephemeral' } —— 5 分钟 TTL；命中只收 10% input token 价。
 */
function toContentBlocks(msg: { content: string; cacheControl?: boolean }) {
  return [
    {
      type: 'text' as const,
      text: msg.content,
      cache_control: msg.cacheControl
        ? ({ type: 'ephemeral' as const } as const)
        : undefined
    }
  ]
}

export function createClaudeProvider(opts: {
  name: string
  apiKey: string | undefined
  baseURL: string
  defaultModel: string
  models: ModelInfo[]
}): AIProvider {
  const client = new Anthropic({
    apiKey: opts.apiKey ?? 'placeholder',
    baseURL: opts.baseURL
  })

  return {
    name: opts.name,
    listModels: () => opts.models,

    async stream(input, onChunk) {
      const stream = client.messages.stream(
        {
          model: input.model || opts.defaultModel,
          // system 永远标 cache：每次 generate 都重发同一份 system prompt，
          // 缓存它能让连续调用复用，命中按 10% 计费。
          system: input.system
            ? toContentBlocks({ content: input.system, cacheControl: true })
            : undefined,
          messages: input.messages.map((m) => ({
            role: m.role,
            content: toContentBlocks(m)
          })),
          max_tokens: input.maxTokens ?? 4096,
          temperature: input.temperature ?? 0.7
        },
        { signal: input.signal }
      )

      let text = ''
      for await (const event of stream) {
        // 内容增量
        if (
          event.type === 'content_block_delta' &&
          event.delta.type === 'text_delta'
        ) {
          text += event.delta.text
          onChunk(event.delta.text)
        }
      }

      const final = await stream.finalMessage()
      // cache_* 字段在 Anthropic SDK 0.32 的 TS 类型里只在 beta namespace 声明，
      // 但标准 endpoint 运行时也会返回。安全访问：先取标准字段，cache 字段做类型断言。
      const usage = final.usage as
        | (NonNullable<typeof final.usage> & {
            cache_read_input_tokens?: number
            cache_creation_input_tokens?: number
          })
        | undefined
      return {
        text,
        tokens:
          (usage?.input_tokens ?? 0) +
          (usage?.output_tokens ?? 0),
        // 透传 cache 命中数据，前端可在 SSE done 事件里展示"本次命中 cache X tokens"
        cacheRead: usage?.cache_read_input_tokens ?? 0,
        cacheWrite: usage?.cache_creation_input_tokens ?? 0
      }
    }
  }
}
