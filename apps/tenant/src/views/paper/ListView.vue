<script setup lang="ts">
/**
 * 试卷库：只展示**已审核通过**的试卷（个人创建的草稿存「我的文件」，编辑从那里进），
 * 因此列表是只读的 —— 没有「编辑 / 提交审核」入口，仅保留 预览 / 平行卷 / 导出 / 删除。
 * 新建入口只留 手动协同组卷 与 细目表组卷；智能组卷是独立菜单页（/paper/ai）。
 *
 * 版式与题库管理对齐：左边一棵树、右上筛选条件、右下列表。左边的树是**考试类型树**
 * （分类 → 考试类型），候选项随年级 / 学科收窄 —— 因此筛选面板里不再有「考试类型」这一行：
 * 同一个值两处都能改，必然出现「面板里清掉了、树上还亮着」。
 */
import { computed, onMounted, reactive, ref, watch } from 'vue'
import {
  AppFilterPanel,
  AppIcon,
  PAPER_CATEGORIES,
  PAPER_SOURCE_OPTIONS,
  appConfirm,
  showToast,
  AppModal,
} from '@aiteach/shared'
import type { FilterRowDef, OrgPaper, OrgQuestion } from '@aiteach/shared'
import PaperPreviewModal from '@/components/paper/PaperPreviewModal.vue'
import PaperListPanel from '@/components/paper/PaperListPanel.vue'
import ParallelPaperDialog from '@/components/paper/ParallelPaperDialog.vue'
import PaperTypeTree, { type PaperTypeGroup } from '@/components/compose/PaperTypeTree.vue'
import { recommendPapers } from '@/components/paper/paper-recommend'
import { browsePaper, deletePaper, downloadPaper, fetchPapers, fetchQuestions, fetchTenantDict } from '@/api/org'
import { useBaseData } from '@/composables/useBaseData'
import { exportPaperDoc, exportPaperPdf, type ExportVersion } from '@/utils/paper-export'

const papers = ref<OrgPaper[]>([])
const questions = ref<OrgQuestion[]>([])

/** 考试类型取自全局单例：左树要拿到 `paperCategory` 才能分组，光有名字不够，也免了本页再查一遍字典 */
const { examTypeItems, stageOf, ensure: ensureBase } = useBaseData()

/* ===== 筛选 =====
 * 年级 / 科目 / 难度 / 杯赛 / 地区候选项来自租户字典（与题库管理同一口径），
 * 字典是异步到达的，行定义只在运行时展开成 FilterRowDef。 */
interface PaperFilterRow {
  key: 'grade' | 'subject' | 'difficulty' | 'examType' | 'competition' | 'region' | 'source'
  label: string
  dict?: string
  options?: string[]
  /** 放不下的行收回一行 + 「展开 / 收起」，见 FilterRowDef.collapsible */
  collapsible?: boolean
}

/** 主条件（产品指定的顺序：年级 / 科目 / 难度 / 地区）。考试类型不在这里 —— 它归左侧的树 */
const FILTER_ROWS: PaperFilterRow[] = [
  { key: 'grade', label: '年级', dict: 'grade' },
  { key: 'subject', label: '科目', dict: 'subject' },
  { key: 'difficulty', label: '难度', dict: 'difficulty' },
  /* 地区铺满 34 个省级行政区后一行放不下，收起态只留一行 */
  { key: 'region', label: '地区', dict: 'region', collapsible: true },
]

/** 次要条件：收在「更多查询」里 */
const MORE_ROWS: PaperFilterRow[] = [
  { key: 'competition', label: '杯赛', dict: 'competition' },
  { key: 'source', label: '来源', options: [...PAPER_SOURCE_OPTIONS] },
]

/** 面板里渲染的行：回写与「清空」按这份走 */
const PANEL_ROWS = [...FILTER_ROWS, ...MORE_ROWS]

/** 参与过滤的全部维度 —— 比面板多一个考试类型（那份值由左树写，不在面板里出入） */
const ALL_ROWS: PaperFilterRow[] = [...PANEL_ROWS, { key: 'examType', label: '考试类型', dict: 'examType' }]

const filters = reactive<Record<PaperFilterRow['key'], string[]>>({
  grade: [],
  subject: [],
  difficulty: [],
  examType: [],
  competition: [],
  region: [],
  source: [],
})
const filterOptions = reactive<Record<string, string[]>>({})

/** 每个筛选 key 从试卷上取哪个值（可缺省的维度给空串，等价于「没有该属性」） */
const FIELD_OF: Record<PaperFilterRow['key'], (row: OrgPaper) => string> = {
  grade: (row) => row.grade,
  subject: (row) => row.subject,
  difficulty: (row) => row.difficulty ?? '',
  examType: (row) => row.examType ?? '',
  competition: (row) => row.competition ?? '',
  region: (row) => row.region ?? '',
  source: (row) => row.source ?? '',
}

