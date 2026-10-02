<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'
import AppIcon from '../AppIcon.vue'
import { enterOverlay, exitOverlay, isTopOverlay } from '../../utils/overlay-stack'

/** 居中弹窗（自绘，风格与全局令牌统一；两端共用，样式自带、只取 CSS 变量） */
const props = withDefaults(
  defineProps<{
    title: string
    width?: number
    /** 点击遮罩是否允许关闭 */
    closeOnMask?: boolean
  }>(),
  { width: 460, closeOnMask: true },
)

const emit = defineEmits<{ close: [] }>()

function close() {
  emit('close')
}

function onMask() {
  if (props.closeOnMask) close()
}

const overlayId = enterOverlay()

/**
 * Escape 只关最上层。
 *
 * 弹窗里可以再开弹窗（编辑题目 → 知识点树 / 公式面板 / 媒体选择）或开确认框
 * （appConfirm），而每个浮层都在 document 上监听 —— 不仲裁的话一次 Esc 会把
 * 整摞一起关掉。浮层统一走 overlay-stack，只有栈顶响应。
 */
function onKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape' || !isTopOverlay(overlayId)) return
  close()
}

onMounted(() => document.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => {
  exitOverlay(overlayId)
  document.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <Teleport to="body">
    <div class="modal-mask" @click.self="onMask">
      <div class="modal" :style="{ width: `${width}px` }">
        <header class="modal-head">
          <h3 class="modal-title">{{ title }}</h3>
          <button class="modal-x" type="button" @click="close">
            <AppIcon name="close" :size="15" />
          </button>
        </header>
        <div class="modal-body">
          <slot />
        </div>
        <footer v-if="$slots.footer" class="modal-foot">
          <slot name="footer" />
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.modal-mask {
  position: fixed;
  inset: 0;
  z-index: 120;
  background: rgba(20, 26, 40, 0.42);
  backdrop-filter: blur(2px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  animation: fade-in 0.16s ease;
}
.modal {
  /* 卡片自带（不依赖宿主全局 .panel 类）：shared 组件只取 CSS 变量，两端表现一致 */
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow-lg);
  max-width: 100%;
  max-height: calc(100vh - 80px);
  display: flex;
  flex-direction: column;
  animation: pop-in 0.2s cubic-bezier(0.34, 1.4, 0.64, 1);
}
.modal-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18px 22px 0;
}
.modal-title { font-size: 16px; font-weight: 700; }
.modal-x {
  width: 30px;
  height: 30px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--sub);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s, color 0.15s;
}
.modal-x:hover { background: #f2f4fa; color: var(--ink); }
.modal-body {
  padding: 18px 22px;
  overflow-y: auto;
}
.modal-foot {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 4px 22px 20px;
}

@keyframes fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}
@keyframes pop-in {
  from { opacity: 0; transform: translateY(14px) scale(0.97); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}
</style>
