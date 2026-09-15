/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>
  export default component
}

interface ImportMetaEnv {
  readonly VITE_USE_MOCK?: string
  readonly VITE_API_BASE_URL?: string
  readonly VITE_REMOTE_SERVICES?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

interface ImportMetaEnv {
  /** 全局 Mock 开关：'false' 时全部请求走真实后端，默认（未配置）为开启 Mock */
  readonly VITE_USE_MOCK?: string
  /** 真实后端 API 地址（网关前缀），默认 '/api' */
  readonly VITE_API_BASE_URL?: string
  /** 指定走真实后端的服务前缀（逗号分隔），如 'auth,user' —— 用于逐服务灰度切换 */
  readonly VITE_REMOTE_SERVICES?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
