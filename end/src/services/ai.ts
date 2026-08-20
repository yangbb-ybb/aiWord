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
   * 对话历史：[{role: 'user' | 'assistant', content: string, kind?}, ...]
   * AI 通过它"记住"之前几轮做了什么，避免每次都从零续写
   * content 在 chat/analyze 类消息里是 AI 的回复；在 edit 类消息里是 AI 的"完整新文档"
   */
  history?: Array<{ role: 'user' | 'assistant'; content: string; kind?: 'edit' | 'analyze' | 'chat' }>
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
    '你的回复必须以这三行开头，紧挨着，不要前缀/寒暄/emoji/围栏/解释：',
    '',
    '[INTENT:edit|analyze|chat]',
    '[ASK:none|choice|confirm]',
    '[CONTENT]',
    '',
    'intent 定义：edit=改文档（输出完整新文档替换全部），analyze=给建议不动文档，chat=闲聊/问答/确认。',
    'ask：要给用户选项（A/B/C/D）就 choice，要 yes/no 确认就 confirm，否则 none。',
    '',
    '判定优先级（高 → 低）：',
    '1. edit：用户明确说写/改/续/完善/补充/翻译/润色/重写/拼接/合并/排版/起草/接着/继续 等编辑动作',
    '2. analyze：用户在问"哪里有问题 / 怎么改更好 / 给建议"，但不要直接改文档',
    '3. chat：默认！闲聊/问答/确认/与文档主题无关 → 统统 chat',
    '',
    'edit 模式必须输出完整新文档；analyze/chat 只输出回复正文，不要 dump 文档原文。',
    '',
    '你是 aiWord 写作助手。',
    `风格：${tone}。长度：${length}。语言：${lang}。`,
    '',
    '规则：',
    '- [INTENT]/[ASK] 各只出现一次；正文里禁止方括号协议标记',
    '- 不要解释自己的模式（禁止"我来/我会/不动文档/重新输出完整文档"等元评论）',
    '- 不要 ```json``` 围栏，不要前缀寒暄/emoji',
    '- ASK=choice 时用 2~4 个选项：`- **路径 X**：一句话描述`（A/B/C/D 大写，单条不用此格式）'
  ].join('\n')
}

/**
 * AI 头部声明解析出来的结构化意图（流式响应里第一个 emit 的"meta"事件）。
 * 服务端解析后通过 SSE `event: meta` 一次性推给前端；前端不再依赖正则从 text 里挖协议位。
 */
export type StreamMeta = {
  intent: 'edit' | 'analyze' | 'chat'
  ask: 'none' | 'choice' | 'confirm'
}

/**
 * 三行结构：[INTENT:xxx]\n[ASK:xxx]\n[CONTENT]（后接正文）。
 *
 * ⚠️ 关键：不加 `^\s*` 锚 —— prefill 注入后模型可能"无视" prefill、完整重写协议头，
 * rawBuffer 会变成 `[INTENT:[INTENT:edit]\n[ASK:none]\n[CONTENT]`，锚定版本匹配不上。
 * 非锚定版本在 rawBuffer 任意位置找完整的 `[INTENT:xxx]\n[ASK:xxx]\n[CONTENT]` 子串，
 * 覆盖"模型尊重 prefill"和"模型重生成协议头"两种情况。
 *
 * 老正则要求 [CONTENT] 后必须有换行，但流式 chunk 切分时 [CONTENT] 后可能正好没有 \n，
 * 导致 rawBuffer 卡在 [..., [CONTENT]] 不匹配。放宽为 [CONTENT] 后任意字符即可。
 */
const PROTOCOL_HEADER_RE =
  /\s*\[INTENT:(edit|analyze|chat)\]\s*\n+\s*\[ASK:(none|choice|confirm)\]\s*\n+\s*\[CONTENT\]/i
/**
 * 兜底：只识别第一行 [INTENT]，没写 [ASK] 的视为 [ASK:none]（不弹窗）。
 * ⚠️ 同样去掉 `^\s*` 锚，否则模型重生成协议头时（rawBuffer 第一行变成 `[INTENT:[` 而非完整标签），
 * 这个兜底也匹配不上，会一路 fall through 到 ai.ts:streamWith 的"流结束兜底 chat"分支。
 */
const INTENT_ONLY_RE = /\s*\[INTENT:(edit|analyze|chat)\]/i

/**
 * 尝试从累积文本里解析头部声明。命中 → { intent, ask, body }；没命中 → null。
 */
