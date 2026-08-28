import { defineStore } from 'pinia'
import { ref } from 'vue'

/**
 * 全局 App store 骨架：
 * - 当前只有 `initialized` 一个占位字段
 * - 后续按需扩展：userInfo / networkStatus / themeMode 等
 *
 * 命名为 useAppStore，与具体业务 store（useDocumentStore 等）区分开
 */
export const useAppStore = defineStore('app', () => {
  const initialized = ref(false)

  function init() {
    initialized.value = true
  }

  return { initialized, init }
})
