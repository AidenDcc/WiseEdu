<script setup lang="ts">
/**
 * 环形图（ECharts 封装，按需引入减小体积）。
 *
 * 与 `BarChart` 的分工：柱状图比**同类别的量**（谁多谁少），环形图比**占比构成**（谁占几成）。
 * 分类多到十几个时柱状图会挤成一条线，环形图靠右侧图例一列排开还读得出来。
 *
 * 两处刻意的取法：
 * - **切片上不写标签**：分类名长短不一，十几片时标签必然互相压；名称与数值交给右侧图例
 *   （`type: 'scroll'`，超长可滚）与 tooltip。图例带数值是这里的主要读法，不是装饰。
 * - **配色按序取**：环形图没有单一主色可用，取一组明度接近的分类色按数据顺序发；
 *   超过一轮回环。同一份数据每次渲染的颜色因此是确定的，不会换个页签就换套色。
 *
 * 样式与全局设计令牌统一：文字 #8a94a8、白底圆角 tooltip —— 与 `BarChart` / `TrendChart`
 * / `ComboChart` 同一套数值。
 */
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as echarts from 'echarts/core'
import { PieChart } from 'echarts/charts'
import { LegendComponent, TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'

export interface RingDatum {
  name: string
  value: number
}

const props = withDefaults(
  defineProps<{
    data: RingDatum[]
    /** 数值后缀，如 '%' */
    unit?: string
    height?: number
  }>(),
  { unit: '', height: 280 },
)

echarts.use([PieChart, LegendComponent, TooltipComponent, CanvasRenderer])

/* 分类色板：明度接近、色相拉开，环上相邻两片不会糊在一起 */
const PALETTE = [
  '#00b4a6',
  '#0891b2',
  '#4f6ef7',
  '#7c5cf0',
  '#e6930d',
  '#108e5a',
  '#d64545',
  '#0ea5e9',
  '#a855f7',
  '#f59e0b',
  '#14b8a6',
  '#64748b',
]

const el = ref<HTMLDivElement | null>(null)
let chart: ReturnType<typeof echarts.init> | null = null
let observer: ResizeObserver | null = null

function buildOption(): echarts.EChartsCoreOption {
  return {
    animationDuration: 500,
    color: PALETTE,
    tooltip: {
      trigger: 'item',
      backgroundColor: 'rgba(255,255,255,0.97)',
      borderColor: '#e8ecf4',
      borderWidth: 1,
      padding: [10, 14],
      textStyle: { color: '#1c2434', fontSize: 12 },
      extraCssText: 'box-shadow: 0 12px 28px rgba(28,36,52,0.12); border-radius: 10px;',
      formatter: (params: unknown) => {
        const item = params as { marker?: string; name?: string; value?: unknown }
        return `${item.marker ?? ''}${item.name ?? ''}<br/><b>${Number(item.value).toLocaleString('zh-CN')}${props.unit}</b>`
      },
    },
    legend: {
      type: 'scroll',
      orient: 'vertical',
      right: 0,
      top: 'middle',
      itemWidth: 10,
      itemHeight: 10,
      itemGap: 12,
      textStyle: { color: '#8a94a8', fontSize: 12 },
      data: props.data.map((row) => row.name),
      /* 图例带数值：环上不画标签，读数就靠这一列 */
      formatter: (name: string) => {
        const item = props.data.find((row) => row.name === name)
        return `${name}  ${item ? `${item.value}${props.unit}` : ''}`
      },
    },
    series: [
      {
        type: 'pie',
        radius: ['48%', '74%'],
        /* 圆心偏左：右侧整条留给图例（图例条目是「知识点名 + 数值」，比环上的标签长得多） */
        center: ['32%', '50%'],
        data: props.data,
        itemStyle: { borderColor: '#ffffff', borderWidth: 2 },
        label: { show: false },
        labelLine: { show: false },
        emphasis: { scale: true, scaleSize: 6 },
      },
    ],
  }
}

function render() {
  chart?.setOption(buildOption(), { notMerge: true })
}

onMounted(() => {
  if (!el.value) return
  chart = echarts.init(el.value)
  render()
  observer = new ResizeObserver(() => chart?.resize())
  observer.observe(el.value)
})

watch(() => [props.data, props.unit], render, { deep: true })

onBeforeUnmount(() => {
  observer?.disconnect()
  observer = null
  chart?.dispose()
  chart = null
})
</script>

<template>
  <div ref="el" class="ring-chart" :style="{ height: `${height}px` }" />
</template>

<style scoped>
.ring-chart {
  width: 100%;
}
</style>
