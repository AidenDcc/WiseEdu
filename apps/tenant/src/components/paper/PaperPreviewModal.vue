<script setup lang="ts">
/**
 * 试卷整卷预览（模拟真实纸面的弹窗）。
 *
 * 与「侧边抽屉列题目」的区别在于这里模拟的是**打印稿**：纸面按真实纸张（mm→px），
 * 8K / A3 等大纸一面印两版（先左版后右版），内容按版心宽度实测高度后自动分版；
 * 顶栏调纸张 / 版数 / 方向 / 内容 / 缩放 / 教师版，左栏两个页签：「试卷分析」与「排版样式」。
 *
 * 排版流程：blocks（卷头 + 大题 + 题目）→ 隐藏测量层量高 → paginateBlocks 装箱到「版」
 *          → 按一面版数拼版成纸面 → 逐页渲染。
 * 测量层与纸面页面共用 PaperBlock 组件与同一份 --pp-* 变量，因此量到多少、画出来就是多少。
 *
 * **只有一套版式**：五个调用方（试卷库 / 组卷工作台「试卷」页签 / 试卷编辑页 / 协同任务详情 /
 * 组卷车草稿预览）看到的界面与交互完全一致 —— 曾经按 `reading` 分成「阅读预览」与「排版预览」
 * 两套，同一份卷在两处长得不一样，现已合并。
 *
 * 仍有一处按调用方收窄的地方，是 `browse`（默认关，而不是版式）：
 * - 开（试卷库与组卷工作台，浏览**已入库的现成卷**）：顶栏多出分享 / 平行卷 / 分析三个入口，
 *   左栏「试卷分析」多一段推荐试卷，每道题悬停出现操作条（可逐题取用进组卷车）；
 * - 关（编辑页 / 协同任务 / 组卷车草稿）：这三个入口的前提都是「一份已存好的卷」——
 *   组卷车草稿压根没落库（`id` 为 0，平行卷接口调不通），索性整组动作一起收掉。
 */
