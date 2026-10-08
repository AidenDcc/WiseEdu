import { getAppConfig, getTenantKey, getTokenKey } from '../config'
import { isSessionExpired, notifySessionExpired } from '../auth/session'
import { ApiError } from './api-error'
import { resolveApiMode } from './mock-switch'
import { dispatchMock } from '../mock/engine'
import type { ApiResponse, RequestOptions } from './types'
import '../mock' // 注册全部 Mock 路由（副作用导入）

/**
 * 豁免会话过期检查的接口路径。
 *
 * 少了这两个，会话一过期就连「重新登录」都发不出去 —— 登录请求自己会被闸拦下，
 * 死在登录页；登出同理（过期后点退出，不该再弹「登录已失效」）。
 */
const SESSION_EXEMPT_PATHS = ['/auth/login', '/auth/logout']

/**
 * 统一请求入口：管理端 / 机构端所有 API 均经由此函数发出。
 * 请求先经过 resolveApiMode 判定走 Mock 引擎还是真实后端：统一开关 VITE_USE_MOCK
 * 关闭时全部走 Mock，打开时只有 backend-ready.ts 已登记的接口走真实后端、其余回退 Mock。
 * 业务代码不感知该判定，接入后端时零改动。
 *
 * 发请求前还有一道**会话过期闸**（放在 resolveApiMode 之前，Mock 与真实后端两条分支共用）：
 * 会话到期后前端 localStorage 里可能还留着 token，不拦的话请求会带着废 token 打出去、
 * 各自报一堆看不懂的错，用户也不知道该重新登录。这里统一抛 401 并触发登出流程。
 */
export async function request<T>(url: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? 'GET'

  if (!isSessionExempt(url) && isSessionExpired()) {
    notifySessionExpired()
    throw new ApiError(401, '登录已失效，请重新登录')
  }

  if (resolveApiMode(url) === 'mock') {
    return dispatchMock<T>(method, url, options.data)
  }

  return remoteRequest<T>(url, options)
}

function isSessionExempt(url: string): boolean {
  const path = url.split('?')[0] ?? url
  return SESSION_EXEMPT_PATHS.includes(path)
}

async function remoteRequest<T>(url: string, options: RequestOptions): Promise<T> {
  const { apiBaseUrl } = getAppConfig()
  const fullUrl = buildUrl(apiBaseUrl + url, options.params)
  const token = localStorage.getItem(getTokenKey()) ?? ''
  const tenantId = localStorage.getItem(getTenantKey())

  let response: Response
  try {
    response = await fetch(fullUrl, {
      method: options.method ?? 'GET',
      headers: {
        'Content-Type': 'application/json',
        // JeecgBoot 后端只认 X-Access-Token（见 JwtFilter），不认 Authorization: Bearer
        ...(token ? { 'X-Access-Token': token } : {}),
        // 租户上下文。后端以 token 内的登录租户为准，此头只在「已切换租户」时作为切换申请，
        // 不属于该用户的租户会被后端拒绝 —— 它不是可信来源，仅用于筛选
        ...(tenantId ? { 'X-Tenant-Id': String(tenantId) } : {}),
      },
      body: options.data !== undefined ? JSON.stringify(options.data) : undefined,
    })
  } catch (error) {
    throw new ApiError(-1, '网络异常，请稍后重试', error)
  }

  if (!response.ok) {
    // 真实后端的 token 过期只能靠 HTTP 401 兜底（本地到期的情形上面的闸已经拦下）。
    // **只认 401**：403 是「无权限」，普通越权拒绝不该把用户踢下线。
    if (response.status === 401) notifySessionExpired()

    // 后端鉴权失败走的是 JwtUtil.responseError，HTTP 状态码非 2xx 但 body 里带 message，
    // 直接丢掉的话前端只能显示「请求失败（HTTP 401）」，看不到「登录已失效」这类可行动提示
    throw new ApiError(response.status, await readErrorMessage(response))
  }

  const payload = (await response.json()) as ApiResponse<T>
  if (payload.code !== 0) {
    throw new ApiError(payload.code, payload.message)
  }
  return payload.data
}

function buildUrl(url: string, params?: RequestOptions['params']): string {
  if (!params) return url
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      search.append(key, String(value))
    }
  }
  const qs = search.toString()
  return qs ? `${url}?${qs}` : url
}

/**
 * 从错误响应体里取可展示的提示。
 *
 * 后端两种错误体都要认：教学云接口是 {code,message,data}，框架的鉴权/全局异常是
 * {success,code,message,result}。取不到就回落到带状态码的兜底文案。
 */
async function readErrorMessage(response: Response): Promise<string> {
  const fallback = `请求失败（HTTP ${response.status}）`
  try {
    const body = (await response.json()) as { message?: string }
    return body?.message?.trim() || fallback
  } catch {
    // 响应体不是 JSON（如网关直接拒绝），保持兜底文案
    return fallback
  }
}
