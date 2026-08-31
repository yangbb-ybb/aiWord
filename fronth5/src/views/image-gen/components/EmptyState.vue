<script setup lang="ts">
/**
 * 空态气泡(豆包"系统欢迎"风格)
 *  - 项目符号 + 提示行
 *  - 分隔线 + heading + 一排示例 prompt(可点击)
 */
defineProps<{
  /** 示例 prompt 列表(渲染成一排胶囊按钮) */
  examples: string[]
}>()

const emit = defineEmits<{
  /** 用户点选某个示例 */
  pick: [text: string]
}>()

// 固定的提示行(项目符号),不放进 props 因为这是空态独有的视觉
const TIPS = ['输入图片描述,我会帮你生成', '切换风格让效果更精准']
</script>

<template>
  <div class="empty">
    <div class="empty__bubble">
      <p v-for="(line, i) in TIPS" :key="i" class="empty__line">
        <span class="empty__bullet">○</span>
        <span>{{ line }}</span>
      </p>
      <hr class="empty__divider" />
      <p class="empty__heading">试试这些 prompt</p>
      <div class="empty__examples">
        <button
          v-for="ex in examples"
          :key="ex"
          type="button"
          class="empty__example-btn"
          @click="emit('pick', ex)"
        >
          {{ ex }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped lang="scss">
.empty {
  padding: 4px 0;
}

.empty__bubble {
  max-width: 92%;
  padding: 14px 16px;
  background: #ededee; /* 豆包浅灰气泡 */
  color: #1f1f1f;
  border-radius: 18px;
  border-bottom-left-radius: 4px;
  font-size: 15px;
  line-height: 1.55;
}

.empty__line {
  margin: 0 0 6px;
  display: flex;
  gap: 6px;
}
.empty__line:last-of-type {
  margin-bottom: 0;
}

.empty__bullet {
  color: #8e8e93;
  flex-shrink: 0;
  font-size: 13px;
  line-height: 1.7;
}

.empty__divider {
  border: none;
  border-top: 1px solid rgba(0, 0, 0, 0.08);
  margin: 10px 0;
}

.empty__heading {
  margin: 0 0 8px;
  font-size: 14px;
  font-weight: 600;
  color: #1f1f1f;
}

.empty__examples {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.empty__example-btn {
  font-size: 12px;
  padding: 4px 10px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.7);
  border: 1px solid rgba(0, 0, 0, 0.08);
  color: #1f1f1f;
  cursor: pointer;
  transition: all 0.15s ease;
  &:hover {
    background: #fff;
    border-color: var(--van-primary-color);
  }
}
</style>