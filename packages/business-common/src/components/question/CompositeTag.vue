<script setup lang="ts">
/**
 * 「材料组合题」徽标。
 *
 * 组合题在列表里只能露出**共用题干 / 材料**那一段文字（作答单位在子题里，而子题不进列表行），
 * 光看那段文字认不出它是组合题、更认不出里面还有几道小题。所以凡是「一行 = 一道题」的地方
 * 都要挂这枚徽标，并且带上小问数 —— 小问数也直接关系到该题的分量（一道 3 小问的组合题
 * 与一道单选不是一回事）。
 *
 * 两种形态是既有实现里真实存在的两种，不是预设的扩展点：
 * - `inline`：嵌在题干行首的小胶囊（列表的题干单元格、卡片题干前），不占独立一行；
 * - 默认：常规 `tag tag-orange`（卡片的信息行 / 元信息行里与题型、难度标签并排）。
 *
 * 文案与计数口径收敛在 `compositeBadgeText`，各页不再各写一份。
 */
import { computed } from 'vue'
import { compositeBadgeLabel, compositeBadgeShort } from '../../utils/question-card'

const props = withDefaults(
  defineProps<{
    /** 小问数。留空则只显示「材料组合题」 */
    count?: number
    /** 题干行首的小胶囊形态；默认是常规标签 */
    inline?: boolean
    /** 紧凑文案「组合题 · N」，用于题库列表 92px 的题型列 */
    short?: boolean
  }>(),
  { count: undefined, inline: false, short: false },
)

const text = computed(() => (props.short ? compositeBadgeShort(props.count ?? 0) : compositeBadgeLabel(props.count ?? 0)))
</script>

<template>
  <span :class="inline || short ? 'ct-inline' : 'tag tag-orange'">{{ text }}</span>
</template>

<style scoped>
/* 胶囊比常规 tag 更紧凑：它要挤在题干文字前面，不能把题干第一行吃掉半行
   （与题库管理列表里的同一枚徽标保持完全一致的外观） */
.ct-inline {
  display: inline-block;
  margin-right: 6px;
  border: 1px solid #f0c089;
  border-radius: 999px;
  background: #fff5e9;
  color: #b26a00;
  font-size: 11px;
  font-weight: 600;
  padding: 0 7px;
  line-height: 17px;
  vertical-align: 1px;
  white-space: nowrap;
}
</style>
