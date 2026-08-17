<script setup lang="ts">
import {
  useDocumentStore,
  PLATFORMS,
  type Platform
} from '@/stores/document'

const store = useDocumentStore()

function isSelected(p: Platform) {
  return store.selectedPlatforms.includes(p)
}

function toggle(p: Platform) {
  store.togglePlatform(p)
}
</script>

<template>
  <div class="platform-chips">
    <button
      v-for="p in PLATFORMS"
      :key="p.key"
      class="chip"
      :class="{ 'chip--active': isSelected(p.key) }"
      :style="{ '--chip-color': p.color }"
      @click="toggle(p.key)"
      type="button"
    >
      <span class="chip__dot" />
      {{ p.label }}
    </button>
  </div>
</template>

<style scoped>
.platform-chips {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-radius: 999px;
  border: 1px solid var(--border-color);
  background: transparent;
  font-size: var(--fs-xs);
  color: var(--text-secondary);
  transition: all 0.15s ease;
  cursor: pointer;
}
.chip:hover {
  border-color: var(--chip-color);
  color: var(--chip-color);
}
.chip__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--chip-color);
  opacity: 0.35;
  transition: opacity 0.15s ease;
}
.chip--active {
  background: var(--chip-color);
  border-color: var(--chip-color);
  color: #fff;
}
.chip--active .chip__dot {
  background: #fff;
  opacity: 1;
}
</style>
