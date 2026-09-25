<script setup lang="ts">
import { computed, ref } from 'vue'
import { AppIcon } from '@aiteach/shared'

/**
 * 课程小程序预览卡：卡片内是可交互的数学示意图。
 * 点击画布按档位切换二次函数开口系数，`重置` 按钮恢复初值（与小程序内交互一致的最小演示）。
 */
const props = defineProps<{ name: string; to?: string; seed?: number }>()

const STEPS = [1, 1.7, -1]
const OPEN_TEXT: Record<string, string> = { '1': 'y = x²', '1.7': 'y = 1.7x²', '-1': 'y = -x²' }

/** 各卡片初始档位不同，避免一屏五张图完全一样 */
const initialStep = (props.seed ?? 0) % STEPS.length
const step = ref(initialStep)
const coefficient = computed(() => STEPS[step.value])
const formula = computed(() => OPEN_TEXT[String(coefficient.value)])
const dirty = computed(() => step.value !== initialStep)

function nextStep() {
  step.value = (step.value + 1) % STEPS.length
}
function reset() {
  step.value = initialStep
}

/** 采样 y = a·x² 生成折线：x∈[-1,1] → [16,144]，顶点居中 */
const curve = computed(() => {
  const a = coefficient.value
  const points: string[] = []
  for (let i = 0; i <= 32; i++) {
    const x = -1 + (2 * i) / 32
    const px = 80 + x * 64
    const py = 74 - ((a * x * x) / 2.8) * 52
    points.push(`${px.toFixed(1)},${py.toFixed(1)}`)
  }
  return `M${points.join(' L')}`
})
</script>

<template>
  <div class="mini">
    <div class="mini-canvas" role="button" tabindex="0" @click="nextStep" @keyup.enter="nextStep">
      <svg viewBox="0 0 160 100" fill="none">
        <path d="M14 74h132" stroke="var(--border)" stroke-width="1.5" />
        <path d="M80 12v84" stroke="var(--border)" stroke-width="1.5" />
        <path :d="curve" stroke="var(--brand)" stroke-width="2.6" stroke-linecap="round" />
        <circle cx="80" cy="74" r="3.2" fill="var(--brand)" />
      </svg>
      <span class="mini-formula">{{ formula }}</span>
    </div>
    <div class="mini-bar">
      <RouterLink v-if="to" class="mini-name" :to="to">{{ name }}</RouterLink>
      <span v-else class="mini-name">{{ name }}</span>
      <button class="mini-reset" :disabled="!dirty" @click="reset">
        <AppIcon name="undo" :size="13" />重置
      </button>
    </div>
  </div>
</template>

<style scoped>
.mini { display: flex; flex-direction: column; gap: 9px; }
.mini-canvas {
  position: relative;
  aspect-ratio: 16 / 10;
  border-radius: 12px;
  border: 1px solid var(--border);
  background: #f8fbfb;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
}
.mini-canvas:hover { border-color: var(--brand); background: var(--brand-soft); }
.mini-canvas svg { width: 100%; height: 100%; }
.mini-formula {
  position: absolute;
  left: 10px;
  bottom: 7px;
  font-size: 11.5px;
  font-weight: 600;
  color: var(--brand-deep);
  font-variant-numeric: tabular-nums;
}
.mini-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.mini-name {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  transition: color 0.15s;
}
a.mini-name:hover { color: var(--brand-deep); }
.mini-reset {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  flex-shrink: 0;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: #fff;
  color: var(--ink-2);
  font-size: 12px;
  font-weight: 600;
  padding: 3px 9px;
  transition: border-color 0.15s, color 0.15s;
}
.mini-reset:hover:not(:disabled) { border-color: var(--brand); color: var(--brand-deep); }
.mini-reset:disabled { color: #c3cad8; cursor: not-allowed; }
</style>
