<script setup lang="ts">
/**
 * 柱 + 平滑线组合图（ECharts 封装，按需引入减小体积）。
 *
 * 为什么单起一个组件而不是给 `BarChart` 加参数：`BarChart` 的契约是「一维一组值」，
 * 而这里要的是「同一批分类下、量纲完全不同的几组值」——试卷难度分析就是典型：
 * 题数是个位、分值是几十、分值占比是百分数，三者必须各挂一根轴，否则柱子全被压成一条线。
 * 所以本组件的 API 刻意**不猜语义**：轴由调用方声明，每个系列显式指向某根轴。
 *
 * 轴与系列的对应关系（`axis` 是 `axes` 数组的下标）是唯一的隐式约定，写错不会报错、
 * 只会让数值贴错刻度，所以两边的顺序在调用处要挨着写。
 *
 * 三处按需开关，都是「不猜语义」的延伸：`ComboAxis.hidden`（借刻度但不画轴）、
 * `ComboBar/ComboLine.unit`（各系列量纲不同时 tooltip 分开标单位）、`legend`（轴名已经
 * 说清哪根柱是什么时，图例可以关掉）。
 *
 * 样式与全局设计令牌统一：轴线/文字 #8a94a8、网格 #eef1f7、白底圆角 tooltip —— 与
 * `BarChart` / `TrendChart` 同一套数值，三张图并排时不会看出是两套皮。
 */
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as echarts from 'echarts/core'
import { BarChart, LineChart } from 'echarts/charts'
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'

export interface ComboAxis {
  position: 'left' | 'right'
  /** 同一侧的第二根轴必须给偏移（px），否则与第一根重叠；ECharts 不会自己错开 */
  offset?: number
  /** 轴名（画在轴顶端） */
  name: string
  /** 刻度后缀，如 '%' */
  suffix?: string
  /**
   * 只借这根轴的刻度，不把它画出来（轴线 / 刻度 / 轴名全不显示）。
   * 用在「有值的参考线但不想要第四条刻度尺」的场合：系列照常按这根轴定标、画在绘图区内，
   * 只是坐标轴本身不上屏。
   */
  hidden?: boolean
}

export interface ComboBar {
  name: string
  data: number[]
  color: string
  /** `axes` 的下标 */
  axis: number
  /** 本系列的 tooltip 后缀，如 '题'；缺省用组件级 `unit`（各系列量纲不同时必须逐个给） */
  unit?: string
}

export interface ComboLine {
  name: string
  data: number[]
  color: string
  /** `axes` 的下标 */
  axis: number
  /** 同 `ComboBar.unit` */
  unit?: string
}

/** tooltip 回调拿到的单条数据：只列本组件用到的字段，避免在 `unknown` 上乱取属性 */
interface TooltipItem {
  seriesName?: string
  marker?: string
  value?: unknown
  name?: string
  axisValueLabel?: string
}

const props = withDefaults(
  defineProps<{
    labels: string[]
    axes: ComboAxis[]
    bars: ComboBar[]
    line?: ComboLine
    /** tooltip 数值后缀的兜底值，如 '分'；各系列自带 `unit` 时以系列的为准 */
    unit?: string
    /** 关掉图例：轴名已经把「哪根柱是什么」写清楚了，图例反而挤掉绘图区 */
    legend?: boolean
    height?: number
  }>(),
  { unit: '', legend: true, height: 280 },
)

echarts.use([BarChart, LineChart, GridComponent, TooltipComponent, LegendComponent, CanvasRenderer])

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

function axisLabel(formatter?: (value: number) => string) {
  return {
    color: '#8a94a8',
    fontSize: 11,
    formatter: (value: number) =>
      formatter ? formatter(value) : value >= 10000 ? `${(value / 10000).toFixed(1)}万` : String(value),
  }
}

/**
 * 右侧几根轴各自要占掉一块横向空间：轴名与刻度都画在轴的**外面**，
 * 第二根再叠 offset 往外挪。`containLabel` 只保得住第一根，所以这里自己留白 ——
 * 不留的话偏移轴的数字会顶出画布，被裁成半个字。
 */
function gridRight(): number {
  const rightAxes = props.axes.filter((axis) => axis.position === 'right' && !axis.hidden)
  return 14 + rightAxes.reduce((sum, axis) => sum + 46 + (axis.offset ?? 0), 0)
}

