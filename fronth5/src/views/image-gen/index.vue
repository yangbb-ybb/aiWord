<script setup lang="ts">
/**
 * AI 生图页面(豆包 UI 高保真还原版)
 *
 * 拆分后只保留编排逻辑:
 *  - 状态(messages / prompt / style / generating)
 *  - 业务事件(onBack / send / clearHistory / pickExample)
 *  - 模板只负责把状态 + 事件喂给子组件
 *
 * UI 拆到 ./components:
 *  - Navbar / EmptyState / MessageBubble / NewTopicButton
 *  - ShortcutBar / Composer
 */
import { ref, computed, nextTick, onMounted, reactive } from 'vue'
import { useRouter } from 'vue-router'

import Navbar from './components/Navbar.vue'
import EmptyState from './components/EmptyState.vue'
import MessageBubble, { type StyleOption } from './components/MessageBubble.vue'
import NewTopicButton from './components/NewTopicButton.vue'
import ShortcutBar, { type Shortcut } from './components/ShortcutBar.vue'
import Composer from './components/Composer.vue'

import { chatImage, type ImageStyle } from '@/api/image'

type Style = 'realistic' | 'illustration' | 'watercolor' | '3d'
type Role = 'user' | 'ai'

interface Message {
  id: string
  role: Role
  text: string
  imageUrl?: string
  style?: Style
  loading?: boolean
  ts: number
}

const STYLE_OPTIONS: StyleOption[] = [
  { value: 'realistic', label: '写实', emoji: '📷' },
  { value: 'illustration', label: '插画', emoji: '🎨' },
  { value: 'watercolor', label: '水彩', emoji: '💧' },
  { value: '3d', label: '3D', emoji: '🧊' }
]

// const SHORTCUTS: Shortcut[] = [
//   { value: 'p-image', label: 'P 图', emoji: '🖼️' },
//   { value: 'call', label: '打电话', emoji: '📞' },
//   { value: 'image-gen', label: 'AI 生图', emoji: '🎨', active: true },
//   { value: 'write', label: '帮我写作', emoji: '📝' }
// ]

const EXAMPLES = [
  '夕阳下的海边小镇',
  '森林里的小木屋',
  '城市夜景霓虹灯',
  '雪山上的日出'
]

const router = useRouter()
const messages = ref<Message[]>([])
const prompt = ref('')
const style = ref<ImageStyle>('realistic')
const generating = ref(false)
const listRef = ref<HTMLElement | null>(null)

const canSend = computed(
  () => prompt.value.trim().length > 0 && !generating.value
)

onMounted(() => scrollToBottom())

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

function styleLabel(s: Style | undefined) {
  if (!s) return ''
  return STYLE_OPTIONS.find((o) => o.value === s)?.label ?? s
}

function pickExample(text: string) {
  prompt.value = text
}

/**
 * 从 messages 里抽出"已完成的对话轮次"作为 history 发给后端,让 LLM 能延续上文。
 *  - 过滤掉 loading 中、失败标记(以"(图片生成失败)"结尾)的轮次 —— 这些不该污染上下文
 *  - 只取最近 6 条(约 3 轮对话),避免 prompt 过长
 *  - 只取有 text 的轮次(空文本可能是 ai 加载中)
 */
function buildHistory() {
  return messages.value
    .filter(
      (m) =>
        !m.loading &&
        m.text &&
        !m.text.endsWith('(图片生成失败)') &&
        m.text !== '生成失败,请重试'
    )
    .slice(-6)
    .map((m) => ({
      role: (m.role === 'user' ? 'user' : 'ai') as 'user' | 'ai',
      text: m.text,
      // ai 轮且成功出图才有 imageUrl;后端会把它作为 image block 给 LLM 看
      imageUrl: m.role === 'ai' ? m.imageUrl : undefined
    }))
}

