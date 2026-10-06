<script setup lang="ts">
/**
 * 试卷分析：把一份卷「拆开看」，分三个页签 —— 题型分析 / 难度分析 / 知识点分析。
 *
 * 与「考试阅卷 · 试卷分析」（`views/exam/AnalysisView`）是两回事：那个绑一次已结束的考试，
 * 看的是得分率、区分度、班级对比；这里只看**卷子本身**，不依赖任何考试场次，因此浏览到哪份卷
 * 都能立刻弹出来。数据全部由卷内数据现算（试卷 + 题库题目），不需要新的接口。
 *
 * 三个页签各自回答一个问题：
 * - 题型分析：「这份卷由哪些题型、各多少题多少分构成」——一根双轴柱（左题量 / 右分值）+ 大题结构表。
 * - 难度分析：「难度梯度是怎么排的」——柱（题数 / 分值）看绝对量，平滑线（分值占比）看权重。
 * - 知识点分析：「这颗知识树的哪些点被考了、各占多少」——四行筛选 + 环图 + 九列口径表。
 *
 * 统计口径（频数 / 频率 / 卷均考频 / 分值占比 等）全部在 `./paper-analysis`，本文件只负责
 * 画与筛选 —— 口径写在算法里，改口径不会漏改某个页签。
 */
import { computed, ref, watch } from 'vue'
import {
  AppFilterChips,
  AppModal,
  AppTabs,
  ComboChart,
  RingChart,
  paperTotalScore,
} from '@aiteach/shared'
import type { ComboAxis, ComboBar, ComboLine, OrgPaper, OrgQuestion } from '@aiteach/shared'
import { useKnowledgePool } from '@/composables/useKnowledgePool'
import {
  LEVEL_OPTIONS,
  LEVEL_UNKNOWN,
  PAPER_COUNT,
  difficultyRows,
  formatNumbers,
  knowledgeLevels,
  knowledgeRows,
  levelCounts,
  knownItems,
  paperItems,
  typeRows,
} from './paper-analysis'

const props = defineProps<{
  paper: OrgPaper
  /** 题库全量题目（与 PaperPreviewModal 同一入参口径，内部按 id 建索引） */
  questions: OrgQuestion[]
  /** 遮罩层级，透传给 AppModal：从试卷预览（130）里打开时要传 140 才压得住 */
  zIndex?: number
}>()
const emit = defineEmits<{ close: [] }>()

/** 难度读序固定为容易 → 困难：分布要能横着比，不能按出现先后排 */
const DIFFICULTY_ORDER = ['容易', '较易', '中等', '较难', '困难']
/**
 * 图表取色：与 `styles/main.css` 的设计令牌同值（图表组件收 hex，吃不到 CSS 变量，
 * 改了令牌这里要一起改）：--brand / --brand-2 / --warn。
 */
const CHART_BRAND = '#00b4a6'
const CHART_BRAND_2 = '#0891b2'
const CHART_WARN = '#e6930d'

const TABS = [
  { key: 'type', label: '题型分析', icon: 'list-ol' },
  { key: 'difficulty', label: '难度分析', icon: 'chart' },
  { key: 'knowledge', label: '知识点分析', icon: 'branch' },
]
const tab = ref('type')

/* ===== 卷内小事视图（三个页签共用） ===== */

const items = computed(() => paperItems(props.paper, props.questions))
const known = computed(() => knownItems(items.value))
const missingCount = computed(() => items.value.length - known.value.length)
const totalCount = computed(() => items.value.length)
const totalScore = computed(() => paperTotalScore(props.paper))

/* ===== 题型分析 ===== */

const typeStats = computed(() => typeRows(items.value))

/**
 * 题量与分值合成一张图：两者是同一批题型的两个量（题量个位、分值几十），
 * 量纲差一个数量级，共用一根轴会把题量压成一条线，所以左右各挂一根。
 * 拆成两张图时「哪种题型分多但题少」要来回对读，合起来一眼就能看出柱子高度不匹配。
 */
