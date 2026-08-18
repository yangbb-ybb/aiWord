<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { Plus, Document, ChatLineRound, Tickets } from '@element-plus/icons-vue'
import {
  useDocumentStore,
  PLATFORMS,
  type DocumentItem,
  type Platform
} from '@/stores/document'

const store = useDocumentStore()

const recentDocs = computed(() => store.documents)

onMounted(() => {
  // 进入工作台时并行拉取：文档列表 + 模板列表
  store.loadDocuments()
  store.loadTemplates()
})

function formatDate(iso: string) {
  const d = new Date(iso)
  return `${d.getMonth() + 1}-${String(d.getDate()).padStart(2, '0')} ${String(
    d.getHours()
  ).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function platformLabel(p: Platform) {
  return PLATFORMS.find((x) => x.key === p)?.label ?? p
}

function handleNew() {
  store.createNew()
}

function handleOpen(doc: DocumentItem) {
  store.open(doc.id)
}

function handleTemplate(id: string) {
  store.applyTemplate(id)
}
</script>

<template>
  <aside class="left-sidebar">
    <div class="left-sidebar__inner">
      <button class="primary-btn" @click="handleNew">
        <el-icon><Plus /></el-icon>
        <span>新建文档</span>
      </button>

      <section class="group">
        <header class="group__title">
          <el-icon><Document /></el-icon>
          <span>最近</span>
          <em class="group__count">{{ recentDocs.length }}</em>
        </header>

        <div v-if="store.documentsLoading" class="template-empty">
          <span class="loader" />
          <span>正在加载文档…</span>
        </div>

        <div
          v-else-if="store.documentsLoaded && recentDocs.length === 0"
          class="template-empty"
        >
          <span>暂无文档，点击上方"新建文档"开始</span>
        </div>

        <ul v-else class="doc-list">
          <li
            v-for="doc in recentDocs"
            :key="doc.id"
            class="doc-item"
            :class="{ 'doc-item--active': store.currentId === doc.id }"
            @click="handleOpen(doc)"
          >
            <div class="doc-item__title">{{ doc.title }}</div>
            <div class="doc-item__excerpt">{{ doc.excerpt || '（空）' }}</div>
            <div class="doc-item__meta">
              <span class="doc-item__time">{{ formatDate(doc.updatedAt) }}</span>
              <span
                v-for="p in doc.platforms.slice(0, 2)"
                :key="p"
                class="doc-item__tag"
                :style="{ color: `var(--color-${p})` }"
              >
                #{{ platformLabel(p) }}
              </span>
            </div>
          </li>
        </ul>
      </section>

      <section class="group">
        <header class="group__title">
          <el-icon><Tickets /></el-icon>
          <span>模板</span>
        </header>

        <div v-if="store.templatesLoading" class="template-empty">
          <span class="loader" />
          <span>正在加载模板…</span>
        </div>

        <div
          v-else-if="store.templatesLoaded && store.templates.length === 0"
          class="template-empty"
        >
          <span>暂无模板，请联系管理员配置</span>
        </div>

        <ul v-else class="template-list">
          <li
            v-for="tpl in store.templates"
            :key="tpl.id"
            class="template-item"
            :class="{
              'template-item--selected': store.selectedTemplateId === tpl.id
            }"
            @click="handleTemplate(tpl.id)"
          >
            <span class="template-item__emoji">{{ tpl.emoji }}</span>
            <div class="template-item__body">
              <div class="template-item__name">{{ tpl.name }}</div>
              <div class="template-item__desc">{{ tpl.description }}</div>
            </div>
          </li>
        </ul>
      </section>

      <footer class="hint">
        <el-icon><ChatLineRound /></el-icon>
        <span>文档已与账号绑定，仅自己可见</span>
      </footer>
    </div>
  </aside>
</template>

<style scoped>
.left-sidebar {
  height: 100%;
  background: var(--bg-sidebar);
  border-right: 1px solid var(--border-soft);
  overflow-y: auto;
}
.left-sidebar__inner {
  padding: var(--space-5) var(--space-4);
  display: flex;
  flex-direction: column;
  gap: var(--space-5);
}
.primary-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  height: 40px;
  border: none;
  border-radius: var(--radius-md);
  font-size: var(--fs-base);
  font-weight: 600;
  color: #fff;
  background: linear-gradient(
    135deg,
    var(--color-accent-from) 0%,
    var(--color-accent-to) 100%
  );
  box-shadow: 0 6px 18px rgba(99, 102, 241, 0.32);
  transition: transform 0.15s ease, box-shadow 0.15s ease;
}
.primary-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 8px 22px rgba(99, 102, 241, 0.42);
}
.group {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
}
.group__title {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--fs-xs);
  font-weight: 600;
  color: var(--text-muted);
  letter-spacing: 0.5px;
  text-transform: uppercase;
  padding: 0 var(--space-1);
}
.group__count {
  margin-left: auto;
  font-style: normal;
  background: var(--bg-muted);
  color: var(--text-secondary);
  padding: 1px 6px;
  border-radius: 999px;
  font-size: 11px;
}
.doc-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.doc-item {
  padding: var(--space-3);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: background 0.15s ease;
  border: 1px solid transparent;
}
.doc-item:hover {
  background: var(--bg-muted);
}
.doc-item--active {
  background: var(--color-brand-light);
  border-color: rgba(79, 70, 229, 0.18);
}
.doc-item__title {
  font-size: var(--fs-base);
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.doc-item__excerpt {
  font-size: var(--fs-xs);
  color: var(--text-muted);
  margin-bottom: var(--space-2);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.doc-item__meta {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: 11px;
  color: var(--text-muted);
  flex-wrap: wrap;
}
.doc-item__time {
  font-variant-numeric: tabular-nums;
}
.doc-item__tag {
  font-weight: 500;
}
.template-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.template-empty {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: var(--space-3);
  font-size: var(--fs-xs);
  color: var(--text-muted);
  background: var(--bg-muted);
  border-radius: var(--radius-md);
}
.template-empty .loader {
  width: 12px;
  height: 12px;
  border: 2px solid rgba(99, 102, 241, 0.25);
  border-top-color: var(--color-brand);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  flex-shrink: 0;
}
.template-item {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: background 0.15s ease;
}
.template-item:hover {
  background: var(--bg-muted);
}
.template-item--selected {
  background: var(--color-brand-light);
  border: 1px solid rgba(79, 70, 229, 0.25);
}
.template-item--selected:hover {
  background: var(--color-brand-light);
}
.template-item__emoji {
  font-size: 22px;
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  background: var(--bg-muted);
  border-radius: var(--radius-sm);
}
.template-item__name {
  font-size: var(--fs-base);
  font-weight: 500;
  color: var(--text-primary);
}
.template-item__desc {
  font-size: var(--fs-xs);
  color: var(--text-muted);
  margin-top: 2px;
}
.hint {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--fs-xs);
  color: var(--text-muted);
  padding: var(--space-3);
  background: var(--bg-muted);
  border-radius: var(--radius-md);
}
</style>
