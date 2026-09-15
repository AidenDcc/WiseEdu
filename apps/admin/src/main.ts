import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { setupApp } from '@aiteach/shared'
import App from './App.vue'
import router from './router'
import './styles/main.css'

// 注入端标识：管理端使用独立的 token 存储与 Mock 账号库
setupApp({ appName: 'admin', apiBaseUrl: import.meta.env.VITE_API_BASE_URL ?? '/api' })

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.mount('#app')
