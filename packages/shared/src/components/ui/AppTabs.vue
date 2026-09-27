<script setup lang="ts">
/**
 * 下划线式标签页。
 *
 * 这套 `.tab-bar` / `.tab-btn` 原本被复制了 5 遍（ProfileView、org/LogsView、recycle/RecycleView、
 * prompt/PromptView，超管端两份还叫 `.tab-row`），另有 `.subject-tabs`、`.rv-tabs`、
 * `.tabs button`、`.seg` 四种同类变体。这里统一成一个组件。
 */
import AppIcon from '../AppIcon.vue'

defineProps<{
  tabs: Array<{ key: string; label: string; count?: number; icon?: string }>
  modelValue: string
}>()

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
</script>

<template>
  <div class="tab-bar">
    <button
      v-for="tab in tabs"
      :key="tab.key"
      class="tab-btn"
      :class="{ on: tab.key === modelValue }"
      type="button"
      @click="emit('update:modelValue', tab.key)"
    >
      <AppIcon v-if="tab.icon" :name="tab.icon" :size="14" />
      {{ tab.label }}
      <span v-if="tab.count !== undefined" class="tab-count">{{ tab.count }}</span>
    </button>
  </div>
</template>

<style scoped>
.tab-bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 4px;
  margin-bottom: 14px;
  border-bottom: 1px solid var(--border);
}
.tab-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  flex-shrink: 0;
  white-space: nowrap;
  border: none;
  background: transparent;
  padding: 9px 16px;
  font-family: inherit;
  font-size: 13.5px;
  color: var(--sub);
  border-bottom: 2.5px solid transparent;
  margin-bottom: -1px;
  transition: color 0.15s, border-color 0.15s;
}
.tab-btn:hover { color: var(--ink); }
.tab-btn.on { color: var(--brand-deep); font-weight: 600; border-bottom-color: var(--brand); }
.tab-count { font-size: 11.5px; color: var(--sub); }
.tab-btn.on .tab-count { color: var(--brand-deep); }
</style>
