<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import {
  Plus,
  Document,
  ChatLineRound,
  Tickets,
  Delete,
  RefreshLeft,
  CircleClose
} from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  useDocumentStore,
  PLATFORMS,
  type DocumentItem,
  type Platform
} from '@/stores/document'
import { ApiError } from '@/services/api'

const store = useDocumentStore()

const recentDocs = computed(() => store.documents)
const trashDocs = computed(() => store.deletedDocuments)
/** 回收站是否展开：默认折叠，避免列表很长时占太多视线 */
const trashOpen = ref(false)

/** 回收站保留期（与后端 purgeOldDocuments 默认值一致） */
const TRASH_KEEP_DAYS = 30

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

/**
 * 计算"还有 X 天彻底清理"。
 * - 删了 ≤ 24 小时：显示"X 小时前删除"
 * - 否则：显示"X 天后清理"
 */
function trashRemaining(iso: string): string {
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return ''
  const diffMs = Date.now() - t
  const hours = Math.floor(diffMs / (60 * 60 * 1000))
  if (hours < 24) return `${hours} 小时前删除`
  const remainDays = TRASH_KEEP_DAYS - Math.floor(hours / 24)
  return remainDays > 0 ? `${remainDays} 天后清理` : '即将清理'
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

/**
 * 删除文档 → 软删除（移入回收站）：
 * - 先弹 ElMessageBox 二次确认（避免误删）
 * - 确认后调 store.deleteDocument，乐观更新 + 失败回滚由 store 负责
 * - 阻止冒泡，避免点删除时触发打开文档
 */
async function handleDelete(doc: DocumentItem, e: Event) {
  e.stopPropagation()
  try {
    await ElMessageBox.confirm(
      `确定将「${doc.title || '未命名文档'}」移入回收站吗？\n回收站中的文档 30 天内可恢复。`,
      '删除文档',
      {
        type: 'warning',
        confirmButtonText: '移入回收站',
        cancelButtonText: '取消',
        confirmButtonClass: 'el-button--danger'
      }
    )
  } catch {
    // 用户点了取消
    return
  }
  try {
    await store.deleteDocument(doc.id)
    ElMessage.success('已移入回收站，可在左侧"回收站"中恢复')
  } catch (err) {
    const msg = err instanceof ApiError ? err.message : '删除失败，请稍后再试'
    ElMessage.error(msg)
  }
}

/**
 * 恢复一篇回收站文档（轻量提示，不再弹二次确认）。
 */
async function handleRestore(doc: DocumentItem, e: Event) {
  e.stopPropagation()
  try {
    await store.restoreDocument(doc.id)
    ElMessage.success('已恢复')
  } catch (err) {
    const msg = err instanceof ApiError ? err.message : '恢复失败，请稍后再试'
    ElMessage.error(msg)
  }
}

/**
 * 彻底删除回收站文档（**物理删除，不可恢复**）：
 * - 二次确认文案必须够强，避免误操作
 */
async function handlePurge(doc: DocumentItem, e: Event) {
  e.stopPropagation()
  try {
    await ElMessageBox.confirm(
      `确定彻底删除「${doc.title || '未命名文档'}」吗？\n该操作不可撤销，数据库里的内容也会一并清除。`,
      '彻底删除',
      {
        type: 'warning',
        confirmButtonText: '彻底删除',
        cancelButtonText: '取消',
        confirmButtonClass: 'el-button--danger'
      }
    )
  } catch {
    return
  }
  try {
    await store.purgeDocument(doc.id)
    ElMessage.success('已彻底删除')
  } catch (err) {
    const msg = err instanceof ApiError ? err.message : '彻底删除失败，请稍后再试'
    ElMessage.error(msg)
  }
}

function toggleTrash() {
  trashOpen.value = !trashOpen.value
  // 第一次展开时才拉回收站，避免无意义的请求
  if (trashOpen.value && !store.deletedLoaded) {
    store.loadDeletedDocuments()
  }
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
            <button
              class="doc-item__delete"
              type="button"
              title="删除文档"
              aria-label="删除文档"
              @click="handleDelete(doc, $event)"
            >
              <el-icon><Delete /></el-icon>
            </button>
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

      <section class="group">
        <header
          class="group__title group__title--clickable"
          @click="toggleTrash"
        >
          <el-icon><Delete /></el-icon>
          <span>回收站</span>
          <em class="group__count">{{ trashDocs.length }}</em>
          <span class="group__toggle">
            {{ trashOpen ? '收起' : '展开' }}
          </span>
        </header>

        <div v-if="!trashOpen" />

        <template v-else>
          <div v-if="store.deletedLoading" class="template-empty">
            <span class="loader" />
            <span>正在加载回收站…</span>
          </div>

          <div
            v-else-if="store.deletedLoaded && trashDocs.length === 0"
            class="template-empty"
          >
            <span>回收站是空的，30 天内的删除都会出现在这里</span>
          </div>

          <ul v-else class="trash-list">
            <li
              v-for="doc in trashDocs"
              :key="doc.id"
              class="trash-item"
            >
              <div class="trash-item__title">{{ doc.title || '未命名文档' }}</div>
              <div class="trash-item__meta">
                <span class="trash-item__time">
                  {{ doc.deletedAt ? trashRemaining(doc.deletedAt) : '' }}
                </span>
              </div>
              <div class="trash-item__actions">
                <button
                  class="trash-item__btn trash-item__btn--restore"
                  type="button"
                  title="恢复文档"
                  @click="handleRestore(doc, $event)"
                >
                  <el-icon><RefreshLeft /></el-icon>
                  <span>恢复</span>
                </button>
                <button
                  class="trash-item__btn trash-item__btn--purge"
                  type="button"
                  title="彻底删除"
                  @click="handlePurge(doc, $event)"
                >
                  <el-icon><CircleClose /></el-icon>
                  <span>彻底删除</span>
                </button>
              </div>
            </li>
          </ul>
        </template>
      </section>
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
  position: relative;
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
/* 删除按钮：默认透明隐藏，hover 时浮现；激活态始终可见方便操作 */
.doc-item__delete {
  position: absolute;
  top: 6px;
  right: 6px;
  width: 22px;
  height: 22px;
  border: none;
  background: transparent;
  color: var(--text-muted);
  border-radius: 6px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  opacity: 0;
  transition: opacity 0.12s ease, background 0.12s ease, color 0.12s ease;
}
.doc-item:hover .doc-item__delete,
.doc-item__delete:focus-visible {
  opacity: 1;
}
.doc-item--active .doc-item__delete {
  opacity: 0.7;
}
.doc-item__delete:hover {
  background: rgba(239, 68, 68, 0.12);
  color: #ef4444;
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

/* ---- 回收站 ---- */
.group__title--clickable {
  cursor: pointer;
  user-select: none;
  transition: color 0.12s ease;
}
.group__title--clickable:hover {
  color: var(--text-secondary);
}
.group__toggle {
  margin-left: 6px;
  font-size: 11px;
  color: var(--text-muted);
  font-style: normal;
}
.trash-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.trash-item {
  padding: var(--space-3);
  border-radius: var(--radius-md);
  background: var(--bg-muted);
  border: 1px dashed var(--border-color, var(--border-soft));
}
.trash-item__title {
  font-size: var(--fs-base);
  font-weight: 500;
  color: var(--text-secondary);
  margin-bottom: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.trash-item__meta {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: 11px;
  color: var(--text-muted);
  margin-bottom: var(--space-2);
}
.trash-item__time {
  font-variant-numeric: tabular-nums;
}
.trash-item__actions {
  display: flex;
  gap: 6px;
}
.trash-item__btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border: 1px solid var(--border-soft);
  background: var(--bg-card, #fff);
  color: var(--text-secondary);
  border-radius: var(--radius-sm);
  font-size: var(--fs-xs);
  cursor: pointer;
  transition: border-color 0.12s ease, color 0.12s ease, background 0.12s ease;
}
.trash-item__btn:hover {
  border-color: var(--color-brand);
  color: var(--color-brand);
}
.trash-item__btn--purge:hover {
  border-color: #ef4444;
  color: #ef4444;
  background: rgba(239, 68, 68, 0.06);
}
</style>
