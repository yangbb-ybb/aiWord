<script setup lang="ts">
/**
 * 控制台主布局:左侧导航 + 顶部 header + 主区。
 * Element Plus 的 <el-container> 嵌套实现。
 */
import { computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import {
  House,
  User,
  Document,
  Collection,
  DataAnalysis,
  SwitchButton
} from '@element-plus/icons-vue'

const router = useRouter()
const route = useRoute()
const auth = useAuthStore()

const menus = [
  { path: '/dashboard', label: '总览', icon: House },
  { path: '/users', label: '用户管理', icon: User },
  { path: '/documents', label: '文档管理', icon: Document },
  { path: '/templates', label: '模板管理', icon: Collection },
  { path: '/ai-logs', label: 'AI 调用日志', icon: DataAnalysis }
]

const activeMenu = computed(() => route.path)

const currentTitle = computed(() => {
  return (route.meta?.title as string) || '控制台'
})

function onLogout() {
  auth.doLogout()
  router.push('/login')
}
</script>

<template>
  <el-container class="layout">
    <!-- 侧边栏 -->
    <el-aside class="layout__aside" width="220px">
      <div class="layout__logo">aiWord 控制台</div>
      <el-menu
        :default-active="activeMenu"
        router
        background-color="#001529"
        text-color="#cbd5e0"
        active-text-color="#fff"
      >
        <el-menu-item v-for="m in menus" :key="m.path" :index="m.path">
          <el-icon><component :is="m.icon" /></el-icon>
          <span>{{ m.label }}</span>
        </el-menu-item>
      </el-menu>
    </el-aside>

    <el-container>
      <!-- 顶部 -->
      <el-header class="layout__header">
        <div class="layout__title">{{ currentTitle }}</div>
        <el-dropdown @command="(c) => c === 'logout' && onLogout()">
          <span class="layout__user">
            <el-avatar :size="28">{{ auth.user?.nickname?.slice(0, 1) ?? 'A' }}</el-avatar>
            <span class="layout__user-name">{{ auth.user?.nickname ?? '管理员' }}</span>
            <span class="layout__user-role">({{ auth.user?.role ?? '-' }})</span>
          </span>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="logout">
                <el-icon><SwitchButton /></el-icon> 退出登录
              </el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </el-header>

      <!-- 主区 -->
      <el-main class="layout__main">
        <router-view />
      </el-main>
    </el-container>
  </el-container>
</template>

<style scoped lang="scss">
.layout {
  height: 100vh;
}
.layout__aside {
  background: #001529;
  color: #fff;
}
.layout__logo {
  height: 60px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  font-weight: 600;
  color: #fff;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}
.layout__aside :deep(.el-menu) {
  border-right: none;
}
.layout__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: #fff;
  border-bottom: 1px solid var(--console-border);
  padding: 0 24px;
}
.layout__title {
  font-size: 16px;
  font-weight: 500;
}
.layout__user {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  color: var(--console-text);
}
.layout__user-name {
  font-size: 14px;
}
.layout__user-role {
  font-size: 12px;
  color: #909399;
}
.layout__main {
  background: var(--console-bg);
  padding: 16px;
  overflow: auto;
}
</style>