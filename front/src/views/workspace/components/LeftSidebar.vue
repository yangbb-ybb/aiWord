<script setup lang="ts">
import { computed } from 'vue'
import { Plus, Document, ChatLineRound, Tickets } from '@element-plus/icons-vue'
import {
  useDocumentStore,
  PLATFORMS,
  type DocumentItem,
  type Platform
} from '@/stores/document'

const store = useDocumentStore()

const recentDocs = computed(() => store.documents)

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
        <ul class="doc-list">
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
        <ul class="template-list">
          <li
            v-for="tpl in store.templates"
            :key="tpl.id"
            class="template-item"
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
        <span>点击模板会在新文档里套用内容</span>
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
