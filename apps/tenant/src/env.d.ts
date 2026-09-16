/// <reference types="vite/client" />

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, unknown>, Record<string, unknown>, unknown>
  export default component
}

/** Vite 环境变量类型补全（AI 出题 / Deepseek 通道 / 拍照识题视觉通道） */
interface ImportMetaEnv {
  readonly VITE_DEEPSEEK_API_KEY?: string
  /** 默认 '/deepseek'，由 vite dev proxy 转发到 api.deepseek.com；生产指向自建网关 */
  readonly VITE_DEEPSEEK_BASE_URL?: string
  readonly VITE_DEEPSEEK_MODEL?: string
  /** 拍照识题视觉模型（OpenAI 兼容多模态端点），与 Key 同时配置才启用真实识别 */
  readonly VITE_VISION_API_KEY?: string
  /** 默认 '/vision'，由 vite dev proxy 转发；生产指向自建网关 */
  readonly VITE_VISION_BASE_URL?: string
  readonly VITE_VISION_MODEL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