import {
  computed,
  defineAsyncComponent,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from 'vue'
import { AppIcon, AppModal, enterOverlay, exitOverlay, isTopOverlay, paperQuestionCount, showToast } from '@aiteach/shared'
import type { MediaKind, OrgPaper, OrgQuestion, QuestionCorrection } from '@aiteach/shared'
import AppSwitch from '@/components/ui/AppSwitch.vue'
import PaperBlock from './PaperBlock.vue'
/* 异步挂载：试卷分析里那三张图（`ComboChart` / `BarChart` → echarts，约 500 KB）不该跟着
   预览一起下载 —— 静态 import 会让每次打开预览都多拖半兆，而「分析试卷」是预览里偶尔才点
   一次的动作。`v-if` 一开才去拉那一块，代价是点按钮到弹出之间有一小段空白。 */
const PaperAnalysisModal = defineAsyncComponent(() => import('./PaperAnalysisModal.vue'))
import PaperShareDialog from './PaperShareDialog.vue'
import ParallelPaperDialog from './ParallelPaperDialog.vue'
import QuestionActionBarHost from './QuestionActionBarHost.vue'
import QuestionPreviewDrawer from '@/components/question/QuestionPreviewDrawer.vue'
import QuestionCorrectionDialog from '@/components/question/QuestionCorrectionDialog.vue'
import SimilarQuestionsModal from '@/components/compose/SimilarQuestionsModal.vue'
import { fetchQuestionCorrections } from '@/api/org'
import { difficultyClass } from '@/utils/question-card'
import { distributionOf } from './paper-stats'
import {
  ANSWER_LINES,
  MM,
  PAPER_LAYOUTS,
  PAPER_SIZES,
  answerBoxHeight,
  fillChunk,
  fillColumns,
  isObjective,
  paperGeometry,
  presetOf,
  presetVars,
  type PaperBlock as PaperBlockModel,
  type PaperOrientation,
  type PaperSizeKey,
} from './paper-layouts'
import { paginateBlocks, type PaperPage } from './paginate'
import { exportPaperDoc, exportPaperPdf, type ExportOptions, type ExportVersion } from '@/utils/paper-export'

const props = defineProps<{
  paper: OrgPaper
  questions: OrgQuestion[]
  /**
   * 从「试卷编辑」页带过来的初始版式：编辑页的全文设置里已经选好了纸张/样式/内容，
   * 点预览时若仍回到默认值，用户就得再选一遍，且看到的版式与刚才编辑的不是一回事。
   */
  initialSize?: PaperSizeKey
  initialLayout?: string
  initialMode?: PaperMode
  initialOrientation?: PaperOrientation
  initialPanels?: number
  /**
   * 是否在「浏览一份已入库的现成卷」：只有试卷库与组卷工作台传 true。
   * 它不改变版式（版式只有一套），只决定那几个「对一份已存好的卷才成立」的动作出不出来：
   * 顶栏的分享 / 平行卷 / 分析、左栏的推荐试卷、以及每题的悬停操作条。
   */
  browse?: boolean
  /**
   * 「推荐试卷」列表（同年级同学科的其他卷，由父页面筛好传入）——只有 `browse` 时才渲染。
   * 本组件不持有卷池：组卷车草稿预览传进来的是一份 id 为 0 的合成卷，在那样的数据上
   * 「推荐」没有意义 —— 由父页面决定推不推，这里只负责画。
   */
  recommended?: OrgPaper[]
  /**
   * 遮罩层级，默认 130（与 appConfirm 同级：预览之上再开确认框时后者仍压得住）。
   * 子弹窗（分享 / 平行组卷 / 分析 / 题目预览 / 纠错 / 相似题）与悬停操作条都按它 +10 / +1 推。
   *
   * ⚠️ 抬到 300 以上会越过全局搜索(200)与下拉菜单(300)；调用方若把预览挂在很高的浮层里
   * （如组卷车抽屉 310 那类宿主），必须把宿主层级 + 10 传进来，否则预览会被宿主压住。
   */
  zIndex?: number
}>()
const emit = defineEmits<{
  close: []
  /** 点了某份推荐卷：换的是父页面持有的那份卷（本组件是被 v-if 挂载的） */
  pick: [paper: OrgPaper]
}>()

/* 层级由 `zIndex` 推出来，不各写一处：调用方把整层预览抬到别的高度时，
   子弹窗与悬停操作条必须跟着抬，否则会落到遮罩下面去。 */
const maskZ = computed(() => props.zIndex ?? 130)
/** 子弹窗（导出 / 分享 / 平行组卷 / 分析 / 题目预览 / 纠错 / 相似题） */
const childZ = computed(() => maskZ.value + 10)

/**
 * 随卷参考资料（组卷车里的图片 / 视频 / 小程序）。
 *
 * **只列在侧栏，不进纸面**：参考资料不是卷面内容，不占分值也不该打印 —— 塞进 `paperBlocks`
 * 会被自动分版当成一块内容，在打印件上多出一页，还得跟着处理「这块能不能跨页」。
 * 旧卷没有 `attachments`，这个列表为空也就整节不出现。
 */
const ATTACHMENT_KIND_TEXT: Record<MediaKind, string> = { image: '图片', animation: '小程序', video: '视频' }
const attachments = computed(() => props.paper.attachments ?? [])

/* ===== 排版设置 ===== */

/** 卷面内容：只印试卷 / 只印答题卡 / 两者都印 */
type PaperMode = 'paper' | 'card' | 'both'

const layoutKey = ref(props.initialLayout ?? PAPER_LAYOUTS[0].key)
const sizeKey = ref<PaperSizeKey>(props.initialSize ?? 'A4')
const orientation = ref<PaperOrientation>(props.initialOrientation ?? 'portrait')
/** 版数覆盖：0 = 按纸张习惯版数（8K / A3 一面两版） */
const panelPick = ref(props.initialPanels ?? 0)
const mode = ref<PaperMode>(props.initialMode ?? 'paper')
/** 教师版：题目后附答案与解析、答题卡标出正确选项（打印前记得关掉） */
const teacher = ref(false)
const zoom = ref(1)
/** 适应宽度：进来就铺满画布（默认开）；顶栏的「适应宽度」按钮随时切回来 */
const autoFit = ref(true)

/**
 * 左栏的两个页签：默认一律「试卷分析」（进来先看这是份什么卷）。
 * 「排版样式」是另一件事（它怎么排的），要调版式再点过去 —— 顶栏的纸张 / 版数那些参数
 * 两个页签下都在，所以切页签不会把参数藏起来。
 */
type SideTab = 'analysis' | 'layout'
const sideTab = ref<SideTab>('analysis')
const SIDE_TABS: Array<{ key: SideTab; label: string }> = [
  { key: 'analysis', label: '试卷分析' },
  { key: 'layout', label: '排版样式' },
]

const preset = computed(() => presetOf(layoutKey.value))
const size = computed(() => PAPER_SIZES.find((row) => row.key === sizeKey.value) ?? PAPER_SIZES[0])
const geo = computed(() => paperGeometry(size.value, orientation.value, preset.value, panelPick.value))
const vars = computed(() => presetVars(preset.value))

const showPaper = computed(() => mode.value !== 'card')
const showCard = computed(() => mode.value !== 'paper')

const totalScore = computed(() =>
  props.paper.sections.reduce((sum, s) => sum + s.questions.reduce((t, q) => t + (Number(q.score) || 0), 0), 0),
)
const totalCount = computed(() => props.paper.sections.reduce((sum, s) => sum + s.questions.length, 0))

/* ===== 卷面结构：题号全卷连续（试卷与答题卡共用同一套编号） ===== */

const NUMBERS = '一二三四五六七八九十'

interface QuestionView {
  no: number
  questionId: number
  score: number
  item?: OrgQuestion
}

interface SectionView {
  key: string
  title: string
  count: number
  score: number
  perScore: number | null
  questions: QuestionView[]
  /** 大题材料与作答提示（阅读文本共用，见 PaperSection） */
  material: string
  materialHint: string
}

/** 大题标题已自带序号的写法：`一、` / `（一）` / `第 X 部分` / `1.` —— 都不再补卷面序号 */
const NUMBERED_TITLE = /^([一二三四五六七八九十]+[、.．]|（[一二三四五六七八九十]+）|第[一二三四五六七八九十百]+[部分章节]|\d+[、.．])/

const sectionViews = computed<SectionView[]>(() => {
  let no = 0
  return props.paper.sections.map((section, si) => {
    const questions = section.questions.map((entry) => {
      no += 1
      return {
        no,
        questionId: entry.questionId,
        score: Number(entry.score) || 0,
        item: props.questions.find((row) => row.id === entry.questionId),
      }
    })
    const score = questions.reduce((sum, q) => sum + q.score, 0)
    const first = questions[0]?.score ?? 0
    const perScore = questions.length > 0 && questions.every((q) => q.score === first) ? first : null
    /* 大题标题自带序号的保持原样，没写的补一个卷面序号 */
    const raw = section.title.trim()
    return {
      key: `s-${section.id}`,
      title: NUMBERED_TITLE.test(raw) ? section.title : `${NUMBERS[si] ?? si + 1}、${raw}`,
      count: questions.length,
      score,
      perScore,
      questions,
      material: section.material?.trim() ?? '',
      materialHint: section.materialHint?.trim() ?? '',
    }
  })
})

/* ===== 左栏「试卷分析」页签的试题统计 =====
 * 只统计**能查到题目的**小题：卷里引用了、题库中已无数据的历史题（如题目被删除）在
 * 「题目数据缺失」一行里单列，不静默丢掉 —— 与「试卷分析」页脚同一口径。
 * 题型分布与试卷分析弹窗共用 `distributionOf`，同一份卷两处必须给出同一组数。 */
const knownItems = computed(() =>
  sectionViews.value.flatMap((sv) => sv.questions.flatMap((q) => (q.item ? [q.item] : []))),
)
const typeRows = computed(() => distributionOf(knownItems.value, (question) => question.type))
const missingCount = computed(() => totalCount.value - knownItems.value.length)

/* 从预览里打开的子弹窗：三个布尔足矣，弹窗本体都在共享组件里 */
const shareOpen = ref(false)
const parallelOpen = ref(false)
const analysisOpen = ref(false)

/* ===== 试卷块：卷头 + 各大题标题 + 各题 ===== */

const paperBlocks = computed<PaperBlockModel[]>(() => {
  const list: PaperBlockModel[] = [{ key: 'p-head', kind: 'head', span: 2 }]
  sectionViews.value.forEach((sv) => {
    list.push({
      key: `p-${sv.key}`,
      kind: 'section',
      span: 2,
      title: sv.title,
      count: sv.count,
      score: sv.score,
      perScore: sv.perScore,
    })
    /* 阅读材料紧跟在小题标题之后、本大题各小题之前，整版通栏。
       只有作答说明、没有文本的（如听力第一节）也要印，故 material / materialHint 有其一即可。 */
    if (sv.material || sv.materialHint) {
      list.push({ key: `p-${sv.key}-mat`, kind: 'material', span: 2, hint: sv.materialHint, text: sv.material })
    }
    sv.questions.forEach((q) => {
      list.push({
        key: `p-q-${q.no}`,
        kind: 'question',
        /* 版内双栏时客观题占一栏，解答题仍通栏 */
        span: geo.value.subCols === 2 && isObjective(q.item) ? 1 : 2,
        no: q.no,
        questionId: q.questionId,
        score: q.score,
      })
    })
  })
  /* 附加区块（表格 / 四线格 / 横线）排在全部答题区之后 —— 编辑页插进来时就是落在卷末，
     两处顺序必须一致，否则「编辑时看到的换页位置」与预览/打印对不上 */
  ;(props.paper.extras ?? []).forEach((extra) => {
    list.push({ key: `p-extra-${extra.id}`, kind: 'extra', span: 2, extra })
  })
  return list
})

/* ===== 答题卡块：考生信息区 + 填涂区 + 作答区 ===== */

const CARD_HINT = {
  fill: '用 2B 铅笔按题号填涂，修改时用橡皮擦净',
  write: '请在各题指定区域内作答，超出答题区域的答案无效',
} as const

const cardBlocks = computed<PaperBlockModel[]>(() => {
  const list: PaperBlockModel[] = [{ key: 'c-head', kind: 'card-head', span: 2 }]
  const columns = fillColumns(geo.value.panelW, preset.value.fontSize)
  /* 一块填涂区放不下的题自动续块，避免整块高过版面 */
  const perChunk = fillChunk(geo.value.panelW, preset.value.fontSize)

  sectionViews.value.forEach((sv) => {
    const objective = sv.questions.filter((q) => isObjective(q.item))
    const written = sv.questions.filter((q) => !isObjective(q.item))

    if (objective.length) {
      list.push({ key: `c-${sv.key}-fill`, kind: 'card-title', span: 2, title: sv.title, hint: CARD_HINT.fill })
      for (let i = 0; i < objective.length; i += perChunk) {
        list.push({
          key: `c-${sv.key}-fill-${i}`,
          kind: 'card-fill',
          span: 2,
          columns,
          items: objective
            .slice(i, i + perChunk)
            .map((q) => ({ key: `c-bub-${q.no}`, no: q.no, questionId: q.questionId })),
        })
      }
    }

    if (written.length) {
      list.push({
        key: `c-${sv.key}-write`,
        kind: 'card-title',
        span: 2,
        title: objective.length ? `${sv.title}（非选择题）` : sv.title,
        hint: CARD_HINT.write,
      })
      written.forEach((q) => {
        /* 填空题给作答横线，解答题 / 问答题按分值给作答框 */
        const lines = q.item?.type.includes('填空') ? ANSWER_LINES : 0
        list.push({
          key: `c-ans-${q.no}`,
          kind: 'card-answer',
          span: 2,
          no: q.no,
          questionId: q.questionId,
          score: q.score,
          lines,
          boxH: lines ? 0 : answerBoxHeight(q.score),
        })
      })
    }
  })
  return list
})

/** 测量层要量的块：随「内容」开关变化 */
const measureBlocks = computed<PaperBlockModel[]>(() => [
  ...(showPaper.value ? paperBlocks.value : []),
  ...(showCard.value ? cardBlocks.value : []),
])

/* ===== 测量层：按各块的真实宽度量高 ===== */

const measureHost = ref<HTMLElement | null>(null)
const heights = ref<Record<string, number>>({})
/** 首帧还没量到高度时先不排版，避免闪一版错误分页 */
const measured = ref(false)

function measureNow() {
  const host = measureHost.value
  if (!host) return
  const next: Record<string, number> = {}
  host.querySelectorAll<HTMLElement>('[data-block-key]').forEach((el) => {
    const key = el.dataset.blockKey
    if (key) next[key] = el.getBoundingClientRect().height
  })
  heights.value = next
  measured.value = true
}

let frame = 0
function scheduleMeasure() {
  if (frame) return
  frame = requestAnimationFrame(() => {
    frame = 0
    measureNow()
  })
}

/** 块的测量宽度必须与卷面上它实际占的宽度一致，否则换行位置不同、高度就失真 */
function measureWidth(block: PaperBlockModel): string {
  return `${block.span === 1 ? geo.value.colW : geo.value.panelW}px`
}

/* ===== 自动分版 + 拼版 ===== */

function heightOf(block: PaperBlockModel): number {
  return (heights.value[block.key] ?? 0) + preset.value.gap
}

/** 分版以块为原子，单块高于整版时无法再拆（会被纸面裁掉），提示教师换纸张或样式 */
const oversized = computed(() =>
  measureBlocks.value.filter((block) => (heights.value[block.key] ?? 0) + preset.value.gap > geo.value.contentH),
)

/** 分版的单位是「版」：8K / A3 一面两版时，两个版再拼到一张纸面上 */
function paginate(list: PaperBlockModel[]): PaperPage[] {
  return list.length ? paginateBlocks({ blocks: list, heightOf, pageHeight: geo.value.contentH }) : []
}

const paperPages = computed(() => (showPaper.value ? paginate(paperBlocks.value) : []))
const cardPages = computed(() => (showCard.value ? paginate(cardBlocks.value) : []))

interface SheetView {
  key: string
  /** 试卷 / 答题卡（两种内容都印时用于区分页码） */
  group: '试卷' | '答题卡'
  index: number
  total: number
  pages: PaperPage[]
}

/** 一张纸面 = 一面版数那么多「版」 */
function toSheets(group: SheetView['group'], pages: PaperPage[]): SheetView[] {
  const perSheet = geo.value.panels
  const total = Math.ceil(pages.length / perSheet)
  const out: SheetView[] = []
  for (let i = 0; i < pages.length; i += perSheet) {
    out.push({ key: `${group}-${i}`, group, index: i / perSheet + 1, total, pages: pages.slice(i, i + perSheet) })
  }
  return out
}

const sheets = computed<SheetView[]>(() => [
  ...toSheets('试卷', paperPages.value),
  ...toSheets('答题卡', cardPages.value),
])

const paperSheetCount = computed(() => sheets.value.filter((sheet) => sheet.group === '试卷').length)
const cardSheetCount = computed(() => sheets.value.filter((sheet) => sheet.group === '答题卡').length)

/** 纸面上方的页码提示（不进纸面、不参与打印） */
function sheetTag(sheet: SheetView): string {
  const head = mode.value === 'both' ? `${sheet.group} · ` : ''
  const flow = geo.value.panels > 1 ? ` · 一面 ${geo.value.panels} 版（先左版后右版）` : ''
  return `${head}第 ${sheet.index} 页 / 共 ${sheet.total} 页${flow}`
}

/** 纸面页脚的页码 */
function footText(sheet: SheetView): string {
  const head = mode.value === 'both' ? `${sheet.group} ` : ''
  return `${head}第 ${sheet.index} 页 · 共 ${sheet.total} 页`
}

function mmOf(px: number): number {
  return Math.round(px / MM)
}

/* 换纸张 / 换样式 / 切内容 / 切教师版后必须重量一次：块高会变，
   而 ResizeObserver 只在测量层的总高真的变了才回调（如 A4↔A3 恰好等高就不会触发）。 */
watch(
  [measureBlocks, () => `${geo.value.panelW}|${preset.value.key}`, teacher],
  () => nextTick(scheduleMeasure),
)

/* ===== 缩放（默认适应宽度，顶栏可 10% 步进或直接输入） ===== */

const canvas = ref<HTMLElement | null>(null)
const canvasW = ref(900)

/** 缩放上下限（30% ~ 160%）：手动输入与加减档位共用同一套钳制 */
const ZOOM_MIN = 0.3
const ZOOM_MAX = 1.6

function fitZoom() {
  const usable = Math.max(240, canvasW.value - 56)
  return Math.min(1.25, Math.max(0.25, usable / geo.value.sheetW))
}

/** 手动调过缩放就退出「适应宽度」，否则下一次窗口尺寸变化会把用户设的比例冲掉 */
function applyZoom(next: number) {
  autoFit.value = false
  zoom.value = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Number(next.toFixed(2))))
}

