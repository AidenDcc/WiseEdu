/* 必须最先引入：为依赖链里的 Node polyfill 补上 process 全局 */
import './shims/node-globals'
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { setupApp } from '@aiteach/shared'
import App from './App.vue'
import router from './router'
import './styles/main.css'

// 注入端标识：机构端使用独立的 token 存储与 Mock 账号库
setupApp({ appName: 'tenant', apiBaseUrl: import.meta.env.VITE_API_BASE_URL ?? '/api' })

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.mount('#app')
