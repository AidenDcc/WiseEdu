<script setup lang="ts">
/**
 * 试题页签：与题库管理（BankView）**同一套 UI 与交互** —— 左栏教材知识点树（KnowledgeFilter，
 * 含年级→学科→版本级联），右栏可折叠筛选条件（AppFilterPanel，字典驱动）+ 表格/详细两种展示 + 分页。
 *
 * 与题库管理的两处刻意差别：
 * 1. 年级 / 学科的来源：题库管理跟随顶部栏作用域；工作台的页签条前有 ScopePicker，
 *    两条路（顶栏选择器、左树级联）都写进同一份 `filter`，列表与树始终一致。
 * 2. 行内操作是组卷动作：收藏 / 相似题 / 加入组卷车（未入库题拦下，FR-PP-003），
 *    另有**纠错**——但只做「反馈」（弹窗提交问题类型 + 描述），改题本身仍是题库治理动作，
 *    留在题库管理 / 录题中心，本页不提供变式 / 上下架。已经有人提过纠错的题，
 *    按钮显示「已提交纠错」，提醒组卷的人这题有争议。
 *    表格里不再单放「预览」按钮：整行可点即预览（操作列自己 stop 掉点击）。
 *
 * 默认**不显示未入库题**（`includeUnapproved`），与协同组卷选题池「仅已入库可入卷」同口径；
 * 录题中心刚录完、还没审核的题要主动勾选才能看到，避免把待审题误加进正式试卷。
 */
import { computed, onMounted, reactive, ref, watch } from 'vue'
import type { OrgQuestion } from '@aiteach/shared'
import {
  AppFilterPanel,
  AppIcon,
  AppListToolbar,
  AppSegmented,
  QUESTION_SOURCE_OPTIONS,
  RichTextViewer,
  showToast,
  toPlainText,
} from '@aiteach/shared'
import type { FilterRowDef } from '@aiteach/shared'
import AppPagination from '@/components/ui/AppPagination.vue'
import KnowledgeFilter from '@/components/ui/KnowledgeFilter.vue'
import QuestionCorrectionDialog from '@/components/question/QuestionCorrectionDialog.vue'
import QuestionOptions from '@/components/question/QuestionOptions.vue'
import QuestionPreviewDrawer from '@/components/question/QuestionPreviewDrawer.vue'
import SimilarQuestionsModal from '@/components/compose/SimilarQuestionsModal.vue'
import { useComposeData } from '@/composables/useComposeData'
import { useComposeBasket } from '@/composables/useComposeBasket'
import { useComposeKeyword } from '@/composables/useComposeKeyword'
import { useQuestionFavorites } from '@/composables/useQuestionFavorites'
import { useViewMode } from '@/composables/useViewMode'
import { examTypesFor, scopedQuestionTypes } from '@/composables/useBaseData'
import { fetchQuestionCorrections, fetchTenantDict, type TenantDictItem } from '@/api/org'
import {
  difficultyClass,
  isJudgeNoOptions,
  judgeAnswerText,
  needsFigure,
  optionColumnsOf,
  questionSourceBadge,
} from '@/utils/question-card'
import { matchesQuestionFilter, type ComposeFilter, type QuestionFilterContext } from '../types'

const props = defineProps<{ filter: ComposeFilter }>()
const emit = defineEmits<{
  patch: [patch: Partial<ComposeFilter>]
  findSimilar: [tags: string[]]
}>()

const { questions, loading, loaded, ensure } = useComposeData()
const basket = useComposeBasket()
const favorites = useQuestionFavorites()

void ensure()

/**
 * 「只看收藏」「排除已选」依赖的 id 集合。
 * 二者都是**单例状态**而非筛选条件，故走 context 传给谓词，而不是塞进 ComposeFilter
 * —— 否则「重置筛选」还得记得把这些 id 清掉，且筛选条件会变得与用户填的内容无关。
 */
const ctx = computed<QuestionFilterContext>(() => ({
  favorites: favorites.set.value,
  picked: basket.ids.value,
}))

const rows = computed(() => questions.value.filter((row) => matchesQuestionFilter(row, props.filter, ctx.value)))

/**
 * 知识点树上的计数用「除知识点外，其余条件全生效」的题池。
 *
 * 直接拿全库计数会与点下去看到的结果对不上：树上写着「三角函数 15」，而当前是高一·数学，
 * 点进去只有 8 条 —— 用户会以为丢了题。先摘掉 knowledge 再筛，这个数就正好是「选了它会看到几道」。
 */
