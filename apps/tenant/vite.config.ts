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
    port: 5174,
    strictPort: true,
    host: true,
    proxy: {
      /* Deepseek API 不返回 CORS 头，浏览器无法直连；
         开发环境经此代理转发（Key 由前端请求携带，不落 vite 配置）。 */
      '/deepseek': {
        target: 'https://api.deepseek.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/deepseek/, ''),
      },
      /* 拍照识题的多模态通道（OpenAI 兼容协议）。目标端点按所用服务商配置：
         如阿里云 DashScope 兼容模式 target=https://dashscope.aliyuncs.com、
         prefix=/compatible-mode/v1；自建网关则把 VITE_VISION_BASE_URL 直接指向网关地址，
         不配置本代理。 */
      '/vision': {
        target: process.env.VITE_VISION_PROXY_TARGET || 'https://dashscope.aliyuncs.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/vision/, process.env.VITE_VISION_PROXY_PREFIX || '/compatible-mode/v1'),
      },
      // 后端服务就绪后，取消以下注释并将 VITE_USE_MOCK 置为 false 即可切换到真实后端
      // '/api': {
      //   target: 'http://localhost:8080',
      //   changeOrigin: true,
      //   rewrite: (path) => path.replace(/^\/api/, ''),
      // },
    },
  },
})
