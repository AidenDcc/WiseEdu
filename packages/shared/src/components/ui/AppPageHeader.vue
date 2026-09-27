<script setup lang="ts">
/**
 * 页面顶部工具条：左侧一句说明，右侧操作按钮。
 *
 * **刻意不渲染页面名** —— 页面名由顶栏的面包屑承担（机构端 / 超管端的 AppLayout）。
 * 改造前机构端有 28 个页面在这里再写一遍页面名，且 18 处用裸 `<h2>`（UA 默认 ≈24px）、
 * 10 处用内联 `font-size: 18px`，同一个「页面标题」两种字号。
 *
 * 全屏新标签页（`/paper/compose`、`/paper/edit`）不经 AppLayout，不适用本组件，
 * 它们保留自身的标题。
 */
withDefaults(defineProps<{ desc?: string }>(), { desc: '' })
</script>

<template>
  <div v-if="desc || $slots.actions" class="page-header">
    <p v-if="desc" class="ph-desc">{{ desc }}</p>
    <div v-if="$slots.actions" class="ph-actions">
      <slot name="actions" />
    </div>
  </div>
</template>

<style scoped>
.page-header {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 12px 16px;
  margin-bottom: 16px;
  min-height: 42px;
}
.ph-desc {
  font-size: 12.5px;
  color: var(--sub);
  line-height: 1.65;
  max-width: 880px;
}
/* 换行到第二行时操作区仍靠右 */
.ph-actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  flex-shrink: 0;
}
</style>
