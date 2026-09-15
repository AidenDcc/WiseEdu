/** 轻量 toast（不引入组件库，保持 demo 轻量；后续接入 Element Plus 后可替换为 ElMessage） */
export type ToastType = 'info' | 'success' | 'error'

const STYLE = `
.aiteach-toast-host { position: fixed; top: 24px; left: 50%; transform: translateX(-50%); z-index: 9999; display: flex; flex-direction: column; gap: 10px; align-items: center; pointer-events: none; }
.aiteach-toast { padding: 10px 20px; border-radius: 10px; font-size: 14px; color: #fff; background: rgba(26,35,51,.88); backdrop-filter: blur(8px); box-shadow: 0 8px 24px rgba(26,35,51,.18); animation: aiteach-toast-in .22s ease; display:flex; align-items:center; gap:8px; max-width: 72vw; }
.aiteach-toast.success { background: rgba(16,142,90,.92); }
.aiteach-toast.error { background: rgba(214,69,69,.92); }
.aiteach-toast.leaving { opacity: 0; transform: translateY(-8px); transition: all .25s ease; }
@keyframes aiteach-toast-in { from { opacity: 0; transform: translateY(-10px); } }
`

let host: HTMLElement | null = null
let styleInjected = false

export function showToast(message: string, type: ToastType = 'info'): void {
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
  toast.textContent = message
  host.appendChild(toast)

  setTimeout(() => {
    toast.classList.add('leaving')
    setTimeout(() => toast.remove(), 260)
  }, 2200)
}
