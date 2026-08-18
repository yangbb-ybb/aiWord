<script setup lang="ts">
import { onMounted, ref } from 'vue'
import {
  MagicStick,
  Position,
  Share,
  Bell
} from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useDocumentStore } from '@/stores/document'
import { api, ApiError } from '@/services/api'
import PlatformChips from './PlatformChips.vue'

interface AiModel {
  id: string
  label: string
}

const store = useDocumentStore()

const model = ref('claude-sonnet')
const tone = ref('formal')
const length = ref(50)
const language = ref('zh')
const prompt = ref('')

const modelOptions = ref<{ label: string; value: string }[]>([])
const providerName = ref('minimax')
const loadingModels = ref(false)

const toneOptions = [
  { label: '正式', value: 'formal' },
  { label: '口语', value: 'casual' },
  { label: '营销', value: 'marketing' },
  { label: '技术', value: 'technical' }
]
const langOptions = [
  { label: '中文', value: 'zh' },
  { label: 'English', value: 'en' },
  { label: '中英混合', value: 'mixed' }
]

const presetPrompts = [
  '帮我写一篇关于 Vite 6 新特性的公众号文章',
  '总结本周产品迭代，要求 800 字以内',
  '把下面的代码片段写成一个技术教程',
  '用轻松的口吻介绍 TypeScript 5.5'
]

/** 启动时拉一次模型列表，挂掉时给个降级默认值，不阻塞 UI */
async function loadModels() {
  loadingModels.value = true
  try {
    const res = await api.get<{ provider: string; models: AiModel[] }>('/api/ai/models')
    providerName.value = res.provider
    modelOptions.value = res.models.map((m) => ({ label: m.label, value: m.id }))
    if (modelOptions.value.length && !modelOptions.value.some((o) => o.value === model.value)) {
      model.value = modelOptions.value[0].value
    }
  } catch (e) {
    const msg = e instanceof ApiError ? e.message : '模型列表加载失败'
    ElMessage.warning(`${msg}（已使用默认模型）`)
    // 兜底：保证下拉至少有一条
    if (!modelOptions.value.length) {
      modelOptions.value = [{ label: 'minimax · Sonnet（推荐）', value: 'claude-sonnet' }]
      providerName.value = 'minimax'
    }
  } finally {
    loadingModels.value = false
  }
}

onMounted(loadModels)

function applyPreset(p: string) {
  prompt.value = p
}

async function handleGenerate() {
  if (!store.current) {
    ElMessage.warning('请先选择或创建文档')
    return
  }
  if (!prompt.value.trim() && !store.current.content?.trim()) {
    ElMessage.warning('请填写 Prompt 或先有正文')
    return
  }
  try {
    await store.generate({
      prompt: prompt.value,
      model: model.value,
      tone: tone.value,
      length: length.value,
      language: language.value
    })
    ElMessage.success('AI 已生成，请到编辑器审阅改动 ✦')
  } catch (e) {
    const msg = e instanceof ApiError ? `${e.code} · ${e.message}` : '生成失败，请稍后再试'
    ElMessage.error(msg)
  }
}

async function handlePublish() {
  if (!store.current) {
    ElMessage.warning('请先选择或创建文档')
    return
  }
  if (!store.current.content?.trim()) {
    ElMessage.warning('文档内容为空，无法发布')
    return
  }
  if (store.selectedPlatforms.length === 0) {
    ElMessage.warning('请至少选择一个发布渠道')
    return
  }
  try {
    await ElMessageBox.confirm(
      `确认发布到 ${store.selectedPlatforms.length} 个渠道？\n\n（发布通道将在第二阶段对接）`,
      '发布确认',
      {
        confirmButtonText: '发布',
        cancelButtonText: '取消',
        type: 'info'
      }
    )
    ElMessage.success('已加入发布队列，第二阶段将接通真实 API')
  } catch {
    // 用户取消
  }
}
</script>

