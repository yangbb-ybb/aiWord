<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import {
  MagicStick,
  Position,
  Share,
  Bell,
  ChatDotRound,
  Delete,
  Check,
  EditPen,
  Promotion,
  Close
} from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import MarkdownIt from 'markdown-it'
import {
  useDocumentStore,
  type ChatMessage,
  type ChatChoice,
  parseChoices
} from '@/stores/document'
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
/** Prompt 为空时按钮直接置灰，从源头避免空请求；与 handleGenerate 里的兜底判断保持一致 */
const canGenerate = computed(() => !store.isGenerating && prompt.value.trim().length > 0)

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
  '用轻松的口吻介绍 TypeScript 5.5',
  '你能做什么？' // 闲聊类提示，让用户看到"非改写"分支
]

/** Markdown 渲染实例（用于 AI 的聊天回复） */
const md = new MarkdownIt({
  html: false,
  breaks: true,
  linkify: true
})

/** 当前文档的对话流 */
const chatMessages = computed<ChatMessage[]>(() => {
  const id = store.current?.id
  if (!id) return []
  return store.chatThread.get(id) ?? []
})

/** 当前是否处于"聊天模式"的实时流式（AI 打字中） */
const isChatStreaming = computed(
  () =>
    store.isGenerating &&
    store.streamingPreview?.mode === 'chat' &&
    store.streamingPreview?.docId === store.current?.id
)
/** 当前流式中累积的聊天文本 */
const streamingChatText = computed(() => {
  const sp = store.streamingPreview
  if (!isChatStreaming.value || !sp) return ''
  return sp.accumulated
})

/**
 * "AI 选项"弹窗：当 AI 的回复里能解析出"路径 A/B/C"等选项时，
 * 自动弹出独立的居中弹窗让用户一键挑一个继续聊。
 * 不再把按钮塞进聊天气泡里，避免挤压气泡布局 / 文字穿透。
 */
const activeChoiceMsgId = ref<string | null>(null)

/** 找出当前正在弹的选项所属的消息 */
const activeChoiceMsg = computed<ChatMessage | null>(() => {
  const id = activeChoiceMsgId.value
  if (!id) return null
  return chatMessages.value.find((m) => m.id === id) ?? null
})

/** 当前弹窗里要展示的选项列表（来自对应消息的正文） */
const activeChoices = computed<ChatChoice[]>(() => {
  const m = activeChoiceMsg.value
  if (!m) return []
  return choicesOf(m)
})

/**
 * el-dialog 用 v-model 控制开关。包一层 computed 把"是否有活跃选项"映射成 boolean，
 * 用户点 X / 遮罩 / Esc 关闭时（el-dialog 会把 modelValue 置 false）→ 同步清掉 activeChoiceMsgId。
 */
const choiceDialogOpen = computed<boolean>({
  get: () => activeChoiceMsgId.value !== null,
  set: (open) => {
    if (!open) activeChoiceMsgId.value = null
  }
})

/** 关闭选项弹窗（用户点 X 或遮罩） */
function dismissChoice() {
  activeChoiceMsgId.value = null
}

/** 用户在弹窗里挑了一个选项：先关弹窗，再把选项当下一轮 prompt 发出去 */
async function pickChoice(c: ChatChoice) {
  activeChoiceMsgId.value = null
  await handleChoice(c)
}

/**
 * 监听聊天列表变化：
 * - 当新追加的 assistant 消息（kind=chat）里能解析出选项时，自动弹出选项弹窗
 * - 这样用户不用先去气泡里找按钮，AI 给了选择就直接弹出来
 */
