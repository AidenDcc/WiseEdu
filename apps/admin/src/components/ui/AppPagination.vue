<script setup lang="ts">
import { computed } from 'vue'
import { AppIcon } from '@aiteach/shared'

/** 简洁分页器（页码 + 上/下一页） */
const props = withDefaults(
  defineProps<{
    total: number
    page: number
    pageSize?: number
  }>(),
  { pageSize: 10 },
)

const emit = defineEmits<{ 'update:page': [page: number] }>()

const pageCount = computed(() =>
  Math.max(1, Math.ceil(props.total / props.pageSize)),
)

/** 最多展示 5 个页码，超出折叠 */
const pages = computed<number[]>(() => {
  const count = pageCount.value
  if (count <= 7) return Array.from({ length: count }, (_, i) => i + 1)
  const current = Math.min(Math.max(props.page, 1), count)
  const visible = [current - 1, current, current + 1].filter((p) => p >= 2 && p <= count - 1)
  const result: number[] = [1]
  if (visible[0] > 2) result.push(-1)
  result.push(...visible)
  if (visible[visible.length - 1] < count - 1) result.push(-2)
  result.push(count)
  return result
})

function go(page: number) {
  if (page < 1 || page > pageCount.value || page === props.page) return
  emit('update:page', page)
}
</script>

<template>
  <div v-if="total > 0" class="pagination">
    <span class="total">共 {{ total }} 条</span>
    <button class="page-btn" :disabled="page <= 1" type="button" @click="go(page - 1)">
      <AppIcon name="chevron-left" :size="14" />
    </button>
    <template v-for="p in pages" :key="p">
      <span v-if="p < 0" class="dots">…</span>
      <button
        v-else
        class="page-btn"
        :class="{ active: p === page }"
        type="button"
        @click="go(p)"
      >
        {{ p }}
      </button>
    </template>
    <button class="page-btn" :disabled="page >= pageCount" type="button" @click="go(page + 1)">
      <AppIcon name="chevron-right" :size="14" />
    </button>
  </div>
</template>

<style scoped>
.pagination {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
  padding: 14px 18px;
}
.total { font-size: 12.5px; color: var(--sub); margin-right: 8px; }
.page-btn {
  min-width: 30px;
  height: 30px;
  padding: 0 6px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--ink-2);
  font-size: 13px;
  font-weight: 600;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s, color 0.15s;
}
.page-btn:hover:not(:disabled) { background: #f2f4fa; }
.page-btn.active {
  background: var(--brand-grad);
  color: #fff;
  box-shadow: 0 4px 10px rgba(79, 110, 247, 0.3);
}
.page-btn:disabled { color: #c3cad8; cursor: not-allowed; }
.dots { color: var(--sub); font-size: 13px; padding: 0 2px; }
</style>