async function send() {
  if (!canSend.value) return
  const userText = prompt.value.trim()
  // 抓取当前消息列表的快照作为 history —— 在 push 当前 user/ai 之前
  const history = buildHistory()
  messages.value.push({
    id: `u-${Date.now()}`,
    role: 'user',
    text: userText,
    ts: Date.now()
  })
  prompt.value = ''
  scrollToBottom()

  generating.value = true
  // 用 reactive() 包一下 —— push 进 ref 数组后,Vue 会再包一层,但这里直接持有
  // reactive proxy 引用,后续 aiMsg.text += 才能触发响应式更新(否则 UI 不会刷新)
  const aiMsg = reactive<Message>({
    id: `a-${Date.now()}`,
    role: 'ai',
    text: 'AI 正在创作…',
    style: style.value,
    loading: true,
    ts: Date.now() + 1
  })
  messages.value.push(aiMsg)
  scrollToBottom()

  try {
    await chatImage(
      { prompt: userText, style: style.value, history },
      {
        onChunk: (chunk) => {
          // 流式把 AI 文字累加到 aiMsg.text,用户看到"AI 正在打字"
          aiMsg.text += chunk.text
        },
        onDone: (done) => {
          // done.text 优先 —— 流式累积的 text 可能漏掉尾部,但 done.text 是后端聚合的完整版
          // 如果 onError 已经追加了"图片生成失败"提示,要保留别被覆盖
          if (done.text) {
            const failTag = '(图片生成失败)'
            if (aiMsg.text.endsWith(failTag)) {
              // 保留失败提示,把完整正文插在提示前面
              aiMsg.text = `${done.text}\n\n${failTag}`
            } else {
              aiMsg.text = done.text
            }
          }
          // done.url 可能 undefined(图生成失败时),AI 文字照样展示
          aiMsg.imageUrl = done.url
        },
        onError: (err) => {
          console.error('[image-gen] chatImage error', err)
          // 流式累积的 aiMsg.text 可能已经有部分文字,没文字时给个兜底
          if (!aiMsg.text || aiMsg.text === 'AI 正在创作…') {
            aiMsg.text = '生成失败,请重试'
          } else if (!aiMsg.text.endsWith('(图片生成失败)')) {
            aiMsg.text = `${aiMsg.text}\n\n(图片生成失败)`
          }
        }
      }
    )
  } finally {
    aiMsg.loading = false
    generating.value = false
    scrollToBottom()
  }
}

function clearHistory() {
  messages.value = []
}
</script>

<template>
  <div class="ig">
    <!-- 顶部 NavBar -->
    <Navbar title="AI 生图" subtitle="aiword.com" @back="onBack" />

    <!-- 主体消息流 -->
    <main ref="listRef" class="ig__main">
      <!-- 空态 -->
      <EmptyState
        v-if="!messages.length"
        :examples="EXAMPLES"
        @pick="pickExample"
      />

      <!-- 消息列表 -->
      <template v-else>
        <MessageBubble
          v-for="m in messages"
          :key="m.id"
          :role="m.role"
          :text="m.text"
          :image-url="m.imageUrl"
          :style="m.style"
          :loading="m.loading"
          :style-options="STYLE_OPTIONS"
        />

        <!-- 聊聊新话题 -->
        <NewTopicButton @click="clearHistory" />
      </template>
    </main>

    <!-- 快捷功能栏 -->
    <!-- <ShortcutBar :shortcuts="SHORTCUTS" /> -->

    <!-- 底部输入栏 -->
    <Composer v-model="prompt" @send="send" />
  </div>
</template>

<style scoped lang="scss">
/* 整体:只保留布局相关样式,UI 细节都搬到子组件 */
.ig {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: #f4f4f5;
  color: #1f1f1f;
  font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Helvetica Neue', sans-serif;
}

.ig__main {
  flex: 1;
  overflow-y: auto;
  padding: 8px 12px 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  -webkit-overflow-scrolling: touch;
}
</style>