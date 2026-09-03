import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers'
import path from 'node:path'

/**
 * aiWord 运营控制台 dev/build 配置。
 *
 * - 端口 5175(跟 fronth5=5174、end=8787 错开)
 * - 代理 /api 到 end 后端(8787),dev 模式直接对端
 * - Element Plus 用 unplugin 自动按需引入,不需要手动 import
 */
export default defineConfig({
  plugins: [
    vue(),
    AutoImport({
      imports: ['vue', 'vue-router', 'pinia'],
      resolvers: [ElementPlusResolver()],
      dts: 'src/auto-imports.d.ts'
    }),
    Components({
      resolvers: [ElementPlusResolver()],
      dts: 'src/components.d.ts'
    })
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src')
    }
  },
  server: {
    port: 5175,
    host: '0.0.0.0',
    proxy: {
      // dev 模式把 /api/* 直接转发到 end 后端,避免 CORS 麻烦
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true
      }
    }
  }
})