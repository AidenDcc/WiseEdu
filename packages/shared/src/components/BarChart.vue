<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as echarts from 'echarts/core'
import { BarChart } from 'echarts/charts'
import { GridComponent, TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'

/** 柱状图（ECharts 封装），与 TrendChart 共用同一套主题令牌 */
const props = withDefaults(
  defineProps<{
    labels: string[]
    values: number[]
    /** 主题色（hex），默认管理端靛蓝 */
    color?: string
    unit?: string
    height?: number
  }>(),
  { color: '#4f6ef7', unit: '', height: 260 },
)

echarts.use([BarChart, GridComponent, TooltipComponent, CanvasRenderer])

const el = ref<HTMLDivElement | null>(null)
let chart: ReturnType<typeof echarts.init> | null = null
let observer: ResizeObserver | null = null

function hexToRgba(hex: string, alpha: number): string {
  const value = hex.replace('#', '')
  const r = parseInt(value.slice(0, 2), 16)
  const g = parseInt(value.slice(2, 4), 16)
  const b = parseInt(value.slice(4, 6), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

function render() {
  chart?.setOption(
    {
      animationDuration: 500,
      grid: { left: 8, right: 12, top: 26, bottom: 6, containLabel: true },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(79,110,247,0.06)' } },
        backgroundColor: 'rgba(255,255,255,0.97)',
        borderColor: '#e8ecf4',
        borderWidth: 1,
        padding: [10, 14],
        textStyle: { color: '#1c2434', fontSize: 12 },
        extraCssText: 'box-shadow: 0 12px 28px rgba(28,36,52,0.12); border-radius: 10px;',
        valueFormatter: (value: unknown) =>
          `${Number(value).toLocaleString('zh-CN')}${props.unit}`,
      },
      xAxis: {
        type: 'category',
        data: props.labels,
        axisLine: { lineStyle: { color: '#e8ecf4' } },
        axisTick: { show: false },
        axisLabel: { color: '#8a94a8', fontSize: 11 },
      },
      yAxis: {
        type: 'value',
        splitLine: { lineStyle: { color: '#eef1f7' } },
        axisLabel: {
          color: '#8a94a8',
          fontSize: 11,
          formatter: (value: number) =>
            value >= 10000 ? `${(value / 10000).toFixed(1)}万` : String(value),
        },
      },
      series: [
        {
          type: 'bar',
          data: props.values,
          barWidth: 22,
          itemStyle: {
            borderRadius: [6, 6, 0, 0],
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: hexToRgba(props.color, 0.95) },
              { offset: 1, color: hexToRgba(props.color, 0.45) },
            ]),
          },
        },
      ],
    },
    { notMerge: true },
  )
}

onMounted(() => {
  if (!el.value) return
  chart = echarts.init(el.value)
  render()
  observer = new ResizeObserver(() => chart?.resize())
  observer.observe(el.value)
})

watch(() => [props.labels, props.values], render, { deep: true })

onBeforeUnmount(() => {
  observer?.disconnect()
  observer = null
  chart?.dispose()
  chart = null
})
</script>

<template>
  <div ref="el" class="bar-chart" :style="{ height: `${height}px` }" />
</template>

<style scoped>
.bar-chart {
  width: 100%;
}
</style>
