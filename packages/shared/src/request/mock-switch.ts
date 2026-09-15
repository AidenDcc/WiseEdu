/**
 * Mock / 真实后端 切换器。
 *
 * 判定优先级（对单个请求 URL）：
 *   1. VITE_REMOTE_SERVICES 中声明的前缀命中 → 强制走真实后端（按服务灰度切换）
 *   2. VITE_USE_MOCK === 'false' → 全局切换到真实后端
 *   3. 其余情况（默认）→ 走 Mock
 *
 * 配置示例（各端 .env.development）：
 *   VITE_USE_MOCK=true          # 全局 Mock
 *   VITE_REMOTE_SERVICES=auth   # 仅 auth 服务走真实后端，其余仍走 Mock
 *   VITE_USE_MOCK=false         # 全部走真实后端
 */
export type ApiMode = 'mock' | 'remote'

export function resolveApiMode(url: string): ApiMode {
  const env = import.meta.env
  const remoteRaw: string = env.VITE_REMOTE_SERVICES ?? ''
  const remoteServices: string[] = remoteRaw
    .split(',')
    .map((item: string) => item.trim())
    .filter(Boolean)

  const normalizedUrl = url.startsWith('/') ? url.slice(1) : url
  if (
    remoteServices.some(
      (prefix) => normalizedUrl.startsWith(prefix) || url.startsWith(prefix),
    )
  ) {
    return 'remote'
  }

  const useMock = env.VITE_USE_MOCK !== 'false'
  return useMock ? 'mock' : 'remote'
}
