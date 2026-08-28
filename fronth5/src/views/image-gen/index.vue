<script setup lang="ts">
/**
 * AI 出图页面(参考豆包 UI 风格,只做生图)
 *
 * 布局(自上而下):
 *  1. 顶部 NavBar:左箭头返回 + 标题"AI 生图" + 右侧更多
 *  2. 中间消息流:聊天气泡风格,用户气泡在右(蓝色),AI 气泡在左(灰/白)
 *     - 用户消息:用户输入的 prompt
 *     - AI 消息:loading 态 或 已生成的图片(基于 Lorem Picsum 占位图)
 *  3. 底部输入栏:附件按钮 + textarea + 发送按钮
 *     - 输入框上方一行:风格快捷 chip(写实/插画/水彩/3D),点选切换
 *
 * 状态:消息流在内存里,不持久化(纯前端 demo)
 *
 * 后续接真实 API:替换 generate() 里 setTimeout 那段即可
 */
import { ref, computed, nextTick, onMounted, useTemplateRef } from 'vue'
import { useRouter } from 'vue-router'

type Style = 'realistic' | 'illustration' | 'watercolor' | '3d'
type Role = 'user' | 'ai'

interface Message {
  id: string
  role: Role
  /** 用户:prompt 文本 / AI:loading 文案或图片说明 */
  text: string
  /** AI 的图片 URL(loading 时为空) */
  imageUrl?: string
  /** AI 消息的当前风格 */
  style?: Style
  /** AI 消息是否正在生成 */
  loading?: boolean
  ts: number
}

const STYLE_OPTIONS: { value: Style; label: string; emoji: string }[] = [
  { value: 'realistic', label: '写实', emoji: '📷' },
  { value: 'illustration', label: '插画', emoji: '🎨' },
  { value: 'watercolor', label: '水彩', emoji: '💧' },
  { value: '3d', label: '3D', emoji: '🧊' }
]

const router = useRouter()

const messages = ref<Message[]>([])
const prompt = ref('')
const style = ref<Style>('realistic')
const generating = ref(false)

const listRef = useTemplateRef<HTMLElement>('listRef')

/** 用户能否发送:有内容 + 当前不在生成中 */
const canSend = computed(
  () => prompt.value.trim().length > 0 && !generating.value
)

onMounted(() => {
  // 滚到底部(初始空列表,无操作)
  scrollToBottom()
})

function onBack() {
  if (window.history.length > 1) router.back()
  else router.push('/')
}

function scrollToBottom() {
  nextTick(() => {
    const el = listRef.value
    if (!el) return
    el.scrollTop = el.scrollHeight
  })
}

function pickExample(text: string) {
  prompt.value = text
}

async function send() {
  if (!canSend.value) return
  const userText = prompt.value.trim()
  // 1) 追加用户消息
  const userMsg: Message = {
    id: `u-${Date.now()}`,
    role: 'user',
    text: userText,
    ts: Date.now()
  }
  messages.value.push(userMsg)
  prompt.value = ''
  scrollToBottom()

  // 2) 追加 AI loading 消息
  generating.value = true
  const aiMsg: Message = {
    id: `a-${Date.now()}`,
    role: 'ai',
    text: 'AI 正在创作…',
    style: style.value,
    loading: true,
    ts: Date.now() + 1
  }
  messages.value.push(aiMsg)
  scrollToBottom()

  // 3) 模拟生成耗时
  await new Promise((r) => setTimeout(r, 1500))

  // 4) 用 Lorem Picsum 占位图;水彩加 blur
  const seed = encodeURIComponent(`${userText}|${style.value}|${Date.now()}`)
  const blur = style.value === 'watercolor' ? 2 : 0
  aiMsg.text = `${userText}（${STYLE_OPTIONS.find((s) => s.value === style.value)?.label}）`
  aiMsg.imageUrl = `https://picsum.photos/seed/${seed}/600/600?blur=${blur}`
  aiMsg.loading = false

  generating.value = false
  scrollToBottom()
}

function onSendClick() {
  send()
}

function clearHistory() {
  messages.value = []
}

