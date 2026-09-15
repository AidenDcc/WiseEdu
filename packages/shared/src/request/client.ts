import { getAppConfig, getTokenKey } from '../config'
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

  let response: Response
  try {
    response = await fetch(fullUrl, {
      method: options.method ?? 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: options.data !== undefined ? JSON.stringify(options.data) : undefined,
    })
  } catch (error) {
    throw new ApiError(-1, '网络异常，请稍后重试', error)
  }

  if (!response.ok) {
    throw new ApiError(response.status, `请求失败（HTTP ${response.status}）`)
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
