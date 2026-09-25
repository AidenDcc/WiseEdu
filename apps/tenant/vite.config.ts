import { fileURLToPath, URL } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import vue from '@vitejs/plugin-vue'

/**
 * 把 ketcher-core 里那句裸 require 接回真正的 raphael。
 *
 * ketcher-core/dist/application/render/raphael-ext.modern.js:18（ESM 产物）写着：
 *
 *   var raphaelModule = typeof window !== 'undefined' ? require('raphael') : undefined
 *
 * raphael 是 ketcher-core 的正式依赖（^2.3.0，已随 pnpm 装在 ketcher-core 自己的
 * node_modules 下），Ketcher 的 2D 画布确实要用它（`new Raphael(...)` 建 paper）。
 * 但这句写在 ESM 文件里 —— Rollup 的 commonjs 插件默认只处理 CJS 文件，遇到
 * 「import 与 require 混用」的模块直接跳过，于是裸 require 原样进了产物。
 * 浏览器 ESM 里没有 require 这个标识符，chunk 一求值就抛
 * "ReferenceError: require is not defined"：DrawEditorHost 整个加载失败，
 * 凡是用到富文本编辑器的页面（录题 / 组卷 / 教辅）全白屏。
 * 连 try/catch 都救不了 —— 标识符本身不存在。
 *
 * dev 之所以没这问题：esbuild 预打包会从 ketcher-core 的目录解析到 raphael 并内联。
 * 所以这里不是要屏蔽 raphael，而是让生产构建和 dev 走同一条路 —— 改写成真实 import，
 * 由 Rollup 正常打包 raphael（约 100KB，落在本来就懒加载的 DrawEditorHost chunk 里）。
 * 注：raphael.min.js 自带 eve，内部无 require，不会引入新的裸引用。
 *
 * 上游代码对两种互操作形态都做了兜底：
 *   resolveRaphael() { return typeof raphaelModule === 'function' ? raphaelModule : raphaelModule.default }
 * 故 `import * as` 拿到的命名空间对象会被它取 .default，等价于拿到 Raphael 构造函数。
 */
function ketcherRaphaelRequire(): Plugin {
  return {
    name: 'ketcher-raphael-require',
    enforce: 'pre',
    transform(code, id) {
      if (!id.includes('ketcher-core')) return null
      if (!code.includes('raphael')) return null
      const next = code.replace(/require\s*\(\s*(["'])raphael\1\s*\)/g, '__ketcherRaphael')
      /* 没命中（已经是 import 形态 / 别的包）就别动它 */
      if (next === code) return null
      return { code: `import * as __ketcherRaphael from 'raphael';\n${next}`, map: null }
    },
  }
}

export default defineConfig({
  plugins: [ketcherRaphaelRequire(), vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      /* jsxgraph 的 exports map 未暴露 distrib 下的 CSS 深路径，这里显式指到文件 */
      'jsxgraph-css': fileURLToPath(new URL('./node_modules/jsxgraph/distrib/jsxgraph.css', import.meta.url)),
      /* ketcher-core 依赖 Node 的 events 模块，改用浏览器可用的 events 包 */
      events: fileURLToPath(new URL('./node_modules/events/events.js', import.meta.url)),
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
