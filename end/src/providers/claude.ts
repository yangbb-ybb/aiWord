import Anthropic from '@anthropic-ai/sdk'
import type { AIProvider, GenerateOptions, ModelInfo } from './types'

/**
 * Anthropic 兼容实现 —— 同时承载 minimax（Anthropic 协议）
 * 和 Anthropic 官方，通过环境变量决定 baseURL/apiKey。
 */
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
          system: input.system,
          messages: input.messages,
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
      return {
        text,
        tokens:
          (final.usage?.input_tokens ?? 0) +
          (final.usage?.output_tokens ?? 0)
      }
    }
  }
}
