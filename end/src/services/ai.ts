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
    'intent 定义：edit=改文档（输出 SEARCH/REPLACE 增量操作），analyze=给建议不动文档，chat=闲聊/问答/确认。',
    'ask：要给用户选项（A/B/C/D）就 choice，要 yes/no 确认就 confirm，否则 none。',
    '',
    '判定优先级（高 → 低）：',
    '1. edit：用户明确说写/改/续/完善/补充/翻译/润色/重写/拼接/合并/排版/起草/接着/继续 等编辑动作',
    '2. analyze：用户在问"哪里有问题 / 怎么改更好 / 给建议"，但不要直接改文档',
    '3. chat：默认！闲聊/问答/确认/与文档主题无关 → 统统 chat',
    '',
    '═══ edit 模式专用：SEARCH/REPLACE 增量协议 ═══',
    'edit 模式不要输出完整新文档！只输出**增量操作**。',
    '针对性修改一段 → 用 SEARCH/REPLACE（每块一个独立改动）：',
    '<<<SEARCH>>>',
    '当前文档里要替换的那一段原文（必须能在文档里**唯一**匹配）',
    '>>>REPLACE>>>',
    '替换后的新内容',
    '<<<END>>>',
    '',
    '末尾追加内容（最常用）→ 用 APPEND（不需要锚点，避免拼接易碎的 SEARCH anchor）：',
    '<<<APPEND>>>',
    '要追加的内容（前面如需换行 → 自己加 \n）',
    '<<<END>>>',
    '',
    '整篇重写/从头起草 → 用 REPLACE_ALL（一份覆盖整个文档）：',
    '<<<REPLACE_ALL>>>',
    '完整的新文档内容',
    '<<<END>>>',
    '',
    '规则：',
    '- SEARCH 锚点必须在文档里**唯一**出现（不唯一就重写得更具体、加上下文行）',
    '- APPEND 追加到文档末尾；不要 append 重复的内容（基于当前文档决定）',
    '- REPLACE_ALL 只能 0 或 1 次；一旦出现就完全替换文档，SEARCH/REPLACE/APPEND 不再生效',
    '- 多个独立改动 → 多个 SEARCH/REPLACE 块，按文档顺序排列（先出现的替换先执行）；APPEND 在所有 SEARCH/REPLACE 之后执行',
    '- 不要在正文里出现任何 markdown 围栏（```...```）；不要"以下是…"元评论',
    '',
    '═══ analyze/chat 模式 ═══',
    '只输出回复正文，不要 dump 文档原文。',
    '',
    '你是 aiWord 写作助手。',
    `风格：${tone}。长度：${length}。语言：${lang}。`,
    '',
    '通用规则：',
    '- [INTENT]/[ASK] 各只出现一次；正文里禁止方括号协议标记',
    '- 不要解释自己的模式（禁止"我来/我会/不动文档/重新输出完整文档"等元评论）',
    '- 不要 ```json``` 围栏，不要前缀寒暄/emoji',
    '- ASK=choice 时用 2~4 个选项：`- **路径 X**：一句话描述`（A/B/C/D 大写，单条不用此格式）',
    // ↓ 新增（2026-08-25 修复问答循环）：用户在上一轮已明确选了某个选项（A/B/C/D）时，
    // 本轮 ASK 必须=none,直接执行用户已选的方向,不要再列选项。
    // 否则前端 handleChoice 把"我选 X"喂回来后,AI 会再次 ASK=choice 弹窗,死循环。
    '- 用户上一轮已明确选了某个选项时,本轮 ASK 必须=none,直接继续执行用户已选的方向,不要再列 A/B/C/D 选项'
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
 * edit 模式的增量操作（SEARCH/REPLACE + REPLACE_ALL）。
 * - search_replace: 在 baseContent 里查 search 子串，替换为 replace
 * - replace_all:    整篇替换 baseContent 为 content
 *
 * 后端 `streamWith` 在协议头解析后从 rawBuffer 解析 ops，通过 SSE `done.ops` 一次性下发。
 * 前端 `applyOps()` 负责把 ops 应用到 baseContent 得到 postContent。
 */
export type EditOp =
  | { type: 'search_replace'; search: string; replace: string }
  | { type: 'replace_all'; content: string }
  | { type: 'append'; content: string }

export interface ParseEditOpsResult {
  ops: EditOp[]
  errors: string[]
}

