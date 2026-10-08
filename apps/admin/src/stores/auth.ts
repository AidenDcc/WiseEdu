import { defineStore } from 'pinia'
import {
  loginApi,
  logoutApi,
  getCacheUser,
  setSession,
  clearSession,
  hasValidSession,
  type LoginPayload,
  type SessionUser,
} from '@aiteach/shared'

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
      this.user = hasValidSession() ? getCacheUser() : null
    },
    async login(payload: LoginPayload) {
      const { token, user } = await loginApi(payload)
      setSession(token, user)
      this.user = user
      return user
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
