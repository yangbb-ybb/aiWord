<script setup lang="ts">
import { EditPen, MagicStick } from '@element-plus/icons-vue'
</script>

<template>
  <div class="empty">
    <div class="empty__icon">
      <el-icon><EditPen /></el-icon>
    </div>
    <h3 class="empty__title">开始你的第一篇 AI 文章</h3>
    <p class="empty__desc">
      在右侧输入主题，一键生成草稿；或从左侧选择一个模板。
    </p>
    <div class="empty__tags">
      <span class="empty__tag">
        <el-icon><MagicStick /></el-icon>
        AI 生成
      </span>
      <span class="empty__tag">📝 Markdown</span>
      <span class="empty__tag">📤 多平台发布</span>
    </div>
  </div>
</template>

<style scoped>
.empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: var(--space-8);
}
.empty__icon {
  width: 72px;
  height: 72px;
  border-radius: 50%;
  background: var(--color-brand-light);
  color: var(--color-brand);
  font-size: 32px;
  display: grid;
  place-items: center;
  margin-bottom: var(--space-4);
}
.empty__title {
  font-size: var(--fs-lg);
  color: var(--text-primary);
  margin-bottom: var(--space-2);
}
.empty__desc {
  font-size: var(--fs-sm);
  color: var(--text-muted);
  margin-bottom: var(--space-5);
}
.empty__tags {
  display: flex;
  gap: var(--space-2);
  flex-wrap: wrap;
  justify-content: center;
}
.empty__tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  background: var(--bg-muted);
  border-radius: 999px;
  font-size: var(--fs-xs);
  color: var(--text-secondary);
}
</style>
