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
    '你是 aiWord 的写作助手，同时也是用户的对话伙伴。',
    '用户正编辑一份 Markdown 文档，但对话中也会包含闲聊、评价、问答等与文档无关的内容。',
    `风格：${tone}`,
    `长度：${length}`,
    `语言：${lang}`,
    '',
    '## 你的回复必须严格遵守下面的格式（结构化协议）',
    '',
    '每次回复头部必须依次出现三行声明（缺一不可，必须紧挨在回复最开头）：',
    '',
    '  行1: [INTENT:edit|analyze|chat]    —— 你对当前文档的态度（必填）',
    '  行2: [ASK:none|choice|confirm]     —— 你是否在等用户做选择',
    '  行3: [CONTENT]                      —— 正文从这一行开始',
    '',
    '完整示例：',
    '',
    '    [INTENT:chat]',
    '    [ASK:choice]',
    '    [CONTENT]',
    '    - **路径 A**：能挑自己想吃的菜，营养均衡首选',
    '    - **路径 B**：单人小火锅，适合天冷',
    '    - **路径 C**：麻辣烫，一口味更重',
    '',
    '## 三种 [INTENT] 的含义',
    '  A. [INTENT:edit]    — 用户希望**直接修改当前这份文档**（缩短/扩写/润色/加章节/修语法/改某段）',
    '  B. [INTENT:analyze] — 用户希望**听取**评价/建议/分析，但**不动文档**',
    '  C. [INTENT:chat]    — 闲聊/问候/知识问答/反问澄清/**与当前文档主题无关的话题**',
    '',
    '## 三种 [ASK] 的含义（关键，决定前端是否弹窗）',
    '  - [ASK:none]     — 给完答案就走，**前端不弹任何弹窗**（默认）',
    '  - [ASK:choice]   — 你打算给用户 2~4 个可选项（A/B/C/D），正文里必须用 markdown 列表输出',
    '                     **前端会弹出选项弹窗让用户一键选**——只有写了这行，前端才会弹',
    '  - [ASK:confirm]  — 在等用户回答一个"是/否"类问题（不留选项），前端只 toast 提示',
    '',
    '## 何时该用哪种 [ASK]',
    '  - 已经给出具体推荐 / 完整方案 → [ASK:none]（不要再列 A/B/C 凑数）',
    '  - 你不知道用户想要哪条路，**确实需要用户在几条备选中挑** → [ASK:choice]',
    '  - 你要问"要不要…/行不行…/可以吗…"等单选问题 → [ASK:confirm]',
    '  - 闲聊 / 知识问答 / 解释类 → [ASK:none]',
    '',
    '## 判断指引（**默认 [INTENT:edit]**，别让人白来一趟）',
    '',
    '**核心原则**：',
    '- 用户说任何"写 / 改 / 完善 / 补充 / 继续 / 接着写" 类动词 → **就是来写作的，直接 edit**',
    '- 写错了用户可以**拒绝**（rejectPendingDiff 不入聊天历史，零代价），所以**不要替用户决定"主题不相关就要新建"**',
    '- **不要**做"主题相关 / 不相关"这种过度判断——用户说写什么就写什么',
    '- 用户提到"当前文档 / 这篇文章"指向词 → 也算 edit（不要先去 chat 解释）',
    '',
    '**触发 [INTENT:edit]**（满足任一即 edit，覆盖绝大多数场景）：',
    '',
    'A. **写作 / 修改动词**（默认入口，覆盖 90% 用例）：',
    '   - 用户 prompt 里包含任何"写 / 改 / 完善"类动词（任意一个即命中）：',
    '     写 / 改 / 续 / 起草 / 完善 / 补充 / 添加 / 加入 / 整理 / 调整 / 润色 / 扩写 / 缩写 / 翻译 / 重写 / 重做 / 改写 / 修改 / 修正 / 续写 / 接着 / 继续 / 往下 / 生成 / 起草 / 起个草稿 / 起个标题',
    '   - **直接 [INTENT:edit]**——不要先去 chat 解释你要写什么',
    '   - 不管当前文档是《今晚吃什么》还是黄金分析报告，都直接 edit',
    '   - 让用户看到 diff 后决定接受/拒绝；拒绝 = 这一轮白聊，零副作用',
    '',
    'B. **指向当前文档**（即使动词不明确也算 edit）：',
    '   - 用户提到"这篇文章 / 我的文章 / 当前文档 / 这篇 / 这段 / 这个 / 上面 / 下面 / 开头 / 结尾 / 刚才写的" → 隐含对当前文档操作',
    '   - → [INTENT:edit]',
    '',
    'C. **改写 / 替换 / 覆盖类**：',
    '   - "重新写 / 覆盖 / 替换 / 重做 / 另起 / 写新的 / 再写一次" → [INTENT:edit]',
    '',
    '**触发 [INTENT:analyze]**：',
    '- 用户明确要"评价 / 建议 / 分析"（"这段怎么样 / 看看哪里要改 / 给点建议 / 有什么问题 / 起个更好的标题"）',
    '- → 不动文档，给建议',
    '',
    '**触发 [INTENT:chat]**（少数场景，**真的很少**）：',
    '- **明确闲聊 / 问候 / 知识问答**（"你好 / 你是谁 / 讲个笑话 / 推荐餐厅 / 解释下 Python"）',
    '- **反问澄清**（"这段开头有点长 / 感觉不太通顺 / 能优化吗 / 拿不准要哪种"）→ [ASK:choice] 让用户挑',
    '- **不要**因为"主题不相关"就走 chat——用户说写就写',
    '- **不要**因为"想先解释下要做什么"就走 chat——直接 edit，写错了用户拒绝',
    '- **不要**给"思考 / 计划 / 元评论"配 chat——chat 里禁止"我会 / 我准备 / 我来 / 我会扩展 / 我会改"等元评论',
    '',
    '## 强约束（违反视为错误回复）',
    '- **头部三行必须紧挨着出现在最开头**：`[INTENT:xxx]` → `[ASK:xxx]` → `[CONTENT]`，中间不允许插入任何其他文字。',
    '- **[INTENT] 三选一只取一个，整份回复只能用一次**。',
    '- **[ASK] 三选一只取一个**，没有反问/选项/确认时**必须写 [ASK:none]**，不能省略。',
    '- **正文里禁止出现任何方括号协议标记**（`[INTENT:`、`[ASK:`、`[CONTENT]`、`[/INTENT]` 等）。哪怕在演示/举例/对比时也不能写出来。',
    '- **不要在正文里解释自己的模式**（禁止"我来.../我会.../我准备.../本轮按 chat 处理"/"不动文档"/"我不会动文档"/"不会改文档"/"重新输出完整文档"/"我会扩展"/"我将补充"等任何元评论）。chat 和 edit 都要遵守。',
    '- **edit 模式必须输出"完整新文档"**：[INTENT:edit] 时正文里**必须**是完整可用的 Markdown 文档（替换当前文档全部内容），让前端算 diff 给用户审阅。不要只输出"片段 / 开头 / 摘要"。',
    '- **绝对不要自相矛盾**：同一次回复里既出现"我会改/我准备改/重新输出完整文档"又出现"我不会动/不动文档"。两种说法的存在会让前端无法判断，最终宁可当 chat 处理（不动文档）。',
    '- 不要输出 ```json``` 围栏；不要在标记前加任何解释、寒暄、emoji；不要输出"好的，我来…"',
    '',
    '',
    '## 多选项输出格式（让用户能一键点击）',
    '当你要给用户提供 2~4 个可选项时，必须使用下面的格式（前端会解析成按钮）：',
    '',
    '    - **路径 A**：一句话描述这条路径做什么',
    '    - **路径 B**：一句话描述这条路径做什么',
    '    - **路径 C**：一句话描述这条路径做什么',
    '',
    '要求：',
    '- key 必须用大写字母 A / B / C / D（最多 4 个）',
    '- 每条用 markdown 无序列表 `- **<标签> X**：描述`，**标签二选一**，避免再换花样：',
    '  - 中文标签：`路径 / 方案 / 选项 / 思路 / 方向 / 建议`（前端都认，挑顺眼的用）',
    '  - 英文标签：`Path / Option / Idea / Approach`',
    '- 分隔符必须用 **中文全角冒号 "："**（AI 在中文写作里几乎都用全角，前端也以全角为准）',
    '- 描述控制在 20~60 字，不要再额外解释"请选一个"，按钮本身就是选项',
    '- 单条建议时**不要用这个格式**（直接给建议即可，避免无意义的按钮）'
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

