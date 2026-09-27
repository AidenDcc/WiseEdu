<script setup lang="ts">
/**
 * 列表工具条：一行内放「搜索框 + 若干控件」，右侧插槽靠右。
 *
 * 抽自题库管理（BankView）的 `.list-toolbar` + `.search-box`。原实现只在 BankView 的
 * scoped 样式里，其它页面各自用 `.toolbar` / `.matrix-head` / 裸 `<input style="width:200px">`
 * 代替，行高与间距都不同。
 */
import AppSearchInput from './AppSearchInput.vue'

withDefaults(
  defineProps<{
    /** 搜索关键词（`searchable=false` 时不渲染搜索框） */
    modelValue?: string
    placeholder?: string
    searchable?: boolean
    searchWidth?: string | number
  }>(),
  { modelValue: '', placeholder: '搜索', searchable: true, searchWidth: 240 },
)

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()
</script>

<template>
  <div class="list-toolbar">
    <slot name="left" />
    <AppSearchInput
      v-if="searchable"
      :model-value="modelValue"
      :placeholder="placeholder"
      :width="searchWidth"
      size="md"
      @update:model-value="emit('update:modelValue', $event)"
    />
    <slot />
    <div v-if="$slots.right" class="lt-right">
      <slot name="right" />
    </div>
  </div>
</template>

<style scoped>
.list-toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 12px;
  flex-shrink: 0;
}
/* 右侧操作区靠右；即使因换行掉到第二行也仍靠右 */
.lt-right { margin-left: auto; display: flex; align-items: center; gap: 10px; }
</style>