const typeAxes: ComboAxis[] = [
  { position: 'left', name: '题量' },
  { position: 'right', name: '分值（分）' },
]
const typeBars = computed<ComboBar[]>(() => [
  {
    name: '题量',
    data: typeStats.value.map((row) => row.count),
    color: CHART_BRAND,
    axis: 0,
    unit: '题',
  },
  {
    name: '分值',
    data: typeStats.value.map((row) => row.score),
    color: CHART_BRAND_2,
    axis: 1,
    unit: '分',
  },
])

/** 大题结构：每个大题的题量与分值 */
const sectionRows = computed(() =>
  props.paper.sections.map((section) => ({
    title: section.title,
    count: section.questions.length,
    score: section.questions.reduce((sum, item) => sum + item.score, 0),
  })),
)

/* ===== 难度分析 ===== */

const difficulties = computed(() => difficultyRows(props.paper, items.value, DIFFICULTY_ORDER))

/**
 * 三根轴：题数（个位）与分值（几十）量纲差一个数量级，共用一根轴会把题数压成一条线，
 * 所以各挂一根；分值占比是百分数，第三根只借它的刻度（`hidden`）—— 三根刻度尺并排会挤掉
 * 绘图区，而这根轴上的读数（每条线段的百分比）tooltip 与下方小表里都有。
 */
const difficultyAxes: ComboAxis[] = [
  { position: 'left', name: '题数' },
  { position: 'right', name: '分值（分）' },
  { position: 'right', name: '分值占比', offset: 56, suffix: '%', hidden: true },
]
const difficultyBars = computed<ComboBar[]>(() => [
  {
    name: '题数',
    data: difficulties.value.map((row) => row.count),
    color: CHART_BRAND,
    axis: 0,
    unit: '题',
  },
  {
    name: '分值',
    data: difficulties.value.map((row) => row.score),
    color: CHART_BRAND_2,
    axis: 1,
    unit: '分',
  },
])
const difficultyLine = computed<ComboLine>(() => ({
  name: '分值占比',
  data: difficulties.value.map((row) => round1(row.scoreRatio * 100)),
  color: CHART_WARN,
  axis: 2,
  unit: '%',
}))

/* ===== 知识点分析 ===== */

/* 知识点树按「年级 + 学科」现拉（试卷没有教材版本，传空串 —— 版本只参与节点 id 前缀）。
   档位（一级~五级）由树里的深度推，`knowledgeLevels` 里写清了退化规则。 */
const { nodes } = useKnowledgePool(() => ({ grade: props.paper.grade, subject: props.paper.subject }))
const levels = computed(() => knowledgeLevels(nodes.value))

/** 卷面题型筛选：'全部' 不过滤。候选项取卷内实际出现的题型，避免选出必然为空的一档 */
const typeFilter = ref('全部')
const typeOptions = computed(() => ['全部', ...typeStats.value.map((row) => row.label)])

/** 当前题型范围内的全部知识点（不按层级过滤 —— 频率的分母与层级 chip 无关） */
const knowledgeAll = computed(() =>
  knowledgeRows(props.paper, items.value, levels.value, typeFilter.value),
)
const knowledgeCounts = computed(() => levelCounts(knowledgeAll.value))

/** 层级 chip：固定五档，卷内出现了树里查不到的标签时补一个「未分级」 */
const levelOptions = computed(() => {
  const list: string[] = [...LEVEL_OPTIONS]
  if (knowledgeCounts.value[LEVEL_UNKNOWN]) list.push(LEVEL_UNKNOWN)
  return list
})
/** 档位名后面缀上知识点个数：0 也显示 —— 让人一眼看出是数据没有，而不是这一档坏了 */
const levelLabels = computed(() =>
  Object.fromEntries(levelOptions.value.map((name) => [name, `${name} · ${knowledgeCounts.value[name] ?? 0}`])),
)