/**
 * 从 AI [CONTENT] 之后的正文里解析 op 块。
 *
 * 容忍（之前版本太严格，被实际场景坑过——见下面注释）：
 * - 标记行与内容之间允许任意空白/换行（甚至挤在一行也行）
 * - search/replace 内容里可能有空行、特殊字符（不含 `<<<END>>>` 标记本身）
 * - 多个 SEARCH/REPLACE 块按文档顺序返回
 * - REPLACE_ALL 块只能出现 0 或 1 次
 *
 * 不容忍 / 算 errors：
 * - op 块没有正确闭合（start/end 不匹配）
 * - REPLACE_ALL 出现 > 1 次
 *
 * 历史教训（2026-08-25）：早期版本要求 `\n<<<END>>>\s*\n?` 这种精确换行边界，
 * 但 AI 输出常在 `我是测试001<<<END>>>` 这种**没有前导换行**的情况，正则匹配失败，
 * 整段 op 没解析出来，前端 fallback 把 AI 原文当 postContent 做 diff，
 * 用户看到"原文全被删、新增了一堆标记文本"的诡异结果。
 *
 * 返回的 ops 即使有 errors 也尽量可用——前端 apply 时再做二次校验。
 */
export function parseEditOps(raw: string): ParseEditOpsResult {
  const ops: EditOp[] = []
  const errors: string[] = []

  // 先剥掉 [INTENT]/[ASK]/[CONTENT] 等协议头（如果 AI 把它们也吐进正文了）
  const text = raw.replace(PROTOCOL_INLINE_RE, '')

  // 第一步：用宽松正则匹配完整的 op 块（start marker → end marker）
  // 对标记前后的换行/空格不做任何要求，只要 start/end 标记成对出现即可
  const BLOCK_RE = /<<<(SEARCH|REPLACE_ALL|APPEND)>>>([\s\S]*?)<<<END>>>/g
  let m: RegExpExecArray | null
  let replaceAllCount = 0
  let appendCount = 0
  while ((m = BLOCK_RE.exec(text)) !== null) {
    const kind = m[1]
    const body = m[2]
    if (kind === 'REPLACE_ALL') {
      // 去掉首尾的换行（标记行单独成行时 block 体两端各有一个 \n）
      ops.push({ type: 'replace_all', content: body.replace(/^\n/, '').replace(/\n$/, '') })
      replaceAllCount++
    } else if (kind === 'APPEND') {
      ops.push({
        type: 'append',
        content: body.replace(/^\n+/, '').replace(/\n+$/, '')
      })
      appendCount++
    } else {
      // SEARCH 块：在 body 内找 >>>REPLACE>>> 标记分隔 search / replace
      // 不要求严格换行（容错），用 indexOf 直接切
      const splitIdx = body.indexOf('>>>REPLACE>>>')
      if (splitIdx === -1) {
        errors.push('SEARCH 块缺 >>>REPLACE>>> 标记')
        continue
      }
      // 剥掉 search/replace 各自的"首尾紧贴标记的换行"——
      // 标准格式是 `<<<SEARCH>>>\nfoo\n>>>REPLACE>>>\nbar\n<<<END>>>`，
      // body 在 `<<<SEARCH>>>` 和 `<<<END>>>` 之间是 `\nfoo\n>>>REPLACE>>>\nbar\n`，
      // 切分后两端各有 \n，剥掉得到 `foo` 和 `bar`。但保留内部换行（多行 search 关键）。
      const search = body.slice(0, splitIdx).replace(/^\n+/, '')
      const replace = body.slice(splitIdx + '>>>REPLACE>>>'.length).replace(/\n+$/, '')
      ops.push({ type: 'search_replace', search, replace })
    }
  }

  if (replaceAllCount > 1) {
    errors.push(`REPLACE_ALL 出现 ${replaceAllCount} 次，只能 0 或 1 次`)
  }
  if (appendCount > 1) {
    errors.push(`APPEND 出现 ${appendCount} 次，只能 0 或 1 次`)
  }

  return { ops, errors }
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
 * 注入到 messages 末尾的 assistant prefill —— 用 `[INTENT:` 开头物理上强制模型
 * 续写协议头（Anthropic API 提供 prefill 续写机制，模型必须从 prefill 之后开始写）。
 *
 * 风险 & 兜底：minimax（Anthropic 协议代理）经常**忽略** prefill 自己重写整个协议头，
 * 之前直接 `prefill + delta` 拼回去就会出现 `[INTENT:[INTENT:edit]...` 双前缀污染
 * rawBuffer 和用户输出。streamWith 里 head-gate 负责判断模型选了哪条路再决定拼不拼。
 */
export const PROTOCOL_PREFILL = '[INTENT:'

/** 探针字符数：足够区分"续写 / 重写 / 跳过"三种模型行为（见 streamWith head-gate 注释） */
const HEAD_PROBE_CHARS = 24

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

/** 正文里残留的协议标记（与前端 stores/document.ts 的 stripProtocolInline 保持一致） */
const PROTOCOL_INLINE_RE = /\s*\[(?:INTENT|ASK|CONTENT)(?::[^\]]*)?\]\s*/gi