export function parseStreamMeta(raw: string): StreamMeta | null {
  const m3 = raw.match(PROTOCOL_HEADER_RE)
  if (m3) {
    return {
      intent: m3[1].toLowerCase() as StreamMeta['intent'],
      ask: m3[2].toLowerCase() as StreamMeta['ask']
    }
  }
  const m1 = raw.match(INTENT_ONLY_RE)
  if (m1) {
    return {
      intent: m1[1].toLowerCase() as StreamMeta['intent'],
      ask: 'none'
    }
  }
  return null
}

/**
 * contextText 截断：超过 head+tail+margin 时只留头尾，中间用 "[...已截断 N 字...]" 标记。
 *
 * 为什么这样截：长 doc 全量喂回去会让 input tokens 暴涨（典型 10k 字 doc = ~15k tokens）；
 * 头尾各 4k 字通常包含"用户当前正在编辑的段落 + 文档开头设定"，对 AI 判断要不要改文档足够。
 *
 * margin=50 是为了 [CONTENT] 标签后正好换行这种边界场景不触发截断。
 */
function truncateContext(
  text: string,
  headChars = 4000,
  tailChars = 4000
): string {
  if (text.length <= headChars + tailChars + 50) return text
  const omitted = text.length - headChars - tailChars
  return (
    text.slice(0, headChars) +
    `\n\n[...已截断 ${omitted} 字...]\n\n` +
    text.slice(-tailChars)
  )
}

/**
 * history char cap：保护重 edit session，避免 20 条 edit 历史（每条 ~3000 字）
 * 把 input tokens 顶到 10 万+。从最新的往前累加，超 cap 就丢最老的（保持对话连贯性）。
 *
 * 与前端 `chatHistory` `slice(-20)` entry 计数 cap 叠加：
 * - entry cap 保结构（至少保留最近 20 轮）
 * - char cap 保 token 上限（无论 entry 多大，单次调用 input 封顶 ~18k tokens）
 */
const HISTORY_MAX_CHARS = 12_000
function capHistory(messages: Message[]): Message[] {
  let totalChars = 0
  const result: Message[] = []
  for (let i = messages.length - 1; i >= 0; i--) {
    totalChars += messages[i].content.length
    if (totalChars > HISTORY_MAX_CHARS) break
    result.unshift(messages[i])
  }
  return result
}

/**
 * 通用业务方法：拿 provider，调 stream()。
 *
 * - onChunk：每个增量原文（**含协议头**，前端仍按原样展示正文即可）
 * - onMeta：一旦能从累积 chunk 里解析出 AI 头部声明就触发一次（向后兼容：解析不出就不触发）
 *
 * `model` 是前端下拉的 model id，会通过 resolveModel 映射成 provider 实际期望的名字。
 * `prefill` 是 assistant prefill（最后一条 assistant 消息的内容），用来物理上强制模型
 * 从某个特定开头续写——比如 '[INTENT:' 让模型必须续出协议头。
 */
async function streamWith(
  messages: Message[],
  system: string,
  onChunk: (delta: string) => void,
  onMeta: ((meta: StreamMeta) => void) | undefined,
  model?: string,
  prefill?: string
) {
  const provider = getProvider()
  // 累积 buffer：chunked 传输里协议头可能被切成多片，必须攒齐才能匹配。
  // 关键！rawBuffer 必须**始终包含注入的 prefill**，这样无论模型是否自己重新输出
  // 协议头（实测 minimax/Anthropic 经常忽略 prefill、完整输出 [INTENT:[INTENT:edit]...），
  // 我们都至少能匹配到完整的 `[INTENT:edit]\n[ASK:xxx]\n[CONTENT]` 子串。
  // rawBuffer 累积完成后靠 parseStreamMeta 的非锚定正则兜底匹配（去掉 ^\s*）。
  let rawBuffer = ''
  let metaFired = false
  const handleDelta = (delta: string) => {
    rawBuffer += delta
    if (!metaFired && onMeta) {
      const meta = parseStreamMeta(rawBuffer)
      if (meta) {
        metaFired = true
        onMeta(meta)
      }
    }
  }
  // 第一次进 wrappedChunk 时，如果用了 prefill，把 prefill 拼到 chunk 前面
  // 让前端能看到完整协议头 '[INTENT:edit]\n[ASK:none]\n[CONTENT]\n'
  // 而不是只看到模型续写的 'edit]\n[ASK:none]\n[CONTENT]\n'（缺 [INTENT: 前缀）
  let prefillInjected = false
  const wrappedChunk = (delta: string) => {
    if (prefill && !prefillInjected) {
      prefillInjected = true
      const full = prefill + delta
      handleDelta(full)
      onChunk(full)
    } else {
      handleDelta(delta)
      onChunk(delta)
    }
  }
  // 把 prefill 作为最后一条 assistant 消息发给 SDK，让模型从那里续写
  const finalMessages = prefill
    ? [...messages, { role: 'assistant' as const, content: prefill }]
    : messages
  const { text, tokens, cacheRead, cacheWrite } = await provider.stream(
    {
      model: resolveModel(model ?? ''),
      system,
      messages: finalMessages,
      temperature: 0.7,
      maxTokens: 4096
    },
    wrappedChunk
  )
  // 流结束还没解析出头（理论上不应发生）→ 走兜底：当 chat + none，最安全
  if (!metaFired && onMeta) {
    onMeta({ intent: 'chat', ask: 'none' })
  }
  // 最终 text 也要拼上 prefill（上面 wrappedChunk 只拼了流到前端的增量）
  return {
    text: prefill ? prefill + text : text,
    tokens,
    cacheRead,
    cacheWrite
  }
}

