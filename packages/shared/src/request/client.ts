import { getAppConfig, getTenantKey, getTokenKey } from '../config'
import { ApiError } from './api-error'
import { resolveApiMode } from './mock-switch'
import { dispatchMock } from '../mock/engine'
import type { ApiResponse, RequestOptions } from './types'
import '../mock' // 注册全部 Mock 路由（副作用导入）

/**
 * 统一请求入口：管理端 / 机构端所有 API 均经由此函数发出。
 * 请求先经过 resolveApiMode 判定走 Mock 引擎还是真实后端，
 * 因此后端就绪后仅需调整环境变量即可统一切换或按服务逐步切换，业务代码零改动。
 */
export async function request<T>(url: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? 'GET'

  if (resolveApiMode(url) === 'mock') {
    return dispatchMock<T>(method, url, options.data)
  }

  return remoteRequest<T>(url, options)
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
