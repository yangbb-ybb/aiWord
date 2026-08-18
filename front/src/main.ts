import { createApp } from 'vue'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import * as ElementPlusIconsVue from '@element-plus/icons-vue'

import App from './App.vue'
import router from './router'
import { useDocumentStore } from './stores/document'

import './styles/reset.css'
import './styles/variables.css'

const app = createApp(App)

// 注册全部 Element Plus 图标
for (const [key, component] of Object.entries(ElementPlusIconsVue)) {
  app.component(key, component as any)
}

const pinia = createPinia()
app.use(pinia)
app.use(router)
app.use(ElementPlus)

app.mount('#app')

// 关闭/刷新页面前，把文档里待保存的内容一次性 flush 到后端
// 注意：此时 pinia 已经挂载，可以拿 store
const docStore = useDocumentStore()
window.addEventListener('beforeunload', () => {
  docStore.flushPendingSaves()
})
