<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { AppIcon, AppFilterPanel, AppListToolbar, AppSegmented, QUESTION_SOURCE_OPTIONS, RichTextViewer, showToast, ApiError, toPlainText, truncateRich, AppModal } from '@aiteach/shared'
import type { FilterRowDef, OrgQuestion, QuestionCorrection } from '@aiteach/shared'
import AppPagination from '@/components/ui/AppPagination.vue'
import KnowledgeFilter from '@/components/ui/KnowledgeFilter.vue'
import QuestionOptions from '@/components/question/QuestionOptions.vue'
import QuestionPreviewDrawer from '@/components/question/QuestionPreviewDrawer.vue'
import {
  fetchQuestionCorrections,
  fetchQuestions,
  fetchTenantDict,
  toggleQuestionOffline,
  variantOf,
} from '@/api/org'
import type { TenantDictItem } from '@/api/org'
import { examTypesFor, scopedQuestionTypes } from '@/composables/useBaseData'
import { useScope } from '@/composables/useScope'
import { useViewMode } from '@/composables/useViewMode'
import {
  difficultyClass,
  isJudgeNoOptions,
  judgeAnswerText,
  needsFigure,
  optionColumnsOf,
} from '@/utils/question-card'

const router = useRouter()
const route = useRoute()

/** 顶部栏的全局年级 / 学科：只用来给下面的 scope 一个初值，之后以左侧面板为准 */
const { grade: scopeGrade, subject: scopeSubject, ensureScope } = useScope()

/* 列表只呈现这两种状态，中文标签同时就是筛选面板里的取值（见 FIELD_OF.status）。
   草稿 / 校验中 / 待终审 / 已驳回属于审核流，去「题目审核」页看。 */
const STATUS_LABEL: Record<string, string> = { approved: '已入库', offline: '已下架' }
const VISIBLE_STATUS = Object.keys(STATUS_LABEL)

/* ===== 数据 ===== */
const list = ref<OrgQuestion[]>([])
/**
 * 纠错记录（全量，按提交时间倒序）。
 * 列表上的标识、预览抽屉里的「纠错记录」分节、右上「纠错题目」筛选条件，三处共用这一份，
 * 本地按 questionId 分组即可 —— 记录量级是「一题几条」，不值得再开一个「哪些题有纠错」的接口。
 */
const corrections = ref<QuestionCorrection[]>([])
const loading = ref(false)

async function load() {
  loading.value = true
  try {
    /* 顶部栏作用域只作为 scope 的初值（左侧知识点面板随后会抛出它自己的年级 / 学科，
       那里才是这两个维度的权威来源）；字典失败不阻断开列，退化为缓存值即可 */
    await ensureScope().catch(() => {})
    if (!scope.value.grade && scopeGrade.value) {
      scope.value = { grade: scopeGrade.value, subject: scopeSubject.value }
    }
    const [rows, records] = await Promise.all([fetchQuestions(), fetchQuestionCorrections()])
    list.value = rows
    corrections.value = records
  } finally {
    loading.value = false
  }
}

const correctionsByQuestion = computed(() => {
  const grouped = new Map<number, QuestionCorrection[]>()
  for (const record of corrections.value) {
    const rows = grouped.get(record.questionId)
    if (rows) rows.push(record)
    else grouped.set(record.questionId, [record])
  }
  return grouped
})

/** 某道题的纠错记录；没有则空数组，模板里直接用 length 判「有没有标识」 */
function correctionsOf(id: number): QuestionCorrection[] {
  return correctionsByQuestion.value.get(id) ?? []
}

/** 标识的悬浮说明：摊平类型，省得为了知道是哪类问题还得点开预览 */
function correctionTitle(id: number): string {
  const records = correctionsOf(id)
  return `${records.length} 条纠错：${[...new Set(records.flatMap((item) => item.types))].join('、')}`
}

/* ===== 左侧教材知识点过滤（KnowledgeFilter 组件，选中节点返回子树叶子 tag） ===== */
const activeTags = ref<string[] | null>(null)
function onKnowledgeChange(tags: string[] | null) {
  activeTags.value = tags
}

