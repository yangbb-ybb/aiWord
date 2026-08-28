import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
// Vant 4 样式：unplugin-vue-components 配 VantResolver 仍需全局引入 CSS（只引入一次）
// 后续如需按需 CSS，可改用 unplugin-vant 方案
import 'vant/lib/index.css'
import './styles/index.scss'

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.mount('#app')