function nudgeZoom(delta: number) {
  applyZoom(zoom.value + delta)
}

/* 输入框里的百分比文本，单独存一份，**不跟 `zoom` 双向绑定**：双向绑定会在打字打到一半时
   把内容冲掉（想输 120，刚敲完「1」就被当成 1% 钳到 30%，后面两位根本打不进去）。
   改成「随时输入、回车 / 失焦才提交」—— 与 `zoom` 的同步只走下面这一个方向。 */
const zoomText = ref(String(Math.round(zoom.value * 100)))

watch(zoom, (next) => {
  zoomText.value = String(Math.round(next * 100))
})

/** 提交输入：认数字（手打 `%` 或空格都收），越界钳到 30% ~ 160%，乱输入退回原值 */
function commitZoom() {
  const parsed = Number.parseFloat(zoomText.value.replace(/[^\d.]/g, ''))
  const next = Number.isFinite(parsed)
    ? Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, parsed / 100))
    : zoom.value
  /* 值没变就不走 applyZoom：点进输入框、原样回车，不该顺手把「适应宽度」关掉 */
  if (next !== zoom.value) applyZoom(next)
  /* 无论提交成没成，回写成当前真实值（输入 999 被钳到 160 之后，框里得显示 160 而不是 999） */
  zoomText.value = String(Math.round(zoom.value * 100))
}

watch([geo, canvasW, autoFit], () => {
  if (autoFit.value) zoom.value = fitZoom()
})

/* ===== 左栏「推荐试卷」：换一份卷 ===== */

function pickPaper(next: OrgPaper) {
  /* 点当前这份卷不必换：emit 出去父页面会写回同一个值，白跑一次重建 */
  if (next.id === props.paper.id) return
  emit('pick', next)
}

/**
 * 卷换了（父页面把 `paper` 换成另一份）时收尾：
 * - 三个子弹窗说的都是上一份卷的事，留着会答非所问；
 * - 画布滚回顶部，否则新卷停在上一份卷滚到的位置（可能在第二页、甚至答题卡中段）。
 *
 * 分版与测量不用管：`paperBlocks` 变了，上面那条 watch 自己会重量重排。
 */
watch(
  () => props.paper.id,
  () => {
    shareOpen.value = false
    parallelOpen.value = false
    analysisOpen.value = false
    exportOpen.value = false
    previewTarget.value = null
    correctTarget.value = null
    similarTarget.value = null
    hideBar()
    canvas.value?.scrollTo({ top: 0 })
  },
)

/* ===== 浏览现成卷时每题的悬停操作条（`browse` 才开） =====
 *
 * 操作条本体与定位都在 `QuestionActionBarHost` 里（与试卷编辑画布共用一份 —— 需求要的
 * 「编辑页的按钮样式与预览一致」就是靠这个，不是靠两边各画一遍）。本组件只剩三件事：
 * 给题块挂 `data-qbar` 让壳认得出锚点、给题块描边（`.pp-slot.is-live`）、
 * 接住壳抛上来的三个动作去开对应的子弹窗。
 */

/** 操作条壳。重新分版 / 换卷 / 开子弹窗时都要叫它收起来：前两者让锚点失效（甚至脱离文档），
    后者是「弹窗盖在纸面上时不该还有一条悬停条」。 */
const barHost = ref<InstanceType<typeof QuestionActionBarHost> | null>(null)
function hideBar() {
  barHost.value?.hide()
}

/** 从操作条打开的子弹窗：非空即打开（与试题页签同一套开关方式） */
const previewTarget = ref<OrgQuestion | null>(null)
const correctTarget = ref<OrgQuestion | null>(null)
const similarTarget = ref<OrgQuestion | null>(null)

/**
 * 纠错记录：拉一份全量、按题分组。
 * 既是「已提交纠错」按钮态的依据（口径同 `QuestionsTab`：谁提的都算，说明这题有问题），
 * 也顺手喂给题目预览抽屉的 `corrections`。拉不到就退化成「按钮一律显示纠错」，不白屏。
 */
const corrections = ref<QuestionCorrection[]>([])
const correctedSet = computed(() => new Set(corrections.value.map((row) => row.questionId)))
function correctionsOf(questionId: number): QuestionCorrection[] {
  return corrections.value.filter((row) => row.questionId === questionId)
}
/**
 * 载荷里带的是整条纠错内容（组卷编辑页拿它生成卷面评论），本页没有评论能力，只用得上题号。
 */