/**
 * 年级 / 学科：不再单独出筛选行，改由左侧知识点面板的教材级联（年级 → 学科 → 版本）驱动 ——
 * 知识点树本来就是按这两个维度加载的，两处各筛一次只会互相打架。面板默认跟随顶部栏作用域，
 * 所以初始行为与从前一致。
 */
const scope = ref({ grade: '', subject: '' })
function onScopeChange(next: { grade: string; subject: string }) {
  scope.value = next
  /*
   * 换学科后，原学科专属题型（英语的完形填空 / 七选五 / 短文改错）不再是候选项。
   * 这种选中值在筛选面板里渲染不出 chip（chips 只按 options 渲染），却仍在参与筛选 ——
   * 结果恒为空且用户找不到地方取消，所以一并去掉。字典未到位时不动，免得误清空。
   */
  const types = scopedQuestionTypes(typeItems.value, next.subject)
  if (!next.subject || !types.length) return
  filterSel.type = filterSel.type.filter((type) => types.includes(type))
}

/* ================= 右上：可折叠筛选条件 ================= */
/**
 * 本页的筛选行定义。候选项大多来自租户字典，字典是异步到达的，所以这里只描述「去哪个字典取」，
 * 运行时再展开成共享组件要的 `FilterRowDef`（见 filterRows / moreFilterRows）。
 */
interface BankFilterRow {
  key: 'type' | 'difficulty' | 'examType' | 'competition' | 'status' | 'correction' | 'useCount' | 'region' | 'source' | 'term'
  label: string
  dict?: string
  options?: string[]
  /** 放不下的行收回一行 + 「展开 / 收起」，见 FilterRowDef.collapsible */
  collapsible?: boolean
}

/** 使用次数没法按精确值做筛选项，按档给；档位边界贴着种子分布，保证每档都有题 */
const USE_COUNT_BUCKETS: Array<{ label: string; match: (count: number) => boolean }> = [
  { label: '从未使用', match: (count) => count === 0 },
  { label: '1-9 次', match: (count) => count >= 1 && count <= 9 },
  { label: '10-19 次', match: (count) => count >= 10 && count <= 19 },
  { label: '20 次以上', match: (count) => count >= 20 },
]

/** 主条件：顺序即产品指定的顺序（题型 / 难度 / 考试类型 / 杯赛） */
const FILTER_ROWS: BankFilterRow[] = [
  { key: 'type', label: '题型', dict: 'questionType' },
  { key: 'difficulty', label: '难度', dict: 'difficulty' },
  { key: 'examType', label: '考试类型', dict: 'examType' },
  { key: 'competition', label: '杯赛', dict: 'competition' },
]

/** 次要条件：收在「更多查询」里，选中后靠折叠开关上的角标露出 */
const MORE_ROWS: BankFilterRow[] = [
  { key: 'status', label: '状态', options: Object.values(STATUS_LABEL) },
  /* 「纠错题目」= 有没有老师提交过纠错反馈；要处理这些题时选「已提交纠错」把它们捞出来 */
  { key: 'correction', label: '纠错题目', options: ['已提交纠错', '未提交纠错'] },
  { key: 'useCount', label: '使用次数', options: USE_COUNT_BUCKETS.map((row) => row.label) },
  /* 地区铺满 34 个省级行政区，一行放不下 —— 收起态只留一行，需要时再展开 */
  { key: 'region', label: '地区', dict: 'region', collapsible: true },
  { key: 'source', label: '来源', options: QUESTION_SOURCE_OPTIONS },
  { key: 'term', label: '学期', options: ['上学期', '下学期'] },
]

/** 主条件 + 更多查询 = 参与过滤的全部行（回写、清空、取值映射都按这份走） */
const ALL_ROWS = [...FILTER_ROWS, ...MORE_ROWS]

const filterSel = reactive<Record<BankFilterRow['key'], string[]>>({
  type: [],
  difficulty: [],
  examType: [],
  competition: [],
  status: [],
  correction: [],
  useCount: [],
  region: [],
  source: [],
  term: [],
})
const filterOptions = reactive<Record<string, string[]>>({})
/** 题型字典原始项（含适用学科），候选项按当前学科实时收窄 */
const typeItems = ref<TenantDictItem[]>([])

