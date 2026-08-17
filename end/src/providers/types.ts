/**
 * AI Provider 抽象接口
 * —— 后续加 OpenAI / DeepSeek / 通义只需新写一个实现，注册到 factory
 */

/** system 消息不放进 messages 数组，而是顶层 system 字段 */
export type Role = 'user' | 'assistant'

/** 单独类型表示"system 提示"，仅放在顶层 */
export interface SystemMessage {
  role: 'system'
  content: string
}

export interface Message {
  role: Role
  content: string
}

export interface GenerateOptions {
  model: string
  system?: string
  messages: Message[]
  temperature?: number
  maxTokens?: number
  /** 关闭流式（一次性返回全部内容） */
  nonStream?: boolean
  signal?: AbortSignal
}

export interface ModelInfo {
  id: string
  label: string
}

export interface AIProvider {
  name: string
  listModels(): ModelInfo[]
  /**
   * 流式：每收到一段增量文本就回调一次；最终返回拼好的全文。
   * 业务层把回调接进 SSE。
   */
  stream(
    opts: GenerateOptions,
    onChunk: (delta: string) => void
  ): Promise<{ text: string; tokens?: number }>
}
