<script setup lang="ts">
/**
 * 快捷功能栏(横向胶囊按钮,带 emoji)
 *  - 当前选中项用更深色边框 + 加粗字
 */
export interface Shortcut {
  value: string
  label: string
  emoji: string
  active?: boolean
}

defineProps<{
  shortcuts: Shortcut[]
}>()
</script>

<template>
  <div class="shortcuts">
    <button
      v-for="opt in shortcuts"
      :key="opt.value"
      type="button"
      class="shortcuts__item"
      :class="{ 'shortcuts__item--active': opt.active }"
    >
      <span class="shortcuts__emoji">{{ opt.emoji }}</span>
      <span>{{ opt.label }}</span>
    </button>
  </div>
</template>

<style scoped lang="scss">
.shortcuts {
  flex-shrink: 0;
  display: flex;
  gap: 8px;
  padding: 8px 12px 4px;
  background: #f4f4f5;
  overflow-x: auto;
  scrollbar-width: none;
  &::-webkit-scrollbar {
    display: none;
  }
}

.shortcuts__item {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 6px 14px;
  border-radius: 999px;
  background: #fff;
  border: 1px solid rgba(0, 0, 0, 0.08);
  font-size: 13px;
  color: #1f1f1f;
  cursor: pointer;
  transition: all 0.15s ease;
  &:hover {
    border-color: rgba(0, 0, 0, 0.18);
  }
}

.shortcuts__item--active {
  border-color: #1f1f1f;
  border-width: 1.5px;
  font-weight: 600;
}

.shortcuts__emoji {
  font-size: 13px;
}
</style>