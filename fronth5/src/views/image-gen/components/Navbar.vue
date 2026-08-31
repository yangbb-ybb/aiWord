<script setup lang="ts">
/**
 * 顶部 NavBar(豆包双行版)
 *  - 左箭头返回
 *  - 中间主标题 + 副标题(双行,主标题带下拉箭头)
 */
defineProps<{
  title: string
  subtitle?: string
}>()

const emit = defineEmits<{
  back: []
}>()
</script>

<template>
  <header class="navbar">
    <div class="navbar__row">
      <button class="navbar__btn" aria-label="返回" @click="emit('back')">
        <van-icon name="arrow-left" size="20" />
      </button>
      <div class="navbar__title">
        <div class="navbar__main">
          <span>{{ title }}</span>
          <van-icon name="arrow" size="12" class="navbar__arrow" />
        </div>
        <div v-if="subtitle" class="navbar__sub">{{ subtitle }}</div>
      </div>
    </div>
  </header>
</template>

<style scoped lang="scss">
.navbar {
  flex-shrink: 0;
  background: #f4f4f5;
  padding: 8px 12px 4px;
  // 模拟 iPhone 顶部状态栏安全区
  padding-top: max(8px, env(safe-area-inset-top));
}

.navbar__row {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 44px;
}

.navbar__btn {
  width: 36px;
  height: 36px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  color: #1f1f1f;
  cursor: pointer;
  border-radius: 50%;
  transition: background 0.15s ease;
  &:hover {
    background: rgba(0, 0, 0, 0.05);
  }
}

.navbar__title {
  flex: 1;
  text-align: center;
  line-height: 1.1;
}

.navbar__main {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  font-size: 17px;
  font-weight: 600;
  color: #1f1f1f;
}

.navbar__arrow {
  margin-top: 2px;
  color: #1f1f1f;
}

.navbar__sub {
  font-size: 11px;
  color: #8e8e93;
  margin-top: 2px;
}
</style>