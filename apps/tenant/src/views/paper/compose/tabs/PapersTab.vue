<script setup lang="ts">
/**
 * 试卷页签：浏览试卷库里的卷，并对单份卷做「预览 / 平行组卷 / 试卷分析」。
 *
 * 布局与「试题」页签对齐：左边试卷类型树，右上筛选条件、右下列表；列表本体用与试卷库
 * 同一个 `PaperListPanel`，但**只要详细视图**（`views: ['detail']`）—— 试卷是「读整份」的对象，
 * 表格只能读到卷名与几列属性，详细卡片才是这个页签的主形态。
 *
 * 三处「只有一个控件管」的取舍：
 * - **年级 / 学科**归页签条前的全局 `ScopePicker`，右上面板里不放（两处都能改同一个值必然打架）；
 * - **考试类型**归左树，右上面板里也不放；左树选中的就是这一组考试类型，写进共享的
 *   `filter.examTypes` —— 于是切到「试题」页签，同一批条件依然成立（工作台「条件跨页签保持」的既定语义）；
 * - **搜索框**顶栏 `ComposeSearchBar` 与列表工具条里各有一个，改的都是 `filter.keyword`，两侧实时
 *   同步（见 useComposeKeyword）—— 与「试题」页签一致；顶栏那个多支持图片 / AI 检索。
 *   关键词的命中范围见 `matchesPaperFilter`：卷名 / 出卷人 / **杯赛名** / 卷内题目，
 *   所以输入「希望杯」也能搜到杯赛卷（卷名里未必带这三个字）。
 *
 * 三个操作按钮各管一件事：预览 = 看卷面（复用试卷库的预览弹窗，但传 `reading` —— 换成阅读式：
 * 去掉排版参数，左栏给题型统计、平行组卷 / 分析试卷、推荐试卷，顶部可分享）、
 * 平行组卷 = 以它为母卷生成平行卷、试卷分析 = 看卷面构成。
 *
 * **逐题取用走预览**：阅读式预览里每道题悬停会出现一条操作条（预览 / 解析 / 收藏 / 纠错 /
 * 相似 / 加入组卷车），可以从一份现成卷里挑几道题进组卷车。这里三个按钮自己仍然不往车里加卷
 * ——「整卷引用」（`useComposeBasket.addFromPaper`，`source: 'paper'`）依旧没有调用方。
 *
 * 只看 `status === 'approved'` 的卷，与试卷库同口径 —— 草稿 / 待审的卷不该出现在「浏览现成卷」的场景里。
 */
import { computed, defineAsyncComponent, onMounted, reactive, ref, watch } from 'vue'
import { AppFilterPanel, PAPER_CATEGORIES, PAPER_SOURCE_OPTIONS } from '@aiteach/shared'
import type { FilterRowDef, OrgPaper } from '@aiteach/shared'
import PaperListPanel from '@/components/paper/PaperListPanel.vue'
import PaperPreviewModal from '@/components/paper/PaperPreviewModal.vue'
/* 异步挂载：分析弹窗里的三张图带 echarts（约 500 KB），不该进本页签的首屏包 ——
   与 `PaperPreviewModal` 里的同一处理，两处动态 import 同一个模块，构建后共用一个 chunk */
const PaperAnalysisModal = defineAsyncComponent(() => import('@/components/paper/PaperAnalysisModal.vue'))
import ParallelPaperDialog from '@/components/paper/ParallelPaperDialog.vue'
import PaperTypeTree, { type PaperTypeGroup } from '@/components/compose/PaperTypeTree.vue'
import { fetchTenantDict } from '@/api/org'
import { scopedExamTypes, useBaseData } from '@/composables/useBaseData'
import { useComposeData } from '@/composables/useComposeData'
import { useComposeKeyword } from '@/composables/useComposeKeyword'
import { EARLIER_YEAR, isEarlierYear, matchesPaperFilter, type ComposeFilter } from '../types'

const props = defineProps<{ filter: ComposeFilter }>()
const emit = defineEmits<{ patch: [patch: Partial<ComposeFilter>] }>()

const { papers, questions, loading, loaded, ensure, questionOf } = useComposeData()
const { examTypeItems, stageOf, ensure: ensureBase } = useBaseData()

void ensure()
void ensureBase()