const countRows = computed(() =>
  questions.value.filter((row) => matchesQuestionFilter(row, { ...props.filter, knowledge: [] }, ctx.value)),
)

/* ===== 左树：知识点 / 教材范围（与题库管理同一个 KnowledgeFilter 组件） ===== */
function onKnowledgeChange(tags: string[] | null) {
  emit('patch', { knowledge: tags ?? [] })
}

/** 左树级联改选年级 / 学科：写回 filter，列表与页签条前的 ScopePicker 走同一份状态 */
function onScopeChange(scope: { grade: string; subject: string }) {
  emit('patch', { grade: scope.grade, subject: scope.subject })
}

/* ===== 右上：可折叠筛选条件（字典驱动，行定义与题库管理同一套） ===== */
type FilterKey = 'type' | 'difficulty' | 'examType' | 'competition' | 'region' | 'source' | 'term'
interface QuestionRowDef {
  key: FilterKey
  label: string
  dict?: string
  options?: string[]
  /** 单值维度（难度 / 来源 / 学期）用单选 chip，与题库管理同款 */
  multiple?: boolean
}

/** 主条件（顺序即展示顺序：题型 / 难度 / 考试类型 / 杯赛，与题库管理一致） */
const FILTER_ROWS: QuestionRowDef[] = [
  { key: 'type', label: '题型', dict: 'questionType' },
  { key: 'difficulty', label: '难度', dict: 'difficulty', multiple: false },
  { key: 'examType', label: '考试类型', dict: 'examType' },
  { key: 'competition', label: '杯赛', dict: 'competition' },
]

/** 次要条件：收在「更多查询」里 */
const MORE_ROWS: QuestionRowDef[] = [
  { key: 'region', label: '地区', dict: 'region' },
  { key: 'source', label: '来源', options: [...QUESTION_SOURCE_OPTIONS], multiple: false },
  { key: 'term', label: '学期', options: ['上学期', '下学期'], multiple: false },
]

const ALL_ROWS = [...FILTER_ROWS, ...MORE_ROWS]
const filterOptions = reactive<Record<string, string[]>>({})
/** 题型字典原始项（含适用学科），候选项按当前学科实时收窄 */
const typeItems = ref<TenantDictItem[]>([])

function rowOptions(row: QuestionRowDef): string[] {
  if (row.options) return row.options
  /* 题型按学科收窄：通用题型 + 当前学科的专属题型（英语的完形填空 / 七选五 / 短文改错） */
  if (row.dict === 'questionType') return scopedQuestionTypes(typeItems.value, props.filter.subject)
  /* 考试类型按学段 / 学科收窄：字典项带「适配学段 / 学科」后，高一·数学下不该出现「小升初真题」「物理竞赛」
     ——那些取值点进去必然为空。候选项因此走 useBaseData（工作台里 useScope 已经 ensure 过字典） */
  if (row.dict === 'examType') return examTypesFor(props.filter.grade, props.filter.subject)
  return filterOptions[row.dict ?? ''] ?? []
}

/** 展开给共享 AppFilterPanel 的行定义（选项为空的字典行由组件显示「暂无可选项」） */
function toRowDefs(defs: QuestionRowDef[]): FilterRowDef[] {
  return defs.map((row) => ({
    key: row.key,
    label: row.label,
    options: rowOptions(row),
    multiple: row.multiple,
  }))
}
const filterRowDefs = computed(() => toRowDefs(FILTER_ROWS))
const moreRowDefs = computed(() => toRowDefs(MORE_ROWS))

/** 面板回显：从 filter 取各维度已选值（单值字段包一层数组，chip 才有东西可渲染） */
const filterSel = computed<Record<string, string[]>>(() => ({
  type: props.filter.types,
  difficulty: props.filter.difficulty ? [props.filter.difficulty] : [],
  examType: props.filter.examTypes,
  competition: props.filter.competitions,
  region: props.filter.regions,
  source: props.filter.source ? [props.filter.source] : [],
  term: props.filter.terms,
}))

/** AppFilterPanel 回传整份筛选值（覆盖式回写，不做级联） */
function onFiltersChange(next: Record<string, string[]>) {
  emit('patch', {
    types: next.type ?? [],
    difficulty: next.difficulty?.[0] ?? '',
    examTypes: next.examType ?? [],
    competitions: next.competition ?? [],
    regions: next.region ?? [],
    source: next.source?.[0] ?? '',
    terms: next.term ?? [],
  })
}

