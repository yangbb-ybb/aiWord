import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { diffLines } from 'diff'
import { api, ApiError } from '@/services/api'
import { postStream } from '@/services/stream'

export type Platform = 'wechat' | 'zhihu' | 'csdn' | 'juejin'

export interface DocumentItem {
  id: string
  title: string
  excerpt: string
  content: string
  updatedAt: string // ISO
  platforms: Platform[]
  /**
   * 软删除时间戳：null = 正常文档；非 null = 在回收站里。
   * 回收站里的文档只在"删除后的 30 天"内可见，到期后由后端定时清理。
   */
  deletedAt: string | null
  /** 后端用户隔离字段，方便后续扩展；前端一般不用 */
  userId?: number
}

export interface TemplateItem {
  id: string
  name: string
  emoji: string
  description: string
  content: string
}

/** 一键生成的入参，跟后端 /api/ai/generate body 对齐 */
export interface GenerateOptions {
  prompt: string
  /** 后端 listModels() 返回的 id，如 'claude-sonnet' / 'claude-haiku' / 'claude-opus' */
  model?: string
  tone?: string
  /** 0~100 的滑块值（步长 25） */
  length?: number
  language?: string
  /** 已存在的正文，传过去用于续写 */
  contextText?: string
  /** 对话历史（前端维护）：[{role, content, kind?}] */
  history?: Array<{ role: 'user' | 'assistant'; content: string; kind?: 'edit' | 'analyze' | 'chat'; ask?: AiAsk }>
  /**
   * 强制指定意图，跳过 AI 自主分流：
   * - 'edit'    → 直接进入 pendingDiff 流程
   * - 'analyze' → 直接追加到 chatThread 作为建议
   * - 'chat'    → 直接追加到 chatThread 作为聊天
   * 不传则交给 AI 自己判断（推荐）
   */
  forceMode?: AiIntent
}

/**
 * AI 对话面板里的一条消息：
 * - role='user' 永远是用户输入
 * - role='assistant' 时：
 *   - kind='edit'    → AI 改了文档（内容是"完整新文档"），右侧只显示摘要 + "查看改动"链接
 *   - kind='analyze' → AI 给了评价/建议（不动文档），右侧渲染 + 提供"应用到文档"按钮
 *   - kind='chat'    → AI 闲聊/问答/反问澄清，直接渲染
 */
export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  kind?: 'edit' | 'analyze' | 'chat'
  /**
   * AI 是否在等用户做选择（新版结构化协议的 [ASK:xxx] 字段）。
   * - choice  → 弹选项弹窗
   * - confirm → toast 提示
   * - none    → 不弹窗（默认）
   *
   * 旧回复（没写 ASK）= 'none'。
   */
  ask?: AiAsk
  /** 毫秒时间戳，用于 UI 排序/格式化 */
  ts: number
}

/**
 * AI 智能体分流：识别后端返回的第一行标签
 * - edit：AI 决定改文档，accumulated 是"完整新文档"
 * - analyze：AI 决定给建议/评价，accumulated 是建议正文（不动文档）
 * - chat：AI 决定不改动文档，accumulated 是"聊天回复"
 */
export type AiIntent = 'edit' | 'analyze' | 'chat'

const INTENT_RE = /^\s*\[INTENT:(edit|analyze|chat)\]\s*/i
/**
 * 新版结构化协议：AI 头部必须依次输出三行
 *   行1: [INTENT:edit|analyze|chat]
 *   行2: [ASK:none|choice|confirm]
 *   行3: [CONTENT]
 * 然后才是正文。
 *
 * 这个正则"一次性"匹配前 3 行协议头。兼容老格式（只写第一行）—— 缺 ASK 视为 'none'。
 */
// 老正则要求 [CONTENT] 后必须有换行，但流式 chunk 切分时 [CONTENT] 后可能正好没有 \n，
// 导致 rawBuffer 卡在 [..., [CONTENT]] 不匹配。放宽为 [CONTENT] 后任意字符即可。
const PROTOCOL_HEADER_RE =
  /^\s*\[INTENT:(edit|analyze|chat)\]\s*\n+\s*\[ASK:(none|choice|confirm)\]\s*\n+\s*\[CONTENT\]/i
/**
 * 兜底：只识别第一行 [INTENT]，没写 [ASK] 的视为 [ASK:none]（不弹窗）。
 */
const INTENT_ONLY_RE = /^\s*\[INTENT:(edit|analyze|chat)\]\s*/i
/**
 * 正文中残留的协议标记清理：万一 AI 把 [INTENT:xxx] / [ASK:xxx] / [CONTENT] 当字符串写进正文。
 */
const PROTOCOL_INLINE_RE =
  /\s*\[(?:INTENT|ASK|CONTENT)(?::[^\]]*)?\]\s*/gi
function stripProtocolInline(text: string): string {
  return text.replace(PROTOCOL_INLINE_RE, '')
}

/**
 * AI 的"是否在等用户做选择"信号，由结构化协议 [ASK:xxx] 决定。
 * - choice → 前端弹选项弹窗（唯一权威信号）
 * - confirm → 前端只 toast
 * - none → 不弹窗
 */
export type AiAsk = 'none' | 'choice' | 'confirm'

/**
 * 从 AI 流式累积的原始文本里解析协议头。
 * - 命中三行结构 → 返回 intent + ask + 去掉头部后的正文
 * - 只命中第一行（老格式）→ ask 兜底为 'none'
 * - 都没命中 → 返回 null（调用方走"老兜底逻辑"）
 */
export function parseProtocolHeader(
  raw: string
): { intent: AiIntent; ask: AiAsk; body: string } | null {
  const m3 = raw.match(PROTOCOL_HEADER_RE)
  if (m3) {
    return {
      intent: m3[1].toLowerCase() as AiIntent,
      ask: m3[2].toLowerCase() as AiAsk,
      body: raw.slice(m3[0].length)
    }
  }
  const m1 = raw.match(INTENT_ONLY_RE)
  if (m1) {
    return {
      intent: m1[1].toLowerCase() as AiIntent,
      ask: 'none', // 老格式：没 ASK 就当 none，不弹窗
      body: raw.slice(m1[0].length)
    }
  }
  return null
}