/* ===== 卷池 =====
 * `pool`：除「考试类型」外其余条件全生效的卷池，左树计数用它 —— 直接拿全库计数会与点下去
 *   看到的结果对不上（树上写着「竞赛 5」，点进去只有 2 条，用户会以为丢了卷）。
 * `rows`：最终列表，考试类型也参与筛选。 */
const approved = computed(() => papers.value.filter((row) => row.status === 'approved'))

const pool = computed(() =>
  approved.value.filter((row) => matchesPaperFilter(row, { ...props.filter, examTypes: [] }, questionOf)),
)

const rows = computed(() => approved.value.filter((row) => matchesPaperFilter(row, props.filter, questionOf)))

/** 考试类型 → 卷数。每个叶子查一次即可，不必为每个叶子把卷池重筛一遍 */
const poolByExamType = computed(() => {
  const map = new Map<string, number>()
  pool.value.forEach((row) => {
    const key = row.examType ?? ''
    map.set(key, (map.get(key) ?? 0) + 1)
  })
  return map
})

/* ===== 左树：分类 → 考试类型 =====
 * 分类与归属都来自平台管理端「基础字典 - 考试类型」的配置（`paperCategory` 字段），
 * 这里只按 `PAPER_CATEGORIES` 的顺序归组；没配分类的历史字典项不进树（但仍可用于筛选）。 */
const scopedItems = computed(() => scopedExamTypes(examTypeItems.value, stageOf(props.filter.grade) ?? '', props.filter.subject))

const groups = computed<PaperTypeGroup[]>(() =>
  PAPER_CATEGORIES.map((name) => {
    const items = scopedItems.value
      .filter((item) => item.paperCategory === name)
      .map((item) => ({ name: item.name, count: poolByExamType.value.get(item.name) ?? 0 }))
    return { name, items, count: items.reduce((sum, item) => sum + item.count, 0) }
  }),
)

/** 左树选中项 = `filter.examTypes`，不放额外状态：跨页签共享、顶部搜索重置时一并清掉 */
const selectedExamTypes = computed(() => props.filter.examTypes)

/* ===== 右上：筛选条件 =====
 * 产品指定的五个维度：年份 / 月份 / 难度 / 地区 / 来源，全部平铺（不藏「更多查询」）。
 * 年级 / 学科（ScopePicker 管）与考试类型（左树管）刻意不放 —— 一处能改两遍必然打架。 */
type PaperFilterKey = 'year' | 'month' | 'difficulty' | 'region' | 'source'
interface PaperRowDef {
  key: PaperFilterKey
  label: string
  dict?: string
  /** 候选项由组件现算：年份的取值域是卷池（没有对应字典），拿不到一份静态列表 */
  live?: 'year'
  /** 候选项的文案后缀（取值本身不变）：月份给「3 月」 */
  unit?: string
  options?: string[]
  /** 单值维度（难度 / 来源）用单选 chip —— `ComposeFilter` 里它们就是单个字符串 */
  multiple?: boolean
}

/** 月份固定给满 1-12 月：它是「第几个月」这种固定档位，不该随卷池多少而少几个 */
const MONTHS = Array.from({ length: 12 }, (_, index) => String(index + 1))

const FILTER_ROWS: PaperRowDef[] = [
  { key: 'year', label: '年份', live: 'year' },
  { key: 'month', label: '月份', options: MONTHS, unit: '月' },
  { key: 'difficulty', label: '难度', dict: 'difficulty', multiple: false },
  { key: 'region', label: '地区', dict: 'region' },
  { key: 'source', label: '来源', options: [...PAPER_SOURCE_OPTIONS], multiple: false },
]

const ALL_ROWS = FILTER_ROWS
const filterOptions = reactive<Record<string, string[]>>({})

/** 一组卷里出现过的某个字段取值（去重，丢掉空值） */
function distinctOf(pick: (row: OrgPaper) => string | undefined, list: OrgPaper[]): string[] {
  return [...new Set(list.map(pick).filter((value): value is string => !!value))]
}

/**
 * 年份候选项 = 已入库卷里出现过的近三届（倒序，新的在前）+ 末尾的「更早以前」。
 *
 * 具体年份按已入库的卷推导：照抄一串年份会造出点进去必然为空的档（年份没有对应字典，
 * 取值域只可能是数据里出现的）。更早的年份不再逐个列，统一并进 `EARLIER_YEAR` ——
 * 年份这一行才不会被一串陈年老卷越铺越长。
 * 「更早以前」固定给一条（即使当前一份老卷也没有）：它是兜底的尾档，时有时无会让人
 * 以为年份只能选那三届。种子卷里留了老卷，这一档在演示里点得动。
 */
