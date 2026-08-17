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
  List
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

      <div class="ce-body">
        <div class="ce-paper" :key="store.currentId">
          <textarea
            v-if="activeTab === 'edit'"
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
