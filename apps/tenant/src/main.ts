/* 必须最先引入：为依赖链里的 Node polyfill 补上 process 全局 */
import './shims/node-globals'
import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { armSessionWatch, clearSession, registerSessionExpiredHandler, setupApp } from '@aiteach/shared'
import { provideBusinessApi } from '@aiteach/business-common'
import App from './App.vue'
import router from './router'
import * as orgApi from './api/org'
import { clearDemoIdentity } from './composables/useDemoRole'
import './styles/main.css'
/* 富文本正文（.rte-content）的共用观感：录题编辑器、备课文档编辑器、只读渲染三处同源，
   写成全局而不是挂在某一个组件里（见该文件的说明） */
import './styles/richtext-content.css'
/* 两个编辑器（录题 / 备课文档）工具栏弹层里的共用原子件 —— 弹层 Teleport 到 body，
   写在组件里会各复制一份且互相看不见，故提到全局（见该文件的说明） */
import './styles/rte-popover.css'

// 注入端标识：机构端使用独立的 token 存储与 Mock 账号库
setupApp({ appName: 'tenant', apiBaseUrl: import.meta.env.VITE_API_BASE_URL ?? '/api' })

/* 把机构端自己的数据访问层注入题库 / 试卷公共层（见 packages/business-common/src/api/business-api.ts）。
   公共组件只调用契约上的方法，真正的 URL、查询参数与权限都在 ./api/org 里 ——
   换句话说，公共层的组件代码里既没有 /tenant 也没有 /admin。 */
provideBusinessApi(orgApi)

/* 会话失效的统一出口：路由守卫、请求层、到期看门狗三条通路都收敛到这里。
   清会话 + 复位演示身份 + 跳登录页（带回跳地址，重登后回到原页面）。 */
registerSessionExpiredHandler(() => {
  clearSession()
  clearDemoIdentity()
  const current = router.currentRoute.value
  if (current.path === '/login') return
  void router.replace({ path: '/login', query: { redirect: current.fullPath } })
})

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.mount('#app')

/* 到期看门狗。等 router.isReady() 再启：定时器不跨刷新存活，启动时要为「带着有效会话刷新」
   补一次；而此刻若已经过期，回调会用到 currentRoute —— 首屏导航还没落定时它还是空路径，
   立即跳转会把深链的 redirect 丢掉。守卫本身已经能拦住那次导航，这里只需覆盖之后的到点。 */
void router.isReady().then(() => armSessionWatch())
