import { getProvider, resolveModel } from '~/providers'
import type { Message } from '~/providers/types'

/** 前端风格 → 自然语言描述 */
const TONE_DESC: Record<string, string> = {
  formal: '正式、书面、有理有据',
  casual: '口语化、轻松、像朋友聊天',
  marketing: '营销、煽动性强、有行动号召',
  technical: '技术深度高、术语准确、代码示例'
}

const LANG_DESC: Record<string, string> = {
  zh: '中文',
  en: 'English',
  mixed: '中英混合'
}

/**
 * 前端滑块值（0/25/50/75/100） → 字数描述。
 * 0=短, 25=中短, 50=中长, 75=长, 100=超长
 */
function lengthToText(n: number): string {
  if (n <= 0) return '300 字以内'
  if (n <= 25) return '300~500 字'
  if (n <= 50) return '500~900 字'
  if (n <= 75) return '900~1500 字'
  return '1500 字以上（深度长文）'
}

export interface GenerateInput {
  prompt: string
  /** 前端下拉的 model id，如 'claude-sonnet' / 'claude-haiku' / 'claude-opus' */
  model?: string
  tone?: string
  /** 前端滑块值 0~100（步长 25） */
  length?: number
  language?: string
  /** 已存在的正文（完整 Markdown） */
  contextText?: string
  /**
   * 对话历史：[{role: 'user' | 'assistant', content: string}, ...]
   * AI 通过它"记住"之前几轮做了什么，避免每次都从零续写
   */
  history?: Array<{ role: 'user' | 'assistant'; content: string }>
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
  length?: number
  language?: string
}): string {
  const tone = TONE_DESC[opts.tone ?? 'formal']
  const length = lengthToText(opts.length ?? 50)
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
 * `model` 是前端下拉的 model id，会通过 resolveModel 映射成 provider 实际期望的名字。
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
      model: resolveModel(model ?? ''),
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

  // 关键 prompt：让 AI 每次都返回"完整新文档"，而不是片段
  // 这样前端拿到结果后直接替换 doc.content，不会越堆越长
  const userText = input.contextText
    ? `以下是当前文档的完整 Markdown 内容：

\`\`\`markdown
${input.contextText}
\`\`\`

用户当前的指令：${input.prompt || '请基于以上内容继续完善'}

要求：
1. 严格按照用户指令对文档做整体性修改（缩短/扩写/润色/加结论/修语法 等）
2. 返回的是**完整的新文档**（Markdown 全文），不是片段、不是 diff、不是追加
3. 不要解释、不要寒暄、不要输出 \`\`\`markdown\`\`\` 围栏，直接给正文
4. 如果用户指令与文档内容无关（如"写个新章节"），把新内容合理插入到合适位置，并保留原文档其余部分`
    : `用户指令：${input.prompt || '请自由发挥，写一篇 Markdown 文章'}

要求：
1. 返回完整的 Markdown 文档全文
2. 不要解释、不要寒暄、不要围栏`

  // 组装消息：历史 + 当前指令
  const messages: Message[] = []
  if (input.history?.length) {
    for (const m of input.history) {
      if (m.role === 'user' || m.role === 'assistant') {
        messages.push({ role: m.role, content: m.content })
      }
    }
  }
  messages.push({ role: 'user', content: userText })

  return streamWith(messages, system, onChunk, input.model)
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
