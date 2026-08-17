<script setup lang="ts">
defineProps<{ size?: number }>()
</script>

<template>
  <div class="brand-logo" :style="{ '--logo-size': (size || 28) + 'px' }">
    <div class="brand-logo__mark">Ai</div>
    <div class="brand-logo__text">aiWord</div>
  </div>
</template>

<style scoped>
.brand-logo {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  user-select: none;
}
.brand-logo__mark {
  width: var(--logo-size);
  height: var(--logo-size);
  border-radius: calc(var(--logo-size) / 4);
  background: linear-gradient(
    135deg,
    var(--color-accent-from) 0%,
    var(--color-accent-to) 100%
  );
  color: #fff;
  font-weight: 700;
  font-size: calc(var(--logo-size) * 0.5);
  display: grid;
  place-items: center;
  box-shadow: 0 4px 12px rgba(99, 102, 241, 0.35);
}
.brand-logo__text {
  font-size: calc(var(--logo-size) * 0.6);
  font-weight: 700;
  color: var(--text-primary);
  letter-spacing: -0.5px;
}
</style>