async function loadDicts() {
  /* examType 不在这里拉：它的候选项要按学段 / 学科实时收窄，统一走 useBaseData（见 rowOptions） */
  const types = [...new Set(ALL_ROWS.map((row) => row.dict).filter((d): d is string => !!d && d !== 'examType'))]
  await Promise.all(
    types.map(async (type) => {
      const items = await fetchTenantDict(type)
      /* 题型的候选项要随学科重算，留下原始字典项；其余字典只用到名字 */
      if (type === 'questionType') typeItems.value = items
      else filterOptions[type] = items.map((item) => item.name)
    }),
  )
}

/**
 * 已经有人提过纠错的题号（列表里的按钮据此从「纠错」变「已提交纠错」）。
 *
 * 口径是**题目**级而不是「我提交过的」：一条纠错记录就是一封待处理的反馈，
 * 谁提的都说明这题有问题 —— 正在组卷的人恰恰需要这个提示。
 * （若产品上要改成「我提交过的」，把下面的 map 换成按 reporter === 当前登录人过滤即可。）
 *
 * 拉一份全量、本地摊平成 id 列表：记录量级是「一题几条」，不值得为按钮态单开接口。
 */
const correctedIds = ref<number[]>([])
const correctedSet = computed(() => new Set(correctedIds.value))
function hasSubmittedCorrection(id: number): boolean {
  return correctedSet.value.has(id)
}

/**
 * 提交成功就地补上，不用重拉列表（子组件的 `submitted` 只在成功时发）。
 * 载荷里带的是整条纠错内容（组卷编辑页拿它生成卷面评论），这里只用得上题号。
 */
function onCorrectionSubmitted({ questionId }: { questionId: number; types: string[]; description: string }) {
  if (!correctedSet.value.has(questionId)) correctedIds.value = [...correctedIds.value, questionId]
}

onMounted(() => {
  void loadDicts()
  /* 纠错记录拉不到就退化成「按钮一律显示纠错」，不该因此白屏，故吞掉异常 */
  fetchQuestionCorrections()
    .then((records) => {
      correctedIds.value = records.map((item) => item.questionId)
    })
    .catch(() => {})
})

/* ===== 关键词：与顶部搜索条同一份 filter.keyword（260ms 防抖，两侧互相同步） ===== */
const keyword = useComposeKeyword(
  () => props.filter.keyword,
  (value) => emit('patch', { keyword: value }),
)

/* ===== 表格 / 详细 两种展示（与题库管理同一模式，展示方式记在本地） ===== */
const viewMode = useViewMode('compose-questions', ['table', 'detail'] as const, 'table')
const VIEW_MODES = [
  { value: 'table', label: '表格', icon: 'grid' },
  { value: 'detail', label: '详细', icon: 'file' },
]
function setViewMode(value: string) {
  viewMode.value = value as 'table' | 'detail'
}

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

/** 列表内部滚动容器：换页 / 切展示后回到顶部，否则停在半路显得列表是空的 */
const scrollRef = ref<HTMLElement | null>(null)
watch([page, viewMode], () => scrollRef.value?.scrollTo({ top: 0 }))

/* ===== 题干悬浮提示（与个人题库列表同一套） =====
   表格里的题干最多给三行（.stem-clip），完整内容悬浮显示。原生 title 放不了富文本
   （上下标 / 公式），故自持一个 fixed 定位的小浮层：跟随光标、贴边翻转、限宽限高，
   pointer-events: none 让它永不挡住 hover 目标，也不会因滚轮滚表格而错位闪烁。
   注意只挂在题干格上，不是整行 —— 整行已改成点击预览，划过操作列一带动不动弹浮层会很吵。 */
const TIP_W = 420
const TIP_H = 190
const tip = ref<{ x: number; y: number; row: OrgQuestion } | null>(null)

function onStemEnter(event: MouseEvent, row: OrgQuestion) {
  tip.value = { x: event.clientX, y: event.clientY, row }
}
function onStemMove(event: MouseEvent) {
  if (tip.value) tip.value = { ...tip.value, x: event.clientX, y: event.clientY }
}
function onStemLeave() {
  tip.value = null
}
/** 浮层落点：默认光标右下；越出视口时贴边 / 翻到上方 */
function tipStyle() {
  const t = tip.value
  if (!t) return {}
  const left = Math.min(Math.max(t.x + 14, 8), window.innerWidth - TIP_W - 8)
  const flipUp = t.y + 18 + TIP_H > window.innerHeight
  const top = flipUp ? Math.max(t.y - TIP_H - 12, 8) : t.y + 18
  return { left: `${left}px`, top: `${top}px` }
}

