<script setup lang="ts">
import { computed, ref, watch, nextTick } from 'vue'
import MarkdownIt from 'markdown-it'
import {
  EditPen,
  View,
  DocumentCopy,
  Download,
  Link,
  Picture,
  List,
  MagicStick,
  CircleClose,
  Check
} from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { useDocumentStore } from '@/stores/document'
import EmptyState from './EmptyState.vue'

const store = useDocumentStore()

const md = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
  typographer: true
})

const activeTab = ref<'edit' | 'preview'>('edit')
const titleRef = ref<HTMLInputElement | null>(null)

const currentTitle = computed({
  get: () => store.current?.title ?? '',
  set: (v: string) => {
    if (store.current) store.rename(store.current.id, v)
  }
})

const currentContent = computed(() => store.current?.content ?? '')

const rendered = computed(() => md.render(currentContent.value))

/**
 * 把 store 里的 diffParts 摊平成"按行"渲染的视图：
 * - kind: 'add' | '删除' | '不变'（ctx）
 * - text: 单行内容（不含 \n）
 * diffLines 的 value 形如 "old\nnew\n"，需要按 \n 拆开每一行。
 */
const diffLinesView = computed<
  Array<{ kind: 'add' | 'del' | 'ctx'; text: string }>
>(() => {
  const parts = store.pendingDiff?.diffParts
  if (!parts) return []
  const out: Array<{ kind: 'add' | 'del' | 'ctx'; text: string }> = []
  for (const part of parts) {
    // diff 库返回的 value 通常以 \n 结尾；空字符串需要跳过
    const lines = part.value.split('\n')
    // 如果末尾是 \n，split 会留下空字符串——去掉
    if (lines.length && lines[lines.length - 1] === '') lines.pop()
    const kind: 'add' | 'del' | 'ctx' = part.added
      ? 'add'
      : part.removed
      ? 'del'
      : 'ctx'
    for (const line of lines) out.push({ kind, text: line })
  }
  return out
})

/** 保存状态指示：idle / saving / saved */
const saveStatus = computed<'idle' | 'saving' | 'saved'>(() => {
  const id = store.current?.id
  if (!id) return 'idle'
  if (store.savingIds.has(id)) return 'saving'
  if (store.lastSavedAt.has(id)) return 'saved'
  return 'idle'
})
const saveStatusClass = computed(() => `save-status--${saveStatus.value}`)
const saveStatusText = computed(() => {
  switch (saveStatus.value) {
    case 'saving':
      return '保存中…'
    case 'saved':
      return '已保存'
    default:
      return ''
  }
})

function onEditorInput(e: Event) {
  const v = (e.target as HTMLTextAreaElement).value
  if (store.current) store.updateContent(store.current.id, v)
}

function applyWrap(prefix: string, suffix: string = prefix) {
  const ta = document.getElementById('editor-textarea') as HTMLTextAreaElement | null
  if (!ta || !store.current) return
  const start = ta.selectionStart
  const end = ta.selectionEnd
  const value = ta.value
  const selected = value.slice(start, end) || '文本'
  const next = value.slice(0, start) + prefix + selected + suffix + value.slice(end)
  store.updateContent(store.current.id, next)
  // 选中保留以便连续输入
  nextTick(() => {
    ta.focus()
    ta.setSelectionRange(start + prefix.length, start + prefix.length + selected.length)
  })
}

function insertHeading(level: 1 | 2 | 3) {
  applyWrap('#'.repeat(level) + ' ', '')
}
function insertBold() {
  applyWrap('**')
}
function insertItalic() {
  applyWrap('*')
}
function insertCode() {
  applyWrap('`')
}
function insertLink() {
  applyWrap('[', '](https://)')
}
function insertImage() {
  applyWrap('![', '](https://)')
}
function insertList() {
  applyWrap('\n- ', '')
}

function copyMarkdown() {
  if (!currentContent.value) return
  navigator.clipboard.writeText(currentContent.value)
  ElMessage.success('已复制 Markdown')
}

function exportDocx() {
  ElMessage.warning('导出 .docx 将在第二阶段接入')
}

