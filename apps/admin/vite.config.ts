import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    host: true,
    // target 指向网关(9999)，不是单体后端(8080)：平台端 /admin/** 由 edu-platform 微服务承接，
    // 由网关按 sys_gateway_route 里的路由规则转发。具体哪些请求走后端由统一开关
    // VITE_USE_MOCK 决定，且仅限 backend-ready.ts 已登记的接口 —— 未实现的仍走 Mock。
    proxy: {
      '/api': {
        target: 'http://localhost:9999',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
})
