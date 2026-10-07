import type { HttpMethod } from '../request/types'
import { persistMockState } from './persist'

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
  /* 写请求成功即落一份快照（见 persist.ts）。同步写、且紧跟在 handler 之后：机构端拿到结果就
     开新标签页打开试卷编辑页，晚一步落盘，新标签页读到的还是种子数据。GET 不改内存态，跳过。 */
  if (route.method !== 'GET') persistMockState()
  return detach(result) as T
}

/**
 * 把响应与 store 里的活对象脱钩。
 *
 * 直接返回 store 里的数组 / 对象时，视图里 `x.value = await fetch()` 前后是同一个引用，
 * Vue 判定「未变化」而不触发更新 —— 轻则表现为「新增/上传/组卷成功但列表不刷新」，
 * 重则更隐蔽：对象身份没变 → 依赖它的 computed（卷面题数、总分…）缓存不失效，于是
 * 同一屏里「模板函数重算」的部分已经刷新、「computed 缓存」的部分还是旧值，
 * 出现自相矛盾的两个数字（协同组卷抽题后就遇到过：题型进度 7/8，头部却仍写「共 3 题」）。
 *
 * 数组浅拷贝（换身份、保留元素引用）够用；对象必须**深**拷贝 —— 像 `{ task, paper }`
 * 这种包装响应，浅拷贝只换了最外层，里面的 `paper` 仍是 store 里的同一个活对象，
 * 视图 `paper.value = res.paper` 依旧触发不了更新。
 */
function detach<T>(result: unknown): T {
  if (Array.isArray(result)) return [...result] as T
  if (result === null || typeof result !== 'object') return result as T
  try {
    return structuredClone(result) as T
  } catch {
    /* 响应里混入了不可结构化克隆的值（函数 / 类实例）时退回浅拷贝，至少保住引用刷新 */
    return { ...(result as Record<string, unknown>) } as T
  }
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
