<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import AppIcon from '../AppIcon.vue'
import { enterOverlay, exitOverlay, isTopOverlay } from '../../utils/overlay-stack'

/**
 * 系统级确认框（AppConfirm.vue 本身不对外导出，统一走 `appConfirm()` 函数入口，
 * 见 utils/confirm.ts）。样式自带、只取 CSS 变量，两端主题自动适配。
 *
 * 键盘约定：Esc = 取消（只作用于最上层浮层，见 overlay-stack）；Enter / Space 走
 * 原生「激活聚焦按钮」——非 danger 初始聚焦「确认」，danger 初始聚焦「取消」防手滑，
 * 因此 Enter 的实际语义跟随焦点，与系统原生弹窗一致；Tab 在两个按钮间循环（焦点不出框）。
 */
const props = withDefaults(
  defineProps<{
    title: string
    message: string
    type?: 'info' | 'warning' | 'danger'
    confirmText?: string
    cancelText?: string
    /** 由 appConfirm() 传入，结算回调（true=确认 / false=取消） */
    onResolve: (value: boolean) => void
  }>(),
  { type: 'info', confirmText: '确认', cancelText: '取消' },
)

const confirmBtn = ref<HTMLButtonElement | null>(null)
const cancelBtn = ref<HTMLButtonElement | null>(null)
const leaving = ref(false)
/** 已结算标志：双击 / 动画期间再按键，只生效一次 */
let done = false

const overlayId = enterOverlay()

/** 播完 160ms 离场动画再回调，调用方（appConfirm）随后卸载本组件 */
function finish(value: boolean) {
  if (done) return
  done = true
  leaving.value = true
  setTimeout(() => props.onResolve(value), 160)
}

function onKeydown(event: KeyboardEvent) {
  /* 非栈顶不响应：弹窗里再开确认框时，Esc 只关最上层那个 */
  if (!isTopOverlay(overlayId)) return
  if (event.key === 'Escape') {
    event.preventDefault()
    finish(false)
  } else if (event.key === 'Tab') {
    /* 焦点陷阱：只有两个按钮，首尾循环，别让 Tab 把焦点带到背景页上 */
    const buttons = [cancelBtn.value, confirmBtn.value].filter(Boolean) as HTMLButtonElement[]
    if (buttons.length < 2) return
    event.preventDefault()
    const active = document.activeElement
    if (event.shiftKey && active === buttons[0]) buttons[buttons.length - 1].focus()
    else if (!event.shiftKey && active === buttons[buttons.length - 1]) buttons[0].focus()
    else (event.shiftKey ? buttons[0] : buttons[buttons.length - 1]).focus()
  }
}

onMounted(() => {
  document.addEventListener('keydown', onKeydown)
  /* danger 聚焦「取消」防手滑回车，其余聚焦「确认」 */
  ;(props.type === 'danger' ? cancelBtn.value : confirmBtn.value)?.focus()
})
onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown)
  exitOverlay(overlayId)
})
</script>

<template>
  <Teleport to="body">
    <div class="confirm-mask" :class="{ leaving }" @click.self="finish(false)">
      <div class="confirm" role="alertdialog" :aria-label="title">
        <span class="c-icon" :class="type">
          <AppIcon :name="type === 'info' ? 'info' : 'warning'" :size="20" />
        </span>
        <h3 class="c-title">{{ title }}</h3>
        <p class="c-msg">{{ message }}</p>
        <div class="c-actions">
          <button ref="cancelBtn" class="c-btn" type="button" :disabled="done" @click="finish(false)">
            {{ cancelText }}
          </button>
          <button
            ref="confirmBtn"
            class="c-btn primary"
            :class="type"
            type="button"
            :disabled="done"
            @click="finish(true)"
          >
            {{ confirmText }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.confirm-mask {
  position: fixed;
  inset: 0;
  z-index: 130; /* 高于 AppModal(120)，低于 toast(9999)：弹窗里可以再开确认框 */
  background: rgba(20, 26, 40, 0.42);
  backdrop-filter: blur(2px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  animation: c-fade-in 0.16s ease;
}
.confirm-mask.leaving {
  opacity: 0;
  transition: opacity 0.16s ease;
}
.confirm {
  width: 400px;
  max-width: 100%;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow-lg);
  padding: 26px 26px 22px;
  text-align: center;
  animation: c-pop-in 0.2s cubic-bezier(0.34, 1.4, 0.64, 1);
}
.confirm-mask.leaving .confirm {
  transform: translateY(8px) scale(0.98);
  transition: transform 0.16s ease;
}
.c-icon {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.c-icon.info { background: var(--brand-soft); color: var(--brand); }
.c-icon.warning { background: var(--warn-soft); color: var(--warn); }
.c-icon.danger { background: var(--danger-soft); color: var(--danger); }
.c-title {
  margin-top: 12px;
  font-size: 16px;
  font-weight: 700;
  color: var(--ink);
}
.c-msg {
  margin-top: 8px;
  font-size: 14px;
  line-height: 1.7;
  color: var(--ink-2);
  white-space: pre-line;
  word-break: break-word;
}
.c-actions {
  margin-top: 22px;
  display: flex;
  justify-content: center;
  gap: 12px;
}
.c-btn {
  min-width: 96px;
  height: 38px;
  padding: 0 22px;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: var(--card);
  color: var(--ink-2);
  font-size: 14px;
  font-weight: 600;
  transition: opacity 0.2s, transform 0.15s, box-shadow 0.2s;
}
.c-btn:hover { color: var(--ink); }
.c-btn:active { transform: scale(0.98); }
.c-btn:disabled { opacity: 0.55; cursor: not-allowed; }
/* 主按钮跟随类型：info/warning 走品牌渐变，danger 红色实底 */
.c-btn.primary {
  border: none;
  color: #fff;
  background: var(--brand-grad);
  box-shadow: 0 6px 16px rgba(28, 36, 52, 0.14);
}
.c-btn.primary.danger {
  background: var(--danger);
  box-shadow: 0 6px 16px rgba(214, 69, 69, 0.28);
}
.c-btn.primary.warning {
  background: var(--brand-grad);
}
@keyframes c-fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}
@keyframes c-pop-in {
  from { opacity: 0; transform: translateY(14px) scale(0.97); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}
</style>
