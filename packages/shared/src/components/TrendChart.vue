<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as echarts from 'echarts/core'
import { LineChart } from 'echarts/charts'
import {
  GridComponent,
  TooltipComponent,
  LegendComponent,
} from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'

/**
 * 趋势折线图（ECharts 封装，按需引入减小体积）。
 * 样式与全局设计令牌统一：轴线/文字 #8a94a8、网格 #eef1f7、品牌色由各端传入。
 */
export interface ChartSeries {
  name: string
  data: number[]
  color: string
}

const props = withDefaults(
  defineProps<{
    labels: string[]
    series: ChartSeries[]
    /** 数值单位后缀，如 '次' */
    unit?: string
    /** 画布高度（px） */
    height?: number
  }>(),
  { unit: '', height: 280 },
)

echarts.use([LineChart, GridComponent, TooltipComponent, LegendComponent, CanvasRenderer])

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

function buildOption(): echarts.EChartsCoreOption {
  return {
    animationDuration: 500,
    grid: { left: 8, right: 16, top: 38, bottom: 6, containLabel: true },
    legend: {
      top: 0,
      right: 0,
      icon: 'roundRect',
      itemWidth: 10,
      itemHeight: 4,
      itemGap: 18,
      textStyle: { color: '#8a94a8', fontSize: 12 },
    },
    tooltip: {
      trigger: 'axis',
      backgroundColor: 'rgba(255,255,255,0.97)',
      borderColor: '#e8ecf4',
      borderWidth: 1,
      padding: [10, 14],
      textStyle: { color: '#1c2434', fontSize: 12 },
      extraCssText: 'box-shadow: 0 12px 28px rgba(28,36,52,0.12); border-radius: 10px;',
      axisPointer: {
        type: 'line',
        lineStyle: { color: '#c9d2e3', type: 'dashed' },
      },
      valueFormatter: (value: unknown) =>
        `${Number(value).toLocaleString('zh-CN')}${props.unit}`,
    },
    xAxis: {
      type: 'category',
      boundaryGap: false,
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
    series: props.series.map((item) => ({
      name: item.name,
      type: 'line',
      smooth: 0.35,
      showSymbol: false,
      symbolSize: 7,
      data: item.data,
      lineStyle: { width: 2.5, color: item.color },
      itemStyle: {
        color: item.color,
        borderColor: '#ffffff',
        borderWidth: 2,
      },
      emphasis: { focus: 'series' },
      areaStyle: {
        color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
          { offset: 0, color: hexToRgba(item.color, 0.2) },
          { offset: 1, color: hexToRgba(item.color, 0.01) },
        ]),
      },
    })),
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

watch(() => [props.labels, props.series], render, { deep: true })

onBeforeUnmount(() => {
  observer?.disconnect()
  observer = null
  chart?.dispose()
  chart = null
})
</script>

<template>
  <div ref="el" class="trend-chart" :style="{ height: `${height}px` }" />
</template>

<style scoped>
.trend-chart {
  width: 100%;
}
</style>