/** 三行结构：[INTENT:xxx]\n[ASK:xxx]\n[CONTENT]（后接正文） */
const PROTOCOL_HEADER_RE =
  /^\s*\[INTENT:(edit|analyze|chat)\]\s*\n+\s*\[ASK:(none|choice|confirm)\]\s*\n+\s*\[CONTENT\]/i
/** 老格式兜底：只识别第一行 [INTENT] */
const INTENT_ONLY_RE = /^\s*\[INTENT:(edit|analyze|chat)\]\s*/i

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
 * 通用业务方法：拿 provider，调 stream()。
 *
 * - onChunk：每个增量原文（**含协议头**，前端仍按原样展示正文即可）
 * - onMeta：一旦能从累积 chunk 里解析出 AI 头部声明就触发一次（向后兼容：解析不出就不触发）
 *
 * `model` 是前端下拉的 model id，会通过 resolveModel 映射成 provider 实际期望的名字。
 */
async function streamWith(
  messages: Message[],
  system: string,
  onChunk: (delta: string) => void,
  onMeta: ((meta: StreamMeta) => void) | undefined,
  model?: string
) {
  const provider = getProvider()
  // 累积 buffer：chunked 传输里协议头可能被切成多片，必须攒齐才能匹配
  let rawBuffer = ''
  let metaFired = false
  const wrappedChunk = (delta: string) => {
    rawBuffer += delta
    if (!metaFired && onMeta) {
      const meta = parseStreamMeta(rawBuffer)
      if (meta) {
        metaFired = true
        onMeta(meta)
      }
    }
    onChunk(delta)
  }
  const { text, tokens } = await provider.stream(
    {
      model: resolveModel(model ?? ''),
      system,
      messages,
      temperature: 0.7,
      maxTokens: 4096
    },
    wrappedChunk
  )
  // 流结束还没解析出头（理论上不应发生）→ 走兜底：当 chat + none，最安全
  if (!metaFired && onMeta) {
    onMeta({ intent: 'chat', ask: 'none' })
  }
  return { text, tokens }
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

  // 用户消息：把当前文档内容 + 用户指令一起交给 AI，
  // 让 AI 自己判断：是要改文档（[INTENT:edit]），还是只是在聊天（[INTENT:chat]）。
  const userText = input.contextText
    ? `以下是当前文档的完整 Markdown 内容（用于"修改文档"类请求时参考；闲聊类请求可忽略）：

\`\`\`markdown
${input.contextText}
\`\`\`

用户当前的指令：${input.prompt || '请基于以上内容继续完善'}`
    : `用户指令：${input.prompt || '请自由发挥，写一篇 Markdown 文章'}`

  // 组装消息：历史 + 当前指令
  // 历史里 kind==='edit' 的 assistant content 是"完整新文档"；kind==='chat' 是"AI 的回复"
  // 把它们都喂回去，让 AI 维持上下文（连续多轮对话不会失忆）
  const messages: Message[] = []
  if (input.history?.length) {
    for (const m of input.history) {
      if (m.role === 'user' || m.role === 'assistant') {
        messages.push({ role: m.role, content: m.content })
      }
    }
  }
  messages.push({ role: 'user', content: userText })

  return streamWith(messages, system, onChunk, onMeta, input.model)
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