/** 某个系列自己的单位，缺省回落到组件级 `unit`（柱与线可能量纲不同，tooltip 要分开标） */
function unitOf(seriesName: string): string {
  const all = [...props.bars, ...(props.line ? [props.line] : [])]
  return all.find((row) => row.name === seriesName)?.unit ?? props.unit
}

/**
 * 轴触发时 ECharts 会把**同一分类下的所有系列**一起给我们，逐条拼单位 ——
 * `valueFormatter` 只能给一个全局后缀，量纲不同的组合图会标错。
 */
function tooltipLabel(params: unknown): string {
  const list = (Array.isArray(params) ? params : [params]) as TooltipItem[]
  const head = list[0]?.axisValueLabel ?? list[0]?.name ?? ''
  const rows = list.map(
    (item) =>
      `${item.marker ?? ''}${item.seriesName ?? ''} <b>${Number(item.value).toLocaleString('zh-CN')}${unitOf(item.seriesName ?? '')}</b>`,
  )
  return [head, ...rows].join('<br/>')
}

function buildOption(): echarts.EChartsCoreOption {
  return {
    animationDuration: 500,
    grid: { left: 8, right: gridRight(), top: 38, bottom: 6, containLabel: true },
    legend: props.legend
      ? {
          top: 0,
          right: 0,
          icon: 'roundRect',
          itemWidth: 10,
          itemHeight: 4,
          itemGap: 18,
          textStyle: { color: '#8a94a8', fontSize: 12 },
        }
      : { show: false },
    tooltip: {
      trigger: 'axis',
      axisPointer: { type: 'shadow', shadowStyle: { color: 'rgba(79,110,247,0.06)' } },
      backgroundColor: 'rgba(255,255,255,0.97)',
      borderColor: '#e8ecf4',
      borderWidth: 1,
      padding: [10, 14],
      textStyle: { color: '#1c2434', fontSize: 12 },
      extraCssText: 'box-shadow: 0 12px 28px rgba(28,36,52,0.12); border-radius: 10px;',
      formatter: tooltipLabel,
    },
    xAxis: {
      type: 'category',
      data: props.labels,
      axisLine: { lineStyle: { color: '#e8ecf4' } },
      axisTick: { show: false },
      axisLabel: { color: '#8a94a8', fontSize: 11 },
    },
    yAxis: props.axes.map((axis) => ({
      type: 'value',
      position: axis.position,
      offset: axis.offset ?? 0,
      name: axis.hidden ? '' : axis.name,
      nameTextStyle: { color: '#8a94a8', fontSize: 11, padding: [0, 0, 4, 0] },
      axisLine: { show: !axis.hidden },
      axisTick: { show: false },
      splitLine: {
        show: !axis.hidden && axis.position === 'left',
        lineStyle: { color: '#eef1f7' },
      },
      axisLabel: axis.hidden
        ? { show: false }
        : axisLabel(axis.suffix ? (value: number) => `${value}${axis.suffix}` : undefined),
    })),
    series: [
      ...props.bars.map((bar) => ({
        name: bar.name,
        type: 'bar' as const,
        yAxisIndex: bar.axis,
        data: bar.data,
        barMaxWidth: 18,
        itemStyle: {
          borderRadius: [5, 5, 0, 0],
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: hexToRgba(bar.color, 0.95) },
            { offset: 1, color: hexToRgba(bar.color, 0.45) },
          ]),
        },
      })),
      ...(props.line
        ? [
            {
              name: props.line.name,
              type: 'line' as const,
              yAxisIndex: props.line.axis,
              data: props.line.data,
              smooth: 0.35,
              symbolSize: 7,
              lineStyle: { width: 2.5, color: props.line.color },
              itemStyle: { color: props.line.color, borderColor: '#ffffff', borderWidth: 2 },
              areaStyle: {
                color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                  { offset: 0, color: hexToRgba(props.line.color, 0.18) },
                  { offset: 1, color: hexToRgba(props.line.color, 0.01) },
                ]),
              },
            },
          ]
        : []),
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

watch(() => [props.labels, props.axes, props.bars, props.line], render, { deep: true })

onBeforeUnmount(() => {
  observer?.disconnect()
  observer = null
  chart?.dispose()
  chart = null
})
</script>

<template>
  <div ref="el" class="combo-chart" :style="{ height: `${height}px` }" />
</template>

<style scoped>
.combo-chart {
  width: 100%;
}
</style>
