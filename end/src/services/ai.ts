import { getProvider } from '~/providers'
import type { Message } from '~/providers/types'

/** 前端风格 → 自然语言描述 */
const TONE_DESC: Record<string, string> = {
  formal: '正式、书面、有理有据',
  casual: '口语化、轻松、像朋友聊天',
  marketing: '营销、煽动性强、有行动号召',
  technical: '技术深度高、术语准确、代码示例'
}

/** 前端长度档位 → 字数提示 */
const LENGTH_DESC: Record<string, string> = {
  short: '300 字左右',
  medium: '600 字左右',
  medium_long: '1200 字左右',
  long: '2000 字以上'
}

const LANG_DESC: Record<string, string> = {
  zh: '中文',
  en: 'English',
  mixed: '中英混合'
}

export interface GenerateInput {
  prompt: string
  model?: string
  tone?: string
  length?: string
  language?: string
  /** 已存在的正文（续写） */
  contextText?: string
}

export interface RewriteInput {
  text: string
  instruction?: string
  tone?: string
  model?: string
}

export interface SummarizeInput {
  text: string
  /** 摘要字数上限 */
  maxChars?: number
  model?: string
}

export interface TranslateInput {
  text: string
  targetLang: 'zh' | 'en' | 'mixed'
  model?: string
}

function buildSystem(opts: {
  tone?: string
  length?: string
  language?: string
}): string {
  const tone = TONE_DESC[opts.tone ?? 'formal']
  const length = LENGTH_DESC[opts.length ?? 'medium']
  const lang = LANG_DESC[opts.language ?? 'zh']
  return [
    '你是 aiWord 的写作助手，用户正编辑一份 Markdown 文档。',
    `风格：${tone}`,
    `长度：${length}`,
    `语言：${lang}`,
    '输出格式：合法 Markdown，可直接被渲染。遇到标题/列表/代码请正确使用语法。',
    '不要解释、不要寒暄，直接产出内容。'
  ].join('\n')
}

/**
 * 通用业务方法：拿 provider，调 stream()，把增量喂给 onChunk 回调。
 */
async function streamWith(
  messages: Message[],
  system: string,
  onChunk: (delta: string) => void,
  model?: string
) {
  const provider = getProvider()
  const { text, tokens } = await provider.stream(
    {
      model: model ?? 'claude-sonnet',
      system,
      messages,
      temperature: 0.7,
      maxTokens: 4096
    },
    onChunk
  )
  return { text, tokens }
}

export async function runGenerate(
  input: GenerateInput,
  onChunk: (delta: string) => void
) {
  const system = buildSystem({
    tone: input.tone,
    length: input.length,
    language: input.language
  })

  const userText = input.contextText
    ? `以下是目前已有的内容（Markdown）：\n\n${input.contextText}\n\n请基于它${input.prompt || '续写/扩展/优化'}：`
    : input.prompt || '自由发挥'

  return streamWith([{ role: 'user', content: userText }], system, onChunk, input.model)
}

export async function runRewrite(
  input: RewriteInput,
  onChunk: (delta: string) => void
) {
  const system = buildSystem({ tone: input.tone ?? 'formal' })
  const user = [
    '请按以下要求改写下面的文本（保持 Markdown 结构）：',
    input.instruction
      ? `要求：${input.instruction}`
      : '要求：措辞更精炼，结构更清晰，观点更鲜明。',
    '',
    '原文：',
    input.text
  ].join('\n')
  return streamWith([{ role: 'user', content: user }], system, onChunk, input.model)
}

export async function runSummarize(
  input: SummarizeInput,
  onChunk: (delta: string) => void
) {
  const system = [
    '你是 aiWord 的摘要助手。',
    `请用不超过 ${input.maxChars ?? 200} 字输出摘要，保留关键信息和数字。`,
    '输出 Markdown，关键事实加粗。'
  ].join('\n')
  return streamWith(
    [{ role: 'user', content: `请摘要以下内容：\n\n${input.text}` }],
    system,
    onChunk,
    input.model
  )
}

export async function runTranslate(
  input: TranslateInput,
  onChunk: (delta: string) => void
) {
  const langMap = { zh: '中文', en: 'English', mixed: '中英混合' } as const
  const system = [
    '你是 aiWord 的翻译助手。',
    `把用户内容翻译为：${langMap[input.targetLang]}。`,
    '保持 Markdown 结构，代码/链接不译，术语准确。'
  ].join('\n')
  return streamWith(
    [{ role: 'user', content: input.text }],
    system,
    onChunk,
    input.model
  )
}