watch(
  () => chatMessages.value.map((m) => `${m.role}:${m.kind ?? ''}:${m.id}`).join('|'),
  () => {
    // 已经在生成时不要抢戏（用户正在等 AI 回复，避免弹窗反复抖动）
    if (store.isGenerating) return
    const thread = chatMessages.value
    for (let i = thread.length - 1; i >= 0; i--) {
      const m = thread[i]
      // 必须同时满足：能解析出选项 + 真的是在反问/把选择权交回给用户
      // 仅"能解析出选项"不够 —— AI 经常在完整答案后列举对比，不该弹窗干扰
      if (m.role === 'assistant' && shouldShowChoiceDialog(m) && choicesOf(m).length >= 1) {
        // 已经为这条消息弹过就不再重复弹（id 不一致才更新）
        if (activeChoiceMsgId.value !== m.id) activeChoiceMsgId.value = m.id
        return
      }
    }
  }
)

/** 聊天列表滚动容器 */
const chatListRef = ref<HTMLElement | null>(null)

/**
 * 自动滚动聊天列表到最底部：
 * - 仅在距离底部 ≤ 80px 时强制滚（避免抢走用户手动上滑浏览历史的滚动）
 * - watch 监听消息数量 + 实时流文本变化
 */
async function scrollChatToBottom() {
  await nextTick()
  const el = chatListRef.value
  if (!el) return
  const distance = el.scrollHeight - el.scrollTop - el.clientHeight
  if (distance <= 80) {
    el.scrollTop = el.scrollHeight
  }
}

watch(
  () => chatMessages.value.length,
  () => scrollChatToBottom()
)
watch(streamingChatText, () => scrollChatToBottom())

/** 编辑消息的"行级增减行数"统计（从 postContent 和原内容差异大致估算） */
function editMsgStats(_msg: ChatMessage): { added: number; removed: number } {
  // 这里简单返回 0，让 UI 显示"+ 编辑"，真实统计可后续接 diffLines
  return { added: 0, removed: 0 }
}