function acceptDiff() {
  if (store.acceptPendingDiff()) {
    ElMessage.success('已应用 AI 改动 ✦')
  }
}
function rejectDiff() {
  store.rejectPendingDiff()
  ElMessage.info('已丢弃 AI 改动')
}

/**
 * 流式面板 + diff 视图：让滚动条自动跟着新内容走到底部。
 * 规则：
 * - 内容更新后，自动滚到底（nextTick 等 DOM 更新）
 * - 如果用户手动往上滚了（不在底部 50px 范围内），就不再强制拉，保留他的视口位置
 * - 用户重新滚到底后，下次更新又恢复自动跟随
 */
const streamBodyRef = ref<HTMLElement | null>(null)
const diffBodyRef = ref<HTMLElement | null>(null)

function stickToBottom(el: HTMLElement | null) {
  if (!el) return
  const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight
  // 用户距离底部 <= 50px，认为是"想看最新"，继续贴底
  if (distanceToBottom <= 50) {
    el.scrollTop = el.scrollHeight
  }
}

watch(
  () => store.streamingPreview?.accumulated,
  () => {
    nextTick(() => stickToBottom(streamBodyRef.value))
  }
)

watch(
  () => store.pendingDiff?.diffParts,
  () => {
    nextTick(() => stickToBottom(diffBodyRef.value))
  },
  { deep: true }
)

watch(
  () => store.currentId,
  () => {
    // 切换文档时强制回到编辑页
    activeTab.value = 'edit'
  }
)
</script>

