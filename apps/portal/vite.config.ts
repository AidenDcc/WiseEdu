import { defineConfig } from 'vite'

// 演示总入口：pnpm dev 后默认访问 http://localhost:5172，
// 由本页选择进入超级管理端（5173）或机构端（5174）
export default defineConfig({
  server: {
    port: 5172,
    strictPort: true,
    host: true,
  },
})
