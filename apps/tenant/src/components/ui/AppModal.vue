<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'
import { AppIcon } from '@aiteach/shared'

/** 居中弹窗（自绘，风格与全局令牌统一） */
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

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') close()
}

onMounted(() => document.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => document.removeEventListener('keydown', onKeydown))
</script>

<template>
  <Teleport to="body">
    <div class="modal-mask" @click.self="onMask">
      <div class="modal panel" :style="{ width: `${width}px` }">
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
  max-width: 100%;
  max-height: calc(100vh - 80px);
  display: flex;
  flex-direction: column;
  animation: pop-in 0.2s cubic-bezier(0.34, 1.4, 0.64, 1);
  box-shadow: var(--shadow-lg);
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
