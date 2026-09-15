/**
 * 应用运行配置：由各端应用在启动时（main.ts）调用 setupApp 注入。
 * 管理端与机构端共用一套请求 / Mock 基础设施，通过 appName 区分 token 存储与 Mock 账号库。
 */
export type AppName = 'admin' | 'tenant'

export interface AppConfig {
  appName: AppName
  /** 真实后端网关地址，默认 '/api'（配合 Vite proxy 使用） */
  apiBaseUrl: string
}

let currentConfig: AppConfig = {
  appName: 'admin',
  apiBaseUrl: '/api',
}

export function setupApp(config: Partial<AppConfig>): void {
  currentConfig = { ...currentConfig, ...config }
}

export function getAppConfig(): AppConfig {
  return currentConfig
}

/** 各端独立的 localStorage key，避免同域部署时相互覆盖 */
export function getTokenKey(): string {
  return `aiteach:${currentConfig.appName}:token`
}

export function getUserKey(): string {
  return `aiteach:${currentConfig.appName}:user`
}
