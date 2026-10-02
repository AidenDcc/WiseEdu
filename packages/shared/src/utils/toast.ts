/** 轻量 toast：纯 DOM 自绘、不引入组件库。宿主只需在 :root 定义好令牌
 * （--brand / --success / --warn / --danger），两端主题自动适配。
 * 样式注入在页面上下文里解析，CSS 变量可直接引用宿主令牌。 */
export type ToastType = 'info' | 'success' | 'error' | 'warning'

/* 类型图标：内联 SVG 描边（纯 DOM 场景用不了 AppIcon，这里只存 path 片段） */
const ICONS: Record<ToastType, string> = {
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 8h.01"/><path d="M12 11.5V16"/>',
  success: '<path d="M4 12.5l5 5L20 6.5"/>',
  warning: '<path d="M12 3 2 21h20z"/><path d="M12 10v4"/><path d="M12 17.3h.01"/>',
  error: '<path d="M6 6l12 12"/><path d="M18 6 6 18"/>',
}

const STYLE = `
.aiteach-toast-host { position: fixed; top: 24px; left: 50%; transform: translateX(-50%); z-index: 9999; display: flex; flex-direction: column; gap: 10px; align-items: center; pointer-events: none; }
.aiteach-toast { position: relative; overflow: hidden; padding: 10px 20px 10px 15px; border-radius: 10px; font-size: 14px; color: #fff; background: rgba(26,35,51,.92); backdrop-filter: blur(8px); box-shadow: 0 8px 24px rgba(26,35,51,.18); animation: aiteach-toast-in .22s ease; display: flex; align-items: center; gap: 9px; max-width: 72vw; }
.aiteach-toast::before { content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 3px; background: var(--t-bar, var(--brand)); }
.aiteach-toast.info { --t-bar: var(--brand, #4f6ef7); }
.aiteach-toast.success { --t-bar: var(--success, #108e5a); }
.aiteach-toast.warning { --t-bar: var(--warn, #e6930d); }
.aiteach-toast.error { --t-bar: var(--danger, #d64545); }
.aiteach-toast .t-ico { display: inline-flex; flex-shrink: 0; color: var(--t-bar, var(--brand)); }
.aiteach-toast .t-msg { word-break: break-word; }
.aiteach-toast.leaving { opacity: 0; transform: translateY(-8px); transition: all .25s ease; }
@keyframes aiteach-toast-in { from { opacity: 0; transform: translateY(-10px); } }
`

let host: HTMLElement | null = null
let styleInjected = false

export function showToast(message: string, type: ToastType = 'info', duration = 2200): void {
  if (!styleInjected) {
    const style = document.createElement('style')
    style.textContent = STYLE
    document.head.appendChild(style)
    styleInjected = true
  }
  if (!host) {
    host = document.createElement('div')
    host.className = 'aiteach-toast-host'
    document.body.appendChild(host)
  }

  const toast = document.createElement('div')
  toast.className = `aiteach-toast ${type}`
  const icon = document.createElement('span')
  icon.className = 't-ico'
  /* 图标 path 是本文件维护的常量，可以进 innerHTML；消息不行（见下） */
  icon.innerHTML = `<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[type]}</svg>`
  const text = document.createElement('span')
  text.className = 't-msg'
  /* 消息可能拼接后端 error.message，一律按纯文本渲染，防注入 */
  text.textContent = message
  toast.append(icon, text)
  host.appendChild(toast)

  setTimeout(() => {
    toast.classList.add('leaving')
    setTimeout(() => toast.remove(), 260)
  }, duration)
}
