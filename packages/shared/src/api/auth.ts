import { request } from '../request/client'
import { getTenantKey, getTokenKey, getUserKey } from '../config'
import type { SessionUser } from '../mock/types'

export interface LoginPayload {
  account: string
  password: string
}

export interface LoginResult {
  token: string
  user: SessionUser
}

export function loginApi(payload: LoginPayload): Promise<LoginResult> {
  return request<LoginResult>('/auth/login', { method: 'POST', data: payload })
}

export function fetchCurrentUser(): Promise<SessionUser> {
  return request<SessionUser>('/auth/me')
}

export function logoutApi(): Promise<null> {
  return request<null>('/auth/logout', { method: 'POST' })
}

/* ---------------- 本地会话存取 ---------------- */

export function getToken(): string | null {
  return localStorage.getItem(getTokenKey())
}

export function setSession(token: string, user: SessionUser): void {
  localStorage.setItem(getTokenKey(), token)
  localStorage.setItem(getUserKey(), JSON.stringify(user))
  // 单独存一份供请求层读取（原因见 config.getTenantKey）。
  // tenantId 为 0（平台侧）是有效值，要用 != null 判断而不是真值判断
  if (user.tenantId != null) {
    localStorage.setItem(getTenantKey(), String(user.tenantId))
  } else {
    localStorage.removeItem(getTenantKey())
  }
}

export function getCacheUser(): SessionUser | null {
  const raw = localStorage.getItem(getUserKey())
  if (!raw) return null
  try {
    return JSON.parse(raw) as SessionUser
  } catch {
    return null
  }
}

/**
 * 当前登录租户ID；平台侧为 0，未登录为 null。
 * 需要判断「是否有租户」时用 `getTenantId()` 真值判断（0 是平台侧，不是无租户）。
 */
export function getTenantId(): number | null {
  const raw = localStorage.getItem(getTenantKey())
  if (raw === null || raw === '') return null
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : null
}

export function clearSession(): void {
  localStorage.removeItem(getTokenKey())
  localStorage.removeItem(getUserKey())
  localStorage.removeItem(getTenantKey())
}
