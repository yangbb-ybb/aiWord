<script setup lang="ts">
/**
 * 底部输入栏(豆包大圆角胶囊)
 *  - 相机 + 输入框 + 语音 + 加号
 *  - v-model 双向绑定文本
 *  - 按 Enter 直接 send(也可在父级处理)
 */
const props = defineProps<{
  modelValue: string
  placeholder?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [value: string]
  send: []
}>()

function onInput(value: string) {
  emit('update:modelValue', value)
}

function onEnter() {
  emit('send')
}
</script>

<template>
  <footer class="composer">
    <button type="button" class="composer__icon" aria-label="相机">
      <van-icon name="photograph" size="20" />
    </button>
    <van-field
      :model-value="props.modelValue"
      type="textarea"
      rows="1"
      autosize
      :border="false"
      :placeholder="props.placeholder ?? '发消息或按住说话…'"
      class="composer__field"
      @update:model-value="onInput"
      @keydown.enter.prevent="onEnter"
    />
    <button type="button" class="composer__icon" aria-label="语音">
      <van-icon name="volume-o" size="20" />
    </button>
    <button type="button" class="composer__plus" aria-label="更多">
      <van-icon name="plus" size="20" />
    </button>
  </footer>
</template>

<style scoped lang="scss">
.composer {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 8px 12px calc(8px + env(safe-area-inset-bottom));
  padding: 6px 8px;
  background: #fff;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 24px;
}

.composer__icon {
  flex-shrink: 0;
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
  &:hover {
    background: rgba(0, 0, 0, 0.04);
  }
}

.composer__plus {
  flex-shrink: 0;
  width: 36px;
  height: 36px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: 1px solid rgba(0, 0, 0, 0.12);
  color: #1f1f1f;
  cursor: pointer;
  border-radius: 50%;
  &:hover {
    background: rgba(0, 0, 0, 0.04);
  }
}

.composer__field {
  flex: 1;
  background: transparent;
  padding: 0;
  font-size: 15px;
  line-height: 1.4;
  min-width: 0; /* 让 ellipsis 在 flex 容器里生效 */
}
.composer__field :deep(.van-field__control) {
  min-height: 22px;
  max-height: 80px;
  padding: 0;
}
.composer__field :deep(.van-field__body) {
  padding: 0;
}
.composer__field :deep(textarea) {
  padding: 8px 0;
}
</style>