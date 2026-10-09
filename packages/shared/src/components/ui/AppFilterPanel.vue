<script setup lang="ts">
/**
 * 可折叠的「搜索条件」面板：每行一组 chip，折叠时把已选项汇总成若干小标签。
 *
 * 抽自题库管理（BankView）的 `.filter-panel` / `.fp-*`。原实现只存在于该文件的 scoped
 * 样式里，`question/CreateView.vue` 想复用只能手抄一份（`.prop-bar`），其它列表页则退回到
 * 一行 `<select>` 下拉。这里统一成共享组件。
 *
 * 行定义用 `options` 直接给候选值；候选项来自字典时由父组件先查好再传进来。
 *
 * 一行条件不一定是 chip（比如日期区间），这时把该行标成 `custom`：面板不画它的控件，
 * 由宿主用 `#extra` 插槽画，但汇总、清空照旧归面板管。详见 `FilterRowDef.custom`。
 */
import { computed, ref } from 'vue'
import AppIcon from '../AppIcon.vue'
import AppFilterChips from './AppFilterChips.vue'
import type { FilterRowDef } from './types'

const props = withDefaults(
  defineProps<{
    rows: FilterRowDef[]
    /**
     * 收在「更多查询」里的次要条件。与 `rows` 只差一个折叠开关：选中值同样进头部汇总、
     * 同样被「清空」清掉 —— 筛选生效了却看不见，比少一个筛选项更糟。
     */
    moreRows?: FilterRowDef[]
    /** 每个 key 对应的已选值 */
    modelValue: Record<string, string[]>
    defaultOpen?: boolean
    title?: string
  }>(),
  { defaultOpen: true, title: '搜索条件' },
)

const emit = defineEmits<{ 'update:modelValue': [value: Record<string, string[]>] }>()

const open = ref(props.defaultOpen)
const moreOpen = ref(false)

/** 折叠态每个条件值串的最大展示长度，超出省略（沿用 BankView 的取值） */
const COLLAPSE_MAX = 18

const moreRows = computed(() => props.moreRows ?? [])

/**
 * 只有这部分行会在面板里画 chip。`custom` 行的控件由宿主的 `#extra` 插槽渲染，
 * 这里再画一遍就是一行空 chip。但它们仍然要进 `activeRows`（折叠摘要）和 `clearAll`（清空）。
 */
const chipsRows = computed(() => props.rows.filter((row) => !row.custom))
const allRows = computed(() => [...props.rows, ...moreRows.value])

function selectedOf(key: string): string[] {
  return props.modelValue[key] ?? []
}

const activeRows = computed(() =>
  allRows.value
    .filter((row) => selectedOf(row.key).length > 0)
    .map((row) => {
      // 摘要跟着 optionLabels 走，否则展开态写着「（已停用）」、折叠态却只剩原值
      const text = selectedOf(row.key)
        .map((value) => row.optionLabels?.[value] ?? value)
        .join('、')
      return { key: row.key, label: row.label, text, overflow: text.length > COLLAPSE_MAX }
    }),
)

/** 更多查询已选条数：收在折叠里的条件只能靠这个角标露出，否则用户看不出列表为什么变短了 */
const moreCount = computed(() => moreRows.value.filter((row) => selectedOf(row.key).length > 0).length)

function onRowChange(key: string, value: string[]) {
  emit('update:modelValue', { ...props.modelValue, [key]: value })
}

function clearAll() {
  const next: Record<string, string[]> = {}
  for (const row of allRows.value) next[row.key] = []
  emit('update:modelValue', next)
}
</script>