/* ===== 组卷车动作 ===== */
/** 未入库题目不能入卷（FR-PP-003）：单题加入前必须拦下，给出明确解释而不是静默失败 */
function onToggleBasket(row: OrgQuestion) {
  if (basket.has(row.id)) {
    basket.remove(row.id)
    return
  }
  if (row.status !== 'approved') {
    showToast('该题还未入库（待审 / 驳回），不能加入组卷车', 'error')
    return
  }
  basket.add(row, 'search')
}

/** 本页全部加入：同样先剔除未入库题，否则会静默多出几道进不了卷的题 */
function addAllOnPage() {
  const addable = paged.value.filter((row) => row.status === 'approved')
  if (addable.length === 0) {
    showToast('本页没有已入库题目可加入组卷车', 'error')
    return
  }
  const added = basket.addMany(addable, 'search')
  const skipped = addable.length - added
  if (added === 0) showToast('本页题目均已在组卷车中', 'error')
  else showToast(skipped > 0 ? `已加入 ${added} 题，${skipped} 题已在车中` : `已加入 ${added} 题`)
}

/* ===== 预览 / 解析 / 相似题 / 纠错 ===== */
const preview = ref<OrgQuestion | null>(null)
const similarTarget = ref<OrgQuestion | null>(null)
/** 纠错弹窗的目标题：非空即打开（与 preview / similarTarget 同一套开关方式） */
const correctTarget = ref<OrgQuestion | null>(null)
const analysisOpen = ref<number[]>([])
function toggleAnalysis(id: number) {
  const index = analysisOpen.value.indexOf(id)
  if (index >= 0) analysisOpen.value.splice(index, 1)
  else analysisOpen.value.push(id)
}

/** 在相似题里选「按知识点筛选」：关掉弹窗，把知识点交给 shell 去切条件（与其它页签同一条路径） */
function onSimilarFilter(tags: string[]) {
  similarTarget.value = null
  emit('findSimilar', tags)
}
</script>