function onCorrectionSubmitted({ questionId }: { questionId: number; types: string[]; description: string }) {
  if (correctedSet.value.has(questionId)) return
  /* 只补一个 id：列表里其它字段（类型 / 描述）是预览抽屉才要的，提交后没必要重拉全量 */
  corrections.value = [
    ...corrections.value,
    { id: 0, questionId, types: [], description: '', reporter: '', createdAt: '' },
  ]
}

/** 可逐题取用的题块描边类（打印无 hover，纸上不会落痕；`browse` 关闭时不出现） */
function slotClass(block: PaperBlockModel): string {
  return props.browse && block.kind === 'question' ? 'is-live' : ''
}

/**
 * 操作条锚点：只有题目块才挂 `data-qbar`（卷首 / 材料 / 附加区块没有可操作的对象）。
 * 返回 null 时 Vue 会把属性整个去掉，不会留下 `data-qbar=""` 这种假锚点把操作条勾出来。
 */
function barAnchorOf(block: PaperBlockModel): number | null {
  return block.kind === 'question' ? block.questionId : null
}

/* 缩放 / 切内容 / 重新分版 / 开子弹窗：全都直接收掉操作条。
   前三种会让锚点位置失效（甚至脱离文档），后者是「弹窗盖在预览上时不该还有一条悬停条」。 */
watch([zoom, mode, heights, previewTarget, correctTarget, similarTarget], hideBar)

/* ===== 操作条抛上来的三个动作（收藏与组卷车在壳里自己处理） ===== */

/** 预览里没有筛选面板可切：说清去哪儿切，好过按钮点了没反应 */
function onSimilarFilter() {
  showToast('按知识点筛选在「试题」页签可用')
  similarTarget.value = null
}

/* ===== 几何相关的内联样式 ===== */

/** 版内栏间距 = 单版宽 − 两栏宽（版内不分栏时单栏宽 = 单版宽，取 0 即可） */
const colGap = computed(() => geo.value.panelW - geo.value.colW * 2)

const sheetStyle = computed(() => ({
  width: `${geo.value.sheetW}px`,
  height: `${geo.value.sheetH}px`,
  paddingTop: `${geo.value.padTop}px`,
  paddingRight: `${geo.value.padRight}px`,
  paddingBottom: `${geo.value.padBottom}px`,
  paddingLeft: `${geo.value.padLeft}px`,
  /* 缩放只做视觉变换，纸张仍按真实尺寸布局；外层容器按缩放后的尺寸占位 */
  transform: `scale(${zoom.value})`,
  '--pp-col-gap': `${colGap.value}px`,
  '--pp-panel-gap': `${geo.value.panelGap}px`,
  '--pp-panel-w': `${geo.value.panelW}px`,
  ...vars.value,
}))

const sheetWrapStyle = computed(() => ({
  width: `${geo.value.sheetW * zoom.value}px`,
  height: `${geo.value.sheetH * zoom.value}px`,
}))

const bodyStyle = computed(() => ({ height: `${geo.value.contentH}px` }))

/* ===== 生命周期 ===== */

/**
 * 进全局浮层栈（与 AppModal / AppConfirm / AppDrawer 同一套）。
 *
 * 本弹窗是最后一个没登记的浮层：`onKeydown` 对 Esc 无条件响应，于是在它里面开出来的
 * 浮层（顶栏的分享 / 平行卷 / 分析，以及任何 appConfirm）按一次 Esc 会把
 * **子弹窗和预览一起关掉**。登记之后只有栈顶响应 —— 子弹窗后挂载即栈顶，Esc 只关它。
 */
const overlayId = enterOverlay()

function onKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape' || !isTopOverlay(overlayId)) return
  emit('close')
}

let resizeObserver: ResizeObserver | null = null
let canvasObserver: ResizeObserver | null = null
let bodyOverflow = ''

function onPrint() {
  if (teacher.value) showToast('当前为教师版（含答案解析），打印前建议关闭', 'error')
  window.print()
}

/* ===== 导出（Word / PDF） =====
 * 预览里的「打印」打的是**当前这个按真实纸面分好版的 DOM**，适合所见即所得地印出来；
 * 而「导出」是从试卷数据重新生成一份干净的打印文档，适合拿去二次编辑或发给别人。
 * 两者不是一回事，所以按钮并列而不是互相替代。
 *
 * 导出合并成一个按钮 + 一个弹窗，与试卷库列表的「导出」完全一致（版本、答题卡、两种格式
 * 都在弹窗里选）—— 原先工具栏上并排「导出 Word / 导出 PDF」再加一个内联版本下拉，
 * 等于把三个选项摊在一条已经很挤的条上，而且和试卷库那套的两步式操作对不上。
 */

const exportOpen = ref(false)
const exportVersion = ref<ExportVersion>('student')
/** 附带答题卡参考答案：打开弹窗时按当前预览的内容给默认值，之后以勾选为准 */
const exportWithCard = ref(true)

function openExport() {
  if (totalCount.value === 0) {
    showToast('该试卷还没有题目，无法导出', 'error')
    return
  }
  /* 「教师版」开关开着就默认导出教师版：这是用户当下正在看的东西，默认值该跟着它走。
     在打开时算一次而不是 watch(teacher)，是因为它只决定**弹窗打开那一刻**的初始值；
     挂 watch 的话用户手动选了「纯答案」再碰一下预览开关，选择就被无声改掉了。 */
  exportVersion.value = teacher.value ? 'teacher' : 'student'
  /* 预览里选了「含答题卡」就默认一起导出，避免预览有、导出没有 */
  exportWithCard.value = mode.value !== 'paper'
  exportOpen.value = true
}

function buildExportOptions(): ExportOptions {
  return {
    version: exportVersion.value,
    withInfo: true,
    withAnswerCard: exportWithCard.value,
  }
}

function onExport(kind: 'doc' | 'pdf') {
  try {
    if (kind === 'doc') {
      const fileName = exportPaperDoc(props.paper, props.questions, buildExportOptions())
      showToast(`已导出 ${fileName}`)
    } else {
      exportPaperPdf(props.paper, props.questions, buildExportOptions())
      showToast('已在新窗口打开，选择「另存为 PDF」即可')
    }
    exportOpen.value = false
  } catch (error) {
    showToast(error instanceof Error ? error.message : '导出失败', 'error')
  }
}

onMounted(async () => {
  document.addEventListener('keydown', onKeydown)
  /* 预览期间锁背景滚动 */
  bodyOverflow = document.body.style.overflow
  document.body.style.overflow = 'hidden'
  /* 打印样式只在预览打开时生效，避免影响其它页面的正常打印 */
  document.body.classList.add('pp-preview-open')

  await nextTick()
  /* 画布宽度决定「适应宽度」的缩放比例，先取一次再量高 */
  if (canvas.value) {
    canvasW.value = canvas.value.clientWidth
    canvasObserver = new ResizeObserver(() => {
      canvasW.value = canvas.value?.clientWidth ?? canvasW.value
    })
    canvasObserver.observe(canvas.value)
  }
  /* 开了「适应宽度」就按画布实宽定比例（用户手动调过缩放的话 applyZoom 已把它关掉） */
  if (autoFit.value) zoom.value = fitZoom()
  if (props.browse) {
    /* 纠错记录拉不到就退化成「按钮一律显示纠错」，不该因此白屏，故吞掉异常 */
    fetchQuestionCorrections()
      .then((records) => {
        corrections.value = records
      })
      .catch(() => {})
  }
  measureNow()
  /* 图片 / 公式 / 字体加载完成后高度会变，RO 兜底重排 */
  resizeObserver = new ResizeObserver(scheduleMeasure)
  if (measureHost.value) resizeObserver.observe(measureHost.value)
  document.fonts?.ready.then(scheduleMeasure).catch(() => {})
})

onBeforeUnmount(() => {
  exitOverlay(overlayId)
  document.removeEventListener('keydown', onKeydown)
  document.body.style.overflow = bodyOverflow
  document.body.classList.remove('pp-preview-open')
  resizeObserver?.disconnect()
  canvasObserver?.disconnect()
  if (frame) cancelAnimationFrame(frame)
})
</script>