function toRowDefs(rows: PaperFilterRow[]): FilterRowDef[] {
  return rows.map((row) => ({
    key: row.key,
    label: row.label,
    options: row.options ?? filterOptions[row.dict ?? ''] ?? [],
    collapsible: row.collapsible,
  }))
}
const filterRowDefs = computed(() => toRowDefs(FILTER_ROWS))
const moreRowDefs = computed(() => toRowDefs(MORE_ROWS))

/** AppFilterPanel 回传整份筛选值（覆盖式回写） */
function onFiltersChange(next: Record<string, string[]>) {
  PANEL_ROWS.forEach((row) => {
    filters[row.key] = next[row.key] ?? []
  })
  /* 考试类型：正常改某一行的回传里它一定在（面板 spread 的是整份 modelValue），原样写回即可；
     而「清空」只回传面板自己渲染的那几行、`examType` 会缺席（undefined）—— 那正是把左树一起
     清掉的信号。少了这一句，点「清空」后树上还亮着一类考试类型，列表却已经按它筛过了。 */
  filters.examType = next.examType ?? []
}

const keyword = ref('')
const page = ref(1)

/** 单份卷是否命中当前条件；`skip` 用来算「这一维度不算」的卷池（左树计数用） */
function matches(row: OrgPaper, skip?: PaperFilterRow['key']): boolean {
  for (const def of ALL_ROWS) {
    if (def.key === skip) continue
    const selected = filters[def.key]
    if (selected.length > 0 && !selected.includes(FIELD_OF[def.key](row))) return false
  }
  return !keyword.value || row.name.includes(keyword.value)
}

/**
 * 卷池：除考试类型外其余条件全生效。
 * 左树的计数用它而不是全库计数 —— 否则会与点下去看到的结果对不上
 * （树上写着「竞赛 5」、点进去只有 2 条，用户会以为丢了卷）。与组卷工作台试卷页签同一口径。
 */
const pool = computed(() => papers.value.filter((row) => matches(row, 'examType')))
const filtered = computed(() => papers.value.filter((row) => matches(row)))
const rows = computed(() => filtered.value.slice((page.value - 1) * 10, page.value * 10))

/* ===== 左侧：考试类型树（分类 → 考试类型） =====
 * 分组与归属来自平台管理端「考试类型」树的 `paperCategory`，这里只按 `PAPER_CATEGORIES`
 * 的顺序归组；没配分类的项不进树 —— 于是筛不到它。这不是漏洞：那棵树的一级节点就是四个
 * 试卷分类、新节点只能挂在某个分类下，配不出没有分类的类型。与组卷工作台试卷页签同一条口径。 */
const scopedExamTypeItems = computed(() => {
  const stages = filters.grade.map((grade) => stageOf(grade) ?? '')
  const subjects = filters.subject
  return examTypeItems.value.filter((item) => {
    /* 年级 / 学科都是多选：与「任一选中年级对应的学段」且「任一选中学科」兼容就留下 ——
       按交集算会把「高一 + 高二」这种多选直接筛成空树。空串 = 该年级不在字典里，视为不限学段。 */
    const stageOk = stages.length === 0 || stages.includes('') || !item.stage || stages.includes(item.stage)
    const subjectOk =
      subjects.length === 0 || !item.subjects?.length || item.subjects.some((name) => subjects.includes(name))
    return stageOk && subjectOk
  })
})

/** 考试类型 → 卷数。每个叶子查一次即可，不必为每个叶子把卷池重筛一遍 */
const poolByExamType = computed(() => {
  const map = new Map<string, number>()
  pool.value.forEach((row) => {
    const key = row.examType ?? ''
    map.set(key, (map.get(key) ?? 0) + 1)
  })
  return map
})

const treeGroups = computed<PaperTypeGroup[]>(() =>
  PAPER_CATEGORIES.map((name) => {
    const items = scopedExamTypeItems.value
      .filter((item) => item.paperCategory === name)
      .map((item) => ({ name: item.name, count: poolByExamType.value.get(item.name) ?? 0 }))
    return { name, items, count: items.reduce((sum, item) => sum + item.count, 0) }
  }),
)

/**
 * 年级 / 学科一换，树上原先选中的考试类型可能整个消失 —— 那个值既渲染不出选中态、也没地方取消，
 * 却仍在参与筛选，结果恒为空。字典没到位时不动，免得把选中项误清空（同 BankView 的 onScopeChange）。
 */
watch(scopedExamTypeItems, (items) => {
  if (!items.length) return
  const alive = new Set(items.map((item) => item.name))
  const next = filters.examType.filter((name) => alive.has(name))
  if (next.length !== filters.examType.length) filters.examType = next
})