/** 示例 prompt,空态时显示给用户点选 */
const examples = [
  '夕阳下的海边小镇',
  '森林里的小木屋',
  '城市夜景霓虹灯',
  '雪山上的日出'
]

function styleLabel(s: Style | undefined) {
  if (!s) return ''
  return STYLE_OPTIONS.find((o) => o.value === s)?.label ?? s
}
</script>

<template>
  <div class="ig">
    <!-- 顶部 NavBar(参考豆包:左箭头 + 中间标题 + 右侧更多) -->
    <van-nav-bar
      title="AI 生图"
      left-arrow
      :border="false"
      @click-left="onBack"
    >
      <template #right>
        <van-icon
          v-if="messages.length"
          name="delete-o"
          size="20"
          @click="clearHistory"
        />
      </template>
    </van-nav-bar>

    <!-- 中间消息流 -->
    <main ref="listRef" class="ig__list">
      <!-- 空态:欢迎语 + 示例 prompt -->
      <div v-if="!messages.length" class="ig__welcome">
        <div class="ig__welcome-emoji">🎨</div>
        <h2 class="ig__welcome-title">AI 生图</h2>
        <p class="ig__welcome-desc">输入描述,生成图片</p>
        <div class="ig__examples">
          <van-button
            v-for="ex in examples"
            :key="ex"
            round
            plain
            size="small"
            class="ig__example-btn"
            @click="pickExample(ex)"
          >
            {{ ex }}
          </van-button>
        </div>
      </div>

      <!-- 消息流 -->
      <template v-else>
        <div
          v-for="m in messages"
          :key="m.id"
          class="ig__row"
          :class="`ig__row--${m.role}`"
        >
          <!-- AI 消息:头像 + 气泡 -->
          <template v-if="m.role === 'ai'">
            <div class="ig__avatar ig__avatar--ai">AI</div>
            <div class="ig__bubble ig__bubble--ai">
              <div v-if="m.loading" class="ig__loading">
                <van-loading size="20" vertical>
                  {{ m.text }}
                </van-loading>
              </div>
              <template v-else>
                <div class="ig__caption">
                  <span class="ig__caption-tag">{{ styleLabel(m.style) }}</span>
                  <span class="ig__caption-text">{{ m.text }}</span>
                </div>
                <img
                  v-if="m.imageUrl"
                  :src="m.imageUrl"
                  alt="AI 生成的图片"
                  class="ig__image"
                />
              </template>
            </div>
          </template>

          <!-- 用户消息:气泡(右对齐) -->
          <template v-else>
            <div class="ig__bubble ig__bubble--user">
              {{ m.text }}
            </div>
          </template>
        </div>
      </template>
    </main>

    <!-- 底部输入栏(固定,参考豆包风格) -->
    <footer class="ig__composer">
      <!-- 风格快捷 chip 行 -->
      <div class="ig__style-chips">
        <span class="ig__style-chips-label">风格</span>
        <button
          v-for="opt in STYLE_OPTIONS"
          :key="opt.value"
          type="button"
          class="ig__chip"
          :class="{ 'ig__chip--active': style === opt.value }"
          @click="style = opt.value"
        >
          <span class="ig__chip-emoji">{{ opt.emoji }}</span>
          <span>{{ opt.label }}</span>
        </button>
      </div>

      <!-- 输入行:附件 + 输入框 + 发送 -->
      <div class="ig__input-row">
        <button type="button" class="ig__icon-btn" aria-label="附件">
          <van-icon name="photograph" size="22" />
        </button>
        <van-field
          v-model="prompt"
          type="textarea"
          rows="1"
          autosize
          maxlength="200"
          placeholder="描述你想生成的图片…"
          class="ig__field"
          @keydown.enter.prevent="onSendClick"
        />
        <button
          type="button"
          class="ig__send-btn"
          :class="{ 'ig__send-btn--ready': canSend }"
          :disabled="!canSend"
          aria-label="发送"
          @click="onSendClick"
        >
          <van-icon name="guide-o" size="20" />
        </button>
      </div>
    </footer>
  </div>
</template>