<template>
  <Teleport to="body">
    <div class="pp-mask" :style="{ zIndex: maskZ }" @click.self="emit('close')">
      <div class="pp-dialog">
        <!-- 头部 -->
        <header class="pp-head">
          <div class="pp-head-main">
            <h3 class="pp-title">{{ paper.name }}</h3>
            <!-- 元信息用标签（同上架试卷库卡片的口径），空的维度不出现空标签。
                 题量 / 满分 / 时长那一串在左栏「试题统计」里，这里不再重复；
                 出卷人是标签行里唯一没有对应卡片标签的，故自成一条 -->
            <div class="pp-tags">
              <span class="tag tag-blue">{{ paper.grade }} / {{ paper.subject }}</span>
              <span v-if="paper.difficulty" class="tag" :class="difficultyClass(paper.difficulty)">
                {{ paper.difficulty }}
              </span>
              <span v-if="paper.examType" class="tag tag-gray">{{ paper.examType }}</span>
              <span v-if="paper.region || paper.competition" class="tag tag-gray">
                {{ [paper.region, paper.competition].filter(Boolean).join(' / ') }}
              </span>
              <span v-if="paper.source" class="tag tag-gray">{{ paper.source }}</span>
              <span class="tag tag-gray">出卷人 {{ paper.owner }}</span>
            </div>
          </div>
          <div class="pp-head-ops">
            <span class="pp-chip">
              <AppIcon name="file" :size="14" />
              {{ size.name }} · 一面 {{ geo.panels }} 版 · 共 {{ sheets.length }} 页
            </span>
            <!-- 三个「对一份已入库的卷才成立」的动作：分享 / 平行卷 / 分析。
                 试卷库与组卷工作台浏览的都是现成卷，故都在顶栏（原先「平行组卷 / 分析试卷」
                 两个按钮埋在左栏底部，两处预览因此长得不一样）；编辑页 / 协同任务 / 组卷车草稿
                 的预览不传 `browse`，整组收掉 -->
            <template v-if="browse">
              <button class="btn btn-ghost btn-sm" type="button" @click="shareOpen = true">
                <AppIcon name="share" :size="14" /> 分享
              </button>
              <button class="btn btn-ghost btn-sm" type="button" @click="parallelOpen = true">
                <AppIcon name="copy" :size="14" /> 平行卷
              </button>
              <button class="btn btn-ghost btn-sm" type="button" @click="analysisOpen = true">
                <AppIcon name="chart" :size="14" /> 分析
              </button>
            </template>
            <!-- 版式 / 答题卡 / 格式都在弹窗里选，与试卷库列表的「导出」同一个交互 -->
            <button class="btn btn-ghost btn-sm" type="button" @click="openExport">
              <AppIcon name="download" :size="14" /> 导出
            </button>
            <button class="btn btn-ghost btn-sm" type="button" title="按当前分好的版式直接打印" @click="onPrint">
              <AppIcon name="print" :size="14" /> 打印
            </button>
            <button class="pp-x" type="button" @click="emit('close')"><AppIcon name="close" :size="16" /></button>
          </div>
        </header>

        <!-- 工具栏（纸张 / 版数 / 方向 / 内容 / 缩放 / 教师版）：两个页签下都在 ——
             「怎么排」与「这是什么卷」是两件事，切左栏页签不该把排版参数一起藏起来 -->
        <div class="pp-bar">
          <div class="pp-bar-group">
            <span class="pp-bar-label">纸张</span>
            <select v-model="sizeKey" class="f-select" style="width: 178px">
              <option v-for="s in PAPER_SIZES" :key="s.key" :value="s.key">{{ s.name }}（{{ s.mm }}）· {{ s.note }}</option>
            </select>
            <span class="pp-bar-label">版数</span>
            <select v-model.number="panelPick" class="f-select" style="width: 108px">
              <option :value="0">自动（{{ size.panels }} 版）</option>
              <option :value="1">一面 1 版</option>
              <option :value="2">一面 2 版</option>
              <option :value="3">一面 3 版</option>
            </select>
            <div class="pp-seg">
              <button type="button" :class="{ on: orientation === 'portrait' }" @click="orientation = 'portrait'">纵向</button>
              <button type="button" :class="{ on: orientation === 'landscape' }" @click="orientation = 'landscape'">横向</button>
            </div>
          </div>

          <div class="pp-bar-group">
            <span class="pp-bar-label">内容</span>
            <div class="pp-seg">
              <button type="button" :class="{ on: mode === 'paper' }" @click="mode = 'paper'">试卷</button>
              <button type="button" :class="{ on: mode === 'card' }" @click="mode = 'card'">答题卡</button>
              <button type="button" :class="{ on: mode === 'both' }" @click="mode = 'both'">试卷 + 答题卡</button>
            </div>
          </div>

          <div class="pp-bar-group">
            <span class="pp-bar-label">缩放</span>
            <div class="pp-seg">
              <button type="button" @click="nudgeZoom(-0.1)"><AppIcon name="minus" :size="14" /></button>
              <!-- 比例可手动输入：回车 / 失焦提交（`%` 放在框外，手打的 `%` 才不会跟数字粘成 1205） -->
              <input
                class="pp-zoom"
                type="text"
                inputmode="numeric"
                aria-label="缩放比例（%）"
                :value="zoomText"
                @input="zoomText = ($event.target as HTMLInputElement).value"
                @keydown.enter="($event.target as HTMLInputElement).blur()"
                @blur="commitZoom"
              />
              <span class="pp-zoom-unit">%</span>
              <button type="button" @click="nudgeZoom(0.1)"><AppIcon name="plus" :size="14" /></button>
            </div>
            <button class="mini-btn" :class="{ on: autoFit }" type="button" @click="autoFit = true">适应宽度</button>
          </div>

          <div class="pp-bar-group pp-bar-right">
            <span class="pp-bar-label">教师版</span>
            <AppSwitch v-model="teacher" />
            <span class="pp-bar-hint">含答案解析 / 标出正确选项</span>
          </div>
        </div>

        <div class="pp-main">
          <!-- 左栏两个页签：「试卷分析」= 这是什么卷（试题统计 + 推荐卷）、
               「排版样式」= 它怎么排的（内置样式 + 卷面信息）。
               参考资料与裁切警告两个页签下都留 —— 前者是卷的内容，后者说的是「你正看的这版有缺陷」 -->
          <aside class="pp-side">
            <div class="pp-side-tabs">
              <button
                v-for="row in SIDE_TABS"
                :key="row.key"
                type="button"
                :class="{ on: sideTab === row.key }"
                @click="sideTab = row.key"
              >
                {{ row.label }}
              </button>
            </div>

            <template v-if="sideTab === 'layout'">
              <div class="pp-side-title">排版样式</div>
              <div class="pp-side-list">
                <button
                  v-for="row in PAPER_LAYOUTS"
                  :key="row.key"
                  class="pp-style"
                  :class="{ on: layoutKey === row.key }"
                  type="button"
                  @click="layoutKey = row.key"
                >
                  <span class="pp-style-name">
                    {{ row.name }}
                    <AppIcon v-if="layoutKey === row.key" name="check" :size="13" />
                  </span>
                  <span class="pp-style-desc">{{ row.desc }}</span>
                  <span class="pp-style-tags">
                    <i>{{ row.fontSize }}px</i>
                    <i>{{ row.optionColumns === 2 ? '选项双列' : '选项单列' }}</i>
                    <i v-if="row.twoColumn && geo.panels === 1">双栏</i>
                    <i v-if="row.headStyle === 'seal'">密封线</i>
                  </span>
                </button>
              </div>

              <div class="pp-side-title" style="margin-top: 14px">卷面信息</div>
              <ul class="pp-facts">
                <li>
                  <span>纸张</span>{{ size.name }} {{ size.mm }} mm · {{ orientation === 'portrait' ? '纵向' : '横向' }}
                </li>
                <li><span>版面</span>一面 {{ geo.panels }} 版，每版 {{ mmOf(geo.panelW) }} mm 宽</li>
                <li><span>版心</span>每版 {{ mmOf(geo.contentW / geo.panels) }} × {{ mmOf(geo.contentH) }} mm</li>
                <li><span>页边距</span>上 {{ preset.margin.top }} / 右 {{ preset.margin.right }} / 下 {{ preset.margin.bottom }} / 左 {{ preset.margin.left }} mm</li>
                <li>
                  <span>页数</span>
                  <template v-if="mode === 'both'">试卷 {{ paperSheetCount }} 页 · 答题卡 {{ cardSheetCount }} 页（自动分版）</template>
                  <template v-else>{{ sheets.length }} 页（自动分版）</template>
                </li>
              </ul>
            </template>

            <!-- 试卷分析：卷面构成 + （浏览现成卷时的）同类推荐卷。
                 内容切换与缩放不在这儿 —— 它们是「怎么看」而不是「这是什么卷」，
                 顶栏那一条里本来就有，同一件事不再摆两处 -->
            <template v-else>
              <div class="pp-side-title">试题统计</div>
              <p class="pp-total">
                {{ totalCount }} 题 · 满分 {{ totalScore }} 分 · 考试时长 {{ paper.duration }} 分钟
              </p>
              <ul class="pp-stats">
                <li v-for="row in typeRows" :key="row.label">
                  <span class="pp-stats-label" :title="row.label">{{ row.label }}</span>
                  <b>{{ row.count }} 题</b>
                </li>
                <!-- 卷里引用了但题库中已无数据的题：只计题量不进题型分布，单列说清有几道 -->
                <li v-if="missingCount > 0" class="pp-stats-missing">
                  <span class="pp-stats-label">题目数据缺失</span>
                  <b>{{ missingCount }} 题</b>
                </li>
              </ul>
              <p v-if="typeRows.length === 0" class="pp-side-tip">卷内没有可统计的题目</p>

              <!-- 推荐试卷只在浏览现成卷时出现：它推的是卷池里的同类卷（由父页面筛好传入），
                   编辑页 / 协同任务 / 组卷车草稿那几处没有卷池，推不出也不该推 -->
              <template v-if="browse">
                <div class="pp-side-title" style="margin-top: 14px">推荐试卷</div>
                <p v-if="!recommended?.length" class="pp-side-tip">暂无同年级同学科的其他试卷</p>
                <ul v-else class="pp-recs">
                  <li v-for="row in recommended" :key="row.id">
                    <button type="button" :title="row.name" @click="pickPaper(row)">
                      <span class="pp-rec-name">{{ row.name }}</span>
                      <span class="pp-rec-meta">{{ paperQuestionCount(row) }} 题 · {{ row.viewCount ?? 0 }} 浏览</span>
                    </button>
                  </li>
                </ul>
              </template>
            </template>

            <template v-if="attachments.length">
              <div class="pp-side-title" style="margin-top: 14px">参考资料</div>
              <ul class="pp-facts">
                <li v-for="row in attachments" :key="`${row.kind}-${row.mediaId}`">
                  <span>{{ ATTACHMENT_KIND_TEXT[row.kind] }}</span>
                  <em class="pp-att-name" :title="row.name">{{ row.name }}</em>
                  <i class="pp-att-size">{{ row.sizeMb.toFixed(1) }} MB</i>
                </li>
              </ul>
              <p class="pp-side-tip">随卷保存的配套素材，不参与卷面排版与打印。</p>
            </template>

            <p v-if="preset.twoColumn && geo.panels > 1" class="pp-side-tip">
              「{{ preset.name }}」的双栏只在单版纸张上生效；一面 {{ geo.panels }} 版时每版本就只有半张宽，版内不再分栏。
            </p>
            <p v-if="oversized.length" class="pp-side-warn">
              <AppIcon name="warning" :size="13" />
              <span>
                {{ oversized.length }} 处内容高于整版（如解答题题干 / 作答框过高），会被纸面裁切；建议改用更大的纸（8K / A3 / 6K）、增加一面版数或选「紧凑省纸」样式。
              </span>
            </p>
            <p class="pp-side-tip">
              按纸张真实尺寸自动分版：8K / A3 一面两版，阅读顺序先左版后右版。答题卡按题号自动分区（客观题填涂区 + 主观题作答区），与试卷题号一致。打印请选择「实际大小 /
              100%」并关闭页眉页脚。
            </p>
          </aside>

          <!-- 纸面画布 -->
          <div ref="canvas" class="pp-canvas">
            <div v-if="totalCount === 0" class="pp-empty">该试卷还没有题目，无法排版预览</div>
            <div v-else-if="!measured" class="pp-empty">正在按 {{ size.name }} 纸面排版…</div>
            <div v-for="sheet in measured ? sheets : []" :key="sheet.key" class="pp-page-block">
              <div class="pp-page-tag">{{ sheetTag(sheet) }}</div>
              <div class="pp-sheet-wrap" :style="sheetWrapStyle">
                <div class="pp-sheet" :style="sheetStyle">
                  <!-- 装订 / 密封线（高考仿真卷头样式） -->
                  <div v-if="preset.headStyle === 'seal'" class="pp-seal">
                    <span>姓名＿＿＿＿＿ 班级＿＿＿＿＿ 考号＿＿＿＿＿ 密封线内不要答题</span>
                  </div>

                  <div class="pp-body" :style="bodyStyle">
                    <!-- 一面 N 版：先排满左版再排右版，版间留对折留白 -->
                    <div class="pp-panels" :class="{ 'is-multi': geo.panels > 1 }">
                      <div v-for="(panel, pi) in sheet.pages" :key="pi" class="pp-panel">
                        <template v-for="(row, ri) in panel.rows" :key="ri">
                          <!-- 块外壳：浏览现成卷时给每道题一个可识别的区块（`.is-live` 是 hover 才显形的
                               outline）与悬停入口。**必须是一层真实的 DOM**：PaperBlock 的根是片段
                               （模板首行注释让它成了多根），class / 事件透传根本落不到纸面上。
                               壳本身是普通块级 div、不带任何样式 —— `.pp-row` / `.pp-col > *`
                               的块间距从 PaperBlock 挪到壳上，量到多少画出来还是多少，分版不受影响 -->
                          <div v-if="row.kind === 'full'" class="pp-row">
                            <div
                              class="pp-slot"
                              :class="slotClass(row.block)"
                              :data-qbar="barAnchorOf(row.block)"
                            >
                              <PaperBlock
                                :block="row.block"
                                :paper="paper"
                                :questions="questions"
                                :preset="preset"
                                :teacher="teacher"
                              />
                            </div>
                          </div>
                          <div v-else class="pp-row pp-cols">
                            <div v-for="(col, ci) in [row.left, row.right]" :key="ci" class="pp-col">
                              <div
                                v-for="block in col"
                                :key="block.key"
                                class="pp-slot"
                                :class="slotClass(block)"
                                :data-qbar="barAnchorOf(block)"
                              >
                                <PaperBlock
                                  :block="block"
                                  :paper="paper"
                                  :questions="questions"
                                  :preset="preset"
                                  :teacher="teacher"
                                />
                              </div>
                            </div>
                          </div>
                        </template>
                      </div>
                    </div>
                  </div>

                  <div v-if="preset.pageNumber" class="pp-foot">{{ footText(sheet) }}</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- 隐藏测量层：与纸面同样的组件、同样的变量、同样的宽度 -->
        <div ref="measureHost" class="pp-measure" :style="vars">
          <div
            v-for="block in measureBlocks"
            :key="block.key"
            class="pp-measure-item"
            :data-block-key="block.key"
            :style="{ width: measureWidth(block) }"
          >
            <PaperBlock :block="block" :paper="paper" :questions="questions" :preset="preset" :teacher="teacher" />
          </div>
        </div>

        <!-- 导出弹窗：与试卷库列表的「导出」同一套选项（版本 / 答题卡 / Word 还是 PDF），
             两处的话术与顺序保持一致，免得同一个动作在两页要重新学一遍。
             导出 / 打印两份卷都能做，故不按 `browse` 收窄。 -->
        <AppModal v-if="exportOpen" title="导出试卷" :z-index="childZ" @close="exportOpen = false">
          <p style="font-size: 13.5px; color: var(--ink-2); margin-bottom: 12px">
            《{{ paper.name }}》· {{ totalCount }} 题 · {{ totalScore }} 分
          </p>
          <div class="f-field">
            <label class="f-label">卷面版本</label>
            <select v-model="exportVersion" class="f-select">
              <option value="student">学生版（只有题目，解答留作答空白）</option>
              <option value="teacher">教师版（附答案与解析）</option>
              <option value="answer">纯答案页</option>
            </select>
          </div>
          <label class="pp-check">
            <input v-model="exportWithCard" type="checkbox" />
            附带答题卡参考答案
          </label>
          <template #footer>
            <button class="btn btn-ghost" @click="exportOpen = false">取消</button>
            <button class="btn btn-ghost" @click="onExport('doc')">
              <AppIcon name="download" :size="14" /> 导出 Word
            </button>
            <button class="btn btn-primary" @click="onExport('pdf')">
              <AppIcon name="print" :size="14" /> 导出 PDF
            </button>
          </template>
        </AppModal>

        <!-- 浏览现成卷时从预览里打开的子弹窗。
             它们自己 Teleport 到 body，靠 `childZ`（遮罩 +10）压住预览 ——
             详见 AppModal 的 zIndex 说明。打印时被 body.pp-preview-open 的规则一并隐藏。 -->
        <PaperShareDialog v-if="browse && shareOpen" :paper="paper" :z-index="childZ" @close="shareOpen = false" />
        <ParallelPaperDialog
          v-if="browse && parallelOpen"
          :paper="paper"
          :z-index="childZ"
          @close="parallelOpen = false"
        />
        <PaperAnalysisModal
          v-if="browse && analysisOpen"
          :paper="paper"
          :questions="questions"
          :z-index="childZ"
          @close="analysisOpen = false"
        />

        <!-- 悬停操作条打开的三个浮层：同样用 `childZ` 压住预览，打印时被 body 级规则一并隐藏 -->
        <QuestionPreviewDrawer
          v-if="browse && previewTarget"
          :question="previewTarget"
          :corrections="correctionsOf(previewTarget.id)"
          :z-index="childZ"
          @close="previewTarget = null"
        />
        <QuestionCorrectionDialog
          v-if="browse && correctTarget"
          :question="correctTarget"
          :z-index="childZ"
          @close="correctTarget = null"
          @submitted="onCorrectionSubmitted"
        />
        <SimilarQuestionsModal
          v-if="browse && similarTarget"
          :row="similarTarget"
          :z-index="childZ"
          @close="similarTarget = null"
          @find-similar="onSimilarFilter"
        />
      </div>
    </div>
  </Teleport>

  <!-- 每题操作条：壳自己 Teleport 到 body（见 `QuestionActionBarHost`）。
       层级是 maskZ + 1（夹在遮罩与子弹窗之间）；打印时它作为 body 的直接子元素被
       `body.pp-preview-open > *:not(.pp-mask)` 隐藏。 -->
  <QuestionActionBarHost
    ref="barHost"
    :questions="questions"
    :enabled="browse"
    :corrected="correctedSet"
    :scroll-host="canvas"
    :z-index="maskZ + 1"
    @preview="previewTarget = $event"
    @correct="correctTarget = $event"
    @similar="similarTarget = $event"
  />