<template>
  <main class="center-editor">
    <template v-if="store.current">
      <header class="ce-header">
        <input
          ref="titleRef"
          class="ce-title"
          v-model="currentTitle"
          placeholder="无标题文档"
          spellcheck="false"
        />
        <span class="save-status" :class="saveStatusClass">
          <span v-if="saveStatus === 'saving'" class="loader" />
          <span v-else-if="saveStatus === 'saved'" class="dot dot--ok" />
          <span class="save-status__text">{{ saveStatusText }}</span>
        </span>
        <div class="ce-actions">
          <el-tooltip content="复制 Markdown" placement="bottom">
            <button class="icon-btn" @click="copyMarkdown">
              <el-icon><DocumentCopy /></el-icon>
            </button>
          </el-tooltip>
          <el-tooltip content="导出 .docx（第二阶段）" placement="bottom">
            <button class="icon-btn" @click="exportDocx">
              <el-icon><Download /></el-icon>
            </button>
          </el-tooltip>
        </div>
      </header>

      <div class="ce-toolbar">
        <button class="tb-btn" @click="insertHeading(1)" title="一级标题">
          <span class="tb-label">H1</span>
        </button>
        <button class="tb-btn" @click="insertHeading(2)" title="二级标题">
          <span class="tb-label">H2</span>
        </button>
        <span class="tb-divider" />
        <button class="tb-btn tb-btn--text" @click="insertBold" title="加粗">
          <strong>B</strong>
        </button>
        <button class="tb-btn tb-btn--text" @click="insertItalic" title="斜体">
          <em>I</em>
        </button>
        <button class="tb-btn" @click="insertCode" title="行内代码">
          <span class="tb-label">code</span>
        </button>
        <span class="tb-divider" />
        <button class="tb-btn" @click="insertList" title="列表">
          <el-icon><List /></el-icon>
        </button>
        <button class="tb-btn" @click="insertLink" title="链接">
          <el-icon><Link /></el-icon>
        </button>
        <button class="tb-btn" @click="insertImage" title="图片">
          <el-icon><Picture /></el-icon>
        </button>

        <div class="tb-tabs">
          <button
            class="tb-tab"
            :class="{ 'tb-tab--active': activeTab === 'edit' }"
            @click="activeTab = 'edit'"
          >
            <el-icon><EditPen /></el-icon>
            <span>编辑</span>
          </button>
          <button
            class="tb-tab"
            :class="{ 'tb-tab--active': activeTab === 'preview' }"
            @click="activeTab = 'preview'"
          >
            <el-icon><View /></el-icon>
            <span>预览</span>
          </button>
        </div>
      </div>

      <!-- AI 实时打字预览：仅在"修改文档"模式下显示，让用户看到 AI 在写正文。
           闲聊/问答模式下，AI 的回复已经在右栏聊天气泡里流式呈现，这里不重复展示。 -->
      <div
        v-if="store.streamingPreview && store.streamingPreview.mode !== 'chat'"
        class="ai-stream-panel"
      >
        <header class="ai-stream-panel__head">
          <div class="ai-stream-panel__title">
            <span class="ai-stream-panel__dot" />
            <span>
              {{
                store.streamingPreview.mode === 'edit'
                  ? 'AI 正在改文档…'
                  : 'AI 正在思考…'
              }}
            </span>
            <em class="ai-stream-panel__prompt">{{ store.streamingPreview.prompt }}</em>
          </div>
          <span class="ai-stream-panel__counter">
            {{ store.streamingPreview.accumulated.length }} 字
          </span>
        </header>
        <div ref="streamBodyRef" class="ai-stream-panel__body">
          <pre class="ai-stream-panel__text">{{ store.streamingPreview.accumulated }}<span class="caret" /></pre>
        </div>
      </div>

      <!-- AI 改动顶部操作条：接受/拒绝 + 统计；diff 主体在 ce-body 渲染 -->
      <div v-else-if="store.pendingDiff" class="ai-diff-bar">
        <div class="ai-diff-bar__title">
          <el-icon><MagicStick /></el-icon>
          <span>AI 提议的改动</span>
          <em class="ai-diff-bar__stats">
            <span class="diff-stat diff-stat--add">+{{ store.pendingDiffSummary.added }}</span>
            <span class="diff-stat diff-stat--del">-{{ store.pendingDiffSummary.removed }}</span>
          </em>
        </div>
        <div class="ai-diff-bar__actions">
          <button class="diff-btn diff-btn--ghost" @click="rejectDiff">
            <el-icon><CircleClose /></el-icon>
            <span>拒绝</span>
          </button>
          <button class="diff-btn diff-btn--primary" @click="acceptDiff">
            <el-icon><Check /></el-icon>
            <span>接受</span>
          </button>
        </div>
      </div>

      <div ref="diffBodyRef" class="ce-body">
        <div class="ce-paper" :key="store.currentId ?? 'empty'">
          <!-- AI diff 视图：直接把差异画在编辑器里（替换 textarea） -->
          <div
            v-if="store.pendingDiff"
            class="ce-diff-editor"
          >
            <div
              v-for="(line, i) in diffLinesView"
              :key="i"
              class="ce-diff-row"
              :class="{
                'ce-diff-row--add': line.kind === 'add',
                'ce-diff-row--del': line.kind === 'del',
                'ce-diff-row--ctx': line.kind === 'ctx'
              }"
            >
              <span class="ce-diff-row__sign">
                {{ line.kind === 'add' ? '+' : line.kind === 'del' ? '−' : '' }}
              </span>
              <span class="ce-diff-row__text">{{ line.text }}</span>
            </div>
          </div>

          <textarea
            v-else-if="activeTab === 'edit'"
            id="editor-textarea"
            class="ce-textarea"
            :value="currentContent"
            @input="onEditorInput"
            spellcheck="false"
            placeholder="开始写点什么……"
          />
          <article
            v-else
            class="ce-preview markdown-body"
            v-html="rendered"
          />
        </div>
      </div>
    </template>

    <EmptyState v-else />
  </main>
</template>

<style scoped>
.center-editor {
  flex: 1;
  display: flex;
  flex-direction: column;
  background: var(--bg-app);
  min-width: 0;
  height: 100%;
}
.ce-header {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-4) var(--space-6);
  background: var(--bg-card);
  border-bottom: 1px solid var(--border-soft);
}
.ce-title {
  flex: 1;
  border: none;
  outline: none;
  background: transparent;
  font-size: var(--fs-lg);
  font-weight: 600;
  color: var(--text-primary);
  padding: 4px 6px;
  border-radius: var(--radius-sm);
  transition: background 0.15s ease;
}
.ce-title:focus {
  background: var(--bg-muted);
}
.ce-actions {
  display: flex;
  align-items: center;
  gap: var(--space-1);
}
.icon-btn {
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-secondary);
  transition: background 0.15s ease, color 0.15s ease;
}
.icon-btn:hover {
  background: var(--bg-muted);
  color: var(--color-brand);
}

