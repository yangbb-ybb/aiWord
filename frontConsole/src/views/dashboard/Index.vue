<script setup lang="ts">
/**
 * Dashboard 总览:用户/文档/AI 调用核心指标。
 */
import { onMounted, ref } from 'vue'
import { getStats, type DashboardStats } from '@/api/stats'
import { User, Document, Collection, Picture, Warning } from '@element-plus/icons-vue'

const stats = ref<DashboardStats | null>(null)
const loading = ref(false)

async function load() {
  loading.value = true
  try {
    stats.value = await getStats()
  } finally {
    loading.value = false
  }
}

onMounted(load)

const cards = [
  { key: 'userTotal', label: '累计用户', icon: User, color: '#409eff' },
  { key: 'userTodayNew', label: '今日新增用户', icon: User, color: '#67c23a' },
  { key: 'documentTotal', label: '累计文档', icon: Document, color: '#e6a23c' },
  { key: 'documentTodayNew', label: '今日新增文档', icon: Document, color: '#67c23a' },
  { key: 'templateTotal', label: '模板数量', icon: Collection, color: '#909399' },
  { key: 'imageSuccess7d', label: '7 天生图成功', icon: Picture, color: '#67c23a' },
  { key: 'imageFail7d', label: '7 天生图失败', icon: Warning, color: '#f56c6c' }
] as const
</script>

<template>
  <div class="dashboard" v-loading="loading">
    <el-row :gutter="16">
      <el-col v-for="c in cards" :key="c.key" :span="6" class="dashboard__col">
        <el-card shadow="hover" class="dashboard__card">
          <div class="dashboard__card-inner">
            <el-icon :size="32" :color="c.color"><component :is="c.icon" /></el-icon>
            <div class="dashboard__card-meta">
              <div class="dashboard__card-value">
                {{ stats?.[c.key] ?? '-' }}
              </div>
              <div class="dashboard__card-label">{{ c.label }}</div>
            </div>
          </div>
        </el-card>
      </el-col>
    </el-row>

    <el-card class="dashboard__hint" shadow="never">
      <template #header>
        <span>说明</span>
      </template>
      <ul>
        <li>本控制台仅供项目运营 / 管理员使用,需要 role=admin 的账号登录</li>
        <li>Dashboard 数据来自 /api/admin/stats(本次新增)</li>
        <li>用户列表 / 文档列表支持搜索 + 分页,文档列表可按用户筛选</li>
        <li>AI 调用日志后续会接 image_chat 数据库持久化,现在先看日志文件</li>
      </ul>
    </el-card>
  </div>
</template>

<style scoped lang="scss">
.dashboard {
  .el-row {
    margin-bottom: 16px;
  }
}
.dashboard__col {
  margin-bottom: 16px;
}
.dashboard__card-inner {
  display: flex;
  align-items: center;
  gap: 16px;
}
.dashboard__card-meta {
  display: flex;
  flex-direction: column;
}
.dashboard__card-value {
  font-size: 24px;
  font-weight: 600;
  line-height: 1.2;
}
.dashboard__card-label {
  font-size: 13px;
  color: #909399;
  margin-top: 4px;
}
.dashboard__hint {
  ul {
    margin: 0;
    padding-left: 20px;
    line-height: 1.8;
    color: #606266;
  }
}
</style>