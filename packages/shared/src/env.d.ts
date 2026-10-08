/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>
  export default component
}

interface ImportMetaEnv {
  /** Vite 内置：开发构建为 true、生产构建为 false。用来包住只该在 dev 跑的自检代码
      （如 auth/accounts.ts 的 SHA-256 向量），生产构建会被静态剔除 */
  readonly DEV: boolean
  /**
   * 统一的 Mock / 后端开关：
   * - 'true'（默认，含未配置）→ 全部走 Mock，与接入后端之前完全一致
   * - 'false' → 后端已实现的接口走真实后端，未实现的仍回退 Mock
   *             （已实现清单见 request/backend-ready.ts）
   */
  readonly VITE_USE_MOCK?: string
  /** 真实后端 API 地址（网关前缀），默认 '/api' */
  readonly VITE_API_BASE_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
