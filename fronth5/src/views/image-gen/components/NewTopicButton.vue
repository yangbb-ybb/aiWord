<script setup lang="ts">
/**
 * "聊聊新话题"按钮(消息流底部居中)
 */
const emit = defineEmits<{
  click: []
}>()
</script>

<template>
  <div class="new-topic">
    <button type="button" class="new-topic__btn" @click="emit('click')">
      聊聊新话题
    </button>
  </div>
</template>

<style scoped lang="scss">
.new-topic {
  display: flex;
  justify-content: center;
  padding: 8px 0 4px;
}

.new-topic__btn {
  background: transparent;
  border: none;
  font-size: 13px;
  color: #8e8e93;
  padding: 6px 14px;
  cursor: pointer;
  &:hover {
    color: #1f1f1f;
  }
}
</style>