const level = ref('')
/* 默认落在**第一个有数据的档位**：数学树的知识标签全在二级，默认一级会是一片空白。
   树是异步拉的，所以这个 watch 要 immediate —— 树回来后档位计数变了会自动落到有数据的那档；
   用户手点过之后只要该档还在列表里就不再自动改（点空档位看空态是他的自由）。 */
watch(
  [levelOptions, knowledgeCounts],
  ([list, counts]) => {
    if (level.value && list.includes(level.value)) return
    level.value = list.find((name) => (counts[name] ?? 0) > 0) ?? list[0]
  },
  { immediate: true },
)

/** 规模概览：知识点那项取当前题型范围内的考查点个数，与下面的表格同口径 */
const overview = computed(() => [
  { label: '题量', value: String(totalCount.value), hint: '道小题' },
  { label: '总分', value: String(totalScore.value), hint: '分' },
  { label: '大题', value: String(props.paper.sections.length), hint: '个部分' },
  { label: '知识点', value: String(knowledgeAll.value.length), hint: '个考查点' },
])

const visibleRows = computed(() => knowledgeAll.value.filter((row) => row.level === level.value))
/* 环图与表格同序（频数降序）：环上从 12 点方向顺时针读下去，与表里从上往下读是同一批知识点 */
const knowledgeRing = computed(() =>
  visibleRows.value.map((row) => ({ name: row.label, value: round1(row.scoreRatio * 100) })),
)

function round1(value: number): number {
  return Math.round(value * 10) / 10
}
function percent(ratio: number): string {
  return `${round1(ratio * 100)}%`
}
</script>