<template>
  <div class="qt">
    <!-- 左：教材知识点树（选中节点的子树 tag 写进 filter.knowledge） -->
    <KnowledgeFilter :rows="countRows" @change="onKnowledgeChange" @scope-change="onScopeChange" />

    <!-- 右：筛选条件在上，题目列表在下（与题库管理同一结构） -->
    <div class="right-col">
      <AppFilterPanel
        :rows="filterRowDefs"
        :more-rows="moreRowDefs"
        :model-value="filterSel"
        @update:model-value="onFiltersChange"
      />

      <div class="panel table-panel">
        <AppListToolbar v-model="keyword" placeholder="题干关键词 / 题目编号" :search-width="220">
          <!-- 工作台特有的三个口径开关：不属于筛选面板的维度，跟在搜索框后面 -->
          <label class="qt-switch" title="显示待审 / 驳回的题目">
            <input
              type="checkbox"
              :checked="filter.includeUnapproved"
              @change="emit('patch', { includeUnapproved: ($event.target as HTMLInputElement).checked })"
            />
            包含未入库
          </label>
          <label class="qt-switch" title="只显示收藏过的题目">
            <input
              type="checkbox"
              :checked="filter.onlyFavorites"
              @change="emit('patch', { onlyFavorites: ($event.target as HTMLInputElement).checked })"
            />
            只看收藏<span v-if="favorites.count.value" class="qt-dim">（{{ favorites.count.value }}）</span>
          </label>
          <label class="qt-switch" title="隐藏已经加入组卷车的题目，避免重复挑中同一道">
            <input
              type="checkbox"
              :checked="filter.excludePicked"
              @change="emit('patch', { excludePicked: ($event.target as HTMLInputElement).checked })"
            />
            排除已选
          </label>

          <template #right>
            <span class="qt-total">共 <b>{{ rows.length }}</b> 题</span>
            <button class="btn btn-ghost btn-sm" type="button" :disabled="paged.length === 0" @click="addAllOnPage">
              <AppIcon name="cart" :size="13" />
              本页全部加入
            </button>
            <AppSegmented :options="VIEW_MODES" :model-value="viewMode" @update:model-value="setViewMode" />
          </template>
        </AppListToolbar>

        <!-- 表格显示 -->
        <div v-if="viewMode === 'table'" ref="scrollRef" class="data-table-wrap">
          <table class="data-table bank-table">
            <thead>
              <tr>
                <th style="width: 46px">序号</th>
                <th style="width: 84px">题目编号</th>
                <!-- 题干列是唯一的「不定宽」列：table-layout: fixed 下它吃掉剩余空间，
                     于是窗口越宽题干越舒展、窄了就换行（最多三行，见 .stem-clip / .bank-table 的说明） -->
                <th>题干</th>
                <th style="width: 76px">题型</th>
                <th style="width: 66px">难度</th>
                <th style="width: 150px">知识点</th>
                <th style="width: 76px">使用次数</th>
                <th style="width: 96px">更新时间</th>
                <th style="width: 268px">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="loading && !loaded">
                <td colspan="9" class="empty-row">正在加载试题…</td>
              </tr>
              <tr v-else-if="paged.length === 0">
                <td colspan="9" class="empty-row">
                  没有匹配的试题<template v-if="!filter.includeUnapproved">；若刚录入的题还没审核，可勾选「包含未入库」</template>
                  <template v-if="filter.onlyFavorites && favorites.count.value === 0">；还没有收藏任何题目</template>
                </td>
              </tr>
              <template v-else>
                <!-- 整行可点即预览（行上挂 click）：表格里再单放一个「预览」按钮纯属重复，
                     行高本身够大，点到哪一格都算「我要看这道题」。
                     操作列那段自己 stop 掉，免得点「加入组卷车」顺手弹出预览 -->
                <tr v-for="(row, i) in paged" :key="row.id" class="row-click" @click="preview = row">
                  <td>{{ (page - 1) * PAGE_SIZE + i + 1 }}</td>
                  <td class="cell-strong">#{{ row.id }}</td>
                  <!-- 题干最多三行（行高随之有上界），完整内容悬浮显示；点整行进预览抽屉 -->
                  <td
                    class="stem-cell"
                    @mouseenter="onStemEnter($event, row)"
                    @mousemove="onStemMove"
                    @mouseleave="onStemLeave"
                  >
                    <div class="stem-clip"><RichTextViewer :content="row.stem" tag="span" /></div>
                  </td>
                  <td>{{ row.type }}</td>
                  <td>{{ row.difficulty }}</td>
                  <td class="knowledge-cell" :title="row.knowledge.join('、')">{{ row.knowledge.join('、') }}</td>
                  <td>{{ row.useCount }} 次</td>
                  <td class="time-cell">{{ row.updatedAt.slice(5, 16) }}</td>
                  <td>
                    <div class="op-group" @click.stop>
                      <!-- 与详细视图同一套动作、顺序上只少了「解析」（表格里没有展开位）：
                           收藏 / 纠错 / 相似 / 加入组卷车。
                           收藏不带星标图标：这一列四个按钮排一行，图标会把「已提交纠错」这种长标签挤出去 -->
                      <button
                        class="mini-btn fav"
                        :class="{ on: favorites.has(row.id) }"
                        type="button"
                        :title="favorites.has(row.id) ? '取消收藏' : '收藏这道题，之后可在「只看收藏」里快速找到'"
                        @click="favorites.toggle(row.id)"
                      >
                        {{ favorites.has(row.id) ? '已收藏' : '收藏' }}
                      </button>
                      <button
                        class="mini-btn"
                        type="button"
                        :title="hasSubmittedCorrection(row.id) ? '这道题已有人提交过纠错反馈，可继续补充' : '提交这道题的问题反馈'"
                        @click="correctTarget = row"
                      >
                        {{ hasSubmittedCorrection(row.id) ? '已提交纠错' : '纠错' }}
                      </button>
                      <button class="mini-btn" type="button" @click="similarTarget = row">相似</button>
                      <button
                        class="mini-btn"
                        :class="{ success: basket.has(row.id) }"
                        type="button"
                        @click="onToggleBasket(row)"
                      >
                        {{ basket.has(row.id) ? '移出' : '加入组卷车' }}
                      </button>
                    </div>
                  </td>
                </tr>
              </template>
            </tbody>
          </table>
        </div>

        <!-- 详细列表：完整面板卡片 -->
        <div v-else ref="scrollRef" class="detail-list">
          <p v-if="paged.length === 0" class="empty-row">没有匹配的试题</p>
          <article v-for="row in paged" :key="row.id" class="q-card">
            <div class="qc-meta">
              <span class="qc-id">#{{ row.id }}</span>
              <!-- 题号后标出题目来源：名校 / 竞赛 / 大型考试的题目标具体名称，日常校考不占位 -->
              <span v-if="questionSourceBadge(row)" class="tag tag-gray qc-source" :title="questionSourceBadge(row)">
                {{ questionSourceBadge(row) }}
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
            <!-- 不传 answer：详细列表是选题态，选项里不能透露正确项，否则扫一眼就知道答案。
                 答案与解析仍可通过下方「解析」展开查看 -->
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
              <button
                class="mini-btn fav"
                :class="{ on: favorites.has(row.id) }"
                type="button"
                :title="favorites.has(row.id) ? '取消收藏' : '收藏这道题，之后可在「只看收藏」里快速找到'"
                @click="favorites.toggle(row.id)"
              >
                {{ favorites.has(row.id) ? '已收藏' : '收藏' }}
              </button>
              <button
                class="mini-btn"
                type="button"
                :title="hasSubmittedCorrection(row.id) ? '这道题已有人提交过纠错反馈，可继续补充' : '提交这道题的问题反馈'"
                @click="correctTarget = row"
              >
                {{ hasSubmittedCorrection(row.id) ? '已提交纠错' : '纠错' }}
              </button>
              <button class="mini-btn" type="button" @click="similarTarget = row">相似</button>
              <button
                class="mini-btn"
                :class="{ success: basket.has(row.id) }"
                type="button"
                @click="onToggleBasket(row)"
              >
                {{ basket.has(row.id) ? '移出组卷车' : '加入组卷车' }}
              </button>
            </div>
          </article>
        </div>

        <AppPagination :total="rows.length" v-model:page="page" :page-size="PAGE_SIZE" />
      </div>
    </div>

    <!-- 题干悬浮浮层：fixed 定位（不受表格滚动容器裁剪），限宽限高，不拦截鼠标 -->
    <div v-if="tip" class="stem-tip" :style="tipStyle()">
      <RichTextViewer :content="tip.row.stem" />
    </div>

    <!-- 题目预览（与题库管理 / 录题中心共用同一个抽屉组件） -->
    <QuestionPreviewDrawer v-if="preview" :question="preview" @close="preview = null" />

    <!-- 纠错：类型多选 + 富文本描述，提交后落一条反馈记录（题库治理侧处理）。
         submitted 回来时把这道题标成「已提交纠错」，按钮立刻翻面，不用重拉列表 -->
    <QuestionCorrectionDialog
      v-if="correctTarget"
      :question="correctTarget"
      @close="correctTarget = null"
      @submitted="onCorrectionSubmitted"
    />

    <!-- 相似题：以某道题为基准找相近题（换题 / 排查重复题） -->
    <SimilarQuestionsModal v-if="similarTarget" :row="similarTarget" @close="similarTarget = null" @find-similar="onSimilarFilter" />
  </div>