/** 展开给共享 AppFilterPanel 的行定义（选项为空的字典行由组件显示「暂无可选项」） */
function toRowDefs(rows: BankFilterRow[]): FilterRowDef[] {
  return rows.map((row) => ({
    key: row.key,
    label: row.label,
    options: rowOptions(row),
    collapsible: row.collapsible,
  }))
}
const filterRows = computed<FilterRowDef[]>(() => toRowDefs(FILTER_ROWS))
const moreFilterRows = computed<FilterRowDef[]>(() => toRowDefs(MORE_ROWS))

/** AppFilterPanel 回传的是整份筛选值（覆盖式回写，不做级联） */
function onFiltersChange(next: Record<string, string[]>) {
  ALL_ROWS.forEach((row) => {
    filterSel[row.key] = next[row.key] ?? []
  })
}

function rowOptions(row: BankFilterRow): string[] {
  if (row.options) return row.options
  /* 题型按学科收窄：通用题型 + 当前学科的专属题型（英语的完形填空 / 七选五 / 短文改错） */
  if (row.dict === 'questionType') return scopedQuestionTypes(typeItems.value, scope.value.subject)
  /* 考试类型按学段 / 学科收窄：字典项带「适配学段 / 学科」后，高一·数学下不该出现「小升初真题」
     这类点进去必然为空的取值。候选项走 useBaseData（本页顶部栏作用域已经 ensure 过字典） */
  if (row.dict === 'examType') return examTypesFor(scope.value.grade, scope.value.subject)
  return filterOptions[row.dict ?? ''] ?? []
}

async function loadDicts() {
  /* examType 不在这里拉：候选项要按学段 / 学科实时收窄，统一走 useBaseData（见 rowOptions） */
  const dictTypes = [...new Set(ALL_ROWS.map((row) => row.dict).filter((d): d is string => !!d && d !== 'examType'))]
  await Promise.all(
    dictTypes.map(async (type) => {
      const items = await fetchTenantDict(type)
      /* 题型的候选项要随学科重算，留下原始字典项；其余字典只用到名字 */
      if (type === 'questionType') typeItems.value = items
      else filterOptions[type] = items.map((item) => item.name)
    }),
  )
}

/* ================= 列表筛选 / 分页 ================= */
/** 工作台全局搜索跳转过来时带 ?keyword=；同路由换关键词不会重新挂载，故用 watch 跟随 */
const keyword = ref(typeof route.query.keyword === 'string' ? route.query.keyword : '')
watch(
  () => route.query.keyword,
  (value) => {
    if (typeof value === 'string') keyword.value = value
  },
)
/** 表格 / 详细两种展示（互斥，始终有选中项）→ 共享 AppSegmented；选择记在本地，下次进来沿用 */
const viewMode = useViewMode('question-bank', ['table', 'detail'] as const, 'table')
const VIEW_MODES = [
  { value: 'table', label: '表格', icon: 'grid' },
  { value: 'detail', label: '详细', icon: 'file' },
]
/** AppSegmented 回传 string，这里收窄回 viewMode 的联合类型 */
function setViewMode(value: string) {
  viewMode.value = value as 'table' | 'detail'
}

const page = ref(1)

/**
 * 每个筛选 key 从题目上取哪个值。
 * 杯赛 / 地区是可选字段，缺省给空串 —— 空串永远不落在任何候选项里，等价于「这题没有这个属性」。
 * 状态用中文标签（面板里显示的也是标签），使用次数用桶名（精确值做不了筛选项）。
 * 纠错取自纠错记录（不是题目自身的字段）：有记录 = 已提交纠错。
 */
const FIELD_OF: Record<BankFilterRow['key'], (row: OrgQuestion) => string> = {
  type: (row) => row.type,
  difficulty: (row) => row.difficulty,
  examType: (row) => row.examType ?? '',
  competition: (row) => row.competition ?? '',
  status: (row) => STATUS_LABEL[row.status] ?? '',
  correction: (row) => (correctionsByQuestion.value.has(row.id) ? '已提交纠错' : '未提交纠错'),
  useCount: (row) => USE_COUNT_BUCKETS.find((bucket) => bucket.match(row.useCount))?.label ?? '',
  region: (row) => row.region ?? '',
  source: (row) => row.source,
  term: (row) => row.term ?? '',
}