/**
 * 一条"可点击选项"：AI 用 markdown 列表输出"**路径 X**：描述"，
 * 前端解析后渲染成按钮，点击即可一键续聊。
 */
export interface ChatChoice {
  /** 选项 key（'A' / 'B' / 'C' / 'D'） */
  key: string
  /** 选项标签，例如"路径 A" */
  label: string
  /** 选项简短描述（按钮文字） */
  description: string
}

/**
 * 从一段 AI 回复里识别选项列表。
 *
 * AI 输出经常不规范，所以按"宽容度从高到低"试 3 种格式（命中其一即可）：
 *   1. markdown bullet + bold：`- **路径 A**：描述`
 *   2. 仅 bold：`**路径 A**：描述`
 *   3. 纯文本：`路径 A：描述` / `路径 A: 描述`
 *
 * 标签同义词：AI 会根据语境挑顺眼的词，"路径/方案/选项/思路/方向/建议" 都视为同一种标签。
 * 分隔符同时接受 ASCII 半角 ":" 和中文全角 "："（AI 倾向用全角）。
 *
 * - key 必须是 A/B/C/D 大写字母
 * - description 截断 80 字防溢出
 * - 同一 key 取最先出现的；最多 8 个（理论上 AI 只给 2~4 个）
 */
export function parseChoices(content: string): ChatChoice[] {
  const choices: ChatChoice[] = []
  // AI 在不同语境下会用不同近义词，全收进来避免漏匹配
  const KEYWORDS = '(?:路径|方案|选项|思路|方向|建议|选择|模式|Path|Option|Idea|Approach)'
  // ":" = ASCII 半角；"：" (U+FF1A) = 中文全角。AI 在中文写作里几乎都用全角
  const SEP = '[:：]'
  const PATTERNS: RegExp[] = [
    // 1. markdown bullet + bold： "- **路径 A**：..."
    new RegExp(`^\\s*[-*]\\s+\\*\\*\\s*${KEYWORDS}\\s+([A-Da-d])\\s*\\*\\*\\s*${SEP}\\s*([^\\n]+)`, 'gm'),
    // 2. 仅 bold："**路径 A**：..."
    new RegExp(`\\*\\*\\s*${KEYWORDS}\\s+([A-Da-d])\\s*\\*\\*\\s*${SEP}\\s*([^\\n]+)`, 'g'),
    // 3. 纯文本：行首"路径 A：..." / "路径 A: ..."，可选前导 -/*
    new RegExp(`^\\s*(?:[-*]\\s*)?${KEYWORDS}\\s+([A-Da-d])\\s*${SEP}\\s*([^\\n]+)`, 'gm')
  ]

  const seen = new Set<string>()
  for (const re of PATTERNS) {
    let m: RegExpExecArray | null
    while ((m = re.exec(content)) !== null) {
      const key = m[1].toUpperCase()
      if (seen.has(key)) continue
      seen.add(key)
      // 去掉描述里残留的 ** / * 等 markdown 符号
      const desc = m[2].trim().replace(/\*\*/g, '').replace(/^\*+/, '').slice(0, 80)
      choices.push({
        key,
        label: `路径 ${key}`,
        description: desc
      })
      if (choices.length >= 8) break
    }
    if (choices.length >= 2) break
  }
  return choices
}

/** 平台显示元数据，供左/右栏复用 */
export const PLATFORMS: { key: Platform; label: string; color: string }[] = [
  { key: 'wechat', label: '微信公众号', color: 'var(--color-wechat)' },
  { key: 'zhihu', label: '知乎', color: 'var(--color-zhihu)' },
  { key: 'csdn', label: 'CSDN', color: 'var(--color-csdn)' },
  { key: 'juejin', label: '掘金', color: 'var(--color-juejin)' }
]

const nowISO = () => new Date().toISOString()

/** 后端 listDocuments 单条返回的形状 */
interface ApiDocument {
  id: string
  title: string
  excerpt: string | null
  content: string | null
  platforms: string[]
  createdAt: Date | string
  updatedAt: Date | string
  /** 后端最新 schema 已下发 deletedAt；老版本接口可能没有，做可选 */
  deletedAt?: Date | string | null
  userId: number
}

/**
 * 后端 DocumentRow → 前端 DocumentItem 转换：
 * - id 已经 string 化（listDocuments 直接转过）
 * - updatedAt / deletedAt 是 Date，转成 ISO 字符串，跟旧前端约定保持一致
 */
function fromApi(doc: ApiDocument): DocumentItem {
  return {
    id: doc.id,
    title: doc.title,
    excerpt: doc.excerpt ?? '',
    content: doc.content ?? '',
    platforms: (doc.platforms ?? []) as Platform[],
    updatedAt:
      doc.updatedAt instanceof Date
        ? doc.updatedAt.toISOString()
        : String(doc.updatedAt),
    deletedAt: toIso(doc.deletedAt),
    userId: doc.userId
  }
}

/** 把 Date / string / null / undefined 都规范成 ISO 字符串或 null */
function toIso(v: Date | string | null | undefined): string | null {
  if (v === undefined || v === null) return null
  if (v instanceof Date) return v.toISOString()
  const s = String(v)
  return s === '' ? null : s
}

const seedTemplates: TemplateItem[] = []

