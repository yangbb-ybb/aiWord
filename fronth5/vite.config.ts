import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import Components from 'unplugin-vue-components/vite'
import AutoImport from 'unplugin-auto-import/vite'
import { VantResolver } from '@vant/auto-import-resolver'
import pxToViewport from 'postcss-px-to-viewport'
import path from 'node:path'

/**
 * fronth5 移动端 H5 项目 Vite 配置：
 * - Vant 4 用 unplugin-vue-components + unplugin-auto-import + VantResolver 实现组件/API 自动按需
 * - postcss-px-to-viewport：设计稿按 375px 宽（iPhone 标准），px 自动转 vw
 *   - 黑名单里加 .ignore-vw（不转的类）和 Vant 内部圆环（避免动画被 vw 计算抖动）
 * - server.port=5174：与桌面端 front 的 5173 区分，可同时启动
 * - host=true：暴露给局域网，方便手机扫码真机调试
 */
export default defineConfig({
  plugins: [
    vue(),
    AutoImport({
      resolvers: [VantResolver()],
      // 自动生成类型声明文件，方便 vue-tsc 识别自动 import 的 API
      dts: 'src/auto-imports.d.ts'
    }),
    Components({
      resolvers: [VantResolver()],
      dts: 'src/components.d.ts'
    })
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      '~': path.resolve(__dirname, 'src')
    }
  },
  postcss: {
    plugins: [
      pxToViewport({
        unitToConvert: 'px',
        viewportWidth: 375,
        unitPrecision: 5,
        viewportUnit: 'vw',
        selectorBlackList: ['.ignore-vw', 'van-circle__layer'],
        minPixelValue: 1,
        mediaQuery: false
      })
    ]
  },
  server: {
    port: 5174,
    host: true
  }
})