/**
 * 选项行识别：`- **路径 A**：描述` 或退化的 `- **A**：描述`（模型经常省掉"路径"二字）。
 * 与前端 parseChoices 的 pattern 1 对齐——这里判 choice 而前端解析不出来的话，
 * RightPanel 的 `choicesOf(msg).length >= 1` 会挡住空弹窗，两边不一致也只是少弹，不会崩。
 */
const CHOICE_LINE_RE =
  /^\s*[-*]\s+\*\*\s*(?:路径|方案|选项|思路|方向|建议|选择|模式|Path|Option|Idea|Approach)?\s*[A-Da-d]\s*\*\*\s*[:：]/m

/**
 * AI 完全没输出协议头时的兜底判定。
 *
 * 之前这里无脑当 `chat` 处理，代价是：模型明明重写了整篇文档，前端却按"聊天"分流 ——
 * 整篇 markdown 被塞进右栏气泡，文档一个字没改，用户看起来就是"AI 没按要求输出"。
 * （2026-08-20 日志 reqId=mt17sv4fr0g8r6m3 就是这个场景：模型跳过协议头直接写
 *  "以下是增加时间后的完整文档：" + ```markdown 围栏）
 *
 * 所以改成看正文结构：像"一整篇文档"就按 edit 走，让用户至少能在 diff 视图里接受/拒绝；
 * 拿不准时仍然退回 chat（不动文档，最安全）。
 */
