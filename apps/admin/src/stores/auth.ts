import { defineStore } from 'pinia'
import {
  loginApi,
  logoutApi,
  getToken,
  getCacheUser,
  setSession,
  clearSession,
  type LoginPayload,
  type SessionUser,
} from '@aiteach/shared'

export const useAuthStore = defineStore('auth', {
  state: () => ({
    user: null as SessionUser | null,
  }),
  getters: {
    isLoggedIn: () => Boolean(getToken()),
  },
  actions: {
    /** 从 localStorage 恢复会话（刷新页面场景） */
    restore() {
      this.user = getCacheUser()
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
