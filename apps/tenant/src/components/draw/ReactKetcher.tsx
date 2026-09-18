/**
 * Ketcher 编辑器桥（React → Vue）。
 *
 * Ketcher 官方编辑器基于 React，这里用 createRoot 把它挂进 Vue 组件给的容器，
 * 通过 onInit 拿到 Ketcher 实例交给 Vue 侧调用（getMolfile / setMolecule /
 * generateImage）。全部依赖本地打包，无任何 CDN（私有化部署要求）。
 */
import React from 'react'
import { createRoot } from 'react-dom/client'
import { Editor } from 'ketcher-react'
import { StandaloneStructServiceProvider } from 'ketcher-standalone'
import type { Ketcher } from 'ketcher-core'
import 'ketcher-react/dist/index.css'

/* StandaloneStructServiceProvider 内含 Indigo（WASM，base64 内联于包内），
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
