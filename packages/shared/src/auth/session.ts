/**
 * 会话有效期：**固定 30 分钟，不滑动续期** —— 到点即失效，不因任何操作顺延。
 *
 * ## 为什么单独一个文件
 *
 * 请求层（request/client.ts）要在发请求前判断「会话是否过期」，但它不能 import api/auth.ts
 * —— auth.ts 反向依赖 request，会成环（同一个理由见 config.getTenantKey() 的注释）。
 * 所以过期判定与「失效通知」放这里，只依赖 config.ts。
 *
 * ## 过期时间存在哪、为什么
 *
 * 存 localStorage（`config.getTokenExpireKey()`），它是前端的**唯一事实源**：
 * Mock 的 token 是随机串、真实后端的是 JWT，前端没法用同一套办法从 token 里解出过期时间，
 * 所以不往 token 里编过期时间，避免出现两份可能不一致的副本。真实后端的过期另以 HTTP 401 兜底
 * （见 request/client.ts）。
 *
 * ## 谁来强制登出
 *
 * 三条独立通路，缺一条就有漏网：路由守卫、请求层、定时器（armSessionWatch）。三者都收敛到
 * `notifySessionExpired()`，由各端 main.ts 注册的处理器统一做「清会话 + 跳登录页」。
 */
import { getTokenExpireKey, getTokenKey } from '../config'

/** 会话有效期：30 分钟。改这个值即可整体调整（到期不滑动续期） */
export const SESSION_TTL_MS = 30 * 60 * 1000

/** setTimeout 的上限（2^31-1 ms，约 24.8 天）。超过它的延时会被立刻触发，必须分段等待 */
const MAX_TIMEOUT_MS = 0x7fffffff

/** 读会话到期时间戳；没有或非法 → null。null **不等于**未登录（未登录看 token） */
export function getSessionExpireAt(): number | null {
  const raw = localStorage.getItem(getTokenExpireKey())
  if (raw === null || raw === '') return null
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * 会话是否已失效。
 *
 * - **没有 token → false**：没登录不是「登录过期」。请求层据此决定要不要提示「登录已失效」，
 *   未登录的拦截交给路由守卫，否则未登录时每个请求都要弹一次。
 * - **有 token 但没有到期时间 → true**：本功能上线前的历史会话（token 在、expireAt 不在）
 *   一律按过期处理，即所有已登录用户需要重登一次。这是有意的安全默认值：宁可多登一次，
 *   也不要让一批「永不过期」的会话留在那里。
 */
export function isSessionExpired(): boolean {
  if (!localStorage.getItem(getTokenKey())) return false
  const expireAt = getSessionExpireAt()
  if (expireAt === null) return true
  return expireAt <= Date.now()
}

/** token 在且未过期。路由守卫判断「已登录」用这个（不要只用 getToken()） */
export function hasValidSession(): boolean {
  return Boolean(localStorage.getItem(getTokenKey())) && !isSessionExpired()
}

/* ---------------- 失效通知（幂等） ---------------- */

let expiredHandler: (() => void) | null = null
let notified = false

/** 各端 main.ts 在应用启动早期注册：清会话 + 清演示身份 + 跳登录页 */
export function registerSessionExpiredHandler(handler: () => void): void {
  expiredHandler = handler
}

/**
 * 触发「会话已失效」处理。**幂等**：同一段会话里只生效一次 —— 页面上的并发请求会一起失败，
 * 不幂等就会重复跳转、把 redirect 覆盖掉。重新登录（`beginSession`）会解除这个闸。
 */
export function notifySessionExpired(): void {
  if (notified || !expiredHandler) return
  notified = true
  cancelSessionWatch()
  expiredHandler()
}

/* ---------------- 到期看门狗 ---------------- */

let timer: ReturnType<typeof setTimeout> | null = null

export function cancelSessionWatch(): void {
  if (timer !== null) {
    clearTimeout(timer)
    timer = null
  }
}

/**
 * 按 expireAt 定时到点触发。登录成功后调用；各端 main.ts 启动时也调一次
 * （覆盖「带着有效会话刷新页面」的场景 —— 定时器不跨刷新存活）。
 */
export function armSessionWatch(): void {
  cancelSessionWatch()
  // 未登录：什么都没得等，也不该通知（见 isSessionExpired 的第一条）
  if (!localStorage.getItem(getTokenKey())) return

  const expireAt = getSessionExpireAt()
  if (expireAt === null) {
    // 老会话（有 token 无到期时间）：按过期处理，与 isSessionExpired 保持一致
    notifySessionExpired()
    return
  }

  const delay = expireAt - Date.now()
  if (delay <= 0) {
    notifySessionExpired()
    return
  }
  if (delay > MAX_TIMEOUT_MS) {
    // 正常路径到不了这里（TTL 固定 30 分钟）；手改过 localStorage 时才可能，分段等待即可
    timer = setTimeout(() => armSessionWatch(), MAX_TIMEOUT_MS)
    return
  }
  timer = setTimeout(() => {
    timer = null
    notifySessionExpired()
  }, delay)
}

/* ---------------- 会话起止（由 api/auth.ts 调用） ---------------- */

/** 登录成功：写入到期时间、解除通知闸、启动看门狗。**未经此函数不算新会话** */
export function beginSession(): void {
  localStorage.setItem(getTokenExpireKey(), String(Date.now() + SESSION_TTL_MS))
  notified = false
  armSessionWatch()
}

/** 会话结束（登出 / 失效）：清到期时间、停看门狗。通知闸留给下一次 beginSession 解除 */
export function endSession(): void {
  localStorage.removeItem(getTokenExpireKey())
  cancelSessionWatch()
}