.save-status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: var(--fs-xs);
  color: var(--text-muted);
  min-width: 80px;
  user-select: none;
}
.save-status--saving {
  color: var(--color-brand);
}
.save-status--saved {
  color: #10b981;
}
.save-status .loader {
  width: 10px;
  height: 10px;
  border: 2px solid rgba(79, 70, 229, 0.25);
  border-top-color: var(--color-brand);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
.save-status .dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #10b981;
}
.save-status .dot--ok {
  background: #10b981;
}

/* ---------- AI diff 顶部操作条（紧凑版） ---------- */
.ai-diff-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-6);
  border-bottom: 1px solid var(--border-soft);
  background: linear-gradient(
    180deg,
    rgba(99, 102, 241, 0.06) 0%,
    var(--bg-card) 100%
  );
  animation: slideDown 0.25s ease;
}
.ai-diff-bar__title {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--fs-sm);
  font-weight: 600;
  color: var(--text-primary);
}
.ai-diff-bar__title .el-icon {
  color: var(--color-brand);
  font-size: 16px;
}
.ai-diff-bar__stats {
  font-style: normal;
  display: inline-flex;
  gap: 6px;
  margin-left: 4px;
}
.ai-diff-bar__actions {
  display: inline-flex;
  gap: var(--space-2);
}
.diff-stat {
  font-size: 11px;
  font-weight: 600;
  padding: 2px 6px;
  border-radius: 4px;
  font-variant-numeric: tabular-nums;
}
.diff-stat--add {
  color: #047857;
  background: rgba(16, 185, 129, 0.12);
}
.diff-stat--del {
  color: #b91c1c;
  background: rgba(239, 68, 68, 0.12);
}
.ai-diff-panel__actions {
  display: inline-flex;
  gap: var(--space-2);
}
.diff-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 30px;
  padding: 0 12px;
  border: none;
  border-radius: var(--radius-sm);
  font-size: var(--fs-xs);
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
}
.diff-btn--ghost {
  background: transparent;
  color: var(--text-secondary);
  border: 1px solid var(--border-color);
}
.diff-btn--ghost:hover {
  background: var(--bg-muted);
  color: #b91c1c;
  border-color: #b91c1c;
}
.diff-btn--primary {
  background: linear-gradient(
    135deg,
    var(--color-accent-from) 0%,
    var(--color-accent-to) 100%
  );
  color: #fff;
  box-shadow: 0 4px 12px rgba(99, 102, 241, 0.3);
}
.diff-btn--primary:hover {
  transform: translateY(-1px);
  box-shadow: 0 6px 16px rgba(99, 102, 241, 0.42);
}