</template>

<style scoped>
/* 左右两栏各自撑满内容区高度：左树内部滚动，右列的列表内部滚动，翻页时筛选条不动 */
.qt {
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

/* ===== 列表 =====
   面板撑满右栏剩余高度：工具栏、分页固定，仅题目列表区域滚动 */
.table-panel { min-width: 0; flex: 1; min-height: 0; display: flex; flex-direction: column; padding: 14px 16px 12px; }
.table-panel :deep(.list-toolbar) { margin-bottom: 10px; }

/* 表格区独立滚动（表头全局样式已 sticky） */
.data-table-wrap { flex: 1; min-height: 0; overflow: auto; }
.table-panel :deep(.pagination) { flex-shrink: 0; }

/* 列宽：题干列不给宽度，在 table-layout: fixed 下自动吃掉剩余空间 —— 于是题干是「按列宽
   换行」而不是被截断（换行本身由 RichTextViewer 的 word-break 负责），行高另有 .stem-clip 封顶三行。
   min-width = 固定列合计 862px + 题干保底 310px。
   操作列仍取 268px：这一列的最宽状态是「收藏 / 已提交纠错 / 相似 / 加入组卷车」四个纯文字按钮
   （收藏去掉星标图标省下的 16px，正好抵掉「纠错 → 已提交纠错」多出的 39px 里的一部分），
   实需 230px + 单元格左右各 14px = 258px，留 10px 余量 */
.bank-table { table-layout: fixed; min-width: 1172px; }
/* 整行可点即预览：指针与悬停底色都交给行本身，题干格不再单独绑事件 / 单独设指针。
   比全局的 tr:hover（#fafbfe，几乎看不出）重一档，才算「这一行可以点」的提示 */
.data-table tbody tr.row-click { cursor: pointer; }
.data-table tbody tr.row-click:hover { background: var(--brand-soft); }
.stem-cell {
  line-height: 1.6;
  font-size: 13px;
  color: var(--ink-2);
  text-align: left;
  vertical-align: middle;
}
.stem-cell:hover { color: var(--brand-deep); }
/* 行内题干最多三行：行高因此有上界（三行约 62px），超出的省略号截断，完整内容看悬浮浮层 / 预览 */
.stem-clip {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
  max-height: 63px;
  overflow: hidden;
}
.knowledge-cell { font-size: 12.5px; max-width: 150px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.time-cell { font-size: 12.5px; color: var(--sub); white-space: nowrap; }

/* 操作列收紧：四个按钮排一行，按全局的 4px 8px 内边距 + 2px 间距算，光按钮之间就空出 18px，
   一行下来比题干的几行字还抢眼。内边距收到 4px 6px、间距归零（悬停底色本身就把按钮分开了），
   省下的 20px 还给题干列。只作用于表格 —— 详细视图的按钮之间有卡片留白，不需要这么挤 */
.op-group { gap: 0; }
.op-group .mini-btn { padding: 4px 6px; }
/* 已收藏用金色（与相似题弹窗 / 题目卡片同一套）；main.css 的 .mini-btn 只给了品牌色 */
.op-group .mini-btn.fav.on { color: #b7791f; background: #fdf6e6; }

/* ===== 详细列表卡片 ===== */
.detail-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  /* 卡片与面板同为白底，只靠 1px 描边区分不够；拉开间距并各留一点外边距感，
     相邻两道题之间才有明确的「一块一块」的间隔 */
  gap: 16px;
  padding-right: 2px;
  padding-bottom: 2px;
}
.q-card {
  border: 1px solid var(--border);
  border-radius: 14px;
  background: #fff;
  padding: 14px 18px;
  box-shadow: 0 1px 3px rgba(28, 36, 52, 0.04);
}
.q-card:hover { border-color: #dbe3ee; box-shadow: 0 4px 14px rgba(28, 36, 52, 0.07); }
.qc-meta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 10px; }
.qc-id { font-size: 13px; font-weight: 700; color: var(--ink); }
/* 来源标签：竞赛 / 名校全称可能较长，超宽裁切，完整名称看 title */
.qc-source { display: inline-block; max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; vertical-align: middle; }
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
/* 卡片里也收紧一档：加上「收藏」后是六个按钮，8px 的间距到行尾会显得散 */
.qc-ops { display: flex; align-items: center; justify-content: flex-end; gap: 6px; margin-top: 12px; border-top: 1px dashed var(--border); padding-top: 10px; }
/* 已收藏：与表格同色（详情卡片没有 .op-group，得各写一条） */
.qc-ops .mini-btn.fav.on { color: #b7791f; background: #fdf6e6; }

/* ===== 题干悬浮浮层：有大小限制（宽 ≤420px、高 ≤190px），超出自身滚动；不拦截鼠标事件 ===== */
.stem-tip {
  position: fixed;
  z-index: 60;
  max-width: 420px;
  max-height: 190px;
  overflow-y: auto;
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: 0 10px 28px rgba(28, 36, 52, 0.14);
  padding: 10px 12px;
  font-size: 13px;
  color: var(--ink-2);
  line-height: 1.7;
  pointer-events: none;
}

/* ===== 工作台口径开关 / 合计（工具条内） ===== */
.qt-switch { display: inline-flex; align-items: center; gap: 5px; font-size: 12.5px; color: var(--sub); cursor: pointer; user-select: none; white-space: nowrap; }
.qt-switch input { accent-color: var(--brand); }
.qt-dim { opacity: 0.7; }
.qt-total { font-size: 12.5px; color: var(--sub); white-space: nowrap; }
.qt-total b { color: var(--brand-deep); font-size: 14px; }
</style>