const yearOptions = computed(() => {
  const recent = distinctOf((row) => row.year, approved.value).filter((year) => !isEarlierYear(year))
  return [...recent.sort().reverse(), EARLIER_YEAR]
})

/** 某一行的候选项：年份取卷池推导值，字典行取已加载的字典，其余取行定义里的静态 options */
function optionsOf(row: PaperRowDef): string[] {
  if (row.live === 'year') return yearOptions.value
  return row.options ?? filterOptions[row.dict ?? ''] ?? []
}

/** 候选项文案：带单位（取值本身不变，仍是 `'2026'` / `'3'`）；年份那档把哨兵译成「更早以前」 */
function labelsOf(row: PaperRowDef, options: string[]): Record<string, string> | undefined {
  if (row.live === 'year') {
    return Object.fromEntries(
      options.map((value) => [value, value === EARLIER_YEAR ? '更早以前' : `${value} 年`]),
    )
  }
  if (row.unit) return Object.fromEntries(options.map((value) => [value, `${value} ${row.unit}`]))
  return undefined
}

function toRowDefs(defs: PaperRowDef[]): FilterRowDef[] {
  return defs.map((row) => {
    const options = optionsOf(row)
    return {
      key: row.key,
      label: row.label,
      options,
      optionLabels: labelsOf(row, options),
      multiple: row.multiple,
    }
  })
}
const filterRowDefs = computed(() => toRowDefs(FILTER_ROWS))

/** 面板回显：单值字段包一层数组，chip 才有东西可渲染 */
const filterSel = computed<Record<string, string[]>>(() => ({
  year: props.filter.years,
  month: props.filter.months,
  difficulty: props.filter.difficulty ? [props.filter.difficulty] : [],
  region: props.filter.regions,
  source: props.filter.source ? [props.filter.source] : [],
}))

function onFiltersChange(next: Record<string, string[]>) {
  emit('patch', {
    years: next.year ?? [],
    months: next.month ?? [],
    difficulty: next.difficulty?.[0] ?? '',
    regions: next.region ?? [],
    source: next.source?.[0] ?? '',
  })
}

async function loadDicts() {
  const types = [...new Set(ALL_ROWS.map((row) => row.dict).filter((d): d is string => !!d))]
  await Promise.all(
    types.map(async (type) => {
      filterOptions[type] = (await fetchTenantDict(type)).map((item) => item.name)
    }),
  )
}

onMounted(() => {
  void loadDicts()
})

/* ===== 关键词：列表工具条里的搜索框与顶栏 `ComposeSearchBar` 改的是同一个 `filter.keyword`
   （与「试题」页签同一套同步逻辑，两侧实时互通） ===== */
const keyword = useComposeKeyword(
  () => props.filter.keyword,
  (value) => emit('patch', { keyword: value }),
)

/* ===== 分页 ===== */
const PAGE_SIZE = 10
const page = ref(1)
const paged = computed(() => rows.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE))

/** 命中数变了就回第 1 页，否则会出现「筛完只剩 3 条却停在第 7 页」的空列表 */
watch(
  () => rows.value.length,
  () => {
    page.value = 1
  },
)

/* ===== 三个操作各自的弹窗 =====
   状态只留「点的是哪份卷」，弹窗本体都在共享组件里（平行组卷与试卷库同一份，
   预览与试卷库同一份）—— 本页不重复实现任何一条流程 */
const openPreview = ref<OrgPaper | null>(null)
const parallelTarget = ref<OrgPaper | null>(null)
const analysisTarget = ref<OrgPaper | null>(null)

/** 预览左侧「推荐试卷」的份数 */
const RECOMMEND_COUNT = 3

/**
 * 推荐试卷：正在看的那份卷的同学科同年级卷，按浏览数取前几份。
 *
 * 取「同年级同学科」而不是按当前筛选条件：筛选是用户为**找卷**设的（比如限定「竞赛 + 2026 年」），
 * 拿它当推荐条件，切一次筛选推荐就换一批，反而像另一个搜索结果列表；
 * 年级学科是卷的固有属性，推荐的是「同一批人能用的卷」。
 * 排除当前卷本身，并保留原顺序稳定性（浏览数相同时按 id 排）。
 */
