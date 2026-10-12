import { createApp } from 'vue'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import { armSessionWatch, clearSession, registerSessionExpiredHandler, setupApp } from '@aiteach/shared'
import { provideBusinessApi } from '@aiteach/business-common'
import App from './App.vue'
import router from './router'
import { businessApi } from './api/bank'
import './styles/main.css'
/* Element Plus 只用来补齐日期选择（日历弹层）——自有设计系统里没有这号控件。
   整包引入是刻意的：本端是演示原型，按需引入要再搭一套 unplugin 配置，
   收益只有产物体积，而产物这里不敏感。locale 传中文，否则日历是英文月份/星期。 */
import 'element-plus/dist/index.css'

// 注入端标识：管理端使用独立的 token 存储与 Mock 账号库
setupApp({ appName: 'admin', apiBaseUrl: import.meta.env.VITE_API_BASE_URL ?? '/api' })

/* 把平台端自己的数据访问层注入题库 / 试卷公共层（见 packages/business-common/src/api/business-api.ts）。
   公共组件（列表骨架 / 预览 / 树 / 筛选面板）只调用契约上的方法，不认端、也不认 URL ——
   平台端将来换成 /admin/platform/** 时只改 ./api/bank.ts。 */
provideBusinessApi(businessApi)

/* 会话失效的统一出口：路由守卫、请求层、到期看门狗三条通路都收敛到这里。
   清会话 + 跳登录页（带回跳地址，重登后回到原页面）。 */
registerSessionExpiredHandler(() => {
  clearSession()
  const current = router.currentRoute.value
  if (current.path === '/login') return
  void router.replace({ path: '/login', query: { redirect: current.fullPath } })
})

const app = createApp(App)
app.use(createPinia())
app.use(ElementPlus, { locale: zhCn })
app.use(router)
app.mount('#app')

/* 到期看门狗。等 router.isReady() 再启：定时器不跨刷新存活，启动时要为「带着有效会话刷新」
   补一次；而此刻若已经过期，回调会用到 currentRoute —— 首屏导航还没落定时它还是空路径，
   立即跳转会把深链的 redirect 丢掉。守卫本身已经能拦住那次导航，这里只需覆盖之后的到点。 */
void router.isReady().then(() => armSessionWatch())
