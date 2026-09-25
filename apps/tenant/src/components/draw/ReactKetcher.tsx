/**
 * Ketcher 编辑器桥（React → Vue）。
 *
 * Ketcher 官方编辑器基于 React，这里用 createRoot 把它挂进 Vue 组件给的容器，
 * 通过 onInit 拿到 Ketcher 实例交给 Vue 侧调用（getMolfile / setMolecule /
 * generateImage）。全部依赖本地打包，无任何 CDN（私有化部署要求）。
 *
 * Indigo 的 WASM 由 Vite 产出为独立资源，进编辑器时才按需拉取；
 * 富文本里不插入分子结构式的用户不会为它付流量。
 */
import React from 'react'
import { createRoot } from 'react-dom/client'
import { Editor } from 'ketcher-react'
/* 必须用 binaryWasm 子入口，不能用包根入口：
   包根的 dist/main.js 把 Indigo WASM 以 base64 内联进 JS，单文件 21MB，
   叠加 Ketcher 本体后 DrawEditorHost chunk 达 29.7MiB —— 超过 Cloudflare Pages
   单文件 25MiB 上限，部署在「校验产物」阶段直接失败。
   本入口改为 new URL('indigo-ketcher-1.46.0.wasm', import.meta.url) + module worker，
   由 Vite 把 .wasm 作为独立静态资源产出（11.25MiB），主 chunk 同步回落到 ~8.5MiB。
   两个入口导出完全一致，是纯粹的 drop-in 替换。 */
import { StandaloneStructServiceProvider } from 'ketcher-standalone/dist/binaryWasm'
import type { Ketcher } from 'ketcher-core'
import 'ketcher-react/dist/index.css'

/* StandaloneStructServiceProvider 内含 Indigo（WASM），
   实例只该建一次：重复创建会重复初始化 WASM worker */
const structServiceProvider = new StandaloneStructServiceProvider()

export function mountKetcher(container: HTMLElement, onInit: (ketcher: Ketcher) => void): () => void {
  const root = createRoot(container)
  root.render(
    <Editor
      staticResourcesUrl=""
      structServiceProvider={structServiceProvider}
      onInit={onInit}
      disableMacromoleculesEditor
      errorHandler={(error) => console.error('[ketcher]', error)}
    />,
  )
  return () => root.unmount()
}
