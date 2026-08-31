import Anthropic from '@anthropic-ai/sdk'
import type { AIProvider, ContentBlock, GenerateOptions, ModelInfo } from './types'

/**
 * Anthropic 兼容实现 —— 同时承载 minimax（Anthropic 协议）
 * 和 Anthropic 官方，通过环境变量决定 baseURL/apiKey。
 */

/**
 * 把 {content, cacheControl} 转成 Anthropic 接受的 content block 数组。
 *
 * 两种入参：
 *  - string content → 包成单 text block
 *  - ContentBlock[] → 透传 image block + text block
 *
 * 注意：Anthropic SDK 0.32 标准类型 TextBlockParam **没有** cache_control 字段
 * (它是 beta 特性,要走 BetaTextBlockParam)。我们这里先不做 cache 优化
 * (cacheControl 参数保留,但转 block 时跳过),后续要做就切到 beta endpoint。
 *
 * 返回类型用 `any`：Anthropic SDK 的 ImageBlockParam 是 discriminated union
 * (url/base64 两种 source 互斥),TS 推断窄到 base64 形式而拒绝 url 形式。
 * runtime 实际接受任意一种,这里直接 `as any` 让 TS 不卡,SDK 端 runtime 会校验。
 */
function toContentBlocks(msg: {
  content: string | ContentBlock[]
  cacheControl?: boolean
}): any {
  if (typeof msg.content === 'string') {
    // cacheControl 当前被忽略 —— 后续切到 BetaTextBlockParam 可重新启用
    return [{ type: 'text', text: msg.content }]
  }

  return msg.content.map((b) => {
    if (b.type === 'text') {
      return { type: 'text', text: b.text }
    }
    if (b.source.type === 'url') {
      return {
        type: 'image',
        source: { type: 'url', url: b.source.data }
      }
    }
    return {
      type: 'image',
      source: {
        type: 'base64',
        media_type: b.source.media_type as
          | 'image/jpeg'
          | 'image/png'
          | 'image/gif'
          | 'image/webp',
        data: b.source.data
      }
    }
  })
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
      // system 永远标 cache：每次 generate 都重发同一份 system prompt，
      // 缓存它能让连续调用复用，命中按 10% 计费。
      // (当前 SDK 不支持 cache_control 字段,先关掉)
      const systemBlocks = input.system
        ? toContentBlocks({ content: input.system })
        : undefined

      const stream = client.messages.stream(
        {
          model: input.model || opts.defaultModel,
          system: systemBlocks,
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