const filtered = computed(() => {
  const kw = keyword.value.trim()
  /* 状态不选时 = 只看已入库；选「已下架」才把下架题翻出来重新上架。
     硬性可见性（VISIBLE_STATUS）在下面第一道卡住草稿 / 校验中 / 待终审 / 已驳回。 */
  const statusSel = filterSel.status.length ? filterSel.status : [STATUS_LABEL.approved]
  return list.value.filter((row) => {
    if (!VISIBLE_STATUS.includes(row.status)) return false
    if (scope.value.grade && row.grade !== scope.value.grade) return false
    if (scope.value.subject && row.subject !== scope.value.subject) return false
    if (activeTags.value && !row.knowledge.some((tag) => activeTags.value!.includes(tag))) return false
    if (!statusSel.includes(FIELD_OF.status(row))) return false
    for (const def of ALL_ROWS) {
      const selected = filterSel[def.key]
      if (selected.length > 0 && !selected.includes(FIELD_OF[def.key](row))) return false
    }
    if (kw && !toPlainText(row.stem).includes(kw) && !String(row.id).includes(kw)) return false
    return true
  })
})

/** 表格与详细两种展示每页都是 10 条 */
const pageSize = 10
const paged = computed(() => filtered.value.slice((page.value - 1) * pageSize, page.value * pageSize))

watch([activeTags, scope, () => JSON.stringify(filterSel), keyword, viewMode], () => {
  page.value = 1
})

/* needsFigure / difficultyClass 与 AI 生成结果列表同源，已收敛到 @/utils/question-card，
   避免两处各改一份；选项字母与排布则由 QuestionOptions 组件统一渲染 */

/* ===== 详细列表：解析展开 ===== */
const analysisOpen = ref<number[]>([])

function toggleAnalysis(id: number) {
  const index = analysisOpen.value.indexOf(id)
  if (index >= 0) analysisOpen.value.splice(index, 1)
  else analysisOpen.value.push(id)
}

/* ===== 操作：预览 / 编辑 / 变式 / 上下架 ===== */
const preview = ref<OrgQuestion | null>(null)
const variantOpen = ref<OrgQuestion | null>(null)

/** 带题目 id 进录题中心（落手动态；新建入口在侧边菜单，列表里只做编辑改题） */
function goEdit(id: number) {
  router.push({ path: '/question/create', query: { id: String(id) } })
}

/**
 * 上架 / 下架。后端只在 `已入库 ⇄ 已下架` 之间切换，其余状态会报错（那种题本来也不在本列表里）。
 * toast 按**返回值**说，不按点击前的状态取反 —— 列表点完就重载，说错了用户也看不出是哪里不对。
 */
async function onToggleOffline(row: OrgQuestion) {
  try {
    const next = await toggleQuestionOffline(row.id)
    showToast(next.status === 'offline' ? `题目 #${row.id} 已下架` : `题目 #${row.id} 已重新上架`, 'success')
    void load()
  } catch (error) {
    showToast(error instanceof ApiError ? error.message : '操作失败', 'error')
  }
}

async function onManualVariant() {
  if (!variantOpen.value) return
  const copy = await variantOf(variantOpen.value.id)
  showToast('已复制原题为变式草稿，永久建立关联', 'success')
  variantOpen.value = null
  goEdit(copy.id)
  void load()
}

function goAiVariant() {
  if (!variantOpen.value) return
  router.push({ path: '/question/create', query: { mode: 'ai', variantOf: String(variantOpen.value.id) } })
  variantOpen.value = null
}

/* ===== 挂载 ===== */
onMounted(() => {
  void load()
  void loadDicts()
})
</script>

