import { defineStore } from 'pinia'
import {
  loginApi,
  logoutApi,
  getCacheUser,
  getAvatarOverride,
  setSession,
  clearSession,
  hasValidSession,
  type LoginPayload,
  type SessionUser,
} from '@aiteach/shared'

/**
 * 把本机保存过的自定义头像贴回会话用户。
 *
 * 头像不受 30 分钟会话约束（见 shared/auth/avatar.ts），登出重登、刷新页面都得重新贴一次，
 * 否则顶栏会在「换头像成功」之后又变回字母头像。管理端一个账号对一个人，故按账号取。
 */
function withStoredAvatar(user: SessionUser): SessionUser {
  const avatar = getAvatarOverride(user.account)
  return avatar ? { ...user, avatar } : user
}

export const useAuthStore = defineStore('auth', {
  state: () => ({
    user: null as SessionUser | null,
  }),
  getters: {
    /* 不能只判 token 是否存在：token 过期后仍留在 localStorage 里（要等守卫/请求层清），
       只判存在性会把过期会话当成已登录 */
    isLoggedIn: () => hasValidSession(),
  },
  actions: {
    /** 从 localStorage 恢复会话（刷新页面场景）。过期会话不恢复，免得界面先渲染成已登录 */
    restore() {
      const cached = hasValidSession() ? getCacheUser() : null
      this.user = cached ? withStoredAvatar(cached) : null
    },
    async login(payload: LoginPayload) {
      const { token, user } = await loginApi(payload)
      const merged = withStoredAvatar(user)
      setSession(token, merged)
      this.user = merged
      return merged
    },
    async logout() {
      try {
        await logoutApi()
      } finally {
        clearSession()
        this.user = null
      }
    },
  },
})