.ai-diff-panel__body {
  flex: 1;
  overflow-y: auto;
  padding: var(--space-3) var(--space-6);
  font-family: 'Menlo', 'Consolas', 'Monaco', monospace;
  font-size: 13px;
  line-height: 1.65;
}
.diff-part {
  display: block;
}
.diff-part--add {
  background: rgba(16, 185, 129, 0.08);
  border-left: 3px solid #10b981;
  padding-left: 6px;
  margin: 2px 0;
}
.diff-part--del {
  background: rgba(239, 68, 68, 0.06);
  border-left: 3px solid #ef4444;
  padding-left: 6px;
  margin: 2px 0;
  text-decoration: line-through;
  text-decoration-color: rgba(239, 68, 68, 0.45);
  opacity: 0.85;
}
.diff-line {
  display: flex;
  gap: 8px;
  white-space: pre-wrap;
  word-break: break-word;
}
.diff-line__sign {
  width: 14px;
  flex-shrink: 0;
  text-align: center;
  color: var(--text-muted);
  user-select: none;
}
.diff-part--add .diff-line__sign {
  color: #047857;
  font-weight: 700;
}
.diff-part--del .diff-line__sign {
  color: #b91c1c;
  font-weight: 700;
}
.diff-line__text {
  flex: 1;
  min-width: 0;
}
@keyframes slideDown {
  from {
    opacity: 0;
    transform: translateY(-8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* ---------- AI 实时打字预览面板 ---------- */
.ai-stream-panel {
  display: flex;
  flex-direction: column;
  max-height: 40vh;
  border-bottom: 1px solid var(--border-soft);
  background: linear-gradient(
    180deg,
    rgba(99, 102, 241, 0.06) 0%,
    var(--bg-card) 100%
  );
  animation: slideDown 0.2s ease;
}
.ai-stream-panel__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-6);
  border-bottom: 1px dashed var(--border-soft);
  background: var(--bg-card);
}
.ai-stream-panel__title {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--fs-sm);
  font-weight: 600;
  color: var(--color-brand);
  min-width: 0;
}
.ai-stream-panel__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--color-brand);
  box-shadow: 0 0 0 0 rgba(99, 102, 241, 0.4);
  animation: pulse 1.2s infinite;
  flex-shrink: 0;
}
.ai-stream-panel__prompt {
  font-style: normal;
  font-size: var(--fs-xs);
  font-weight: 400;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
  min-width: 0;
}
.ai-stream-panel__counter {
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  color: var(--text-muted);
  background: var(--bg-muted);
  padding: 2px 8px;
  border-radius: 999px;
  flex-shrink: 0;
}
.ai-stream-panel__body {
  flex: 1;
  overflow-y: auto;
  padding: var(--space-3) var(--space-6);
}
.ai-stream-panel__text {
  margin: 0;
  font-family: 'Menlo', 'Consolas', 'Monaco', monospace;
  font-size: 13px;
  line-height: 1.7;
  color: var(--text-primary);
  white-space: pre-wrap;
  word-break: break-word;
}
.ai-stream-panel__text .caret {
  display: inline-block;
  width: 7px;
  height: 14px;
  background: var(--color-brand);
  vertical-align: text-bottom;
  margin-left: 1px;
  animation: blink 1s steps(2) infinite;
}
@keyframes pulse {
  0% {
    box-shadow: 0 0 0 0 rgba(99, 102, 241, 0.45);
  }
  70% {
    box-shadow: 0 0 0 8px rgba(99, 102, 241, 0);
  }
  100% {
    box-shadow: 0 0 0 0 rgba(99, 102, 241, 0);
  }
}
@keyframes blink {
  0%, 50% { opacity: 1; }
  51%, 100% { opacity: 0; }
}

.ce-toolbar {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: var(--space-2) var(--space-6);
  background: var(--bg-card);
  border-bottom: 1px solid var(--border-soft);
  position: relative;
}
.tb-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 30px;
  padding: 0 8px;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-secondary);
  font-size: var(--fs-xs);
  transition: background 0.15s ease, color 0.15s ease;
}
.tb-btn:hover {
  background: var(--bg-muted);
  color: var(--color-brand);
}
.tb-btn--text {
  font-size: 14px;
  font-weight: 700;
}
.tb-divider {
  width: 1px;
  height: 16px;
  background: var(--border-color);
  margin: 0 6px;
}
.tb-tabs {
  margin-left: auto;
  display: inline-flex;
  background: var(--bg-muted);
  border-radius: var(--radius-sm);
  padding: 2px;
}
.tb-tab {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 26px;
  padding: 0 12px;
  border: none;
  border-radius: 6px;
  background: transparent;
  font-size: var(--fs-xs);
  color: var(--text-secondary);
  transition: all 0.15s ease;
}
.tb-tab--active {
  background: var(--bg-card);
  color: var(--color-brand);
  box-shadow: var(--shadow-sm);
}

.ce-body {
  flex: 1;
  overflow-y: auto;
  padding: var(--space-6);
  background: var(--bg-app);
}
.ce-paper {
  max-width: min(760px, 100%);
  width: 100%;
  margin: 0 auto;
  background: var(--bg-paper);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-md);
  overflow: hidden;
  animation: fadeIn 0.2s ease;
}

