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

/**
 * 登录租户ID 的 localStorage key。
 *
 * 独立存一份而不是每次请求都从 getUserKey() 的 JSON 里解出来：请求层每个请求都要读它，
 * 而请求层（request/client.ts）不能 import api/auth.ts —— auth.ts 反向依赖 request，会成环。
 * 存成独立键让请求层只依赖 config，依赖方向保持单向。
 */
export function getTenantKey(): string {
  return `aiteach:${currentConfig.appName}:tenantId`
}

/**
 * 会话到期时间戳（毫秒）的 localStorage key。与 tenantId 同理独立存一份，
 * 让请求层的前置过期判断只依赖 config（见 auth/session.ts）。
 */
export function getTokenExpireKey(): string {
  return `aiteach:${currentConfig.appName}:tokenExpire`
}

/** 上次登录成功的账号名，用于登录页「记住账号」回填。**只存账号，不存密码** */
export function getLastAccountKey(): string {
  return `aiteach:${currentConfig.appName}:last-account`
}
