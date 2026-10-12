<script setup lang="ts">
/**
 * 通用筛选面板：共享 `AppFilterPanel` 之上加一层「各端专属条件」的落点。
 *
 * 调色板 | 题库 | 试卷三处的筛选条件大部分相同（题型 / 难度 / 年份 / 地区…），差异只有几行：
 * 平台端公共库要按「题库来源」筛、机构端要按「纠错题目」筛。把相同的行留给页面用 `rows` 传进来，
 * 把差异用**两种**方式表达：
 *
 * - `extraRows`（props）：**仍是 chip 行**的专属条件。与 `rows` 同权 —— 参与折叠摘要、
 *   参与「清空」。这一点很关键：条件生效了却清不掉、折叠时也看不见，比少一个筛选项更糟。
 * - `#extraFilter`（插槽）：**不是 chip 形态**的专属控件（开关 / 区间 / 下拉 / 自定义输入）。
 *   由各端自己渲染，面板只管给它留位置。
 *
 * 公共组件不判断当前是哪个端、不知道 `tenant_id`，也不做任何权限过滤 —— 那些属于页面。
 */
import { computed } from 'vue'
import { AppFilterPanel } from '@aiteach/shared'
import type { FilterRowDef } from '@aiteach/shared'

const props = withDefaults(
  defineProps<{
    /** 两端共有的筛选行 */
    rows: FilterRowDef[]
    /** 收在「更多查询」里的次要条件（各端共有部分） */
    moreRows?: FilterRowDef[]
    /**
     * 当前端的专属筛选行。与 `rows` 合并后交给面板：
     * 于是专属条件同样进折叠汇总、同样被「清空」清掉。
     */
    extraRows?: FilterRowDef[]
    /** 每个 key 对应的已选值（含专属行的 key） */
    modelValue: Record<string, string[]>
    title?: string
    defaultOpen?: boolean
  }>(),
  { title: '搜索条件', defaultOpen: true },
)

const emit = defineEmits<{ 'update:modelValue': [value: Record<string, string[]>] }>()

/** 共有行在前、专属行在后：视线顺序稳定，换端时不会因为插入位置不同而跳动 */
const mergedRows = computed(() => [...props.rows, ...(props.extraRows ?? [])])
</script>

<template>
  <AppFilterPanel
    :rows="mergedRows"
    :more-rows="moreRows"
    :model-value="modelValue"
    :title="title"
    :default-open="defaultOpen"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <!-- 非 chip 形态的专属筛选控件；不提供时面板照常渲染 -->
    <template #extra>
      <slot name="extraFilter" />
    </template>
  </AppFilterPanel>
</template>