const recommended = computed(() => {
  const current = openPreview.value
  if (!current) return []
  return approved.value
    .filter((row) => row.id !== current.id && row.grade === current.grade && row.subject === current.subject)
    .sort((a, b) => (b.viewCount ?? 0) - (a.viewCount ?? 0) || a.id - b.id)
    .slice(0, RECOMMEND_COUNT)
})
</script>

<template>
  <div class="pt">
    <!-- 左：试卷类型树（选中即把该分类 / 类型的考试类型名写进 filter.examTypes） -->
    <PaperTypeTree
      :groups="groups"
      :selected="selectedExamTypes"
      @change="emit('patch', { examTypes: $event })"
    />

    <!-- 右：筛选条件在上，试卷列表在下（与试题页签同一结构） -->
    <div class="right-col">
      <AppFilterPanel :rows="filterRowDefs" :model-value="filterSel" @update:model-value="onFiltersChange" />

      <!-- class 会合并到 PaperListPanel 的根节点上（Vue 的 attribute 透传），
           所以这里能直接给共享面板排布局，面板内部不必知道自己被谁用。
           ⚠️ 类名别取成 `pt-panel` 之类与 PaperTypeTree 根节点同名的名字：父组件的 scoped 样式
           同样会落到子组件根节点上，`flex: 1` 会把左树的 `flex-shrink: 0` 盖掉、把树撑满整行 -->
      <PaperListPanel
        class="list-panel"
        :rows="paged"
        :total="rows.length"
        v-model:page="page"
        v-model:keyword="keyword"
        view-key="compose-papers"
        :views="['detail']"
        placeholder="试卷名称 / 竞赛名称"
        :empty-text="loading && !loaded ? '正在加载试卷…' : '没有匹配的试卷'"
        @preview="openPreview = $event"
      >
        <!-- 份数放在工具条右端（详细视图没有切换器，这里就是右端）：
             工具条左端留给搜索框 -->
        <template #toolbar-right>
          <span class="pt-total">共 <b>{{ rows.length }}</b> 份试卷</span>
        </template>
        <!-- 三个操作贴着卷名右侧（见 PaperListPanel 的 .pc-head） -->
        <template #ops="{ row }">
          <button class="mini-btn" type="button" @click="openPreview = row">预览</button>
          <button class="mini-btn" type="button" @click="parallelTarget = row">平行组卷</button>
          <button class="mini-btn" type="button" @click="analysisTarget = row">试卷分析</button>
        </template>
      </PaperListPanel>
    </div>

    <!-- 三个弹窗都复用共享组件：预览与试卷库同一份（A4/8K 排版与答题卡），
         平行组卷与试卷库同一份（同一个接口与提示），试卷分析是卷面构成分析。
         预览传 `reading`：这里浏览的是已经排好版的现成卷，预览按阅读式来
         （不展示排版参数，左栏给试题统计 / 平行组卷 / 分析试卷 / 推荐试卷，顶部可分享）——
         试卷库 / 编辑页 / 协同任务 / 组卷车草稿那四处仍是不传的排版预览 -->
    <PaperPreviewModal
      v-if="openPreview"
      reading
      :paper="openPreview"
      :questions="questions"
      :recommended="recommended"
      @pick="openPreview = $event"
      @close="openPreview = null"
    />
    <ParallelPaperDialog :paper="parallelTarget" @close="parallelTarget = null" />
    <PaperAnalysisModal
      v-if="analysisTarget"
      :paper="analysisTarget"
      :questions="questions"
      @close="analysisTarget = null"
    />
  </div>
</template>

<style scoped>
/* 左右两栏各自撑满内容区高度：左树内部滚动，右列的列表内部滚动，翻页时筛选条不动 */
.pt {
  display: flex;
  gap: 14px;
  align-items: stretch;
  height: 100%;
  min-height: 480px;
}
.right-col {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 14px;
  height: 100%;
}

/* 面板吃满右栏剩余高度：工具条与分页固定，仅列表区滚动（结构同试题页签的 .table-panel） */
.list-panel { flex: 1; min-height: 0; }
.list-panel :deep(.list-toolbar) { margin-bottom: 10px; }
.list-panel :deep(.pagination) { flex-shrink: 0; }

.pt-total { font-size: 12.5px; color: var(--sub); white-space: nowrap; }
.pt-total b { color: var(--brand-deep); font-size: 14px; }
</style>