<template>
  <div class="filter-panel">
    <div class="fp-head" @click="open = !open">
      <span class="fp-title">
        {{ title }}
        <span v-if="!open" class="fp-summary">
          <template v-if="activeRows.length">
            <span v-for="row in activeRows" :key="row.key" class="fp-chip">
              <b>{{ row.label }}</b>
              <span class="fp-values" :class="{ overflow: row.overflow }" :title="row.text">{{ row.text }}</span>
            </span>
          </template>
          <span v-else class="fp-none">暂无筛选条件</span>
        </span>
      </span>
      <span class="fp-toggle">
        <button v-if="activeRows.length" class="fp-clear" type="button" @click.stop="clearAll">清空</button>
        {{ open ? '收起' : '展开' }}
        <AppIcon name="chevron-down" :size="15" class="fp-caret" :class="{ up: open }" />
      </span>
    </div>

    <div v-if="open" class="fp-body">
      <AppFilterChips
        v-for="row in chipsRows"
        :key="row.key"
        :label="row.label"
        :options="row.options"
        :multiple="row.multiple !== false"
        :option-labels="row.optionLabels"
        :collapsible="row.collapsible"
        :model-value="selectedOf(row.key)"
        @update:model-value="onRowChange(row.key, $event)"
      />

      <template v-if="moreRows.length">
        <button class="fp-more" type="button" @click="moreOpen = !moreOpen">
          {{ moreOpen ? '收起更多查询' : '更多查询' }}
          <span v-if="moreCount" class="fp-more-badge">{{ moreCount }}</span>
          <AppIcon name="chevron-down" :size="14" class="fp-caret" :class="{ up: moreOpen }" />
        </button>
        <template v-if="moreOpen">
          <AppFilterChips
            v-for="row in moreRows"
            :key="row.key"
            :label="row.label"
            :options="row.options"
            :multiple="row.multiple !== false"
            :option-labels="row.optionLabels"
            :collapsible="row.collapsible"
            :model-value="selectedOf(row.key)"
            @update:model-value="onRowChange(row.key, $event)"
          />
        </template>
      </template>

      <slot name="extra" />
    </div>
  </div>
</template>

<style scoped>
/* 面板外观自带（只用设计令牌），不依赖宿主应用的 .panel 类 */
.filter-panel {
  background: var(--card, #fff);
  border: 1px solid var(--border);
  border-radius: var(--radius, 14px);
  box-shadow: var(--shadow, none);
  overflow: visible;
  flex-shrink: 0;
}

.fp-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 12px 16px;
  cursor: pointer;
  min-height: 46px;
}
.fp-title {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  min-width: 0;
  font-size: 13.5px;
  font-weight: 700;
  color: var(--ink);
}
.fp-summary {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: nowrap;
  overflow: hidden;
  font-weight: 400;
}
.fp-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  background: var(--brand-soft);
  color: var(--brand-deep);
  border-radius: 7px;
  padding: 3px 9px;
  font-size: 12px;
  max-width: 200px;
  min-width: 0;
}
.fp-chip b { font-weight: 700; flex-shrink: 0; }
.fp-values { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fp-none { font-size: 12.5px; color: var(--sub); font-weight: 400; }

.fp-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
  color: var(--sub);
  flex-shrink: 0;
  user-select: none;
}
.fp-clear {
  border: none;
  background: transparent;
  color: var(--brand);
  font-family: inherit;
  font-size: 12.5px;
  font-weight: 600;
  padding: 3px 8px;
  border-radius: 7px;
  transition: background 0.15s;
}
.fp-clear:hover { background: var(--brand-soft); }
.fp-caret { transition: transform 0.18s; }
.fp-caret.up { transform: rotate(180deg); }

.fp-body {
  border-top: 1px dashed var(--border);
  padding: 12px 16px 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

/* 「更多查询」折叠开关：与上方条件行左对齐（不放行首标签槽里，它是分组的开头不是一组条件） */
.fp-more {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  align-self: flex-start;
  border: none;
  background: transparent;
  padding: 2px 0;
  font-family: inherit;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--brand);
  cursor: pointer;
}
.fp-more:hover { color: var(--brand-deep); }
.fp-more-badge {
  min-width: 16px;
  height: 16px;
  padding: 0 4px;
  border-radius: 999px;
  background: var(--brand);
  color: #fff;
  font-size: 11px;
  font-weight: 700;
  line-height: 16px;
  text-align: center;
}
</style>
