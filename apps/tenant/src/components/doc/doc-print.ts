/**
 * 打印一份**独立的纸**。
 *
 * 为什么不给当前页面加 `@media print`：整页打印时侧边栏、顶栏、工具栏、右侧图标栏都会跟着上纸，
 * 而它们分别长在**别的组件**里 —— 在任何一个组件的 scoped 样式里都选不中它们。自己写一份
 * 只管内容的文档，既干净，又不必知道外壳长什么样（工作台的骨架以后怎么改都不影响打印）。
 *
 * 用临时 iframe 而不是 `window.open`：新窗口会被拦截策略当成弹窗，而 iframe 在用户手势内
 * 同步创建、写完即打印，不需要任何弹窗权限；打完就把 iframe 摘掉，不残留。
 *
 * 调用方负责两件事：① 传进来的 `css` 要包含 `@page`（纸张与页边距）与正文 / 版式样式；
 * ② 内容为空时**不要**调本函数（空纸打印出来是一张白页，比提示一句「正文还是空的」更糟）。
 */
export interface PrintDocOptions {
  /** 文档标题：写进 `<title>`，也是浏览器打印对话框里的默认文件名 */
  title: string
  /** 完整样式表文本（`@page` + 正文 / 版式样式） */
  css: string
  /** 正文 HTML（拼进 `<body>`） */
  body: string
}

export function printHtmlDoc({ title, css, body }: PrintDocOptions): void {
  const frame = document.createElement('iframe')
  frame.setAttribute('aria-hidden', 'true')
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;'
  document.body.appendChild(frame)

  const win = frame.contentWindow
  const docEl = win?.document
  if (!win || !docEl) {
    frame.remove()
    return
  }

  /* 标题要转义：文档名是用户输入，`<` 会把 <title> 提前闭合，后面整份文档都被当成标签解析 */
  const safeTitle = title.replace(/[<>&]/g, '')
  docEl.open()
  docEl.write(
    `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${safeTitle}</title>` +
      `<style>${css}</style></head><body>${body}</body></html>`,
  )
  docEl.close()

  const run = () => {
    win.focus()
    win.print()
    /* 打印对话框是阻塞的，走到这里说明已经关掉；再留一点时间给渲染进程回收 */
    setTimeout(() => frame.remove(), 400)
  }
  if (docEl.readyState === 'complete') setTimeout(run, 150)
  else win.onload = () => setTimeout(run, 150)
}
