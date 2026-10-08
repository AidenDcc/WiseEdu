import { request } from '../request/client'
import { getLastAccountKey, getTenantKey, getTokenKey, getUserKey } from '../config'
import { beginSession, endSession } from '../auth/session'
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

/** 登录成功时写入会话：token + 用户缓存 + 租户 + **新的 30 分钟有效期** */
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
  beginSession()
}

/**
 * 只更新用户缓存（含租户），**不碰 token 与有效期**。
 *
 * 给「换了当前身份但没重新登录」的场景用：机构端顶栏的「切换演示身份」会在原地把
 * `auth.user` 换成另一个角色。如果那里图省事调 `setSession`，每切一次身份就会把有效期
 * 续满 30 分钟，「固定 30 分钟到点必重登」直接失效 —— 这个坑很容易踩，故单独开一个函数。
 */
export function updateSessionUser(user: SessionUser): void {
  localStorage.setItem(getUserKey(), JSON.stringify(user))
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
  endSession()
}

/* ---------------- 「记住账号」（只记账号，不记密码） ---------------- */

/**
 * 上次登录成功的账号名，用于登录页回填；没有则返回空串。
 *
 * 「记住我（7 天免登录）」已被移除：会话有效期是固定 30 分钟、不滑动续期，
 * 承诺 7 天免登录自相矛盾。现在只持久化账号名 —— **密码永不落盘、永不回填**。
 */
export function getLastAccount(): string {
  return localStorage.getItem(getLastAccountKey()) ?? ''
}

/** 登录**成功**后调用（失败不记，免得把打错的账号名留下来） */
export function rememberAccount(account: string): void {
  const normalized = account.trim()
  if (normalized) localStorage.setItem(getLastAccountKey(), normalized)
  else forgetAccount()
}

/** 取消勾选「记住账号」时调用，让下次打开登录页不再回填 */
export function forgetAccount(): void {
  localStorage.removeItem(getLastAccountKey())
}
