<script setup lang="ts">
import { AppIcon, formatCount, formatDelta } from '@aiteach/shared'

withDefaults(
  defineProps<{
    label: string
    value: number | string
    icon?: string
    /** 增幅（百分比），不传则不显示 */
    delta?: number
    /** 强调色：默认品牌色；warn=橙色预警（FR-PT-001 到期预警高亮） */
    tone?: 'brand' | 'warn' | 'plain'
    hint?: string
  }>(),
  { tone: 'brand' },
)

const display = (value: number | string) =>
  typeof value === 'number' ? formatCount(value) : value
</script>

<template>
  <div class="stat-card panel" :class="`tone-${tone}`">
    <div class="stat-icon">
      <AppIcon v-if="icon" :name="icon" :size="20" />
    </div>
    <div class="stat-main">
      <div class="stat-label">{{ label }}</div>
      <div class="stat-value">
        {{ display(value) }}
        <span v-if="hint" class="stat-hint">{{ hint }}</span>
      </div>
      <div v-if="delta !== undefined" class="stat-delta">
        <AppIcon name="trend-up" :size="13" />
        较上月 {{ formatDelta(delta) }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.stat-card {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  padding: 20px;
  transition: transform 0.2s, box-shadow 0.2s;
}
.stat-card:hover { transform: translateY(-3px); box-shadow: var(--shadow-lg); }
.stat-icon {
  width: 44px; height: 44px;
  border-radius: 12px;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.tone-brand .stat-icon { background: var(--brand-soft); color: var(--brand); }
.tone-warn .stat-icon { background: var(--warn-soft); color: var(--warn); }
.tone-plain .stat-icon { background: #f1f3f9; color: var(--ink-2); }

.stat-label { font-size: 13px; color: var(--ink-2); }
.tone-warn .stat-value { color: var(--warn); }
.stat-value {
  font-size: 26px;
  font-weight: 700;
  letter-spacing: 0.3px;
  margin-top: 4px;
  font-variant-numeric: tabular-nums;
}
.stat-hint { font-size: 12px; font-weight: 500; color: var(--sub); margin-left: 4px; }
.stat-delta {
  display: flex;
  align-items: center;
  gap: 3px;
  font-size: 12px;
  color: var(--success);
  margin-top: 5px;
}
</style>
