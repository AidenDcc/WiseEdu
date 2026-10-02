import { createApp } from 'vue'
import AppConfirm from '../components/ui/AppConfirm.vue'

export type ConfirmType = 'info' | 'warning' | 'danger'

export interface ConfirmOptions {
  /** 标题，不传时按 type 取默认（请确认 / 注意 / 危险操作） */
  title?: string
  /** info=中性确认；warning=流程后果提醒；danger=破坏性操作（红色确认按钮 + 焦点落在取消上） */
  type?: ConfirmType
  confirmText?: string
  cancelText?: string
}

const DEFAULT_TITLE: Record<ConfirmType, string> = {
  info: '请确认',
  warning: '注意',
  danger: '危险操作',
}

/**
 * 系统级确认框，全库统一替代 `window.confirm`：
 *
 * ```ts
 * if (!(await appConfirm('删除该文件？', { type: 'danger' }))) return
 * ```
 *
 * resolve `true` = 确认；`false` = 取消（Esc / 点遮罩 / 取消按钮）。
 * 每次调用独立挂载一个小 Vue 实例（无 Pinia / router 上下文，因此组件内不得碰它们），
 * 并发调用各自叠加，Esc / Enter 由 overlay 栈保证只作用于最上层。
 */
export function appConfirm(message: string, options: ConfirmOptions = {}): Promise<boolean> {
  const type = options.type ?? 'info'
  return new Promise((resolve) => {
    /* 记住触发者，关闭后把焦点还回去（确认框多半是从某个按钮的点击里打开的） */
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const container = document.createElement('div')
    document.body.appendChild(container)

    const app = createApp(AppConfirm, {
      message,
      title: options.title ?? DEFAULT_TITLE[type],
      type,
      confirmText: options.confirmText ?? '确认',
      cancelText: options.cancelText ?? '取消',
      onResolve: (value: boolean) => {
        app.unmount()
        container.remove()
        if (previousFocus && previousFocus.isConnected) previousFocus.focus()
        resolve(value)
      },
    })
    app.mount(container)
  })
}
