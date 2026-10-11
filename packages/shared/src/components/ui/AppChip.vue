<script setup lang="ts">
/**
 * 通用 chip 按钮（可点选的小标签）——全站 chip 视觉的唯一实现。
 *
 * 之前每处 chip 各写各的样式（`.opt-chip` / `.chip` / `.tb-opt` …），选中态一会儿是
 * 实心品牌色、一会儿是浅底描边，同一屏里两种长相。这里收敛成一个组件：
 * 搜索条件（AppFilterChips）、表单选择（AppChipGroup）都用它，样式天然一致。
 *
 * 视觉取值对齐题库管理（BankView）原来的 `.opt-chip`（全站 chip 的基准）：
 * 未选中 = 白底 + 灰描边 + 深灰字；选中 = 实心品牌色 + 白字。
 */
withDefaults(defineProps<{ label: string; active?: boolean }>(), { active: false })

const emit = defineEmits<{ click: [] }>()
</script>

<template>
  <button class="chip" :class="{ on: active }" type="button" @click="emit('click')">{{ label }}</button>
</template>

<style scoped>
.chip {
  border: 1.5px solid var(--border);
  border-radius: 8px;
  background: #fff;
  font-size: 12.5px;
  font-family: inherit;
  color: var(--ink-2);
  padding: 3px 12px;
  white-space: nowrap;
  flex-shrink: 0;
  cursor: pointer;
  transition: border-color 0.12s, background 0.12s, color 0.12s;
}
.chip:hover { border-color: var(--brand); color: var(--brand-deep); }
.chip.on { background: var(--brand); border-color: var(--brand); color: #fff; font-weight: 600; }
</style>
