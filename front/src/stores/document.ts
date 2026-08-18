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
  /** 对话历史（前端维护）：[{role, content}] */
  history?: Array<{ role: 'user' | 'assistant'; content: string }>
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
  userId: number
}

/**
 * 后端 DocumentRow → 前端 DocumentItem 转换：
 * - id 已经 string 化（listDocuments 直接转过）
 * - updatedAt 是 Date，转成 ISO 字符串，跟旧前端约定保持一致
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
    userId: doc.userId
  }
}

const seedTemplates: TemplateItem[] = []

export const useDocumentStore = defineStore('document', () => {
  const documents = ref<DocumentItem[]>([])
  const documentsLoaded = ref(false)
  const documentsLoading = ref(false)
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
    const title = `未命名文档-${documents.value.length + 1}`
    const item: DocumentItem = {
      id,
      title,
      excerpt: '开始记录你的想法……',
      content: `# ${title}\n\n开始写点什么吧……\n`,
      updatedAt: nowISO(),
      platforms: []
    }
    documents.value.unshift(item)
    currentId.value = id
    // 异步落库；用真正的后端 id 替换占位 id
    api
      .post<ApiDocument>('/api/documents', {
        title,
        content: item.content
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
   * Map<docId, Array<{role, content}>>
   */
  const chatHistory = ref<Map<string, Array<{ role: 'user' | 'assistant'; content: string }>>>(
    new Map()
  )
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
   * 避免等待的焦虑感。流式完成后会被 pendingDiff 接管。
   */
  const streamingPreview = ref<{
    docId: string
    preContent: string
    /** AI 实时累积的输出片段 */
    accumulated: string
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
   * - 空 / 纯空白
   * - 只有一级标题（自动生成的 `# 未命名文档-N`）
   * - 只有默认占位符（`开始写点什么吧……`）
   * 只要用户尚未写过一丁点有意义的内容，就视为空。
   */
  function isDocEmpty(content: string | undefined | null): boolean {
    if (!content) return true
    const stripped = content
      .replace(/^#\s+\S+.*$/m, '')           // 去掉一级标题
      .replace(/开始写点什么吧[。. ~…]+/g, '') // 去掉默认占位符
      .replace(/[\s\n\r\t]+/g, '')            // 去掉所有空白
    return stripped === ''
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
   * - AI 收到对话历史 + 当前文档，每次返回**完整新文档**
   * - 流式过程：accumulated 缓冲每个 chunk 更新（不直接改 doc.content）
   * - 流式完成后：**不立刻落库**，而是把 pre/post 内容 + 行级 diff 放进 pendingDiff
   *   等用户在 UI 上点"接受"才真正写入 doc.content、持久化、加历史
   * - 用户可以点"拒绝"丢弃 AI 改动
   */
  async function generate(opts: GenerateOptions): Promise<string> {
    if (!current.value) return ''
    const doc = current.value
    const baseContent = doc.content ?? ''
    isGenerating.value = true

    // 拿这篇文档专属的历史；没有就空
    const history = chatHistory.value.get(doc.id) ?? []

    // 流式过程累积的"AI 输出全文"
    let accumulated = ''

    // 打开"实时预览"，让用户在等待中看到 AI 一段段输出
    streamingPreview.value = {
      docId: doc.id,
      preContent: baseContent,
      accumulated: '',
      prompt: opts.prompt ?? ''
    }

    try {
      const contextText = opts.contextText ?? (baseContent.trim() ? baseContent : undefined)
      const fullText = await postStream(
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
          onDelta(delta) {
            accumulated += delta
            // 同步到 streamingPreview 给 UI 实时渲染
            if (streamingPreview.value && streamingPreview.value.docId === doc.id) {
              // 用替换触发响应式（accumulated 是 ref，赋值会触发更新）
              streamingPreview.value = {
                ...streamingPreview.value,
                accumulated
              }
            }
          }
        }
      )
      if (fullText) accumulated = fullText

      // 计算行级 diff —— 给 UI 展示"AI 改了哪些行"
      // {value: string, added?: true, removed?: true}
      const diffParts = diffLines(baseContent, accumulated)

      // 关掉实时预览，交接给 pendingDiff 等用户审阅
      streamingPreview.value = null
      pendingDiff.value = {
        docId: doc.id,
        preContent: baseContent,
        postContent: accumulated,
        diffParts,
        prompt: opts.prompt ?? ''
      }

      return accumulated
    } catch (err) {
      // 出错时也清掉实时预览，避免残留
      streamingPreview.value = null
      if (err instanceof ApiError) throw err
      throw new ApiError(0, 'GENERATE_FAILED', (err as Error)?.message ?? 'AI 生成失败')
    } finally {
      isGenerating.value = false
    }
  }

  /**
   * 接受 AI 改动：
   * - 把 postContent 写入 doc.content，触发防抖保存
   * - 把 user prompt + AI 输出加入聊天历史
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

    const next = new Map(chatHistory.value)
    const list = [...(next.get(pd.docId) ?? [])]
    list.push({ role: 'user', content: pd.prompt })
    list.push({ role: 'assistant', content: pd.postContent })
    next.set(pd.docId, list.slice(-20))
    chatHistory.value = next

    pendingDiff.value = null
    streamingPreview.value = null
    return true
  }

  /**
   * 拒绝 AI 改动：
   * - 文档保持 preContent 不变
   * - 也不加入对话历史（相当于这一轮白聊了）
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

  /** 清掉某文档的 AI 对话历史（例如"重新开始"按钮） */
  function clearChatHistory(docId?: string) {
    const id = docId ?? current.value?.id
    if (!id) return
    if (!chatHistory.value.has(id)) return
    const next = new Map(chatHistory.value)
    next.delete(id)
    chatHistory.value = next
  }

  return {
    documents,
    documentsLoaded,
    documentsLoading,
    templates,
    templatesLoaded,
    templatesLoading,
    selectedTemplateId,
    savingIds,
    lastSavedAt,
    chatHistory,
    streamingPreview,
    pendingDiff,
    pendingDiffSummary,
    currentId,
    current,
    isGenerating,
    selectedPlatforms,
    open,
    createNew,
    rename,
    updateContent,
    applyTemplate,
    loadDocuments,
    loadTemplates,
    flushPendingSaves,
    clearSelectedTemplate,
    clearChatHistory,
    acceptPendingDiff,
    rejectPendingDiff,
    togglePlatform,
    generate
  }
})
