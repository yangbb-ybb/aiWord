<script setup lang="ts">
/**
 * 聊天气泡:
 *  - 用户气泡(右,主色)
 *  - AI 气泡(左,浅灰):
 *      - loading 态:
 *          - 顶部 spinner + "AI 正在创作..."(短文案,不显示流式 text,免得跟动效冲突)
 *          - 流式文字(text 已超过初始占位时)显示在 spinner 下方,用户能看到 AI 在打字
 *          - 底部图片占位骨架(固定 240×240 灰底 shimmer),告诉用户"还有图要出来"
 *      - 完成态:风格 tag + caption + 图片
 *          - imageUrl 缺失时显示"(图片生成失败)"提示,不渲染空 img
 *
 * 风格选项由父组件传入(便于一处定义,多处复用)
 */
type Style = 'realistic' | 'illustration' | 'watercolor' | '3d'

export interface StyleOption {
  value: Style
  label: string
  emoji: string
}

const props = defineProps<{
  role: 'user' | 'ai'
  text: string
  imageUrl?: string
  style?: Style
  loading?: boolean
  styleOptions: StyleOption[]
}>()

function styleLabel(): string {
  if (!props.style) return ''
  return props.styleOptions.find((o) => o.value === props.style)?.label ?? props.style
}

/** 流式是否已经"超过"初始占位文字 —— 超过意味着 LLM 真的在打字了 */
const isStreaming = (text: string) => text && text !== 'AI 正在创作…'
</script>

<template>
  <div class="bubble" :class="`bubble--${role}`">
    <!-- 用户气泡 -->
    <template v-if="role === 'user'">
      {{ text }}
    </template>

    <!-- AI 气泡 -->
    <template v-else>
      <!-- ============ loading 阶段 ============ -->
      <div v-if="loading" class="bubble__loading">
        <div class="bubble__loading-head">
          <van-loading type="circular" size="16" color="var(--van-primary-color)" />
          <span class="bubble__loading-text">AI 正在创作…</span>
        </div>

        <!-- 流式文字:只在 LLM 真的开始打字后才展示 -->
        <div v-if="isStreaming(text)" class="bubble__loading-stream">
          {{ text }}
        </div>

        <!-- 图片占位:固定 240x240 + shimmer 动效,告诉用户"还有图要出来" -->
        <div class="bubble__skeleton" aria-label="图片生成中">
          <van-loading type="spinner" size="24" color="#fff" />
          <!-- <span class="bubble__skeleton-text"></span> -->
        </div>
      </div>

      <!-- ============ 完成阶段 ============ -->
      <template v-else>
        <div class="bubble__caption">
          <span class="bubble__caption-tag">{{ styleLabel() }}</span>
          <span class="bubble__caption-text">{{ text }}</span>
        </div>
        <img
          v-if="imageUrl"
          :src="imageUrl"
          alt="AI 生成的图片"
          class="bubble__image"
        />
        <div v-else-if="text && !text.endsWith('(图片生成失败)')" class="bubble__fail">
          (图片生成失败)
        </div>
      </template>
    </template>
  </div>
</template>

<style scoped lang="scss">
/* 气泡通用 */
.bubble {
  max-width: 86%;
  padding: 14px 16px;
  border-radius: 18px;
  font-size: 15px;
  line-height: 1.55;
  word-break: break-word;
}

.bubble--user {
  background: var(--van-primary-color);
  color: #fff;
  border-bottom-right-radius: 4px;
  white-space: pre-wrap;
  margin-left: auto;
}

.bubble--ai {
  background: #ededee;
  color: #1f1f1f;
  border-bottom-left-radius: 4px;
}

/* ============ loading 状态 ============ */
.bubble__loading {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.bubble__loading-head {
  display: flex;
  align-items: center;
  gap: 6px;
}

.bubble__loading-text {
  font-size: 13px;
  color: var(--van-primary-color);
}

.bubble__loading-stream {
  font-size: 13px;
  color: #555;
  line-height: 1.55;
  white-space: pre-wrap;
}

/* 图片占位骨架 —— shimmer 渐变扫光,告诉用户"正在出图" */
.bubble__skeleton {
  width: 90px;
  height: 90px;
  border-radius: 8px;
  background:
    linear-gradient(
      90deg,
      rgba(255, 255, 255, 0) 0%,
      rgba(255, 255, 255, 0.55) 50%,
      rgba(255, 255, 255, 0) 100%
    ),
    linear-gradient(135deg, #c8c8d0 0%, #a8a8b0 100%);
  background-size: 200% 100%, 100% 100%;
  background-repeat: no-repeat;
  animation: shimmer 1.6s ease-in-out infinite;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.bubble__skeleton-text {
  color: #fff;
  font-size: 12px;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.25);
}

@keyframes shimmer {
  0% { background-position: -100% 0, 0 0; }
  100% { background-position: 200% 0, 0 0; }
}

/* ============ 完成状态 ============ */
/* AI 消息 caption + 图片 */
.bubble__caption {
  // display: flex;
  // align-items: flex-start;
  // gap: 6px;
  margin-bottom: 8px;
}

.bubble__caption-tag {
  background: var(--van-primary-color);
  color: #fff;
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 4px;
  flex-shrink: 0;
}

.bubble__caption-text {
  font-size: 13px;
  color: #8e8e93;
  white-space: pre-wrap;
}

.bubble__image {
  display: block;
  width: 240px;
  max-width: 100%;
  border-radius: 8px;
  background: #d8d8dc;
}

.bubble__fail {
  font-size: 12px;
  color: #f56c6c;
  margin-top: 4px;
}
</style>