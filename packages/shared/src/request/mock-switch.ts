import { isBackendReady } from './backend-ready'

/**
 * Mock / 真实后端 切换器。
 *
 * 只有一个统一开关 VITE_USE_MOCK（各端 .env.development / .env.production）：
 *
 *   VITE_USE_MOCK=true（默认，含未配置）→ 全部走 Mock，与接入后端之前完全一致
 *   VITE_USE_MOCK=false                → 后端已实现的接口走真实后端，其余仍走 Mock
 *
 * 「其余仍走 Mock」是刻意设计：教学云后端分批落地（清单见 backend-ready.ts），
 * 打开开关时不希望未实现的接口打到后端变成 404，把页面弄得比纯 Mock 还不可用。
 * 因此开关打开≠所有请求都打后端——未登记的接口继续由 Mock 引擎承接，业务代码零改动。
 */
export type ApiMode = 'mock' | 'remote'

export function resolveApiMode(url: string): ApiMode {
  // 开关未打开时一律 Mock：这是「和以前一样」的档位，不看清单，也就不会因为
  // 某个接口登记了后端而在本地开发时被意外带走
  if (import.meta.env.VITE_USE_MOCK !== 'false') {
    return 'mock'
  }

  // 开关打开：清单内的接口走真实后端，清单外回退 Mock
  return isBackendReady(url) ? 'remote' : 'mock'
}
