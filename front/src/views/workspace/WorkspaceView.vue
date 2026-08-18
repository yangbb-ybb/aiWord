<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { Fold, Expand, Share, SwitchButton } from '@element-plus/icons-vue'
import BrandLogo from '@/components/layout/BrandLogo.vue'
import LeftSidebar from './components/LeftSidebar.vue'
import CenterEditor from './components/CenterEditor.vue'
import RightPanel from './components/RightPanel.vue'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const router = useRouter()

const leftCollapsed = ref(false)
const rightCollapsed = ref(false)

const avatarLetter = computed(() =>
  (auth.user?.nickname ?? 'A').slice(0, 1).toUpperCase()
)
const avatarSrc = computed(() => auth.user?.avatar ?? '')

async function handleLogout() {
  await auth.logout()
  ElMessage.success('已退出登录')
  router.replace('/login')
}

async function onUserCommand(cmd: string) {
  if (cmd === 'logout') await handleLogout()
}
</script>

<template>
  <div class="workspace">
    <!-- 顶栏 -->
    <header class="topbar">
      <div class="topbar__left">
        <BrandLogo />
        <button
          class="topbar__toggle"
          @click="leftCollapsed = !leftCollapsed"
          :title="leftCollapsed ? '展开左侧' : '收起左侧'"
        >
          <el-icon>
            <component :is="leftCollapsed ? Expand : Fold" />
          </el-icon>
        </button>
      </div>

      <div class="topbar__center">
        <span class="topbar__breadcrumb">工作台</span>
        <span class="topbar__sep">/</span>
        <span class="topbar__page">AI 写作</span>
      </div>

      <div class="topbar__right">
        <button
          class="topbar__icon-btn"
          @click="rightCollapsed = !rightCollapsed"
          :title="rightCollapsed ? '展开右侧 AI 面板' : '收起右侧 AI 面板'"
        >
          <el-icon>
            <component :is="rightCollapsed ? Expand : Fold" />
          </el-icon>
        </button>
        <button class="topbar__icon-btn" title="历史记录">
          <el-icon><Share /></el-icon>
        </button>
        <el-dropdown trigger="click" @command="onUserCommand">
          <div class="topbar__user" :title="auth.user?.nickname">
            <img
              v-if="avatarSrc"
              :src="avatarSrc"
              class="topbar__avatar topbar__avatar--img"
              :alt="auth.user?.nickname"
            />
            <div v-else class="topbar__avatar">{{ avatarLetter }}</div>
          </div>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item disabled>
                <div class="ud-name">{{ auth.user?.nickname }}</div>
                <div class="ud-sub">{{ auth.user?.email || auth.user?.phone || '未绑定' }}</div>
              </el-dropdown-item>
              <el-dropdown-item divided command="logout">
                <el-icon><SwitchButton /></el-icon>
                <span>退出登录</span>
              </el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </div>
    </header>

    <!-- 主体三栏：flex 布局，左/右栏 width 过渡收缩，中央始终 flex:1 -->
    <div class="workspace__body">
      <div
        class="workspace__col workspace__col--left"
        :class="{ 'is-collapsed': leftCollapsed }"
      >
        <LeftSidebar />
      </div>

      <div class="workspace__center">
        <CenterEditor />
      </div>

      <div
        class="workspace__col workspace__col--right"
        :class="{ 'is-collapsed': rightCollapsed }"
      >
        <RightPanel />
      </div>
    </div>
  </div>
</template>

<style scoped>
.workspace {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: var(--bg-app);
}

.topbar {
  height: var(--topbar-height);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 var(--space-5);
  background: var(--bg-card);
  border-bottom: 1px solid var(--border-soft);
  flex-shrink: 0;
  z-index: 10;
}
.topbar__left {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  flex: 0 0 auto;
  padding-right: var(--space-3);
  min-width: 220px;
}
.topbar__toggle {
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-secondary);
  transition: background 0.15s ease, color 0.15s ease;
}
.topbar__toggle:hover {
  background: var(--bg-muted);
  color: var(--color-brand);
}
.topbar__center {
  flex: 1;
  text-align: center;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  font-size: var(--fs-sm);
  color: var(--text-secondary);
}
.topbar__breadcrumb {
  color: var(--text-muted);
}
.topbar__sep {
  color: var(--text-muted);
}
.topbar__page {
  font-weight: 600;
  color: var(--text-primary);
}
.topbar__right {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  flex: 0 0 auto;
}
.topbar__icon-btn {
  width: 34px;
  height: 34px;
  display: grid;
  place-items: center;
  border: none;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--text-secondary);
  transition: background 0.15s ease, color 0.15s ease;
}
.topbar__icon-btn:hover {
  background: var(--bg-muted);
  color: var(--color-brand);
}
.topbar__avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: linear-gradient(
    135deg,
    var(--color-accent-from) 0%,
    var(--color-accent-to) 100%
  );
  color: #fff;
  font-weight: 600;
  display: grid;
  place-items: center;
  font-size: 13px;
  cursor: pointer;
  box-shadow: 0 2px 6px rgba(99, 102, 241, 0.3);
}

/* ---------- 主体：flex 三栏，折叠时 width → 0 + opacity → 0 ---------- */

.workspace__body {
  flex: 1;
  display: flex;
  min-height: 0;
  overflow: hidden;
}

.workspace__col {
  flex: 0 0 auto;
  min-width: 0;
  min-height: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  transition:
    width 0.25s cubic-bezier(0.4, 0, 0.2, 1),
    opacity 0.2s ease;
}
.workspace__col--left {
  width: var(--sidebar-width);
  border-right: 1px solid var(--border-soft);
  background: var(--bg-card);
}
.workspace__col--right {
  width: var(--rightbar-width);
  border-left: 1px solid var(--border-soft);
  background: var(--bg-card);
}

/* 折叠：宽度收到 0，内容被 overflow:hidden 裁掉 + opacity 0 */
.workspace__col.is-collapsed {
  width: 0 !important;
  opacity: 0;
  pointer-events: none;
  border-color: transparent;
}

.workspace__center {
  flex: 1 1 0;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--bg-app);
}

/* 中屏（1024 - 1280）：左/右栏按比例压缩 */
@media (max-width: 1280px) {
  :root {
    --sidebar-width: 220px;
    --rightbar-width: 280px;
  }
}

/* 小屏（<1024）：三栏垂直堆叠，折叠隐藏 */
@media (max-width: 1024px) {
  :root {
    --sidebar-width: 100%;
    --rightbar-width: 100%;
  }
  .workspace__body {
    flex-direction: column;
    overflow-y: auto;
  }
  .workspace__center {
    flex: 1 1 auto;
    min-height: 400px;
  }
  .workspace__col {
    width: 100%;
    border-right: none;
    border-left: none;
    border-bottom: 1px solid var(--border-soft);
  }
  .workspace__col.is-collapsed {
    height: 0 !important;
    border: none;
  }
}

/* 极端窄屏：面包屑省位 */
@media (max-width: 720px) {
  .topbar__center {
    display: none;
  }
}
</style>