/* AI diff 视图（替代 textarea）：按行渲染，绿色新增 / 红色删除 / 不变 */
.ce-diff-editor {
  width: 100%;
  min-height: calc(100vh - 240px);
  padding: var(--space-6) var(--space-8);
  font-family: 'Menlo', 'Consolas', 'Monaco', monospace;
  font-size: 14.5px;
  line-height: 1.8;
  color: var(--text-primary);
  background: transparent;
}
.ce-diff-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  white-space: pre-wrap;
  word-break: break-word;
  padding: 0 8px;
  margin: 0 -8px;
  border-radius: 4px;
  min-height: 1.8em;
}
.ce-diff-row--add {
  background: rgba(16, 185, 129, 0.12);
  border-left: 3px solid #10b981;
  color: #065f46;
}
.ce-diff-row--del {
  background: rgba(239, 68, 68, 0.08);
  border-left: 3px solid #ef4444;
  color: #991b1b;
  text-decoration: line-through;
  text-decoration-color: rgba(239, 68, 68, 0.4);
  opacity: 0.9;
}
.ce-diff-row--ctx {
  color: var(--text-secondary);
}
.ce-diff-row__sign {
  flex-shrink: 0;
  width: 14px;
  text-align: center;
  font-weight: 700;
  user-select: none;
}
.ce-diff-row--add .ce-diff-row__sign {
  color: #047857;
}
.ce-diff-row--del .ce-diff-row__sign {
  color: #b91c1c;
}
.ce-diff-row__text {
  flex: 1;
  min-width: 0;
}
.ce-textarea {
  width: 100%;
  min-height: calc(100vh - 240px);
  border: none;
  outline: none;
  resize: none;
  padding: var(--space-6) var(--space-8);
  font-family: 'Menlo', 'Consolas', 'Monaco', monospace;
  font-size: 14.5px;
  line-height: 1.8;
  color: var(--text-primary);
  background: transparent;
  display: block;
}
.ce-preview {
  padding: var(--space-6) var(--space-8);
  min-height: calc(100vh - 240px);
  line-height: 1.8;
  color: var(--text-primary);
  font-size: 15px;
}
:deep(.markdown-body h1),
:deep(.markdown-body h2),
:deep(.markdown-body h3) {
  margin: 1.4em 0 0.6em;
  line-height: 1.3;
}
:deep(.markdown-body h1) {
  font-size: 1.8em;
  border-bottom: 1px solid var(--border-soft);
  padding-bottom: 0.3em;
}
:deep(.markdown-body h2) {
  font-size: 1.4em;
}
:deep(.markdown-body h3) {
  font-size: 1.15em;
}
:deep(.markdown-body p) {
  margin: 0.8em 0;
}
:deep(.markdown-body ul),
:deep(.markdown-body ol) {
  padding-left: 1.5em;
  margin: 0.8em 0;
  list-style: revert;
}
:deep(.markdown-body code) {
  background: var(--bg-muted);
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 0.9em;
  font-family: 'Menlo', 'Consolas', 'Monaco', monospace;
}
:deep(.markdown-body pre) {
  background: #1f2937;
  color: #f3f4f6;
  padding: var(--space-4);
  border-radius: var(--radius-md);
  overflow-x: auto;
}
:deep(.markdown-body pre code) {
  background: transparent;
  padding: 0;
  color: inherit;
}
:deep(.markdown-body blockquote) {
  border-left: 4px solid var(--color-brand);
  padding: 4px var(--space-3);
  background: var(--color-brand-light);
  margin: 1em 0;
  color: var(--text-secondary);
  border-radius: 0 var(--radius-sm) var(--radius-sm) 0;
}
:deep(.markdown-body a) {
  color: var(--color-brand);
  border-bottom: 1px solid rgba(79, 70, 229, 0.3);
}
:deep(.markdown-body img) {
  max-width: 100%;
  border-radius: var(--radius-md);
}
:deep(.markdown-body table) {
  border-collapse: collapse;
  margin: 1em 0;
  width: 100%;
}
:deep(.markdown-body th),
:deep(.markdown-body td) {
  border: 1px solid var(--border-color);
  padding: var(--space-2) var(--space-3);
  text-align: left;
}

@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(4px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
</style>