/* 筛选 / 关键词变动后停在原页码会看到空列表，回第一页。
   分页已经搬进 PaperListPanel，但这条复位规则依赖的筛选状态仍归本页所有，所以留在这里。 */
watch([() => JSON.stringify(filters), keyword], () => {
  page.value = 1
})

async function load() {
  /* 试卷库只放审核通过的卷；草稿 / 待审在「我的文件」与审核中心里 */
  const [all, qs] = await Promise.all([fetchPapers(), fetchQuestions()])
  papers.value = all.filter((row) => row.status === 'approved')
  questions.value = qs
}

async function loadDicts() {
  /* examType 不在这里拉：左树的候选项要按年级 / 学科实时收窄、还要 paperCategory 才能分组，
     统一走 useBaseData（全站单例，组卷工作台已经加载过同一份） */
  const types = [...new Set(PANEL_ROWS.map((row) => row.dict).filter((d): d is string => !!d))]
  await Promise.all([
    ensureBase(),
    ...types.map(async (type) => {
      filterOptions[type] = (await fetchTenantDict(type)).map((item) => item.name)
    }),
  ])
}

function totalScore(paper: OrgPaper) {
  return paper.sections.reduce((sum, s) => sum + s.questions.reduce((t, q) => t + q.score, 0), 0)
}
function totalCount(paper: OrgPaper) {
  return paper.sections.reduce((sum, s) => sum + s.questions.length, 0)
}

/* ===== 预览 ===== */
const preview = ref<OrgPaper | null>(null)

/** 打开整卷预览 = 一次浏览：计数发给 mock，本地同步 +1（无需为此重拉列表） */
function onPreview(row: OrgPaper) {
  preview.value = row
  void browsePaper(row.id)
  row.viewCount = (row.viewCount ?? 0) + 1
}

/* 预览左栏「推荐试卷」：卷池就是本页这份已审核列表（`papers`，不受当前筛选影响 ——
   推荐要的是「同一批人能用的卷」，不是另一个搜索结果列表）。
   筛选与排序与组卷工作台「试卷」页签同一份实现，见 paper-recommend.ts */
const recommended = computed(() => recommendPapers(papers.value, preview.value))

/* ===== 平行卷（FR-PP-015） =====
   弹窗本体在 ParallelPaperDialog（工作台「试卷」页签也用同一个），这里只留「选中哪份卷」 */
const parallelTarget = ref<OrgPaper | null>(null)

/* ===== 导出 =====
 * 不再走「创建导出任务」的占位：试卷数据本来就在前端，直接生成文档即可。
 * 版本（学生版 / 教师版 / 纯答案）必须让老师选——把带答案的教师版误发给学生是实打实的教学事故，
 * 所以不做「默认给最全的」这种省事的决定。
 */
const exportTarget = ref<OrgPaper | null>(null)
const exportVersion = ref<'student' | 'teacher' | 'answer'>('student')
const exportWithCard = ref(true)

function openExport(row: OrgPaper) {
  exportTarget.value = row
  exportVersion.value = 'student'
  exportWithCard.value = row.sections.some((section) => section.questions.length > 0)
}

function doExport(kind: 'doc' | 'pdf') {
  const paper = exportTarget.value
  if (!paper) return
  if (totalCount(paper) === 0) {
    showToast('该试卷还没有题目，无法导出', 'error')
    return
  }
  const options = { version: exportVersion.value, withInfo: true, withAnswerCard: exportWithCard.value }
  try {
    if (kind === 'doc') {
      const fileName = exportPaperDoc(paper, questions.value, options)
      showToast(`已导出 ${fileName}`, 'success')
    } else {
      exportPaperPdf(paper, questions.value, options)
      showToast('已在新窗口打开，选择「另存为 PDF」即可', 'success')
    }
    /* 导出成功才算一次下载，本地同步 +1 */
    void downloadPaper(paper.id)
    paper.downloadCount = (paper.downloadCount ?? 0) + 1
    exportTarget.value = null
  } catch (error) {
    showToast(error instanceof Error ? error.message : '导出失败', 'error')
  }
}

async function onDelete(row: OrgPaper) {
  if (!(await appConfirm(`删除《${row.name}》？删除后放入回收站（保留 30 天可恢复）`, { type: 'danger' }))) return
  await deletePaper(row.id)
  showToast('已放入回收站', 'success')
  load()
}

onMounted(() => {
  void load()
  void loadDicts()
})
</script>

