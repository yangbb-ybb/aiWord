<script setup lang="ts">
/**
 * 聊天气泡:
 *  - 用户气泡(右,主色)
 *  - AI 气泡(左,浅灰):
 *      - loading 态:van-loading + 文案
 *      - 完成态:风格 tag + caption + 图片
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
</script>

<template>
  <div class="bubble" :class="`bubble--${role}`">
    <!-- 用户气泡 -->
    <template v-if="role === 'user'">
      {{ text }}
    </template>

    <!-- AI 气泡 -->
    <template v-else>
      <div v-if="loading" class="bubble__loading">
        <van-loading size="18" vertical>{{ text }}</van-loading>
      </div>
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

/* AI 消息 caption + 图片 */
.bubble__caption {
  display: flex;
  align-items: center;
  gap: 6px;
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

.bubble__loading {
  padding: 4px 0;
}
</style>