export async function runGenerate(
  input: GenerateInput,
  onChunk: (delta: string) => void,
  onMeta?: (meta: StreamMeta) => void
) {
  const system = buildSystem({
    tone: input.tone,
    length: input.length,
    language: input.language
  })

  // 长 doc 截断：超过 ~8k 字时只取头尾各 4k，中间标记成已截断。
  // 这样即使用户有一篇 10 万字的长文，单次调用 context 部分也封顶在 ~12k tokens。
  const contextText = input.contextText
    ? truncateContext(input.contextText)
    : undefined

  // 用户消息：把当前文档内容 + 用户指令一起交给 AI，
  // 让 AI 自己判断：是要改文档（[INTENT:edit]），还是只是在聊天（[INTENT:chat]）。
  const userText = contextText
    ? `以下是当前文档的完整 Markdown 内容（用于"修改文档"类请求时参考；闲聊类请求可忽略）：

\`\`\`markdown
${contextText}
\`\`\`

用户当前的指令：${input.prompt || '请基于以上内容继续完善'}`
    : `用户指令：${input.prompt || '请自由发挥，写一篇 Markdown 文章'}`

  // 组装消息：历史 + 当前指令
  // 历史里 kind==='edit' 的 assistant content 是"完整新文档"；kind==='chat' 是"AI 的回复"
  // 把它们都喂回去，让 AI 维持上下文（连续多轮对话不会失忆）
  const rawMessages: Message[] = []
  if (input.history?.length) {
    for (const m of input.history) {
      if (m.role === 'user' || m.role === 'assistant') {
        rawMessages.push({ role: m.role, content: m.content })
      }
    }
  }
  rawMessages.push({ role: 'user', content: userText })
  // char cap：保护重 edit session（多条 edit history 累积把 input 顶到 10 万+）
  const messages = capHistory(rawMessages)

  // 标最后一条 user 消息为 Anthropic prompt cache breakpoint。
  // 配合 claude.ts 里 system 的 cacheControl，两段是最稳定的：
  // - system prompt 每次 generate 都重发同一份
  // - 最后一条 user（含 contextText + 当前 prompt）每次重发差异小，cache 命中率高
  // 历史会变（每轮 edit 都不一样），不标 cache。
  if (messages.length > 0) {
    messages[messages.length - 1].cacheControl = true
  }

  // assistant prefill：物理上强制模型从 [INTENT: 开头续写协议头
  // （之前只用 prompt 强调，模型长 prompt 下会"忘记"格式。prefill 是 Anthropic API
  // 提供的可靠机制——模型必须从 prefill 后面开始写，不可能跳过协议头）
  return streamWith(
    messages,
    system,
    onChunk,
    onMeta,
    input.model,
    '[INTENT:'
  )
}

export async function runRewrite(
  input: RewriteInput,
  onChunk: (delta: string) => void,
  onMeta?: (meta: StreamMeta) => void
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
  return streamWith([{ role: 'user', content: user }], system, onChunk, onMeta, input.model)
}

export async function runSummarize(
  input: SummarizeInput,
  onChunk: (delta: string) => void,
  onMeta?: (meta: StreamMeta) => void
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
    onMeta,
    input.model
  )
}

export async function runTranslate(
  input: TranslateInput,
  onChunk: (delta: string) => void,
  onMeta?: (meta: StreamMeta) => void
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
    onMeta,
    input.model
  )
}
