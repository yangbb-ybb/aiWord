<script setup lang="ts">
/**
 * 首页占位：
 * - 顶部 logo + 标题 + 说明
 * - 下方加了一个"功能入口"区,目前只有"AI 出图"demo
 * - 后续按需补充更多入口(列表 / 编辑器 等)
 *
 * 验证骨架可用:Vant 自动按需 + 路由 + Pinia 都装好了
 */
import { useRouter } from 'vue-router'

const router = useRouter()

interface FeatureEntry {
  emoji: string
  title: string
  desc: string
  to: string
}

const features: FeatureEntry[] = [
  {
    emoji: '🎨',
    title: 'AI 出图',
    desc: '输入描述生成图片(纯前端 demo)',
    to: '/image'
  }
  // 后续按需添加:文档列表 / 编辑器 / AI 对话 等
]

function go(to: string) {
  router.push(to)
}
</script>

<template>
  <div class="home">
    <van-nav-bar title="aiWord" :border="false" />
    <main class="home__main">
      <div class="home__logo">📝</div>
      <h1 class="home__title">aiWord H5</h1>
      <p class="home__desc">移动端写作助手骨架已就绪</p>
      <p class="home__hint">页面功能后续按需添加</p>

      <section class="home__features">
        <p class="home__features-title">功能入口</p>
        <van-cell-group inset>
          <van-cell
            v-for="f in features"
            :key="f.to"
            :title="`${f.emoji} ${f.title}`"
            :label="f.desc"
            is-link
            center
            @click="go(f.to)"
          />
        </van-cell-group>
      </section>
    </main>
  </div>
</template>

<style scoped lang="scss">
.home {
  min-height: 100vh;
  background: var(--van-background-2);
}

.home__main {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 80px 0 32px;
  text-align: center;
}

.home__logo {
  font-size: 80px;
  line-height: 1;
  margin-bottom: 20px;
}

.home__title {
  font-size: 28px;
  font-weight: 600;
  margin: 0 0 8px;
  color: var(--van-text-color);
}

.home__desc {
  font-size: 16px;
  color: var(--van-text-color-2);
  margin: 0 0 4px;
}

.home__hint {
  font-size: 13px;
  color: var(--van-text-color-3);
  margin: 0 0 32px;
}

.home__features {
  width: 100%;
  max-width: 480px;
}

.home__features-title {
  font-size: 13px;
  color: var(--van-text-color-3);
  margin: 0 16px 8px;
  text-align: left;
}
</style>
