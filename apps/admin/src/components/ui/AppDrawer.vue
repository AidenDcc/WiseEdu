<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'
import { AppIcon } from '@aiteach/shared'

/** 右侧滑出抽屉（审核详情 / 机构资料） */
const props = withDefaults(
  defineProps<{
    title: string
    subtitle?: string
    width?: number
  }>(),
  { width: 560 },
)

const emit = defineEmits<{ close: [] }>()

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') emit('close')
}

onMounted(() => document.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => document.removeEventListener('keydown', onKeydown))
</script>

<template>
  <Teleport to="body">
    <div class="drawer-mask" @click.self="emit('close')">
      <aside class="drawer panel" :style="{ width: `${width}px` }">
        <header class="drawer-head">
          <div class="drawer-titles">
            <h3 class="drawer-title">{{ title }}</h3>
            <p v-if="subtitle" class="drawer-sub">{{ subtitle }}</p>
          </div>
          <button class="drawer-x" type="button" @click="emit('close')">
            <AppIcon name="close" :size="15" />
          </button>
        </header>
        <div class="drawer-body">
          <slot />
        </div>
        <footer v-if="$slots.footer" class="drawer-foot">
          <slot name="footer" />
        </footer>
      </aside>
    </div>
  </Teleport>
</template>

<style scoped>
.drawer-mask {
  position: fixed;
  inset: 0;
  z-index: 110;
  background: rgba(20, 26, 40, 0.38);
  display: flex;
  justify-content: flex-end;
  animation: fade-in 0.18s ease;
}
.drawer {
  max-width: calc(100vw - 40px);
  display: flex;
  flex-direction: column;
  border-radius: 0;
  border-top: none;
  border-bottom: none;
  border-right: none;
  animation: slide-in 0.24s cubic-bezier(0.3, 1, 0.4, 1);
  box-shadow: var(--shadow-lg);
}
.drawer-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 20px 24px 14px;
  border-bottom: 1px solid var(--border);
}
.drawer-title { font-size: 16.5px; font-weight: 700; }
.drawer-sub { font-size: 12.5px; color: var(--sub); margin-top: 4px; }
.drawer-x {
  width: 30px;
  height: 30px;
  flex-shrink: 0;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--sub);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s, color 0.15s;
}
.drawer-x:hover { background: #f2f4fa; color: var(--ink); }
.drawer-body {
  flex: 1;
  overflow-y: auto;
  padding: 20px 24px;
}
.drawer-foot {
  display: flex;
  gap: 10px;
  padding: 14px 24px 20px;
  border-top: 1px solid var(--border);
}

@keyframes fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}
@keyframes slide-in {
  from { transform: translateX(60px); opacity: 0; }
  to { transform: translateX(0); opacity: 1; }
}
</style>