async function handleClearChat() {
  try {
    await ElMessageBox.confirm('清空当前文档的 AI 对话历史？', '确认', {
      confirmButtonText: '清空',
      cancelButtonText: '取消',
      type: 'warning'
    })
    store.clearChatHistory()
    ElMessage.success('已清空对话历史')
  } catch {
    /* 用户取消 */
  }
}

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
  // prompt 必须有内容才能发起请求：避免"空 query"打到后端浪费 token，
  // 也避免已有正文 + 空 prompt 的歧义请求让 AI 自由发挥产生不可控输出。
  if (!prompt.value.trim()) {
    ElMessage.warning('请填写 Prompt')
    return
  }
  const userPrompt = prompt.value
  // 先清空输入框，让用户感觉到"消息已发出"
  prompt.value = ''
  try {
    const result = await store.generate({
      prompt: userPrompt,
      model: model.value,
      tone: tone.value,
      length: length.value,
      language: language.value
    })
    // 编辑模式：弹个 toast 引导用户去审阅 diff；聊天模式不打扰，气泡自动出现在右栏
    if (result.mode === 'edit') {
      ElMessage.success('AI 已生成，请到编辑器审阅改动 ✦')
    }
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

/** 给一段 markdown 字符串生成 HTML（聊天气泡用） */
function renderMd(text: string): string {
  return md.render(text || '')
}

/**
 * 处理"应用到文档"按钮：把 AI 的建议作为 edit 指令重新发起生成。
 * - 用户已经在建议气泡里看到了评价；点这个 = 同意按建议改
 * - 走 forceMode='edit'，所以会进 pendingDiff 而不是再走一次 analyze
 */
async function handleApplySuggestion(msg: ChatMessage) {
  if (!store.current) {
    ElMessage.warning('请先选择或创建文档')
    return
  }
  if (store.isGenerating) return
  try {
    await store.applySuggestion(msg.id, store.current.id)
    ElMessage.success('已按建议重写，请在编辑器审阅改动 ✦')
  } catch (e) {
    const errMsg = e instanceof ApiError ? `${e.code} · ${e.message}` : '应用失败，请稍后再试'
    ElMessage.error(errMsg)
  }
}

/**
 * 用户在弹窗里挑了一个选项：把"选项 + 之前用户问的问题"合成新 prompt 发给 AI 续聊。
 * - 必须拼上原问题：AI 只看到"路径 A"不知道你想干嘛，回答必然又吐出选项 → 死循环
 * - 强制 forceMode='chat'：避免 AI 把"用户选了 X"误判成 edit，去推一份完整新文档
 * - 不走 prompt 输入框，绕过用户手动复制粘贴
 */
async function handleChoice(choice: ChatChoice) {
  if (!store.current) {
    ElMessage.warning('请先选择或创建文档')
    return
  }
  if (store.isGenerating) return

  // 1) 从当前 chatThread 里找出"弹出这个选项"的 AI 消息之前的最近一条 user 消息
  //    —— 用户原始问题是基于这个；不带上下文 AI 一定会再吐一份 A/B/C 回来
  const docId = store.current.id
  const thread = store.chatThread.get(docId) ?? []
  const choiceMsgId = activeChoiceMsgId.value
  let userPrompt = ''
  if (choiceMsgId) {
    const idx = thread.findIndex((m) => m.id === choiceMsgId)
    if (idx >= 0) {
      for (let i = idx - 1; i >= 0; i--) {
        if (thread[i].role === 'user') {
          userPrompt = thread[i].content
          break
        }
      }
    }
  }
  // 2) 合成明确指令：原问题 + 用户的选择
  const composed = userPrompt
    ? `针对问题"${userPrompt}"，我选「${choice.label}」：${choice.description}。请继续。`
    : `我选「${choice.label}」：${choice.description}。请继续。`

  try {
    await store.generate({
      prompt: composed,
      model: model.value,
      tone: tone.value,
      length: length.value,
      language: language.value,
      forceMode: 'chat' // 明确告诉前端"这是聊天不是改文档"
    })
  } catch (e) {
    const errMsg = e instanceof ApiError ? `${e.code} · ${e.message}` : '续聊失败，请稍后再试'
    ElMessage.error(errMsg)
  }
}

/**
 * 计算某条 AI 消息里可解析的选项。
 * 只对 chat / analyze 两种非编辑类消息生效（编辑类已经在 diff 流程里）。
 */
function choicesOf(msg: ChatMessage): ChatChoice[] {
  if (msg.role !== 'assistant') return []
  if (msg.kind === 'edit') return []
  return parseChoices(msg.content)
}

/**
 * 是否弹"AI 选项"弹窗 —— 唯一权威信号：AI 自己声明的 [ASK:choice]。
 *
 * 新版结构化协议里：
 * - chat/analyze 消息如果 ask === 'choice' 才弹
 * - 其他情况一律不弹（不再靠反问词启发式判定，协议说没有就没有）
 */
function shouldShowChoiceDialog(msg: ChatMessage): boolean {
  if (msg.role !== 'assistant') return false
  if (msg.kind === 'edit') return false
  return msg.ask === 'choice' && choicesOf(msg).length >= 1
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

        <!-- <div class="field">
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
        </div> -->

        <div class="field">
          <label class="field__label">Prompt</label>
          <textarea
            v-model="prompt"
            class="field__textarea"
            rows="4"
            placeholder="描述你想写什么，例如：帮我写一篇关于 Vite 6 新特性的公众号文章……"
          />
        </div>

        <!-- <div class="presets">
          <button
            v-for="(p, i) in presetPrompts"
            :key="i"
            class="preset-chip"
            type="button"
            @click="applyPreset(p)"
          >
            {{ p }}
          </button>
        </div> -->

        <button
          class="generate-btn"
          :disabled="!canGenerate"
          @click="handleGenerate"
        >
          <el-icon v-if="!store.isGenerating"><MagicStick /></el-icon>
          <span v-if="store.isGenerating" class="loader" />
          <span>{{ store.isGenerating ? 'AI 正在创作…' : '一键生成' }}</span>
        </button>
      </section>

      <!-- AI 对话面板：展示聊天流（编辑类消息以"已修改"形式呈现） -->
      <section class="block chat-block">
        <header class="block__head">
          <el-icon class="block__icon"><ChatDotRound /></el-icon>
          <span class="block__title">AI 对话</span>
          <button
            v-if="chatMessages.length"
            class="clear-btn"
            type="button"
            @click="handleClearChat"
            title="清空当前文档的对话历史"
          >
            <el-icon><Delete /></el-icon>
            <span>清空</span>
          </button>
        </header>

        <div ref="chatListRef" class="chat-list">
          <!-- 空态 -->
          <div v-if="!chatMessages.length && !isChatStreaming" class="chat-empty">
            <el-icon class="chat-empty__icon"><ChatDotRound /></el-icon>
            <p>在 Prompt 里跟 AI 聊点什么吧——</p>
            <p>它会智能判断要不要改你的文档</p>
          </div>

          <!-- 历史消息 -->
          <div
            v-for="msg in chatMessages"
            :key="msg.id"
            class="bubble-row"
            :class="{ 'bubble-row--user': msg.role === 'user' }"
          >
            <!-- 用户消息 -->
            <template v-if="msg.role === 'user'">
              <div class="bubble bubble--user">
                <div class="bubble__content">{{ msg.content }}</div>
              </div>
            </template>

            <!-- AI 闲聊回复 -->
            <template v-else-if="msg.kind === 'chat'">
              <div class="bubble bubble--ai">
                <div class="bubble__avatar">AI</div>
                <div class="bubble__content markdown-body" v-html="renderMd(msg.content)" />
              </div>
            </template>

            <!-- AI 评价/建议（不动文档，带"应用到文档"按钮） -->
            <template v-else-if="msg.kind === 'analyze'">
              <div class="bubble bubble--ai bubble--analyze">
                <div class="bubble__avatar bubble__avatar--analyze">
                  <el-icon><EditPen /></el-icon>
                </div>
                <div class="bubble__content markdown-body" v-html="renderMd(msg.content)" />
                <!-- AI 给出的可点击选项（"路径 A/B/C"） -->
                <div
                  v-if="choicesOf(msg).length"
                  class="choice-list"
                >
                  <div class="choice-list__hint">↳ 点击下方按钮一键回复</div>
                  <button
                    v-for="c in choicesOf(msg)"
                    :key="c.key"
                    class="choice-btn"
                    type="button"
                    :disabled="store.isGenerating"
                    @click="handleChoice(c)"
                  >
                    <span class="choice-btn__key">{{ c.label }}</span>
                    <span class="choice-btn__desc">{{ c.description }}</span>
                  </button>
                </div>
                <button
                  class="apply-btn"
                  type="button"
                  :disabled="store.isGenerating"
                  @click="handleApplySuggestion(msg)"
                  title="让 AI 按这条建议改文档（进入 diff 流程）"
                >
                  <el-icon><Promotion /></el-icon>
                  <span>应用到文档</span>
                </button>
              </div>
            </template>

            <!-- AI 编辑消息 -->
            <template v-else>
              <div class="bubble bubble--ai bubble--edit">
                <div class="bubble__avatar">
                  <el-icon><Check /></el-icon>
                </div>
                <div class="bubble__content bubble__content--edit">
                  <div class="edit-summary">
                    <span class="edit-summary__label">已修改文档</span>
                    <span class="edit-summary__hint">
                      请到编辑器查看 diff 并"接受/拒绝"
                    </span>
                  </div>
                </div>
              </div>
            </template>
          </div>

          <!-- 聊天模式实时流式（AI 打字中） -->
          <div v-if="isChatStreaming" class="bubble-row">
            <div class="bubble bubble--ai bubble--streaming">
              <div class="bubble__avatar">AI</div>
              <div class="bubble__content markdown-body" v-html="renderMd(streamingChatText)" />
              <span class="cursor-blink" />
            </div>
          </div>
        </div>
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

    <!--
      AI 选项弹窗（fixed 居中）：
      - 当 AI 的 chat 类回复里能解析出"路径 A/B/C..."时自动弹出
      - 点哪个选项就把哪条 label 当下一轮 prompt 发出去
      - 点 X / 点遮罩 / 按 Esc 关闭
      - 用 el-dialog 自带 modal 遮罩 + ESC + 锁滚动，比自造 mask 更省心
    -->
    <el-dialog
      v-model="choiceDialogOpen"
      title="AI 给你的几个方向"
      width="min(480px, 92vw)"
      :close-on-click-modal="true"
      :close-on-press-escape="true"
      :modal="true"
      :show-close="false"
      align-center
      custom-class="choice-dialog"
      @close="dismissChoice"
    >
      <p class="choice-dialog__sub">挑一个直接继续聊，或点关闭自己写</p>
      <div class="choice-dialog__list">
        <button
          v-for="c in activeChoices"
          :key="c.key"
          class="choice-btn choice-btn--modal"
          type="button"
          :disabled="store.isGenerating"
          @click="pickChoice(c)"
        >
          <span class="choice-btn__key">{{ c.label }}</span>
          <span class="choice-btn__desc">{{ c.description }}</span>
        </button>
      </div>
      <template #header>
        <div class="choice-dialog__head">
          <el-icon class="choice-dialog__icon"><MagicStick /></el-icon>
          <span>AI 给你的几个方向</span>
          <button
            class="choice-dialog__close"
            type="button"
            aria-label="关闭"
            @click="dismissChoice"
          >
            <el-icon><Close /></el-icon>
          </button>
        </div>
      </template>
    </el-dialog>
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

/* ============== AI 对话面板 ============== */
.chat-block {
  border-top: 1px dashed var(--border-soft);
  padding-top: var(--space-4);
}
.clear-btn {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--text-muted);
  background: transparent;
  border: 1px solid var(--border-soft);
  border-radius: 999px;
  padding: 2px 8px;
  cursor: pointer;
  transition: all 0.15s ease;
}
.clear-btn:hover {
  color: var(--color-error, #ef4444);
  border-color: var(--color-error, #ef4444);
}

.chat-list {
  max-height: 360px;
  min-height: 120px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: 4px 2px;
  scrollbar-width: thin;
}

.chat-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: var(--space-6) var(--space-3);
  color: var(--text-muted);
  font-size: var(--fs-xs);
  text-align: center;
  gap: 4px;
}
.chat-empty__icon {
  font-size: 28px;
  color: var(--color-brand);
  opacity: 0.4;
  margin-bottom: 6px;
}
.chat-empty p {
  margin: 0;
}

.bubble-row {
  display: flex;
  width: 100%;
}
.bubble-row--user {
  justify-content: flex-end;
}

.bubble {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  max-width: 92%;
  border-radius: 10px;
  padding: 8px 10px;
  font-size: var(--fs-sm);
  line-height: 1.5;
  word-break: break-word;
}
.bubble--user {
  background: var(--color-brand);
  color: #fff;
  border-bottom-right-radius: 2px;
}
.bubble--user .bubble__content {
  white-space: pre-wrap;
}
.bubble--ai {
  background: var(--bg-soft, #f5f5f7);
  color: var(--text-primary);
  border-bottom-left-radius: 2px;
}
.bubble--ai .bubble__content {
  flex: 1;
  min-width: 0;
}
.bubble--ai .bubble__avatar {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(
    135deg,
    var(--color-accent-from) 0%,
    var(--color-accent-to) 100%
  );
  color: #fff;
  font-size: 10px;
  font-weight: 700;
  flex-shrink: 0;
  margin-top: 1px;
}
.bubble--edit {
  background: linear-gradient(
    135deg,
    rgba(16, 185, 129, 0.08) 0%,
    rgba(99, 102, 241, 0.08) 100%
  );
  border: 1px solid rgba(16, 185, 129, 0.25);
}
.bubble--edit .bubble__avatar {
  background: linear-gradient(135deg, #10b981 0%, #059669 100%);
}

/* analyze（评价/建议）气泡：紫色系，含"应用到文档"按钮 */
.bubble--analyze {
  flex-direction: column;
  align-items: stretch;
  background: linear-gradient(
    135deg,
    rgba(168, 85, 247, 0.08) 0%,
    rgba(99, 102, 241, 0.08) 100%
  );
  border: 1px solid rgba(168, 85, 247, 0.25);
}
.bubble--analyze > .bubble__avatar {
  display: none;
}
.bubble--analyze::before {
  content: 'AI 建议';
  display: inline-block;
  font-size: 10px;
  font-weight: 700;
  color: #7c3aed;
  background: rgba(168, 85, 247, 0.12);
  padding: 1px 6px;
  border-radius: 4px;
  width: fit-content;
  margin-bottom: 4px;
}
.bubble__avatar--analyze {
  background: linear-gradient(135deg, #a855f7 0%, #7c3aed 100%) !important;
}
.apply-btn {
  margin-top: 6px;
  align-self: flex-start;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  font-weight: 600;
  color: #fff;
  background: linear-gradient(135deg, #a855f7 0%, #7c3aed 100%);
  border: none;
  border-radius: 999px;
  padding: 5px 12px;
  cursor: pointer;
  transition: transform 0.15s ease, box-shadow 0.15s ease, opacity 0.15s ease;
  box-shadow: 0 3px 10px rgba(124, 58, 237, 0.28);
}
.apply-btn:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 5px 14px rgba(124, 58, 237, 0.4);
}
.apply-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

/* AI 给出的可点击选项（路径 A/B/C...） */
.choice-list {
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  align-items: stretch;
}
.choice-btn {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  text-align: left;
  background: rgba(255, 255, 255, 0.75);
  border: 1px solid var(--color-brand);
  border-radius: 8px;
  padding: 6px 10px;
  cursor: pointer;
  transition: all 0.15s ease;
  font-family: inherit;
}
.choice-btn:hover:not(:disabled) {
  background: var(--color-brand);
  color: #fff;
  transform: translateX(2px);
}
.choice-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.choice-btn__key {
  font-size: 12px;
  font-weight: 700;
  color: var(--color-brand);
}
.choice-btn:hover:not(:disabled) .choice-btn__key {
  color: #fff;
}
.choice-btn__desc {
  font-size: var(--fs-xs);
  color: var(--text-secondary);
  line-height: 1.45;
}
.choice-btn:hover:not(:disabled) .choice-btn__desc {
  color: rgba(255, 255, 255, 0.92);
}

/* ============================================================
 * "AI 选项" 居中弹窗（el-dialog）
 * - 不再用 inline 按钮，避免挤气泡布局
 * - 按钮填满弹窗宽度，整体感更强
 * ============================================================ */
.choice-dialog {
  border-radius: 14px;
  overflow: hidden;
}
.choice-dialog .el-dialog__header {
  padding: 0;
  margin: 0;
}
.choice-dialog .el-dialog__body {
  padding: 14px 18px 18px;
}
.choice-dialog__head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 14px 18px;
  background: linear-gradient(
    135deg,
    var(--color-accent-from) 0%,
    var(--color-accent-to) 100%
  );
  color: #fff;
  font-size: var(--fs-md);
  font-weight: 600;
}
.choice-dialog__icon {
  font-size: 18px;
}
.choice-dialog__close {
  margin-left: auto;
  background: transparent;
  border: none;
  color: rgba(255, 255, 255, 0.85);
  cursor: pointer;
  padding: 4px;
  border-radius: 6px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  transition: background 0.15s ease;
}
.choice-dialog__close:hover {
  background: rgba(255, 255, 255, 0.18);
  color: #fff;
}
.choice-dialog__sub {
  margin: 0 0 12px;
  font-size: var(--fs-xs);
  color: var(--text-secondary);
  line-height: 1.5;
}
.choice-dialog__list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
/* 弹窗里的按钮：填满宽度 + 更显眼的边框/阴影 */
.choice-btn--modal {
  width: 100%;
  align-items: stretch;
  background: #fff;
  border: 1px solid var(--color-brand);
  border-radius: 10px;
  padding: 10px 14px;
  font-size: var(--fs-sm);
  box-shadow: 0 1px 3px rgba(99, 102, 241, 0.08);
}
.choice-btn--modal:hover:not(:disabled) {
  background: var(--color-brand);
  color: #fff;
  transform: translateX(2px);
  box-shadow: 0 4px 12px rgba(99, 102, 241, 0.25);
}
.bubble__content--edit {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.edit-summary {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.edit-summary__label {
  font-weight: 600;
  color: #059669;
  font-size: var(--fs-sm);
}
.edit-summary__hint {
  font-size: 11px;
  color: var(--text-muted);
}

.bubble--streaming {
  position: relative;
}
.cursor-blink {
  display: inline-block;
  width: 2px;
  height: 14px;
  background: var(--color-brand);
  margin-left: 2px;
  align-self: center;
  animation: blink 0.9s steps(2) infinite;
  flex-shrink: 0;
}
@keyframes blink {
  to {
    opacity: 0;
  }
}

/* Markdown 渲染：聊天气泡里要紧凑一点 */
.markdown-body {
  font-size: var(--fs-sm);
  line-height: 1.6;
  color: inherit;
}
.markdown-body :deep(p) {
  margin: 0 0 6px;
}
.markdown-body :deep(p:last-child) {
  margin-bottom: 0;
}
.markdown-body :deep(h1),
.markdown-body :deep(h2),
.markdown-body :deep(h3),
.markdown-body :deep(h4) {
  margin: 8px 0 4px;
  font-weight: 600;
  line-height: 1.3;
}
.markdown-body :deep(h1) { font-size: 1.1em; }
.markdown-body :deep(h2) { font-size: 1.05em; }
.markdown-body :deep(h3),
.markdown-body :deep(h4) { font-size: 1em; }
.markdown-body :deep(ul),
.markdown-body :deep(ol) {
  margin: 4px 0;
  padding-left: 1.2em;
}
.markdown-body :deep(li) {
  margin: 2px 0;
}
.markdown-body :deep(code) {
  background: rgba(0, 0, 0, 0.06);
  padding: 1px 4px;
  border-radius: 3px;
  font-size: 0.92em;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
.bubble--user .markdown-body :deep(code) {
  background: rgba(255, 255, 255, 0.18);
  color: #fff;
}
.markdown-body :deep(pre) {
  background: rgba(0, 0, 0, 0.06);
  padding: 6px 8px;
  border-radius: 6px;
  overflow-x: auto;
  font-size: 0.9em;
  margin: 6px 0;
}
.markdown-body :deep(pre code) {
  background: transparent;
  padding: 0;
}
.markdown-body :deep(blockquote) {
  border-left: 3px solid currentColor;
  padding-left: 8px;
  opacity: 0.8;
  margin: 4px 0;
}
.markdown-body :deep(a) {
  color: var(--color-brand);
  text-decoration: underline;
}
.markdown-body :deep(strong) {
  font-weight: 700;
}
.markdown-body :deep(table) {
  border-collapse: collapse;
  margin: 6px 0;
  font-size: 0.92em;
}
.markdown-body :deep(th),
.markdown-body :deep(td) {
  border: 1px solid rgba(0, 0, 0, 0.12);
  padding: 3px 6px;
}
</style>