<template>
  <div class="bank-layout">
    <!-- 年级 / 学科由左侧教材级联驱动（scopeChange），右上不再重复出这两行 -->
    <KnowledgeFilter :rows="list" @change="onKnowledgeChange" @scope-change="onScopeChange" />

    <!-- 右侧 -->
    <div class="right-col">
      <!-- 搜索条件（可折叠；行渲染 / 折叠汇总 / 清空由共享组件 AppFilterPanel 负责，
           「更多查询」里收着使用次数 / 地区 / 来源 / 学期等次要条件） -->
      <AppFilterPanel
        :rows="filterRows"
        :more-rows="moreFilterRows"
        :model-value="filterSel"
        @update:model-value="onFiltersChange"
      />

      <!-- 试题列表 -->
      <div class="panel table-panel">
        <AppListToolbar v-model="keyword" placeholder="题干关键词 / 题目编号" :search-width="240">
          <template #right>
            <AppSegmented :options="VIEW_MODES" :model-value="viewMode" @update:model-value="setViewMode" />
          </template>
        </AppListToolbar>

        <!-- 表格显示 -->
        <div v-if="viewMode === 'table'" class="data-table-wrap">
          <table class="data-table bank-table">
            <thead>
              <tr>
                <th style="width: 46px">序号</th>
                <th style="width: 96px">题目编号</th>
                <!-- 题干列是唯一的「不定宽」列：table-layout: fixed 下它吃掉剩余空间，
                     于是窗口越宽题干越舒展、窄了就换行（见 .bank-table 的说明） -->
                <th>题干</th>
                <th style="width: 76px">题型</th>
                <th style="width: 66px">难度</th>
                <th style="width: 150px">知识点</th>
                <th style="width: 76px">使用次数</th>
                <th style="width: 96px">更新时间</th>
                <th style="width: 264px">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="loading && list.length === 0">
                <td colspan="9" class="empty-row">加载中…</td>
              </tr>
              <tr v-else-if="paged.length === 0">
                <td colspan="9" class="empty-row">暂无符合条件的题目</td>
              </tr>
              <template v-else>
                <tr v-for="(row, i) in paged" :key="row.id">
                  <td>{{ (page - 1) * pageSize + i + 1 }}</td>
                  <td class="cell-strong">
                    <!-- 编号下挂「纠错 N」标识：这一列本来就窄，横排会把题干挤走，故竖着放 -->
                    <div class="no-cell">
                      <span>#{{ row.id }}</span>
                      <span
                        v-if="correctionsOf(row.id).length"
                        class="tag tag-red no-badge"
                        :title="correctionTitle(row.id)"
                      >
                        纠错 {{ correctionsOf(row.id).length }}
                      </span>
                    </div>
                  </td>
                  <td class="stem-cell" @click="preview = row"><RichTextViewer :content="row.stem" tag="span" /></td>
                  <td>{{ row.type }}</td>
                  <td>{{ row.difficulty }}</td>
                  <td class="knowledge-cell" :title="row.knowledge.join('、')">{{ row.knowledge.join('、') }}</td>
                  <td>{{ row.useCount }} 次</td>
                  <td class="time-cell">{{ row.updatedAt.slice(5, 16) }}</td>
                  <td>
                    <div class="op-group">
                      <button class="mini-btn" type="button" @click="preview = row">预览</button>
                      <button class="mini-btn" type="button" @click="goEdit(row.id)">编辑</button>
                      <button class="mini-btn" type="button" @click="variantOpen = row">变式</button>
                      <button class="mini-btn" type="button" @click="onToggleOffline(row)">
                        {{ row.status === 'offline' ? '上架' : '下架' }}
                      </button>
                    </div>
                  </td>
                </tr>
              </template>
            </tbody>
          </table>
        </div>

        <!-- 详细列表：完整面板卡片 -->
        <div v-else class="detail-list">
          <p v-if="paged.length === 0" class="empty-row">暂无符合条件的题目</p>
          <article v-for="row in paged" :key="row.id" class="q-card">
            <div class="qc-meta">
              <span class="qc-id">#{{ row.id }}</span>
              <!-- 有人提交过纠错：点「预览」看具体是哪些问题 -->
              <span
                v-if="correctionsOf(row.id).length"
                class="tag tag-red"
                :title="correctionTitle(row.id)"
              >
                纠错 {{ correctionsOf(row.id).length }}
              </span>
              <span class="tag tag-blue">{{ row.type }}</span>
              <span class="tag" :class="difficultyClass(row.difficulty)">{{ row.difficulty }}</span>
              <span class="qc-kp">{{ row.knowledge.join('、') }}</span>
              <span class="qc-right">使用 {{ row.useCount }} 次 · {{ row.updatedAt.slice(5, 16) }}</span>
            </div>
            <RichTextViewer class="qc-stem" :content="row.stem" @click="preview = row" />
            <!-- 配图（含图形描述的题展示图位；题内已嵌图的不再占位） -->
            <div v-if="needsFigure(row)" class="qc-figure">
              <AppIcon name="image" :size="26" />
              <span>题目配图（演示占位）</span>
            </div>
            <!-- 不传 answer：详细列表是选题态，选项里不透露正确项（答案在下方「解析」里展开） -->
            <QuestionOptions class="qc-options" :options="row.options" :columns="optionColumnsOf(row)" />
            <div v-if="analysisOpen.includes(row.id)" class="qc-answer">
              <p>
                <b>答案：</b>
                <!-- 客观题答案是字母用强调色纯文本；无选项判断题的对/错同理；
                     问答题答案是富文本（公式/插图） -->
                <span v-if="row.options.length || isJudgeNoOptions(row)" class="qc-answer-text">
                  {{ isJudgeNoOptions(row) ? judgeAnswerText(row.answer) : row.answer || '—' }}
                </span>
                <RichTextViewer v-else :content="row.answer" tag="span" empty="—" />
              </p>
              <p><b>解析：</b><RichTextViewer :content="row.analysis" tag="span" empty="—" /></p>
            </div>
            <div class="qc-ops">
              <button class="mini-btn" type="button" @click="preview = row">预览</button>
              <button class="mini-btn" type="button" @click="toggleAnalysis(row.id)">
                {{ analysisOpen.includes(row.id) ? '收起解析' : '解析' }}
              </button>
              <button class="mini-btn" type="button" @click="goEdit(row.id)">编辑</button>
              <button class="mini-btn" type="button" @click="variantOpen = row">变式</button>
              <button class="mini-btn" type="button" @click="onToggleOffline(row)">
                {{ row.status === 'offline' ? '上架' : '下架' }}
              </button>
            </div>
          </article>
        </div>

        <AppPagination :total="filtered.length" v-model:page="page" :page-size="pageSize" />
      </div>
    </div>

    <!-- 题目预览（与录题中心共用同一个抽屉组件，两页不再各写一份）；
         纠错记录按题现取：处理纠错的入口就是「预览」 -->
    <QuestionPreviewDrawer
      v-if="preview"
      :question="preview"
      :corrections="correctionsOf(preview.id)"
      @close="preview = null"
    />

    <!-- 变式入口 -->
    <AppModal v-if="variantOpen" :title="`变式 · 题目 #${variantOpen.id}`" @close="variantOpen = null">
      <p class="f-hint" style="margin-bottom: 12px">{{ truncateRich(variantOpen.stem, 60) }}…</p>
      <button class="variant-entry" type="button" @click="onManualVariant">
        <span class="ve-title">手动变式</span>
        <span class="ve-desc">复制原题全部内容进入录题页，人工修改后保存，系统永久建立原题-变式关联</span>
      </button>
      <button class="variant-entry" type="button" @click="goAiVariant">
        <span class="ve-title">AI 变式</span>
        <span class="ve-desc">选择变式策略批量生成（消耗 AI 额度），结果卡片可逐题采纳 / 丢弃</span>
      </button>
    </AppModal>
  </div>
