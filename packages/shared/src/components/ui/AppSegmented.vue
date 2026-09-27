<script setup lang="ts">
/**
 * 方框分段控件（互斥，始终有选中项）。
 *
 * 抽自题库管理（BankView）的表格 / 详细切换器 `.mode-toggle`；`resource/ResourceView` 的
 * `.rv-tabs`、`material/ClipView` 的 `.seg` 也是同一个东西的不同写法。
 */
import AppIcon from '../AppIcon.vue'

defineProps<{
  options: Array<{ value: string; label: string; icon?: string }>
  modelValue: string
}>()

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
</script>

<template>
  <div class="segmented">
    <button
      v-for="option in options"
      :key="option.value"
      class="seg-btn"
      :class="{ on: option.value === modelValue }"
      type="button"
      @click="emit('update:modelValue', option.value)"
    >
      <AppIcon v-if="option.icon" :name="option.icon" :size="14" />
      {{ option.label }}
    </button>
  </div>
</template>

<style scoped>
.segmented {
  display: inline-flex;
  align-items: center;
  border: 1.5px solid var(--border);
  border-radius: 9px;
  overflow: hidden;
  flex-shrink: 0;
}
.seg-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  flex-shrink: 0;
  white-space: nowrap;
  border: none;
  background: #fff;
  font-family: inherit;
  font-size: 12.5px;
  color: var(--sub);
  padding: 7px 14px;
  transition: background 0.15s, color 0.15s;
}
.seg-btn:hover { color: var(--brand-deep); }
.seg-btn.on { background: var(--brand-soft); color: var(--brand-deep); font-weight: 700; }
</style>