</template>

<style scoped>
.pp-mask {
  position: fixed;
  inset: 0;
  /* 实际层级由内联样式给（见 `maskZ`，默认 130）；这里留一个兜底值，避免内联样式失效时无层级 */
  z-index: 130;
  background: rgba(20, 26, 40, 0.48);
  backdrop-filter: blur(2px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 18px;
  animation: fade-in 0.16s ease;
}
.pp-dialog {
  width: min(1480px, 97vw);
  height: min(94vh, 1080px);
  background: #fff;
  border-radius: 16px;
  box-shadow: var(--shadow-lg);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  animation: pop-in 0.2s cubic-bezier(0.34, 1.4, 0.64, 1);
}

.pp-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 14px;
  padding: 16px 20px 12px;
  border-bottom: 1px solid var(--border);
}
.pp-head-main { flex: 1; min-width: 0; }
.pp-title { font-size: 16.5px; font-weight: 700; }
/* 元信息标签行：标签之间只留 6px，换行时行距靠 gap 撑开 */
.pp-tags { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; margin-top: 5px; }
/* 顶栏这一排按钮（分享 / 平行卷 / 分析 / 导出 / 打印）：`flex-shrink: 0` 让它们无论卷名多长
   都保持原尺寸，宁可挤窄左边的标题区，也不要收窄到图标与文字互相压 */