<style scoped lang="scss">
.ig {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: var(--van-background-2);
}

/* ============ 消息流 ============ */
.ig__list {
  flex: 1;
  overflow-y: auto;
  padding: 16px 12px 12px;
  display: flex;
  flex-direction: column;
  gap: 14px;
  // 让 iOS 橡皮筋滚动不被父级拦截
  -webkit-overflow-scrolling: touch;
}

.ig__row {
  display: flex;
  width: 100%;
  align-items: flex-start;
  gap: 8px;
}
.ig__row--user {
  justify-content: flex-end;
}

.ig__avatar {
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: 700;
  color: #fff;
  background: linear-gradient(135deg, #4f46e5, #7c3aed);
}

.ig__bubble {
  max-width: 75%;
  border-radius: 14px;
  padding: 10px 12px;
  font-size: 15px;
  line-height: 1.5;
  word-break: break-word;
}
.ig__bubble--user {
  background: var(--van-primary-color);
  color: #fff;
  border-bottom-right-radius: 4px;
  white-space: pre-wrap;
}
.ig__bubble--ai {
  background: #fff;
  color: var(--van-text-color);
  border-bottom-left-radius: 4px;
  padding: 8px;
}

.ig__caption {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 2px 4px 6px;
  font-size: 12px;
  color: var(--van-text-color-2);
}
.ig__caption-tag {
  background: var(--van-primary-color);
  color: #fff;
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 4px;
}

.ig__image {
  display: block;
  width: 220px;
  max-width: 100%;
  border-radius: 8px;
  background: var(--van-background-2);
}

.ig__loading {
  padding: 8px 16px;
}

/* ============ 空态 ============ */
.ig__welcome {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 24px;
  text-align: center;
}
.ig__welcome-emoji {
  font-size: 64px;
  margin-bottom: 16px;
}
.ig__welcome-title {
  font-size: 22px;
  font-weight: 600;
  margin: 0 0 6px;
  color: var(--van-text-color);
}
.ig__welcome-desc {
  font-size: 14px;
  color: var(--van-text-color-2);
  margin: 0 0 24px;
}
.ig__examples {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  justify-content: center;
}
.ig__example-btn {
  font-size: 13px;
}

/* ============ 底部输入栏(参考豆包) ============ */
.ig__composer {
  flex-shrink: 0;
  background: #fff;
  border-top: 1px solid var(--van-border-color);
  padding: 8px 12px calc(8px + env(safe-area-inset-bottom));
}

.ig__style-chips {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 0 8px;
  overflow-x: auto;
  // 隐藏滚动条但保留滚动
  scrollbar-width: none;
  &::-webkit-scrollbar { display: none; }
}
.ig__style-chips-label {
  flex-shrink: 0;
  font-size: 12px;
  color: var(--van-text-color-3);
  margin-right: 4px;
}
.ig__chip {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  font-size: 12px;
  border-radius: 999px;
  background: var(--van-background-2);
  color: var(--van-text-color-2);
  border: none;
  cursor: pointer;
  transition: all 0.15s ease;
  &:hover {
    color: var(--van-text-color);
  }
}
.ig__chip--active {
  background: var(--van-primary-color);
  color: #fff;
}
.ig__chip-emoji {
  font-size: 13px;
}

.ig__input-row {
  display: flex;
  align-items: flex-end;
  gap: 8px;
}
.ig__icon-btn {
  flex-shrink: 0;
  width: 36px;
  height: 36px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  color: var(--van-text-color-2);
  cursor: pointer;
}

.ig__field {
  flex: 1;
  background: var(--van-background-2);
  border-radius: 18px;
  padding: 8px 12px;
  font-size: 15px;
  line-height: 1.4;
}
.ig__field :deep(.van-field__control) {
  min-height: 22px;
  max-height: 80px;
}

.ig__send-btn {
  flex-shrink: 0;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: none;
  background: var(--van-background-2);
  color: var(--van-text-color-3);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.15s ease;
}
.ig__send-btn--ready {
  background: var(--van-primary-color);
  color: #fff;
}
.ig__send-btn:disabled {
  cursor: not-allowed;
}
</style>
