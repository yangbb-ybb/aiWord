import { createApp } from 'vue'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import App from './App.vue'
import router from './router'
import './styles/index.scss'

/**
 * 入口:
 *  - Element Plus 全量引入(MVP 阶段不考虑按需优化,首屏体积不重要)
 *  - 后续如果体积成问题,改成 unplugin-vue-components 按需
 */
const app = createApp(App)
app.use(createPinia())
app.use(router)
app.use(ElementPlus)
app.mount('#app')