</template>

<style scoped>
/* 整体高度随屏幕高度动态撑满内容区（顶栏 62 + 内容区上下内边距 44），
   左右两栏各自内部滚动，滚动题目列表时左侧知识点面板保持不动 */
.bank-layout {
  --content-h: calc(100vh - 106px);
  display: flex;
  gap: 14px;
  align-items: stretch;
  height: var(--content-h);
  min-height: 460px;
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

/* ===== 筛选面板 =====
   面板外观 / 折叠汇总 / chip 行都搬到了共享组件 AppFilterPanel（只取设计令牌），
   本页不再持有那套 .filter-panel / .fp-* / .cf-* / .opt-chip 规则。 */

/* ===== 列表 =====
   面板撑满右栏剩余高度：工具栏、分页固定，仅题目列表区域滚动。
   面板自带内边距：搜索框 / 表格-详细显示切换不与面板边缘贴边 */
.table-panel { min-width: 0; flex: 1; min-height: 0; display: flex; flex-direction: column; padding: 14px 16px 12px; }

/* 表格区独立滚动（表头全局样式已 sticky） */
.data-table-wrap { flex: 1; min-height: 0; overflow: auto; }
.table-panel .pagination { flex-shrink: 0; }

/* 列宽：题干列不给宽度，在 table-layout: fixed 下自动吃掉剩余空间 —— 于是题干是「按列宽
   换行」而不是被截断（换行本身由 RichTextViewer 的 word-break 负责）。
   固定列合计 870px（见各 <th> 的内联宽度），min-width 让窗口再窄就横向滚动，题干列始终有地儿放字。
   编号列因「纠错」标识加宽了 12px，min-width 同步 +20，题干列的最小宽度不比从前窄 */
.bank-table { table-layout: fixed; min-width: 1100px; }
/* 编号列：编号 + 纠错标识竖排（横排要 100px 以上，会把题干挤窄） */
.no-cell { display: flex; flex-direction: column; align-items: flex-start; gap: 3px; }
.no-badge { padding: 0 8px; font-size: 11px; line-height: 18px; }
.stem-cell {
  line-height: 1.6;
  font-size: 13px;
  color: var(--ink-2);
  cursor: pointer;
  text-align: left;
  vertical-align: middle;
}
.stem-cell:hover { color: var(--brand-deep); }
.knowledge-cell { font-size: 12.5px; max-width: 150px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.time-cell { font-size: 12.5px; color: var(--sub); white-space: nowrap; }

/* ===== 详细列表卡片 ===== */
.detail-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-right: 2px;
}
.q-card { border: 1px solid var(--border); border-radius: 14px; background: #fff; padding: 14px 18px; }
.qc-meta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 10px; }
.qc-id { font-size: 13px; font-weight: 700; color: var(--ink); }
.qc-kp { font-size: 12px; color: var(--sub); }
.qc-right { margin-left: auto; font-size: 12px; color: var(--sub); }
.qc-stem { font-size: 13.5px; color: var(--ink); line-height: 1.8; cursor: pointer; }
.qc-figure {
  margin-top: 10px;
  height: 110px;
  border: 1px dashed var(--border);
  border-radius: 10px;
  background: repeating-conic-gradient(#f4f7f7 0% 25%, #fff 0% 50%) 50% / 16px 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--sub);
  font-size: 12.5px;
}
/* 选项的外观（描边块 / 一行 N 个）都在 QuestionOptions 里，这里只负责与上方题干的距离 */
.qc-options { margin-top: 10px; }
.qc-answer {
  margin-top: 10px;
  border-left: 3px solid var(--brand);
  background: #f7fafa;
  border-radius: 0 10px 10px 0;
  padding: 10px 14px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;
  color: var(--ink-2);
  line-height: 1.7;
}
.qc-answer b { color: var(--ink); }
.qc-answer-text { color: var(--success); font-weight: 600; }
.qc-ops { display: flex; align-items: center; justify-content: flex-end; gap: 8px; margin-top: 12px; border-top: 1px dashed var(--border); padding-top: 10px; }

/* ===== 预览抽屉 =====
   样式与结构都在共享组件 QuestionPreviewDrawer 里（录题中心同一份），本页不再持有。 */

/* ===== 变式入口 ===== */
.variant-entry {
  display: flex;
  flex-direction: column;
  gap: 5px;
  width: 100%;
  text-align: left;
  border: 1.5px solid var(--border);
  border-radius: 12px;
  padding: 13px 16px;
  background: #fff;
  margin-bottom: 10px;
  transition: border-color 0.15s;
}
.variant-entry:hover { border-color: var(--brand); }
.ve-title { font-size: 14px; font-weight: 700; color: var(--ink); }
.ve-desc { font-size: 12.5px; color: var(--sub); line-height: 1.6; }
</style>