export const useDocumentStore = defineStore('document', () => {
  const documents = ref<DocumentItem[]>([])
  const documentsLoaded = ref(false)
  const documentsLoading = ref(false)
  /**
   * 回收站文档（软删除但未到 30 天清理期）。
   * - 与 `documents` 完全隔离，不参与"最近"列表展示
   * - 仅在用户点开回收站时才拉取
   */
  const deletedDocuments = ref<DocumentItem[]>([])
  const deletedLoaded = ref(false)
  const deletedLoading = ref(false)
  const templates = ref<TemplateItem[]>(seedTemplates)
  const templatesLoaded = ref(false)
  const templatesLoading = ref(false)
  /** 用户当前"选中"但未应用的模板（仅展示态，用于高亮） */
  const selectedTemplateId = ref<string | null>(null)
  /** 首次进站没有文档时为 null；打开任意一份后才赋值 */
  const currentId = ref<string | null>(null)
  const isGenerating = ref(false)
  /** 已选中的发布渠道 */
  const selectedPlatforms = ref<Platform[]>([
    'wechat',
    'zhihu',
    'csdn',
    'juejin'
  ])

  /**
   * edit 流式过程中 pendingDiff 的"刷新次数"——每 30ms 重算一次就 +1。
   * UI 用它显示"实时对比中 · 第 N 次"，让用户感知到"分片对比"在工作。
   * 流结束（acceptPendingDiff / rejectPendingDiff）时清零。
   */
  const pendingDiffRevision = ref(0)

  const current = computed<DocumentItem | null>(() => {
    if (!currentId.value) return null
    return documents.value.find((d) => d.id === currentId.value) ?? null
  })

  function open(id: string) {
    currentId.value = id
  }

  function createNew(): string {
    // 本地先建一个占位条目，立刻给 UI 用 —— 避免接口往返的卡顿感
    const id = `local-${Date.now()}`
    // 真正的空文档：title / content 都为空，编辑器自身的 placeholder（"开始写点什么……"）
    // 和 title input 的 placeholder（"无标题文档"）负责给用户视觉提示
    const item: DocumentItem = {
      id,
      title: '',
      excerpt: '',
      content: '',
      updatedAt: nowISO(),
      platforms: [],
      deletedAt: null
    }
    documents.value.unshift(item)
    currentId.value = id
    // 异步落库；用真正的后端 id 替换占位 id
    api
      .post<ApiDocument>('/api/documents', {
        title: '',
        content: ''
      })
      .then((doc) => {
        const remote = fromApi(doc)
        const i = documents.value.findIndex((d) => d.id === id)
        if (i >= 0) documents.value.splice(i, 1, remote)
        // currentId 切到真实 id，保证后续 updateContent / PUT 能命中
        if (currentId.value === id) currentId.value = remote.id
      })
      .catch((e) => {
        console.error('[createNew] persist failed', e)
        // 失败时回滚占位条目，避免留下一个永远不能同步的孤儿文档
        const i = documents.value.findIndex((d) => d.id === id)
        if (i >= 0) documents.value.splice(i, 1)
        if (currentId.value === id) currentId.value = null
      })
    return id
  }

  function rename(id: string, title: string) {
    const doc = documents.value.find((d) => d.id === id)
    if (doc) {
      doc.title = title || '未命名文档'
      doc.updatedAt = nowISO()
      // 仅对后端文档（id 是数字串）做同步
      if (/^\d+$/.test(id)) {
        api.put(`/api/documents/${id}`, { title: doc.title }).catch((e) => {
          console.error('[rename] persist failed', e)
        })
      }
    }
  }

  /**
   * 删除一篇文档（**软删除**）：
   * - 后端只标记 deletedAt，**不会真从数据库抹掉**（用户在回收站可恢复，30 天后自动清理）
   * - 本地立刻从 `documents` 移除 + 推进 `deletedDocuments`（乐观更新，UI 不阻塞）
   * - 后端 DELETE 失败时回滚（移到 trash 的动作回滚 + 重新放回 documents）
   * - 若删的是当前打开的文档，把 currentId 切到下一篇（或 null）
   * - 若当前正在保存它，先 flushPendingSaves 再删，避免竞态
   * - 同步清掉它的 AI 对话历史/聊天流（避免留下指向不存在文档的状态）
   */
  async function deleteDocument(id: string): Promise<boolean> {
    const idx = documents.value.findIndex((d) => d.id === id)
    if (idx < 0) return false
    const isNumeric = /^\d+$/.test(id)
    const snapshot = documents.value[idx]
    // 1) 先把当前正在防抖落库的数据 flush 出去，避免和 DELETE 抢同一行
    if (isNumeric) flushPendingSaves()
    // 2) 乐观更新：从 documents 移除，挪到 deletedDocuments 顶部
    documents.value.splice(idx, 1)
    const trashItem: DocumentItem = {
      ...snapshot,
      deletedAt: new Date().toISOString()
    }
    deletedDocuments.value.unshift(trashItem)
    // 3) 若是当前打开的，切到下一篇（或 null）
    if (currentId.value === id) {
      const next = documents.value[idx] ?? documents.value[idx - 1] ?? null
      currentId.value = next?.id ?? null
    }
    // 4) 顺手清掉它的 AI 历史 / 聊天流（回收站里没必要继续对话）
    if (chatHistory.value.has(id)) {
      const next = new Map(chatHistory.value)
      next.delete(id)
      chatHistory.value = next
    }
    if (chatThread.value.has(id)) {
      const next = new Map(chatThread.value)
      next.delete(id)
      chatThread.value = next
    }
    // 5) 仅对已落库的文档（id 是数字串）请求后端软删
    if (!isNumeric) {
      // 本地占位（id=local-xxx）就不必上报，后端也没这条
      deletedDocuments.value.shift()
      return true
    }
    try {
      await api.delete(`/api/documents/${id}`)
      return true
    } catch (e) {
      console.error('[deleteDocument] failed', id, e)
      // 失败回滚：从 deletedDocuments 移除，文档插回原位
      const di = deletedDocuments.value.findIndex((d) => d.id === id)
      if (di >= 0) deletedDocuments.value.splice(di, 1)
      documents.value.splice(idx, 0, snapshot)
      if (!currentId.value) currentId.value = id
      throw e
    }
  }

  function updateContent(id: string, content: string) {
    const doc = documents.value.find((d) => d.id === id)
    if (doc) {
      doc.content = content
      doc.updatedAt = nowISO()
      // 同步摘要：用第一段非空纯文本前 32 字
      doc.excerpt = content
        .replace(/[#>`*_~\-\[\]]/g, '')
        .split(/\n/)
        .map((l) => l.trim())
        .filter(Boolean)
        .slice(1) // 跳过标题
        .join(' ')
        .slice(0, 40)
      // 仅对"已落库"的文档（id 是纯数字）启动防抖保存
      if (/^\d+$/.test(id)) {
        scheduleSave(id)
      }
    }
  }

  /** 防抖落库：连续输入时只打最后一次 PUT */
  const SAVE_DEBOUNCE_MS = 1500
  const saveTimers = new Map<string, ReturnType<typeof setTimeout>>()
  const pendingSaves = new Map<string, string>() // id -> 待保存的内容快照

  function scheduleSave(id: string) {
    const doc = documents.value.find((d) => d.id === id)
    if (!doc) return
    pendingSaves.set(id, doc.content)
    // 一旦有新的待保存内容，立刻清掉"已保存"标记，避免误导
    if (lastSavedAt.value.has(id)) {
      const next = new Map(lastSavedAt.value)
      next.delete(id)
      lastSavedAt.value = next
    }
    const prev = saveTimers.get(id)
    if (prev) clearTimeout(prev)
    const timer = setTimeout(() => {
      saveTimers.delete(id)
      const content = pendingSaves.get(id)
      pendingSaves.delete(id)
      if (content === undefined) return
      savingIds.value = new Set([...savingIds.value, id])
      api
        .put(`/api/documents/${id}`, { content })
        .then(() => {
          lastSavedAt.value = new Map(lastSavedAt.value).set(id, Date.now())
        })
        .catch((e) => {
          console.error('[auto-save] failed', id, e)
        })
        .finally(() => {
          const next = new Set(savingIds.value)
          next.delete(id)
          savingIds.value = next
        })
    }, SAVE_DEBOUNCE_MS)
    saveTimers.set(id, timer)
  }

  /**
   * 立刻把所有待保存的文档 flush 到后端：
   * - 切换文档 / 关闭页面前调用，避免丢掉最近的改动
   * - 路由跳转、刷新都会触发浏览器 beforeunload，调用 flushPendingSaves 同步发送
   */
  function flushPendingSaves() {
    for (const [id, timer] of saveTimers) {
      clearTimeout(timer)
      const content = pendingSaves.get(id)
      pendingSaves.delete(id)
      saveTimers.delete(id)
      if (content === undefined) continue
      // sendBeacon 在 unload 时也能可靠发出；普通 fetch 可能被中断
      try {
        const blob = new Blob(
          [JSON.stringify({ content })],
          { type: 'application/json' }
        )
        navigator.sendBeacon?.(
          `${import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8787'}/api/documents/${id}`,
          blob
        )
      } catch {
        // 退化方案：异步 fetch（不一定能完成）
        api.put(`/api/documents/${id}`, { content }).catch(() => {})
      }
    }
  }

  /** 正在保存中的文档 id 集合（UI 显示"保存中…"） */
  const savingIds = ref<Set<string>>(new Set())
  /** 文档最近一次保存成功的时间戳（UI 显示"已保存"） */
  const lastSavedAt = ref<Map<string, number>>(new Map())
  /**
   * 每篇文档独立的"AI 对话历史"：让 AI 记住之前几轮做过什么，
   * 避免每次都从零开始、也不重复堆内容。
   * - 喂回后端的内容：[{role, content, kind}]
   *   - kind='edit'    → AI 之前给出过"完整新文档"
   *   - kind='analyze' → AI 之前的评价/建议
   *   - kind='chat'    → AI 之前的聊天回复
   */
  const chatHistory = ref<
    Map<
      string,
      Array<{
        role: 'user' | 'assistant'
        content: string
        kind?: 'edit' | 'analyze' | 'chat'
        ask?: AiAsk
      }>
    >
  >(new Map())

  /**
   * 右栏"AI 对话"面板里展示的消息流，按文档隔离。
   * - user 消息：每次 generate() 都新增一条
   * - assistant 消息：
   *   - chat 类：generate() 流式完成后立即追加
   *   - edit 类：等用户"接受"后才追加（拒绝则丢弃，让用户感觉这一轮白聊了）
   */
  const chatThread = ref<Map<string, ChatMessage[]>>(new Map())
  /**
   * AI 生成的"待确认改动"：流式完成后不会立刻落库，先存到这里。
   * 用户点接受才真正写入 doc.content + 持久化 + 加入聊天历史。
   * 结构：
   * - docId: 针对哪篇文档
   * - preContent: 生成前的原文（用于"拒绝"时回滚）
   * - postContent: AI 生成的完整新文档
   * - diffParts: 行级 diff 片段（绿色新增 / 红色删除），给 UI 展示
   * - prompt: 用户这一轮的指令（写进聊天历史用）
   */
  const pendingDiff = ref<{
    docId: string
    preContent: string
    postContent: string
    diffParts: Array<{ value: string; added?: boolean; removed?: boolean }>
    prompt: string
  } | null>(null)
  /**
   * AI 正在流式生成时的"实时预览"：让用户看到 AI 在一步步输出内容，
   * 避免等待的焦虑感。流式完成后会被 pendingDiff 或 chatThread 接管。
   * - mode='edit' → accumulated 是"完整新文档"，走 diff 流程
   * - mode='chat' → accumulated 是"AI 聊天回复"，走对话流程
   * - mode=null   → AI 还没表态，先显示"AI 正在思考"
   */
  const streamingPreview = ref<{
    docId: string
    preContent: string
    /** 去掉 [INTENT:xxx] 标签后的累积内容 */
    accumulated: string
    /** 后端原始输出（含标签），用于排查 AI 没打标的情况 */
    rawBuffer: string
    /** AI 自己分流后的意图，未识别前为 null */
    mode: AiIntent | null
    /** 用户这一轮的指令（标题区展示） */
    prompt: string
  } | null>(null)

  /**
   * 从后端拉取当前用户的文档列表（按 updatedAt desc）。
   * - 拉完把列表顶上的设为当前文档
   * - 失败时列表为空 + UI 提示，不阻塞
   */
  async function loadDocuments(force = false) {
    if (documentsLoading.value) return
    if (documentsLoaded.value && !force) return
    documentsLoading.value = true
    try {
      const res = await api.get<{ items: ApiDocument[] }>('/api/documents')
      documents.value = (res.items ?? []).map(fromApi)
      documentsLoaded.value = true
      // 自动打开最近一份；用户没文档就保持 null（编辑器显示 EmptyState）
      if (!currentId.value && documents.value.length) {
        currentId.value = documents.value[0].id
      }
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : '文档列表加载失败'
      console.error('[loadDocuments]', msg)
      documents.value = []
    } finally {
      documentsLoading.value = false
    }
  }

  /**
   * 拉取回收站列表（force 强制重拉，覆盖后台自动清理后的差异）。
   * 失败时不抛错，UI 展示空数组 + 提示横幅即可。
   */
  async function loadDeletedDocuments(force = false) {
    if (deletedLoading.value) return
    if (deletedLoaded.value && !force) return
    deletedLoading.value = true
    try {
      const res = await api.get<{ items: ApiDocument[] }>('/api/documents/trash')
      deletedDocuments.value = (res.items ?? []).map(fromApi)
      deletedLoaded.value = true
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : '回收站加载失败'
      console.error('[loadDeletedDocuments]', msg)
      deletedDocuments.value = []
    } finally {
      deletedLoading.value = false
    }
  }

  /**
   * 恢复一篇回收站文档：
   * - 乐观更新：从 deletedDocuments 移除，回到 documents 顶部
   * - 失败回滚
   */
  async function restoreDocument(id: string): Promise<boolean> {
    const idx = deletedDocuments.value.findIndex((d) => d.id === id)
    if (idx < 0) return false
    const snapshot = deletedDocuments.value[idx]
    // 乐观：从回收站移除
    deletedDocuments.value.splice(idx, 1)
    try {
      const doc = await api.post<ApiDocument>(`/api/documents/${id}/restore`)
      const item = fromApi(doc)
      // 插回"最近"顶部（按 updatedAt desc）
      documents.value.unshift(item)
      // 如果删的是当前打开的文档，currentId 不用切——它已经从 documents 列表移除了，
      // 但内容应该已经没了，所以兜底切到第一篇或 null
      if (currentId.value === id) {
        currentId.value = documents.value[0]?.id ?? null
      }
      return true
    } catch (e) {
      console.error('[restoreDocument] failed', id, e)
      // 回滚：把回收站文档插回原位
      deletedDocuments.value.splice(idx, 0, snapshot)
      throw e
    }
  }

  /**
   * 物理删除一篇回收站文档（用户点"彻底删除"按钮）：
   * - 这才是真正从数据库抹掉
   * - 二次确认由 UI 负责（ElMessageBox.confirm）
   */
  async function purgeDocument(id: string): Promise<boolean> {
    const idx = deletedDocuments.value.findIndex((d) => d.id === id)
    if (idx < 0) return false
    const snapshot = deletedDocuments.value[idx]
    deletedDocuments.value.splice(idx, 1)
    try {
      await api.delete(`/api/documents/${id}/permanent`)
      return true
    } catch (e) {
      console.error('[purgeDocument] failed', id, e)
      deletedDocuments.value.splice(idx, 0, snapshot)
      throw e
    }
  }

  function applyTemplate(id: string) {
    const tpl = templates.value.find((t) => t.id === id)
    if (!tpl) return

    // 已经有用户内容（非空）→ 只切换"选中态"，不覆盖，避免误删
    if (current.value && !isDocEmpty(current.value.content)) {
      selectedTemplateId.value = id
      return
    }

    // 内容为空 → 直接在当前文档（没有就新建）套用模板
    const targetId = current.value?.id ?? createNew()
    const doc = documents.value.find((d) => d.id === targetId)
    if (doc) {
      doc.title = tpl.name
      updateContent(targetId, tpl.content)
      selectedTemplateId.value = id
    }
  }

  /**
   * 判断文档内容是否"实质为空"：
   * 现在新文档创建时 content/title/excerpt 都已经是空字符串，所以这里只看
   * "去掉所有空白后是不是空的"，避免老的占位符正则把真正的用户内容误判。
   */
  function isDocEmpty(content: string | undefined | null): boolean {
    if (!content) return true
    return content.replace(/[\s\n\r\t]+/g, '') === ''
  }

  /**
   * 从后端 `GET /api/templates` 拉取模板列表。
   * - 失败时用本地空数组兜底，UI 侧根据 templatesLoaded 展示空态
   * - 幂等：已加载过则直接返回
   */
  async function loadTemplates(force = false) {
    if (templatesLoading.value) return
    if (templatesLoaded.value && !force) return
    templatesLoading.value = true
    try {
      const res = await api.get<{ items: TemplateItem[] }>('/api/templates')
      templates.value = res.items ?? []
      templatesLoaded.value = true
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : '模板加载失败'
      console.error('[loadTemplates]', msg)
      templates.value = []
    } finally {
      templatesLoading.value = false
    }
  }

  /** 切换/新建文档时清掉旧的模板选中态 */
  function clearSelectedTemplate() {
    selectedTemplateId.value = null
  }

  function togglePlatform(p: Platform) {
    const i = selectedPlatforms.value.indexOf(p)
    if (i === -1) selectedPlatforms.value.push(p)
    else selectedPlatforms.value.splice(i, 1)
  }

  /**
   * 一键生成：POST /api/ai/generate（SSE）。
   * - AI 收到对话历史 + 当前文档，**自己判断**意图（除非传了 forceMode 强制）
   *   - [INTENT:edit]    → 直接修改文档
   *   - [INTENT:analyze] → 给评价/建议，不动文档
   *   - [INTENT:chat]    → 闲聊/问答/反问澄清
   * - 流式过程：先 buffer，等待意图标签出现；标签一出现立刻分流到不同 UI
   *   - edit：进入 pendingDiff 走"接受/拒绝"流程
   *   - analyze/chat：直接追加到 chatThread，给用户聊天气泡
   * - 意图识别失败的兜底：按 edit 走（兼容老行为）
   *
   * 返回 { content, mode }：mode 给调用方做后续 UI 提示（如 toast）用，
   * 因为生成结束后 streamingPreview 已被清空，外部已无法再读到 mode。
   */
  async function generate(
    opts: GenerateOptions
  ): Promise<{ content: string; mode: AiIntent }> {
    if (!current.value) return { content: '', mode: 'chat' }
    const doc = current.value
    const baseContent = doc.content ?? ''
    isGenerating.value = true

    // 拿这篇文档专属的历史；没有就空
    const history = chatHistory.value.get(doc.id) ?? []

    // 流式缓冲：rawBuffer 是后端原始字节（含标签），
    // contentBuffer 是去掉 [INTENT:xxx] 后真正展示/处理的内容
    let rawBuffer = ''
    let contentBuffer = ''
    let detected: AiIntent | null = opts.forceMode ?? null
    // AI 自己声明的"是否在等用户做选择"，由结构化协议 [ASK:xxx] 决定
    let detectedAsk: AiAsk = 'none'

    // streamingPreview 的角色变化：
    // - chat/analyze 模式 → 右栏用它判断"AI 正在打字"（isChatStreaming）
    // - edit 模式 → 不维护（让中央 diff 视图独占，实时刷新）
    // 这样后端流式回来时，前端**立刻**根据已检测到的 intent 分流，不用等流结束
    //
    // mode 没识别前默认 'chat'（AI 99% 的非编辑指令都是聊天/分析）：
    // - 让"一键生成"按下后立刻出现"AI 正在打字"的气泡，不需要等 meta 帧到达
    // - 协议头/正文分片的剥离在 pushPreview 里做（用 stripProtocolInline）
    // - meta 后续若带 intent='edit'，pushPreview 立刻把 streamingPreview 置 null 切走
    streamingPreview.value =
      detected === 'edit'
        ? null
        : {
            docId: doc.id,
            preContent: baseContent,
            accumulated: '',
            rawBuffer: '',
            mode: detected ?? 'chat',
            prompt: opts.prompt ?? ''
          }

    /**
     * 从累积的原始文本里解析协议头（新版三行结构 + 旧版单行兼容）。
     * 命中 → 返回 intent + ask + 去掉头部后的正文
     * 没命中 → 返回 null（让流式继续累积，不切换 UI）
     */
    function tryParseHeader(text: string) {
      // 先试三行结构（新版）
      const m3 = text.match(PROTOCOL_HEADER_RE)
      if (m3) {
        return {
          intent: m3[1].toLowerCase() as AiIntent,
          ask: m3[2].toLowerCase() as AiAsk,
          body: text.slice(m3[0].length)
        }
      }
      // 兜底：只识别第一行 [INTENT]（旧版 / AI 没学会新协议）
      const m1 = text.match(INTENT_ONLY_RE)
      if (m1) {
        return {
          intent: m1[1].toLowerCase() as AiIntent,
          ask: 'none' as AiAsk, // 旧格式：没 ASK 就当 none，不弹窗
          body: text.slice(m1[0].length)
        }
      }
      return null
    }

    /**
     * 兜底：AI 完全没按协议输出时（罕见，理论上不应发生）。
     * 新协议里 AI 必须输出 [INTENT]，所以这里直接当作 chat + none（最安全）。
     */
    function fallbackHeader() {
      // AI 完全没按协议输出时（罕见），做最后一次兜底判断：
      // - 如果清理后的 rawBuffer 能解析出"路径 A/B/C/D"等选项 → 给 choice，让用户能继续点选
      // - 否则给 chat/none（最安全，不动文档）
      // 这样无论协议头是否解析成功，只要 AI 给出了选项 UI 就能弹窗。
      const cleaned = stripProtocolInline(rawBuffer)
      const hasChoices = parseChoices(cleaned).length >= 1
      return {
        intent: 'chat' as AiIntent,
        ask: hasChoices ? ('choice' as AiAsk) : ('none' as AiAsk),
        body: cleaned
      }
    }

    // 更新 streamingPreview（一次性塞新对象，触发响应式）
    // edit 模式不维护 streamingPreview——让中央 diff 视图独占
    // 关键：accumulated 写入前用 stripProtocolInline 把 [INTENT:xxx]/[ASK:xxx]/[CONTENT] 抹掉，
    // 这样右栏气泡打字过程就不会把协议头当成正文渲染出来。
    function pushPreview() {
      if (detected === 'edit') {
        streamingPreview.value = null
        return
      }
      if (!streamingPreview.value) return
      streamingPreview.value = {
        ...streamingPreview.value,
        accumulated: stripProtocolInline(contentBuffer),
        rawBuffer,
        mode: detected ?? 'chat'
      }
    }

    /**
     * edit 模式实时算 diff 写 pendingDiff，让中央 diff 视图在 AI 流式打字过程中实时刷新。
     * 这就是"分片对比"——AI 边写，diff 边成形，用户看到行级绿/红增量。
     *
     * 30ms 节流（≈30fps）：流式 chunk 通常 50-100ms 一个，30ms 节流保证每收到 1~2 个 chunk
     * 就重算一次 diff，视觉上"分片对比"非常顺滑。diffLines 对中等长度 markdown
     * （< 5000 字）耗时 < 5ms，30fps 完全扛得住。
     */
    let pendingDiffTimer: ReturnType<typeof setTimeout> | null = null
    // 局部计数器：每次 flushPushPendingDiff 触发，pendingDiffRevision.value++
    function schedulePushPendingDiff() {
      if (pendingDiffTimer) return
      pendingDiffTimer = setTimeout(() => {
        pendingDiffTimer = null
        flushPushPendingDiff()
      }, 30)
    }
    function flushPushPendingDiff() {
      if (pendingDiffTimer) {
        clearTimeout(pendingDiffTimer)
        pendingDiffTimer = null
      }
      const cleaned = stripProtocolInline(contentBuffer)
      const diffParts = diffLines(baseContent, cleaned)
      pendingDiffRevision.value++
      pendingDiff.value = {
        docId: doc.id,
        preContent: baseContent,
        postContent: cleaned,
        diffParts,
        prompt: opts.prompt ?? ''
      }
    }

    // 把消息写进 chatThread + chatHistory 的通用动作
    function recordConversation(
      userPrompt: string,
      aiContent: string,
      kind: AiIntent,
      ask: AiAsk = 'none'
    ) {
      const userMsg: ChatMessage = {
        id: `u-${Date.now()}`,
        role: 'user',
        content: userPrompt,
        ts: Date.now()
      }
      const aiMsg: ChatMessage = {
        id: `a-${Date.now() + 1}`,
        role: 'assistant',
        content: aiContent,
        kind,
        ask,
        ts: Date.now() + 1
      }
      const next = new Map(chatThread.value)
      next.set(doc.id, [...(next.get(doc.id) ?? []), userMsg, aiMsg])
      chatThread.value = next

      const histNext = new Map(chatHistory.value)
      const histList = [...(histNext.get(doc.id) ?? [])]
      histList.push({ role: 'user', content: userPrompt })
      histList.push({ role: 'assistant', content: aiContent, kind, ask })
      histNext.set(doc.id, histList.slice(-20))
      chatHistory.value = histNext
    }

    try {
      const contextText = opts.contextText ?? (baseContent.trim() ? baseContent : undefined)
      await postStream(
        '/api/ai/generate',
        {
          prompt: opts.prompt ?? '',
          model: opts.model,
          tone: opts.tone,
          length: opts.length,
          language: opts.language,
          contextText,
          history
        },
        {
          // 每个流式 chunk 进来——立刻分流，**不等流结束**
          onDelta(delta) {
            rawBuffer += delta
            // 无条件 append：保证右栏气泡逐字打字，无论 detected 是 null 还是已设
            // 协议头会被 pushPreview 里的 stripProtocolInline 抹掉，不会泄漏给用户
            contentBuffer += delta
            if (detected === null) {
              // 还在等头部协议。优先信后端 meta 事件；如果没收到，再退回到本地正则解析
              // - 后端 meta 事件走 onMeta 路径会立刻设 detected
              // - 这里再兜一层，确保即使后端没发出 meta，也能从 rawBuffer 切出来
              const parsed = tryParseHeader(rawBuffer)
              if (parsed) {
                detected = parsed.intent
                detectedAsk = parsed.ask
              }
              if (detected === 'edit') {
                schedulePushPendingDiff() // edit 模式：立刻初始化 diff
              }
            } else if (detected === 'edit') {
              schedulePushPendingDiff() // edit 模式：实时刷新 diff
            }
            pushPreview() // chat/analyze 模式：实时更新 streamingPreview；edit 模式这里被首行 if 拦住置 null
          },
          // 后端结构化 meta 事件：拿到就立刻分流（**权威信号**）
          // 如果 stream 里没收到 meta（兼容老后端），onDelta 里的正则兜底
          onMeta(meta) {
            if (detected !== null) return // 已经切过了，不重复
            detected = meta.intent
            detectedAsk = meta.ask
            // onDelta 里已经无条件 contentBuffer += delta，所以 contentBuffer 此时可能已经包含了
            // 第一个 chunk（含协议头）。直接 stripProtocolInline(contentBuffer) 把头剥掉，
            // 后续 pushPreview 再走一遍也无所谓（同样的输入同样的输出）。
            contentBuffer = stripProtocolInline(contentBuffer)
            if (detected === 'edit') {
              schedulePushPendingDiff() // edit 模式：立刻初始化 diff
            }
            pushPreview()
          }
        }
      )

      const finalMode: AiIntent = detected ?? 'chat' // AI 没出协议 → 当 chat（最安全，不动文档）
      const cleanedContent = stripProtocolInline(contentBuffer)

      // AI 完全没出协议头时（罕见），走 fallbackHeader 智能判断 ask
      if (detected === null) {
        const fb = fallbackHeader()
        detectedAsk = fb.ask
      }

      // ============ analyze / chat：流结束后才进 chatThread（避免流式中提前出现正式消息） ============
      if (finalMode === 'analyze' || finalMode === 'chat') {
        recordConversation(opts.prompt ?? '', cleanedContent, finalMode, detectedAsk)
        streamingPreview.value = null
        return { content: cleanedContent, mode: finalMode }
      }

      // ============ edit：flush 最后一次 diff，确保用的是完整内容 ============
      flushPushPendingDiff()
      streamingPreview.value = null
      // edit 模式下 user/AI 消息不在这里加，等用户点"接受"再追加（拒绝则整个一轮都不算）
      return { content: cleanedContent, mode: 'edit' }
    } catch (err) {
      // 出错时清掉实时预览和定时器，避免残留
      if (pendingDiffTimer) {
        clearTimeout(pendingDiffTimer)
        pendingDiffTimer = null
      }
      streamingPreview.value = null
      if (err instanceof ApiError) throw err
      throw new ApiError(0, 0, 'GENERATE_FAILED', (err as Error)?.message ?? 'AI 生成失败')
    } finally {
      isGenerating.value = false
    }
  }

  /**
   * 接受 AI 改动：
   * - 把 postContent 写入 doc.content，触发防抖保存
   * - 把 user prompt + AI 输出加入聊天历史（chatHistory 用于 AI 记忆；chatThread 用于右栏展示）
   * - 清掉 pendingDiff
   */
  function acceptPendingDiff(): boolean {
    const pd = pendingDiff.value
    if (!pd) return false
    const doc = documents.value.find((d) => d.id === pd.docId)
    if (!doc) {
      pendingDiff.value = null
      streamingPreview.value = null
      return false
    }
    updateContent(pd.docId, pd.postContent)

    // chatHistory：喂回 AI 用，标记 kind='edit'
    const histNext = new Map(chatHistory.value)
    const histList = [...(histNext.get(pd.docId) ?? [])]
    histList.push({ role: 'user', content: pd.prompt })
    histList.push({ role: 'assistant', content: pd.postContent, kind: 'edit', ask: 'none' })
    histNext.set(pd.docId, histList.slice(-20))
    chatHistory.value = histNext

    // chatThread：右栏展示，编辑消息渲染为"已修改 [+N -M]"而不是全文
    const threadNext = new Map(chatThread.value)
    const threadList = [...(threadNext.get(pd.docId) ?? [])]
    threadList.push({
      id: `u-${Date.now()}`,
      role: 'user',
      content: pd.prompt,
      ts: Date.now()
    })
    threadList.push({
      id: `a-${Date.now()}`,
      role: 'assistant',
      content: pd.postContent,
      kind: 'edit',
      ask: 'none',
      ts: Date.now()
    })
    threadNext.set(pd.docId, threadList)
    chatThread.value = threadNext

    pendingDiff.value = null
    streamingPreview.value = null
    return true
  }

  /**
   * 拒绝 AI 改动：
   * - 文档保持 preContent 不变
   * - 不入 chatHistory / chatThread（相当于这一轮白聊了，符合用户预期）
   */
  function rejectPendingDiff(): boolean {
    if (!pendingDiff.value) return false
    pendingDiff.value = null
    streamingPreview.value = null
    return true
  }

  /** Diff 摘要：新增 N 行 / 删除 M 行，用于面板标题 */
  const pendingDiffSummary = computed(() => {
    const parts = pendingDiff.value?.diffParts
    if (!parts) return { added: 0, removed: 0, total: 0 }
    let added = 0
    let removed = 0
    let total = 0
    for (const p of parts) {
      const lines = p.value.split('\n').length - (p.value.endsWith('\n') ? 1 : 0)
      total += lines
      if (p.added) added += lines
      else if (p.removed) removed += lines
    }
    return { added, removed, total }
  })

  /** 清掉某文档的 AI 对话历史与右栏对话流（例如"重新开始"按钮） */
  function clearChatHistory(docId?: string) {
    const id = docId ?? current.value?.id
    if (!id) return
    let changed = false
    if (chatHistory.value.has(id)) {
      const next = new Map(chatHistory.value)
      next.delete(id)
      chatHistory.value = next
      changed = true
    }
    if (chatThread.value.has(id)) {
      const next = new Map(chatThread.value)
      next.delete(id)
      chatThread.value = next
      changed = true
    }
    return changed
  }

  /**
   * 把 AI 的"建议"消息一键应用到文档：
   * - 找到这条 assistant 消息之前的 user prompt，拼出明确的"按建议改"指令
   * - 强制走 edit 流程（forceMode='edit'），让用户能看到 diff 决定是否接受
   * - 应用前在 chatThread 留个占位说明，避免用户忘了刚才点了什么
   */
  async function applySuggestion(analyzeMsgId: string, docId: string) {
    const thread = chatThread.value.get(docId) ?? []
    const idx = thread.findIndex((m) => m.id === analyzeMsgId)
    if (idx < 0) return
    const msg = thread[idx]
    if (msg.role !== 'assistant') return

    // 找到这条之前最近的 user 消息作为上下文
    let userPrompt = ''
    for (let i = idx - 1; i >= 0; i--) {
      if (thread[i].role === 'user') {
        userPrompt = thread[i].content
        break
      }
    }

    const suggestion = msg.content
    const editPrompt = userPrompt
      ? `按你刚才的建议修改文档。\n\n原问题：${userPrompt}\n\n建议：${suggestion}`
      : `按以下建议修改文档：\n\n${suggestion}`

    // 在 chatThread 留一个"用户已确认应用"的提示，避免与 pendingDiff 失联
    const notice: ChatMessage = {
      id: `apply-${Date.now()}`,
      role: 'user',
      content: '↪ 按上面建议修改文档',
      ts: Date.now()
    }
    const next = new Map(chatThread.value)
    next.set(docId, [...(next.get(docId) ?? []), notice])
    chatThread.value = next

    await generate({
      prompt: editPrompt,
      forceMode: 'edit'
    })
  }

  return {
    documents,
    documentsLoaded,
    documentsLoading,
    deletedDocuments,
    deletedLoaded,
    deletedLoading,
    templates,
    templatesLoaded,
    templatesLoading,
    selectedTemplateId,
    savingIds,
    lastSavedAt,
    chatHistory,
    chatThread,
    streamingPreview,
    pendingDiff,
    pendingDiffRevision,
    pendingDiffSummary,
    currentId,
    current,
    isGenerating,
    selectedPlatforms,
    open,
    createNew,
    rename,
    updateContent,
    deleteDocument,
    applyTemplate,
    loadDocuments,
    loadDeletedDocuments,
    restoreDocument,
    purgeDocument,
    loadTemplates,
    flushPendingSaves,
    clearSelectedTemplate,
    clearChatHistory,
    acceptPendingDiff,
    rejectPendingDiff,
    applySuggestion,
    togglePlatform,
    generate
  }
})
