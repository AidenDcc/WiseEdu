import type { HttpMethod } from '../request/types'

export interface MockContext {
  /** 请求体 */
  body: Record<string, unknown>
  /** 查询参数 */
  query: Record<string, string>
  /** 请求路径（去查询串） */
  path: string
}

export type MockHandler = (ctx: MockContext) => unknown

export interface MockRoute {
  method: HttpMethod
  /** 路径，如 '/auth/login'；以 '/*' 结尾表示前缀匹配 */
  path: string
  handler: MockHandler
  /** 模拟网络延迟（ms），默认 200–600 随机 */
  delay?: number
}

const routes: MockRoute[] = []

export function registerMockRoutes(newRoutes: MockRoute[]): void {
  routes.push(...newRoutes)
}

export function matchMockRoute(method: string, path: string): MockRoute | undefined {
  const purePath = path.split('?')[0]
  return (
    routes.find(
      (route) =>
        route.method === method.toUpperCase() && route.path === purePath,
    ) ??
    routes.find((route) => {
      if (route.method !== method.toUpperCase()) return false
      return route.path.endsWith('/*') && purePath.startsWith(route.path.slice(0, -1))
    })
  )
}

/** 模拟后端处理：随机延迟 → 路由匹配 → 返回 data（失败通过 mockFail 抛出） */
export async function dispatchMock<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const route = matchMockRoute(method, path)
  if (!route) {
    console.warn(`[mock] 未注册的接口：${method.toUpperCase()} ${path}`)
    throw Object.assign(new Error(`Mock 未注册：${method.toUpperCase()} ${path}`), {
      code: 501,
    })
  }

  const delay = route.delay ?? 200 + Math.random() * 400
  await sleep(delay)

  const query = parseQuery(path)
  const result = await route.handler({
    body: (body ?? {}) as Record<string, unknown>,
    query,
    path: path.split('?')[0],
  })
  /* 列表响应做浅拷贝：直接返回 store 的数组时，视图里 `list.value = await fetch()` 前后是
     同一个引用，Vue 判定未变化而不触发更新 —— 表现为「新增/上传/组卷成功但列表不刷新」。
     浅拷贝只换数组身份、保留元素引用，既能触发更新又不改变既有的写穿语义。 */
  return (Array.isArray(result) ? [...result] : result) as T
}

function parseQuery(path: string): Record<string, string> {
  const result: Record<string, string> = {}
  const index = path.indexOf('?')
  if (index === -1) return result
  for (const [key, value] of new URLSearchParams(path.slice(index + 1))) {
    result[key] = value
  }
  return result
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Mock handler 内抛出的「业务失败」：最终以 { code, message } 形式返回给前端 */
export function mockFail(code: number, message: string): never {
  throw Object.assign(new Error(message), { code, __mockFail: true })
}
