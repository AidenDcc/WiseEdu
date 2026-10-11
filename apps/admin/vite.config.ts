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
  // 构建产物固定落在 apps/admin/dist —— 与 .gitignore 的 dist/ 规则一一对应。
  // 显式写出来是为了避免「临时配置 + --outDir dist-<时间戳>」这类旁路构建
  // 在工作区留下游离目录（曾经出现过 apps/admin/dist-1791620619）。
  build: {
    outDir: 'dist',
    emptyOutDir: true,
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