<template>
  <AppModal :title="`试卷分析 · ${paper.name}`" :width="900" :z-index="zIndex" @close="emit('close')">
    <div class="pa">
      <!-- 规模概览：三个页签共用，切页签不必回头找「这卷多大」 -->
      <div class="pa-cards">
        <div v-for="card in overview" :key="card.label" class="pa-card">
          <span class="pa-card-label">{{ card.label }}</span>
          <b class="pa-card-value">{{ card.value }}</b>
          <span class="pa-card-hint">{{ card.hint }}</span>
        </div>
      </div>

      <AppTabs v-model="tab" :tabs="TABS" />

      <p v-if="known.length === 0" class="pa-empty">卷内没有可统计的题目</p>

      <!-- ===== 题型分析 ===== -->
      <template v-else-if="tab === 'type'">
        <div class="pa-chart">
          <div class="pa-chart-title">题型分布</div>
          <!-- 不要图例：左右两根轴的名字（题量 / 分值）已经说清哪根柱是什么 -->
          <ComboChart
            :labels="typeStats.map((row) => row.label)"
            :axes="typeAxes"
            :bars="typeBars"
            :legend="false"
            :height="280"
          />
        </div>

        <div class="pa-block">
          <div class="pa-block-title">大题结构</div>
          <table class="pa-table pa-table--fixed pa-table--struct">
            <thead>
              <tr>
                <th class="pa-name-col">大题</th>
                <th class="pa-num-col">题量</th>
                <th class="pa-num-col">分值</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, index) in sectionRows" :key="index">
                <td class="pa-name-col" :title="row.title">{{ row.title }}</td>
                <td class="pa-num-col">{{ row.count }}</td>
                <td class="pa-num-col">{{ row.score }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>

      <!-- ===== 难度分析 ===== -->
      <template v-else-if="tab === 'difficulty'">
        <div class="pa-chart">
          <div class="pa-chart-title">难度分析</div>
          <!-- 不要图例：左右两根轴的名字（题数 / 分值）已经说清哪根柱是什么 -->
          <ComboChart
            :labels="difficulties.map((row) => row.label)"
            :axes="difficultyAxes"
            :bars="difficultyBars"
            :line="difficultyLine"
            :legend="false"
            :height="300"
          />
        </div>

        <!-- 图看趋势、表读准数：柱子被压扁或缩放时，图上的数字读不出来 -->
        <table class="pa-table pa-table--fixed pa-table--diff">
          <thead>
            <tr>
              <th class="pa-name-col">难度</th>
              <th class="pa-num-col">题数</th>
              <th class="pa-num-col">分值</th>
              <th class="pa-num-col">分值占比</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in difficulties" :key="row.label">
              <td class="pa-name-col">{{ row.label }}</td>
              <td class="pa-num-col">{{ row.count }}</td>
              <td class="pa-num-col">{{ row.score }}</td>
              <td class="pa-num-col">{{ percent(row.scoreRatio) }}</td>
            </tr>
          </tbody>
        </table>
      </template>

      <!-- ===== 知识点分析 ===== -->
      <template v-else>
        <div class="pa-filters">
          <AppFilterChips
            label="卷面题型"
            label-width="68px"
            :options="typeOptions"
            :model-value="typeFilter === '全部' ? ['全部'] : [typeFilter]"
            :multiple="false"
            @update:model-value="typeFilter = $event[0] ?? '全部'"
          />
          <!-- 知识维度 / 知识点范围：本版各只有一个取值，按规格做成固定值而不是能点的 chip
               （点了也没有第二个选项可切），接上第二个维度时再换成 AppFilterChips -->
          <div class="pa-static-row">
            <span class="pa-static-label">知识维度</span>
            <span class="pa-static-value">知识点</span>
          </div>
          <div class="pa-static-row">
            <span class="pa-static-label">知识点范围</span>
            <span class="pa-static-value">全部</span>
          </div>
          <AppFilterChips
            label="知识层级"
            label-width="68px"
            :options="levelOptions"
            :option-labels="levelLabels"
            :model-value="level ? [level] : []"
            :multiple="false"
            @update:model-value="level = $event[0] ?? level"
          />
        </div>

        <p v-if="visibleRows.length === 0" class="pa-empty">
          {{ level }}暂无知识点（换一档或换「卷面题型」看看）
        </p>
        <template v-else>
          <div class="pa-chart">
            <div class="pa-chart-title">知识点分值占比</div>
            <RingChart :data="knowledgeRing" unit="%" :height="300" />
          </div>

          <div class="pa-table-wrap">
            <table class="pa-table">
              <thead>
                <tr>
                  <th class="pa-kp-col">知识点</th>
                  <th>层级</th>
                  <th class="pa-num-col">频数</th>
                  <th class="pa-num-col">频率</th>
                  <th class="pa-num-col">卷均考频</th>
                  <th class="pa-num-col">分值</th>
                  <th class="pa-num-col">分值占比</th>
                  <th class="pa-no-col">题号</th>
                  <th class="pa-num-col">题数</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in visibleRows" :key="row.label">
                  <td class="pa-kp-col" :title="row.label">{{ row.label }}</td>
                  <td>{{ row.level }}</td>
                  <td class="pa-num-col">{{ row.frequency }}</td>
                  <td class="pa-num-col">{{ percent(row.rate) }}</td>
                  <td class="pa-num-col">{{ row.perPaper }}</td>
                  <td class="pa-num-col">{{ row.score }}</td>
                  <td class="pa-num-col">{{ percent(row.scoreRatio) }}</td>
                  <td class="pa-no-col" :title="formatNumbers(row.numbers)">{{ formatNumbers(row.numbers) }}</td>
                  <td class="pa-num-col">{{ row.count }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </template>
      </template>

      <!-- 统计口径写在页脚：缺题、一题多标签、各分母口径不写清，看表的人会以为算错了 -->
      <p class="pa-note">
        统计口径：分布只计入能查到题目的 {{ known.length }} 道小题（共 {{ totalCount }} 题，总分
        {{ totalScore }} 分）。<template v-if="missingCount > 0">
          另有 {{ missingCount }} 道题的题目数据已不存在，仅计入题量与分值。</template>
        知识点：频数按大题去重（同一大题内多道小题带同一标签只算 1 次），题数按小题计；一题带多个知识点时
        会在多行重复计入，故合计可能超过 100%。频率 = 频数 ÷ 当前「卷面题型」范围内的总频数；卷均考频 =
        频数 ÷ 试卷数（当前为单卷分析，分母 {{ PAPER_COUNT }}）；分值占比 = 分值 ÷ 卷面总分值
        {{ totalScore }} 分。
      </p>
    </div>
  </AppModal>
</template>

<style scoped>
/* 底部多留一截：本弹窗没有 footer，内容与弹窗下边框之间只剩 `AppModal` 的 18px，
   而内容末尾是整段口径说明（知识点页签还会滚到底），贴着边看着像被裁掉。
   加在内容根节点上而不是改共享的 `AppModal`，免得两端几十个弹窗跟着一起变。 */
.pa { display: flex; flex-direction: column; gap: 14px; padding-bottom: 12px; }

.pa-cards { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
/* 一项一行：标签 / 数值 / 单位横排，不折行 —— 竖排时四个卡片要占三行高，把下面的图挤下去 */
.pa-card {
  display: flex;
  flex-direction: row;
  align-items: baseline;
  gap: 6px;
  padding: 9px 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: #f8fafd;
  white-space: nowrap;
}
.pa-card-label { font-size: 12px; color: var(--sub); }
.pa-card-value { font-size: 18px; font-weight: 700; color: var(--ink); }
.pa-card-hint { font-size: 11.5px; color: var(--sub); }

.pa-block-title,
.pa-chart-title {
  font-size: 13px;
  font-weight: 700;
  color: var(--ink);
  margin-bottom: 6px;
}
.pa-chart { min-width: 0; }

.pa-filters { display: flex; flex-direction: column; gap: 8px; }
.pa-static-row { display: flex; align-items: center; gap: 12px; }
.pa-static-label { width: 68px; flex-shrink: 0; font-size: 12.5px; font-weight: 600; color: var(--sub); }
.pa-static-value { font-size: 12.5px; color: var(--ink-2); }

.pa-empty { font-size: 12.5px; color: var(--sub); }

.pa-table-wrap { overflow-x: auto; }
.pa-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
.pa-table th,
.pa-table td { text-align: left; padding: 7px 8px; border-bottom: 1px solid var(--border); color: var(--ink-2); }
.pa-table th { font-size: 12px; font-weight: 600; color: var(--sub); white-space: nowrap; }
.pa-table tbody tr:last-child td { border-bottom: none; }
/* 数值列右对齐：上面 `.pa-table th, .pa-table td` 的选择器权重更高，
   单写 `.pa-num-col` 会被它的 `text-align: left` 压掉，这里必须带上 .pa-table */
.pa-table .pa-num-col { width: 68px; text-align: right; white-space: nowrap; }

/* 默认（auto）布局下，剩余宽度会被「内容最长的那一列」全部吃掉 —— 难度 / 大题一列能占到
   600px 上下，而三个数值列被压到 68px。这两张表改成按表头给的百分比切列的固定布局。 */
.pa-table--fixed { table-layout: fixed; }
.pa-table.pa-table--diff .pa-name-col { width: 40%; }
.pa-table.pa-table--diff .pa-num-col { width: 20%; }
.pa-table.pa-table--struct .pa-name-col { width: 52%; }
.pa-table.pa-table--struct .pa-num-col { width: 24%; }
.pa-name-col { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* 题号列可能很长（「1、3-5、8」）：定宽 + 省略，完整串在 title 里 */
.pa-no-col { width: 130px; max-width: 130px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pa-kp-col { max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.pa-note { font-size: 12px; color: var(--sub); line-height: 1.7; }
</style>
