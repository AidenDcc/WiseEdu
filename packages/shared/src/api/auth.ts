import { request } from '../request/client'
import { getTokenKey, getUserKey } from '../config'
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

export function clearSession(): void {
  localStorage.removeItem(getTokenKey())
  localStorage.removeItem(getUserKey())
}
