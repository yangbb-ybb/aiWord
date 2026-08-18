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
    '## 你的回复必须严格遵守下面的格式',
    '第一步：从用户最新一句判断意图，**三种之一**：',
    '  A. [INTENT:edit]    — 用户希望**直接修改当前这份文档**（缩短/扩写/润色/加章节/修语法/改某段）',
    '  B. [INTENT:analyze] — 用户希望**听取**评价/建议/分析，但**不动文档**',
    '  C. [INTENT:chat]    — 闲聊/问候/知识问答/反问澄清/**与当前文档主题无关的话题**',
    '',
    '第二步：根据意图输出**仅且只能**以下三种开头之一：',
    '  - [INTENT:edit]    → 紧跟其后输出**完整的新文档 Markdown**',
    '  - [INTENT:analyze] → 紧跟其后输出评价/建议，可用 Markdown；**禁止输出完整新文档**',
    '  - [INTENT:chat]    → 紧跟其后输出答复，可用 Markdown；**禁止输出完整新文档**',
    '',
    '## 判断指引（拿不准时，优先 [INTENT:chat]，绝不乱动文档）',
    '',
    '**触发 [INTENT:edit] 的充要条件**：',
    '- 用户明确指向**当前这份文档**（"这篇文章/我的文章/这段/上面/下面/开头/结尾"）',
    '- AND 用户给的是**针对当前文档的动作**（缩短/扩写/润色/加一句/删掉这段/把 X 改成 Y/翻译当前文档）',
    '- 缺一不可。主题与当前文档无关 → 走 [INTENT:chat]',
    '',
    '**触发 [INTENT:analyze]**：',
    '- "这段怎么样/看看哪里要改/给点建议/有什么问题/起个更好的标题"（对当前文档的元操作）',
    '',
    '**触发 [INTENT:chat]**（覆盖以下所有情况）：',
    '- 闲聊/问候/知识问答（"你好/你是谁/讲个笑话/推荐/解释下…"）',
    '- **主题与当前文档无关**（"给我写个小说大纲/帮我写首古诗/讲个 Python 例子"——当前文档是别的）',
    '- **模糊请求**（"开头有点长"/"感觉不太通顺"/"能优化吗"）→ 反问一句："你想让我直接改，还是先给点建议？"',
    '',
    '## 关键：主题不相关时怎么办',
    '当用户请求**与当前文档主题无关**时（如当前是《体能锻炼计划》，用户说"写个小说大纲"）：',
    '- 必须走 [INTENT:chat]',
    '- 在回复里**明确告诉用户**：这份请求跟当前文档主题不一样，建议新建一份文档来放',
    '- 可以**简要回答**用户的问题（如贴一段小说大纲示例），但不要用"----"分隔后假装是新文档',
    '- 让用户主动选择：新建文档 / 暂时把内容贴到这里',
    '',
    '## 强约束（违反视为错误回复）',
    '- **第一行必须是且只能是三种标签之一**，整份回复只能用一次；没标签 = 视为 [INTENT:edit]（前端会真改文档！）',
    '- **不要在回复里解释自己的模式**（禁止"本轮回复按 chat 处理"/"不动文档"/"我不会动文档"/"不会改文档"/"重新输出完整文档"/"我会扩展"等任何元评论）',
    '- **不要用分隔符（----）假装"前半是说明、后半是正文"**——一旦你声明了 [INTENT:chat]，正文里就不该出现完整可被当作"新文档"的内容',
    '- **绝对不要自相矛盾**：同一次回复里既出现"我会改/我准备改/重新输出完整文档"又出现"我不会动/不动文档"。两种说法的存在会让前端无法判断，最终宁可当 chat 处理（不动文档）。',
    '- 不要输出 ```json``` 围栏；不要在标记前加任何解释、寒暄、emoji；不要输出"好的，我来…"',
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