export function inferMetaFromBody(raw: string): StreamMeta {
  const text = raw.replace(PROTOCOL_INLINE_RE, '').trim()
  // 新协议：AI 输出 SEARCH/REPLACE 或 REPLACE_ALL → 视为 edit 模式
  const hasEditOp = /<<<SEARCH>>>|<<<REPLACE_ALL>>>/.test(text)
  if (hasEditOp) {
    return {
      intent: 'edit',
      ask: CHOICE_LINE_RE.test(text) ? 'choice' : 'none'
    }
  }
  // 老路径兼容：```markdown 围栏包住的整块 —— 模型用围栏交付"完整新文档"的典型形态
  const fenced = text.match(/```(?:markdown|md)?\s*\n([\s\S]*?)```/i)
  const doc = fenced ? fenced[1] : text
  const headings = (doc.match(/^#{1,6}\s+\S/gm) ?? []).length
  // 有围栏时 1 个标题就够；没围栏时要求 2 个标题 + 200 字，避免把"聊天里顺手写个 ## 小标题"误判成改文档
  const isDocument = fenced ? headings >= 1 : headings >= 2 && doc.length >= 200
  return {
    intent: isDocument ? 'edit' : 'chat',
    ask: CHOICE_LINE_RE.test(text) ? 'choice' : 'none'
  }
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
): Promise<{
  text: string
  tokens?: number
  cacheRead?: number
  cacheWrite?: number
  /** edit 模式的解析后 op 数组；chat/analyze 模式始终为空数组 */
  ops: EditOp[]
  /** parseEditOps 的诊断信息（如 REPLACE_ALL 出现多次） */
  opErrors: string[]
}> {
  const provider = getProvider()
  // rawBuffer 始终包含 prefill（拼过就拼，没拼过就不拼），保证 parseStreamMeta 的非锚定正则
  // 能找到完整 `[INTENT:edit]\n[ASK:xxx]\n[CONTENT]`。用户实际看到的 onChunk 输出走另一条路。
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

  // ====== prefill 拼接 head-gate ======
  // 模型对 prefill `[INTENT:` 有三种反应，stream 必须给前端看到**一致**的内容：
  //   A. 顺着续写（推荐路径）：模型输出 `edit]\n[ASK:none]\n[CONTENT]\n` —— 拼回 prefill 前缀
  //   B. 忽略 prefill、重写整段协议头：模型输出 `[INTENT:edit]\n[ASK:none]\n[CONTENT]\n` —— **不**拼
  //      否则会出现 `[INTENT:[INTENT:edit]...` 双前缀污染 rawBuffer 和用户输出
  //   C. 完全跳过协议头，直接写正文（如 "以下是增加时间后的完整文档：" + 围栏）：
  //      **不**拼 prefill，让前端的 fallback 逻辑走 inferMetaFromBody 按"完整文档"分流到 edit
  //
  // 区分 A/B/C 只需看模型第一个 chunk 的前 16~24 字符：
  //   A: 模型首个 chunk 以 `[A-Za-z]` 续写（如 `edit]\n`）
  //   B: 模型首个 chunk 以 `[INTENT:` 开头
  //   C: 模型首个 chunk 是其他字符（中文 / 英文 / ```）
  // 因此攒够 HEAD_PROBE_CHARS 字符再决定拼不拼 prefill，把首包作为整体 flush 给 onChunk，
  // 决策时机延迟到首包读完之后——延迟肉眼不可见（≈20ms 内）。
  let prefillInjected: string = prefill ? 'pending' : 'no'
  let headBuffer = ''
  const flushHead = () => {
    if (prefillInjected !== 'pending') return
    if (!prefill) {
      prefillInjected = 'no'
      return
    }
    // B：模型自己重写了协议头 → 不拼
    if (/^\[INTENT:/.test(headBuffer)) {
      prefillInjected = 'no'
      return
    }
    // A：模型以小写字母续写（如 `edit]` / `analyze]` / `chat]`）→ 拼回 prefill
    if (/^[a-z]{3,7}\]/.test(headBuffer)) {
      prefillInjected = 'yes'
      return
    }
    // C：模型跳过了协议头 → 不拼，让前端 fallback 接管
    prefillInjected = 'no'
  }

  const wrappedChunk = (delta: string) => {
    if (prefillInjected === 'pending') {
      headBuffer += delta
      if (headBuffer.length >= HEAD_PROBE_CHARS) {
        flushHead()
        // 首包作为整体推给下游（带或不带 prefill 前缀）
        // 类型断言绕开 TS 控制流窄化（块内 prefillInjected 被收窄成 'pending'，无法直比 'yes'）
        const state = prefillInjected as string
        const stitchPrefill = state === 'yes'
        const toForward = stitchPrefill && prefill ? prefill + headBuffer : headBuffer
        handleDelta(toForward)
        onChunk(toForward)
      } else {
        // 还没攒够探测字符 → 仅累积 rawBuffer，不向前端推（避免半截前缀泄漏）
        handleDelta(delta)
      }
      return
    }
    handleDelta(delta)
    onChunk(delta)
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

  // 探测阶段结束时 stream 已经 close 但 headBuffer 可能还没攒够 HEAD_PROBE_CHARS：
  // 用模型最终全文做一次兜底决策（<24 字的情况极罕见，主要是 maxTokens=1 那种边角）。
  if (prefillInjected === 'pending') {
    headBuffer = text
    flushHead()
  }
  // 流到末尾仍然攒不到探测字符（基本不可能，但兜底一下）→ 视为模型没理会 prefill
  if (prefillInjected === 'pending') prefillInjected = 'no'

  // meta 没在流中解析出来 → 走 inferMetaFromBody 按正文结构判定
  // （之前这里硬塞 { intent: 'chat' }，会把"模型跳协议头直写文档"的整篇输出降级成聊天，
  //  2026-08-20 日志 reqId=mt17sv4fr0g8r6m3 就是这个 bug）
  if (!metaFired && onMeta) {
    onMeta(inferMetaFromBody(rawBuffer))
  }

  // 返回给调用方的完整 text：与流到前端的拼接策略保持一致
  const stitchPrefill = prefillInjected === 'yes'
  const finalText = stitchPrefill && prefill ? prefill + text : text
  // 解析 edit ops：只有声明了 edit 模式才解析（chat/analyze 模式 AI 不输出 op 块），
  // 但安全起见只要 rawBuffer 里出现 op 标记就尝试解析 —— 万一 meta 误判也能兜住
  const { ops, errors: opErrors } = parseEditOps(rawBuffer)
  return {
    text: finalText,
    tokens,
    cacheRead,
    cacheWrite,
    ops,
    opErrors
  }
}

/**
 * 主入口：续写/改写文档。
 * - 带 contextText → AI 可走 [INTENT:edit] 改文档
 * - 不带 contextText → AI 当成"自由创作"，默认 [INTENT:edit] 起新文档
 * - 历史通过 input.history 喂回去，多轮对话上下文不断
 * - 用 prefill '[INTENT:' 物理强制模型写协议头，让前端能区分 edit/analyze/chat
 */
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

/**
 * 局部改写：在用户选中的文本片段上润色/精修，保留 Markdown 结构。
 * 与 runGenerate 的区别：单轮无历史，prompt 直接喂原文 + 改写要求。
 */
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

/**
 * 摘要：把长文压成不超过 maxChars（默认 200）字的关键事实清单，Markdown 输出。
 * 不发 prefill，因为摘要永远只走 chat 路径，不需要 AI 自己做 intent 决策。
 */
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

/**
 * 翻译：把文本翻成指定 targetLang（zh / en / mixed），保留 Markdown / 代码 / 链接。
 * 同样不发 prefill，固定走 chat 路径。
 */
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
