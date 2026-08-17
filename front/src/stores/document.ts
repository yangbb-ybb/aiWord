import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

export type Platform = 'wechat' | 'zhihu' | 'csdn' | 'juejin'

export interface DocumentItem {
  id: string
  title: string
  excerpt: string
  content: string
  updatedAt: string // ISO
  platforms: Platform[]
}

export interface TemplateItem {
  id: string
  name: string
  emoji: string
  description: string
  content: string
}

/** 平台显示元数据，供左/右栏复用 */
export const PLATFORMS: { key: Platform; label: string; color: string }[] = [
  { key: 'wechat', label: '微信公众号', color: 'var(--color-wechat)' },
  { key: 'zhihu', label: '知乎', color: 'var(--color-zhihu)' },
  { key: 'csdn', label: 'CSDN', color: 'var(--color-csdn)' },
  { key: 'juejin', label: '掘金', color: 'var(--color-juejin)' }
]

const nowISO = () => new Date().toISOString()

/** 历史文档 mock */
const seedDocuments: DocumentItem[] = [
  {
    id: 'doc-1',
    title: '关于 AI 写作的 5 个误区',
    excerpt: '聊了聊大家在使用 AI 写作时常踩的坑……',
    content: '## 误区一：把 AI 当作搜索引擎\n\n很多人把 AI 当成 ChatGPT + 搜索的合体……',
    updatedAt: nowISO(),
    platforms: ['wechat', 'juejin']
  },
  {
    id: 'doc-2',
    title: '2026 Q2 产品迭代总结',
    excerpt: '本季度重点：新编辑器、协同能力、性能优化……',
    content: '# 2026 Q2 产品迭代总结\n\n## 业务进展\n\n- 新编辑器上线\n- 协同能力补齐',
    updatedAt: nowISO(),
    platforms: ['zhihu']
  },
  {
    id: 'doc-3',
    title: '前端工程化：从 Webpack 到 Vite 的迁移笔记',
    excerpt: '记录团队从 Webpack 切换到 Vite 的全过程……',
    content: '## 为什么迁移\n\n- 启动慢\n- HMR 卡顿',
    updatedAt: nowISO(),
    platforms: ['juejin', 'csdn']
  },
  {
    id: 'doc-4',
    title: '一封发不出去的辞职信',
    excerpt: '写给自己的一份告别信……',
    content: '> 谨以此文献给这一年的自己。\n\n',
    updatedAt: nowISO(),
    platforms: []
  },
  {
    id: 'doc-5',
    title: 'TypeScript 5.5 新特性速览',
    excerpt: '类型推断改进、新增工具类型……',
    content: '## 新特性速览\n\n```ts\ntype T = Uppercase<"hello"> // "HELLO"\n```',
    updatedAt: nowISO(),
    platforms: ['csdn']
  }
]

const seedTemplates: TemplateItem[] = [
  {
    id: 'tpl-weekly',
    name: '工作周报',
    emoji: '📅',
    description: '本周完成 / 下周计划 / 风险与阻塞',
    content: `# 工作周报（YYYY-MM-DD ~ YYYY-MM-DD）\n\n## 本周完成\n- \n\n## 下周计划\n- \n\n## 风险与阻塞\n- \n`
  },
  {
    id: 'tpl-meeting',
    name: '会议纪要',
    emoji: '📝',
    description: '会议信息 / 议题 / 决议 / 待办',
    content: `# 会议纪要\n\n- 时间：\n- 地点：\n- 参会人：\n\n## 议题讨论\n\n## 决议事项\n\n## 待办事项\n- [ ] @责任人：\n`
  },
  {
    id: 'tpl-summary',
    name: '项目总结',
    emoji: '📊',
    description: '背景 / 目标 / 进展 / 数据 / 反思',
    content: `# 项目总结：xxx\n\n## 项目背景\n\n## 目标与指标\n\n## 关键进展\n\n## 数据表现\n\n## 反思与下一步\n`
  },
  {
    id: 'tpl-wechat',
    name: '公众号推文',
    emoji: '📣',
    description: '钩子开头 + 故事 + 行动号召',
    content: `# 一个让读者停不下来的标题\n\n> 写在最前：用一个反常识的事实作为开场。\n\n## 现象\n\n观察到什么？\n\n## 思考\n\n为什么会这样？\n\n## 行动\n\n我们能做什么？\n\n---\n\n如果觉得有用，欢迎转发给身边的朋友 🙌\n`
  }
]

export const useDocumentStore = defineStore('document', () => {
  const documents = ref<DocumentItem[]>(seedDocuments)
  const templates = ref<TemplateItem[]>(seedTemplates)
  const currentId = ref<string | null>(seedDocuments[0]?.id ?? null)
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
    const id = `doc-${Date.now()}`
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
    return id
  }

  function rename(id: string, title: string) {
    const doc = documents.value.find((d) => d.id === id)
    if (doc) {
      doc.title = title || '未命名文档'
      doc.updatedAt = nowISO()
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
    }
  }

  function applyTemplate(id: string) {
    const tpl = templates.value.find((t) => t.id === id)
    if (!tpl) return
    // 优先新建一份文档，再套用模板
    const newId = createNew()
    const doc = documents.value.find((d) => d.id === newId)
    if (doc) {
      doc.title = `${tpl.name} - ${doc.title}`
      doc.content = tpl.content
      updateContent(newId, tpl.content)
    }
  }

  function togglePlatform(p: Platform) {
    const i = selectedPlatforms.value.indexOf(p)
    if (i === -1) selectedPlatforms.value.push(p)
    else selectedPlatforms.value.splice(i, 1)
  }

  /**
   * 一键生成 —— 本阶段模拟加载，返回一段 mock 内容
   * TODO[stage2]: 调用真实 AI 接口（Claude / DeepSeek / 通义……）
   */
  async function generate(prompt: string): Promise<string> {
    if (!current.value) return ''
    isGenerating.value = true
    try {
      // 模拟生成耗时
      await new Promise((r) => setTimeout(r, 1500))

      const today = new Date().toLocaleDateString('zh-CN')
      const mockOutput = `\n\n## AI 生成：${prompt.trim() || '自由主题'}\n\n> 生成时间：${today}\n\n这是基于你的 Prompt 由 AI 草拟的段落，**后续会接入真实的 LLM 接口**。\n\n- 第一点要点说明\n- 第二点要点说明\n- 第三点要点说明\n\n\`\`\`ts\n// 示例代码块\nfunction hello() {\n  console.log('world')\n}\n\`\`\`\n`
      // 追加到当前文档末尾
      const newContent = (current.value.content || '') + mockOutput
      updateContent(current.value.id, newContent)
      return mockOutput
    } finally {
      isGenerating.value = false
    }
  }

  return {
    documents,
    templates,
    currentId,
    current,
    isGenerating,
    selectedPlatforms,
    open,
    createNew,
    rename,
    updateContent,
    applyTemplate,
    togglePlatform,
    generate
  }
})