.pp-head-ops { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }
.pp-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  color: var(--brand-deep);
  background: var(--brand-soft);
  border-radius: 999px;
  padding: 4px 11px;
}
/* 导出弹窗里的答题卡勾选项（试卷库列表的导出弹窗有同款，两处样式各自 scoped） */
.pp-check {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: var(--ink-2);
  cursor: pointer;
  user-select: none;
}
.pp-check input { accent-color: var(--brand); }
.pp-x {
  width: 30px;
  height: 30px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--sub);
  display: flex;
  align-items: center;
  justify-content: center;
}
.pp-x:hover { background: #f2f4fa; color: var(--ink); }

.pp-bar {
  display: flex;
  align-items: center;
  gap: 22px;
  padding: 10px 20px;
  border-bottom: 1px solid var(--border);
  background: #fafbfd;
  flex-wrap: wrap;
}
.pp-bar-group { display: flex; align-items: center; gap: 8px; }
.pp-bar-right { margin-left: auto; }
.pp-bar-label { font-size: 12.5px; color: var(--sub); }
.pp-bar-hint { font-size: 12px; color: var(--sub); }
/* 缩放比例：可编辑，外观跟同一排的按钮保持一致（无边框、透明底），
   只留悬停 / 聚焦两块状态表明「这儿能改」。宽度定死，30% ↔ 160% 切换时两边的按钮不跟着抖 */
.pp-zoom {
  width: 34px;
  border: none;
  background: transparent;
  /* 上下 4px 是撑出和同排按钮一样的高度（分段控件的行高取最高那一项），别删 */
  padding: 4px 0;
  font-family: inherit;
  font-size: 12.5px;
  color: var(--ink-2);
  text-align: center;
  outline: none;
}
.pp-zoom:hover { background: #f2f4fa; }
.pp-zoom:focus { background: #fff; color: var(--ink); box-shadow: inset 0 0 0 1.5px var(--brand); }
.pp-zoom-unit { font-size: 12.5px; color: var(--ink-2); padding: 0 6px 0 1px; }
/* 这里刻意不加 align-items: center —— 各项 stretch 到整行高，悬停底色才铺满格子、不留上下白边。
   代价是「格子里的东西自己居中」得由每一项负责：按钮本来就是 flex 居中，缩放那一格是 <input>，
   表单控件天生把文字在自己的框中垂直居中（原先放的是 <span>，撑高后文字就贴在顶边了） */
.pp-seg { display: inline-flex; border: 1.5px solid var(--border); border-radius: 9px; overflow: hidden; background: #fff; }
.pp-seg button {
  border: none;
  background: transparent;
  padding: 4px 11px;
  font-size: 12.5px;
  color: var(--ink-2);
  display: flex;
  align-items: center;
  justify-content: center;
}
.pp-seg button + button { border-left: 1px solid var(--border); }
.pp-seg button:hover { background: #f2f4fa; }
.pp-seg button.on { background: var(--brand-soft); color: var(--brand-deep); font-weight: 600; }
.mini-btn.on { background: var(--brand-soft); color: var(--brand-deep); border-color: var(--brand); }

.pp-main { flex: 1; display: flex; min-height: 0; }

.pp-side {
  width: 244px;
  flex-shrink: 0;
  border-right: 1px solid var(--border);
  padding: 14px;
  overflow-y: auto;
  background: #fff;
}
/* 两个页签的分段控件：撑满 244px 的整栏（顶栏里那种贴内容的 .pp-seg 在这儿会留一截空档），
   下面各节的 .pp-side-title 不再需要额外的上间距 —— 与页签条之间的 14px 已经隔开了 */
.pp-side-tabs {
  display: flex;
  border: 1.5px solid var(--border);
  border-radius: 9px;
  overflow: hidden;
  background: #fff;
  margin-bottom: 14px;
}
.pp-side-tabs button {
  flex: 1;
  border: none;
  background: transparent;
  padding: 7px 0;
  font-size: 12.5px;
  color: var(--ink-2);
}
.pp-side-tabs button + button { border-left: 1px solid var(--border); }
.pp-side-tabs button:hover { background: #f2f4fa; }
.pp-side-tabs button.on { background: var(--brand-soft); color: var(--brand-deep); font-weight: 600; }

.pp-side-title { font-size: 12.5px; font-weight: 700; color: var(--ink); margin-bottom: 9px; }
.pp-side-list { display: flex; flex-direction: column; gap: 8px; }
.pp-style {
  text-align: left;
  border: 1.5px solid var(--border);
  border-radius: 11px;
  background: #fff;
  padding: 9px 11px;
  display: flex;
  flex-direction: column;
  gap: 5px;
  transition: all 0.15s;
}
.pp-style:hover { border-color: var(--brand); }
.pp-style.on { border-color: var(--brand); background: var(--brand-soft); }
.pp-style-name { display: flex; align-items: center; gap: 5px; font-size: 13px; font-weight: 600; color: var(--ink); }
.pp-style.on .pp-style-name { color: var(--brand-deep); }
.pp-style-desc { font-size: 11.5px; color: var(--sub); line-height: 1.5; }
.pp-style-tags { display: flex; flex-wrap: wrap; align-items: center; gap: 5px; }
.pp-style-tags i {
  font-style: normal;
  font-size: 10.5px;
  color: var(--sub);
  border: 1px solid var(--border);
  border-radius: 5px;
  padding: 0 5px;
}
/* ===== 「试卷分析」页签：试题统计 + 推荐试卷 ===== */

/* 总览一行（题量 · 总分 · 时长） */
.pp-total { font-size: 12px; color: var(--sub); margin-bottom: 9px; }
.pp-stats { display: flex; flex-direction: column; gap: 6px; font-size: 12.5px; color: var(--ink-2); }
.pp-stats li { display: flex; align-items: baseline; gap: 8px; }
/* 题型名可能长（「阅读理解（选择）」）：占满剩余宽度并省略，计数贴右不抖动 */
.pp-stats-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* 题数用 <b> 只是为了跟题型名分开（`<b>` 自带加粗，这里显式压回常规字重）：
   一栏统计里十几个数字全都加粗，看过去是一排黑块，反而盖过了题型名本身 */
.pp-stats li b { flex-shrink: 0; color: var(--ink); font-size: 13px; font-weight: 400; }
.pp-stats-missing { color: var(--warn); }
.pp-stats-missing b { color: var(--warn); }

/* 推荐试卷：整块可点，卷名 + 「题量 · 浏览数」两行 */
.pp-recs { display: flex; flex-direction: column; gap: 6px; }
.pp-recs button {
  display: flex;
  flex-direction: column;
  gap: 3px;
  width: 100%;
  text-align: left;
  border: 1px solid var(--border);
  border-radius: 9px;
  background: #fff;
  padding: 7px 9px;
  transition: border-color 0.15s, background 0.15s;
}
.pp-recs button:hover { border-color: var(--brand); background: var(--brand-soft); }
/* 卷名往往长到一行放不下（「2026 届高三第一次模拟联考数学卷」），单行省略号会把「哪份卷」
   这唯一的关键信息切掉一半：放开换行、最多 3 行，行高固定所以几张卡的高度仍然一致。
   完整卷名仍挂在按钮的 title 上 */
.pp-rec-name {
  font-size: 12.5px;
  color: var(--ink);
  line-height: 1.45;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.pp-rec-meta { font-size: 11.5px; color: var(--sub); }

.pp-facts { display: flex; flex-direction: column; gap: 6px; font-size: 12px; color: var(--ink-2); }
/* 标签 + 值：值在 244px 侧栏里会折到两行，用 baseline 让标签与值首行同基线
   （center 会在多行值时把标签拽到中间，反而错位） */
.pp-facts li { display: flex; align-items: baseline; gap: 8px; line-height: 1.5; }
.pp-facts span { color: var(--sub); flex-shrink: 0; width: 42px; }
/* 参考资料行：名称占满剩余宽度并截断（侧栏只有 244px），大小贴右不留白 */
.pp-att-name {
  flex: 1;
  min-width: 0;
  font-style: normal;
  color: var(--ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pp-att-size { flex-shrink: 0; font-style: normal; font-size: 11px; color: var(--sub); }
.pp-side-warn {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  font-size: 11.5px;
  line-height: 1.6;
  color: var(--warn);
  background: var(--warn-soft);
  border-radius: 8px;
  padding: 7px 9px;
  margin-top: 12px;
}
.pp-side-warn span { min-width: 0; }
.pp-side-tip { font-size: 11.5px; color: var(--sub); line-height: 1.6; margin-top: 12px; }

.pp-canvas {
  flex: 1;
  min-width: 0;
  overflow: auto;
  background: #eef1f6;
  padding: 22px 28px 40px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 26px;
}
.pp-empty { margin: auto; font-size: 13px; color: var(--sub); }
.pp-page-block { display: flex; flex-direction: column; align-items: center; gap: 8px; }
.pp-page-tag { font-size: 11.5px; color: var(--sub); }
.pp-sheet-wrap { position: relative; }
.pp-sheet {
  position: absolute;
  top: 0;
  left: 0;
  transform-origin: top left;
  background: #fff;
  box-shadow: 0 6px 22px rgba(28, 36, 52, 0.16);
  box-sizing: border-box;
  overflow: hidden;
  font-family: var(--pp-font);
  color: var(--pp-accent);
  print-color-adjust: exact;
  -webkit-print-color-adjust: exact;
}
.pp-body { position: relative; }
/* 一面 N 版：每版宽度写死为 panelW（与测量层同一个值），版间留对折留白 */
.pp-panels { display: flex; align-items: flex-start; gap: var(--pp-panel-gap); }
.pp-panel { flex: 0 0 auto; position: relative; width: var(--pp-panel-w); }
/* 版与版之间的对折提示虚线（绝对定位，不参与布局） */
.pp-panels.is-multi .pp-panel + .pp-panel::before {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: calc(var(--pp-panel-gap) / -2);
  border-left: 1px dashed #d3d9e6;
}
/* 块间距由分页算法统一计入高度（每块 = 内容高 + 间距），所以这里逐块加下间距，
   与实际渲染高度保持一一对应，否则页尾会溢出或少排。 */
.pp-row { margin-bottom: var(--pp-gap); }
.pp-row.pp-cols { margin-bottom: 0; }
.pp-cols { display: flex; align-items: flex-start; gap: var(--pp-col-gap); }
.pp-col { flex: 1 1 0; min-width: 0; }
.pp-col > * { margin-bottom: var(--pp-gap); }

/* 浏览现成卷时的每题区块：hover 才描边（outline 不占布局、也不会回流 —— 用 border / padding 会改块高，
   量到的高度与实际画出来的就对不上，分版会开始溢出）。打印时无 hover，纸上不留痕。
   壳本身不给任何样式：它只是 PaperBlock 的容器（分版靠量 PaperBlock，不量壳） */
.pp-slot.is-live:hover { outline: 2px solid var(--brand); outline-offset: 4px; border-radius: 2px; }

.pp-seal {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 22px;
  width: 20px;
  border-right: 1px dashed #9aa4b8;
  padding-top: 40px;
  display: flex;
  justify-content: center;
  overflow: hidden;
}
.pp-seal span {
  writing-mode: vertical-rl;
  font-size: 11px;
  letter-spacing: 2px;
  color: #6b7280;
  font-family: var(--pp-head-font);
  white-space: nowrap;
}

.pp-foot {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 6px;
  text-align: center;
  font-size: 11px;
  color: #6b7280;
}

/* 隐藏测量层：不参与视觉，但必须参与布局（display:none 量不到高度） */
.pp-measure {
  position: fixed;
  top: 0;
  left: -20000px;
  visibility: hidden;
  pointer-events: none;
  font-family: var(--pp-font);
  color: var(--pp-accent);
}
.pp-measure-item { margin: 0 0 var(--pp-gap); }

@keyframes fade-in { from { opacity: 0; } to { opacity: 1; } }
@keyframes pop-in {
  from { opacity: 0; transform: translateY(14px) scale(0.98); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}
</style>

<!--
  打印：只留纸张，剥掉弹窗外壳（工具栏、样式栏、测量层、缩放变换、页面阴影）。
  这条规则是全局的，但用 body.pp-preview-open 兜住 —— 该类只在预览打开时挂到 body，
  所以其它页面的 Ctrl+P 不受影响。
-->
<style>
@media print {
  body.pp-preview-open { overflow: visible !important; background: #fff !important; }
  body.pp-preview-open > *:not(.pp-mask) { display: none !important; }

  .pp-mask {
    position: static !important;
    display: block !important;
    inset: auto !important;
    padding: 0 !important;
    background: none !important;
    backdrop-filter: none !important;
    animation: none !important;
  }
  .pp-dialog {
    width: auto !important;
    height: auto !important;
    max-width: none !important;
    border-radius: 0 !important;
    box-shadow: none !important;
    overflow: visible !important;
    animation: none !important;
  }
  .pp-head,
  .pp-bar,
  .pp-side,
  .pp-page-tag,
  .qbar-host,
  .pp-measure { display: none !important; }

  .pp-main { display: block !important; }
  .pp-canvas {
    display: block !important;
    overflow: visible !important;
    background: none !important;
    padding: 0 !important;
  }
  .pp-page-block { display: block !important; }
  .pp-sheet-wrap { width: auto !important; height: auto !important; }
  /* 一面 N 版：打印时版仍并排，纸面本身不跨页 */
  .pp-panels { display: flex !important; }
  .pp-panel { flex: 0 0 auto !important; }
  .pp-sheet {
    position: relative !important;
    transform: none !important;
    box-shadow: none !important;
    break-inside: avoid;
    page-break-inside: avoid;
    break-after: page;
    page-break-after: always;
  }
  .pp-page-block:last-child .pp-sheet { break-after: auto; page-break-after: auto; }

  @page { margin: 0; }
}
</style>