<template>
  <aside class="right-panel">
    <div class="rp-inner">
      <!-- AI 配置 -->
      <section class="block">
        <header class="block__head">
          <el-icon class="block__icon"><MagicStick /></el-icon>
          <span class="block__title">AI 生成配置</span>
          <span class="block__hint">TODO[stage2]</span>
        </header>

        <div class="field">
          <label class="field__label">模型</label>
          <el-select v-model="model" class="field__control" size="default">
            <el-option
              v-for="o in modelOptions"
              :key="o.value"
              :label="o.label"
              :value="o.value"
            />
          </el-select>
        </div>

        <div class="field">
          <label class="field__label">风格</label>
          <el-radio-group v-model="tone" size="default" class="field__control">
            <el-radio-button
              v-for="o in toneOptions"
              :key="o.value"
              :value="o.value"
            >
              {{ o.label }}
            </el-radio-button>
          </el-radio-group>
        </div>

        <div class="field">
          <label class="field__label">长度</label>
          <div class="field__slider">
            <el-slider v-model="length" :min="0" :max="100" :step="25" :show-tooltip="false" />
            <div class="slider-ticks">
              <span :class="{ active: length < 25 }">短</span>
              <span :class="{ active: length >= 25 && length < 50 }">中</span>
              <span :class="{ active: length >= 50 && length < 75 }">中长</span>
              <span :class="{ active: length >= 75 }">长</span>
            </div>
          </div>
        </div>

        <div class="field">
          <label class="field__label">语言</label>
          <el-radio-group v-model="language" size="default" class="field__control">
            <el-radio-button
              v-for="o in langOptions"
              :key="o.value"
              :value="o.value"
            >
              {{ o.label }}
            </el-radio-button>
          </el-radio-group>
        </div>

        <div class="field">
          <label class="field__label">Prompt</label>
          <textarea
            v-model="prompt"
            class="field__textarea"
            rows="4"
            placeholder="描述你想写什么，例如：帮我写一篇关于 Vite 6 新特性的公众号文章……"
          />
        </div>

        <div class="presets">
          <button
            v-for="(p, i) in presetPrompts"
            :key="i"
            class="preset-chip"
            type="button"
            @click="applyPreset(p)"
          >
            {{ p }}
          </button>
        </div>

        <button
          class="generate-btn"
          :disabled="store.isGenerating"
          @click="handleGenerate"
        >
          <el-icon v-if="!store.isGenerating"><MagicStick /></el-icon>
          <span v-if="store.isGenerating" class="loader" />
          <span>{{ store.isGenerating ? 'AI 正在创作…' : '一键生成' }}</span>
        </button>
      </section>

      <!-- 发布渠道 -->
      <!-- <section class="block">
        <header class="block__head">
          <el-icon class="block__icon"><Position /></el-icon>
          <span class="block__title">发布渠道</span>
        </header>

        <p class="block__tip">
          <el-icon><Bell /></el-icon>
          <span>当前已选 <strong>{{ store.selectedPlatforms.length }}</strong> / 4</span>
        </p>

        <PlatformChips />

        <button class="publish-btn" @click="handlePublish">
          <el-icon><Share /></el-icon>
          <span>一键发布</span>
        </button>
        <p class="publish-hint">
          发布通道将在第二阶段接入（OAuth + 各平台 API）
        </p>
      </section> -->
    </div>
  </aside>
</template>

<style scoped>
.right-panel {
  height: 100%;
  background: var(--bg-card);
  border-left: 1px solid var(--border-soft);
  overflow-y: auto;
}
.rp-inner {
  padding: var(--space-5);
  display: flex;
  flex-direction: column;
  gap: var(--space-6);
}

.block {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
}
.block__head {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  margin-bottom: 2px;
}
.block__icon {
  font-size: 16px;
  color: var(--color-brand);
}
.block__title {
  font-size: var(--fs-base);
  font-weight: 600;
  color: var(--text-primary);
}
.block__hint {
  margin-left: auto;
  font-size: 11px;
  color: var(--color-warning);
  background: rgba(245, 158, 11, 0.1);
  padding: 2px 6px;
  border-radius: 4px;
}
.block__tip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: var(--fs-xs);
  color: var(--text-muted);
  margin: 0;
}
.block__tip strong {
  color: var(--color-brand);
}

.field {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
}
.field__label {
  font-size: var(--fs-xs);
  font-weight: 500;
  color: var(--text-muted);
}
.field__control {
  width: 100%;
}
.field__slider {
  width: 100%;
}
.field__textarea {
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  padding: var(--space-2) var(--space-3);
  font-size: var(--fs-sm);
  color: var(--text-primary);
  resize: vertical;
  outline: none;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
  font-family: inherit;
}
.field__textarea:focus {
  border-color: var(--color-brand);
  box-shadow: 0 0 0 3px rgba(79, 70, 229, 0.12);
}

.slider-ticks {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: var(--text-muted);
  margin-top: -10px;
}
.slider-ticks span {
  position: relative;
  padding-top: 4px;
}
.slider-ticks span.active {
  color: var(--color-brand);
  font-weight: 600;
}

.presets {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.preset-chip {
  font-size: var(--fs-xs);
  padding: 4px 10px;
  border-radius: 999px;
  border: 1px dashed var(--border-color);
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
  transition: all 0.15s ease;
}
.preset-chip:hover {
  border-color: var(--color-brand);
  color: var(--color-brand);
  background: var(--color-brand-light);
}

.generate-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  height: 44px;
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
  transition: transform 0.15s ease, box-shadow 0.15s ease, opacity 0.15s ease;
}
.generate-btn:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 8px 22px rgba(99, 102, 241, 0.45);
}
.generate-btn:disabled {
  opacity: 0.75;
  cursor: not-allowed;
}
.loader {
  width: 14px;
  height: 14px;
  border: 2px solid rgba(255, 255, 255, 0.4);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.publish-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  height: 40px;
  border: 1px solid var(--color-brand);
  border-radius: var(--radius-md);
  background: var(--bg-card);
  color: var(--color-brand);
  font-size: var(--fs-sm);
  font-weight: 600;
  transition: all 0.15s ease;
}
.publish-btn:hover {
  background: var(--color-brand-light);
}
.publish-hint {
  margin: 0;
  font-size: 11px;
  color: var(--text-muted);
  text-align: center;
}

/* 紧凑 Element Plus 风格调整 */
:deep(.el-radio-button__inner) {
  padding: 6px 10px;
  font-size: var(--fs-xs);
}
:deep(.el-select),
:deep(.el-select-v2) {
  width: 100%;
}
:deep(.el-slider__runway) {
  margin: 14px 0 4px;
}
</style>
