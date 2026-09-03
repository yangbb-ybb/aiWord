<script setup lang="ts">
/**
 * AI 调用日志 —— 当前是占位页。
 *
 * 后续计划:
 *  - 在 end 增加 image_chat_logs 表(每次 /api/image/chat 调用都 INSERT 一行)
 *  - 后端加 GET /api/admin/ai-logs(分页 + 按状态/时间筛选)
 *  - 前端这里拉真实数据,显示 prompt + 耗时 + 状态 + url
 *
 * 现在只是简单提示,避免空路由。
 */
</script>

<template>
  <div class="ai-logs">
    <el-card shadow="never">
      <template #header>
        <span>AI 调用日志</span>
      </template>
      <el-alert
        type="info"
        :closable="false"
        show-icon
        title="功能规划中"
        description="当前 image-01 调用记录只在 end/logs/app.YYYY-MM-DD.log 里。下一步会在数据库加 image_chat_logs 表持久化,并在此页拉真实数据。"
      />
      <div class="ai-logs__hint">
        <p>短期可以这样排查:</p>
        <pre><code>tail -f end/logs/app.$(date +%F).log | grep image_chat</code></pre>
        <p>该命令实时显示最近的 AI 生图请求(自包含 prompt / 耗时 / url / 错误码)。</p>
      </div>
    </el-card>
  </div>
</template>

<style scoped lang="scss">
.ai-logs__hint {
  margin-top: 16px;
  color: #606266;
  line-height: 1.8;
  pre {
    background: #f5f7fa;
    padding: 8px 12px;
    border-radius: 4px;
    font-family: ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
    font-size: 13px;
  }
}
</style>