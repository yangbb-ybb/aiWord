<script setup lang="ts">
/**
 * 根组件。
 *  - 只放 <RouterView/>，所有 layout 在 router 里配
 */
</script>

<template>
  <router-view />
</template>

<style lang="scss">
html, body, #app {
  height: 100%;
  margin: 0;
  padding: 0;
  font-family: -apple-system, BlinkMacSystemFont, 'PingFang SC', 'Helvetica Neue', sans-serif;
}
</style>