<template>
  <div class="paper-layout">
    <!-- 左：考试类型树（分类 → 考试类型，候选项随年级 / 学科收窄）。
         选中即写进 filters.examType —— 与面板共用同一份筛选状态，「清空」也会一并清掉它 -->
    <PaperTypeTree
      title="考试类型"
      :groups="treeGroups"
      :selected="filters.examType"
      @change="filters.examType = $event"
    />

    <!-- 右：筛选条件在上，试卷列表在下（结构与题库管理、组卷工作台试卷页签一致） -->
    <div class="right-col">
      <AppFilterPanel
        :rows="filterRowDefs"
        :more-rows="moreRowDefs"
        :model-value="filters"
        @update:model-value="onFiltersChange"
      />

      <!-- 列表整块交给共享面板（工作台「试卷」页签用同一个），弹窗与筛选状态仍留在本页。
           class 会透传到面板根节点上（Vue 的 attribute 透传），所以布局能在这里排 -->
      <PaperListPanel
        class="list-panel"
        :rows="rows"
        :total="filtered.length"
        v-model:page="page"
        v-model:keyword="keyword"
        placeholder="试卷名称"
        view-key="paper-list"
        @preview="onPreview"
      >
        <template #ops="{ row }">
          <button class="mini-btn" @click="onPreview(row)">预览</button>
          <button class="mini-btn" @click="parallelTarget = row">平行卷</button>
          <button class="mini-btn" @click="openExport(row)">导出</button>
          <button class="mini-btn danger" @click="onDelete(row)">删除</button>
        </template>
      </PaperListPanel>
    </div>

    <!-- 平行卷弹窗（生成 + 落库 + 提示都在组件里，本页只传母卷） -->
    <ParallelPaperDialog :paper="parallelTarget" @close="parallelTarget = null" />

    <!-- 导出弹窗：版本必须显式选，避免把带答案的教师版误发给学生 -->
    <AppModal v-if="exportTarget" title="导出试卷" :width="460" @close="exportTarget = null">
      <p style="font-size: 13.5px; color: var(--ink-2); margin-bottom: 12px">
        《{{ exportTarget.name }}》· {{ totalCount(exportTarget) }} 题 · {{ totalScore(exportTarget) }} 分
      </p>
      <div class="f-field">
        <label class="f-label">卷面版本</label>
        <select v-model="exportVersion" class="f-select">
          <option value="student">学生版（只有题目，解答留作答空白）</option>
          <option value="teacher">教师版（附答案与解析）</option>
          <option value="answer">纯答案页</option>
        </select>
      </div>
      <label class="f-check">
        <input v-model="exportWithCard" type="checkbox" />
        附带答题卡参考答案
      </label>
      <template #footer>
        <button class="btn btn-ghost" @click="exportTarget = null">取消</button>
        <button class="btn btn-ghost" @click="doExport('doc')">
          <AppIcon name="download" :size="14" /> 导出 Word
        </button>
        <button class="btn btn-primary" @click="doExport('pdf')">
          <AppIcon name="print" :size="14" /> 导出 PDF
        </button>
      </template>
    </AppModal>

    <!-- 整卷预览：弹窗按真实纸张（8K/A3/16K…）自动分版排版，可切换排版样式、答题卡。
         这里浏览的是库里已入库的现成卷，故传 `browse` —— 顶栏出分享 / 平行卷 / 分析，
         左栏「试卷分析」带推荐试卷，每题悬停可逐题取用（与工作台「试卷」页签同一套界面） -->
    <PaperPreviewModal
      v-if="preview"
      browse
      :paper="preview"
      :questions="questions"
      :recommended="recommended"
      @pick="onPreview"
      @close="preview = null"
    />
  </div>
</template>

<style scoped>
/* ===== 左右两栏 =====
   高度随屏幕动态撑满内容区（顶栏 62 + 内容区上下内边距 44），左右各自内部滚动：左树滚动时
   右侧筛选条不动，翻列表时左侧树不动。取值与题库管理的 .bank-layout 逐项一致，两页并排切换才不跳。 */
.paper-layout {
  --content-h: calc(100vh - 106px);
  display: flex;
  gap: 14px;
  align-items: stretch;
  height: var(--content-h);
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

/* 列表面板吃满右栏剩余高度：工具条与分页固定，仅列表区滚动。
   ⚠️ 类名不要取成 `type-panel` 这类与 PaperTypeTree 根节点同名的名字：父组件的 scoped 样式
   同样会落到子组件根节点上，`flex: 1` 会把左树的 `flex-shrink: 0` 盖掉、把树撑满整行。 */
.list-panel { flex: 1; min-height: 0; }
.list-panel :deep(.pagination) { flex-shrink: 0; }

/* 列表本体（工具条 / 表格 / 详细卡片 / 分页）已抽到 PaperListPanel，本页只剩导出弹窗的小样式 */
.f-check {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--ink-2);
  cursor: pointer;
  user-select: none;
}
.f-check input { accent-color: var(--brand); }
</style>
