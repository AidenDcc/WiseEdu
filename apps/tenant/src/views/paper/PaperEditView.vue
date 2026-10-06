<script setup lang="ts">
/**
 * 试卷编辑（全屏工作台，从「生成试卷」或试卷库「编辑」进入）。
 *
 * 为什么做成**独立全屏页**（与 `/paper/compose` 同一思路，不进 AppLayout）：
 * 教材、试卷这类「纸面型」编辑任务要的是尽可能宽的画布 + 常驻的右侧工具条，
 * 套在带侧边栏与顶栏的壳里，画布会被压到不足 1000px，A4 卷面根本展不开。
 *
 * 两条贯穿全页的约束：
 * 1. **所见即所得**：纸面用与「整卷预览」同一套几何（mm→px）、同一套版式令牌（--pp-*）
 *    与同一个渲染组件（PaperBlock），并在隐藏测量层里实测块高后自动分版 ——
 *    编辑时看到的换页位置，就是打印出来的换页位置。
 * 2. **改动都可回溯**：每次结构性改动（加题、删题、换序、改分、改标题、改版式）
 *    都打一份 sections 快照进本地历史，撤销/重做与右侧「历史记录」共用同一份栈。
 *
 * 右侧工具条对标教研云的竖向图标栏：全文设置 / 试题库 / 媒体库 / 资源篮 / 导入文档 / 历史记录。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { AppIcon, appConfirm, showToast, toPlainText, truncateRich, AppModal } from '@aiteach/shared'
import type {
  MediaKind,
  OrgCollabTask,
  OrgMedia,
  OrgPaper,
  OrgQuestion,
  PaperAttachment,
  PaperExtra,
  PaperExtraKind,
  PaperSection,
} from '@aiteach/shared'
import PaperBlock from '@/components/paper/PaperBlock.vue'
import PaperPreviewModal from '@/components/paper/PaperPreviewModal.vue'
import AppDropdownMenu from '@/components/ui/AppDropdownMenu.vue'
import {
  DEFAULT_PAPER_NOTICES,
  PAPER_EXTRAS,
  PAPER_LAYOUTS,
  PAPER_SIZES,
  isObjective,
  makePaperExtra,
  paperGeometry,
  presetOf,
  presetVars,
  type PaperBlock as PaperBlockModel,
  type PaperLayoutPreset,
  type PaperOrientation,
  type PaperSizeKey,
} from '@/components/paper/paper-layouts'
import { paginateBlocks, type PaperPage } from '@/components/paper/paginate'
import {
  fetchCollabTasks,
  fetchMedia,
  fetchPapers,
  fetchPaperVersions,
  fetchQuestions,
  replacePaperVersion,
  restorePaperVersion,
  savePaper,
  saveQuestion,
  swapPaperQuestion,
} from '@/api/org'
import { useBaseData } from '@/composables/useBaseData'
import { useComposeBasket } from '@/composables/useComposeBasket'
import { defaultScore, findSectionIndex, makeSectionTitle, sectionKeywordsOf, sectionLabelOf, MAX_SECTIONS } from './paper-sections'

const route = useRoute()
const router = useRouter()
const { subjects, grades, questionTypesFor, difficulties, ensure, pick, withCurrent } = useBaseData()
const basket = useComposeBasket()

/* ================= 卷面数据 ================= */

const form = reactive({ id: 0, name: '', subject: '', grade: '', duration: 120 })
const sections = ref<PaperSection[]>([])
/**
 * 随卷参考资料（图片 / 视频 / 小程序），来自组卷车或本卷既有数据。
 *
 * 刻意**不进 `snapshots` 撤销栈**：那套栈快照的是 `sections`（卷面），把附件一起塞进去要连带改
 * 历史面板的每一处；而且「撤销卷面改动」本就不该顺手把附上的素材丢掉 —— 附件是加法操作，
 * 移错了直接在面板里移出即可。
 */
const attachments = ref<PaperAttachment[]>([])
/**
 * 卷面附加区块（表格 / 四线格 / 横线）。
 *
 * 与 `attachments` 一样**不进撤销栈**：撤销栈快照的是 `sections`（答题区），
 * 把格子块一起塞进去要连带改历史面板的每一处；而且插错一个格子，
 * 在块工具条里选中删掉就行，比先撤销卷面再重来轻得多。
 *
 * 顺序即卷面顺序，且一律排在各答题区之后（见 paperBlocks）—— 格子是给最后那道题写字用的。
 */
const extras = ref<PaperExtra[]>([])
/** 新增区块的 id 自增源：同一张卷里要区分两个「表格」，见 load() 的重建 */
let extraSeq = 1
/**
 * 卷首「注意事项」的编辑稿：一整段文本，**一行一条**。
 *
 * 存文本而不是数组，是因为面板里就是个 textarea —— 边打字边按行拆再写回输入框，
 * 光标会在刚敲下的空行上乱跳。真正的数组由下面的 `notices` 在保存/排版时现拆。
 */
const noticesDraft = ref('')
/** 卷首注意事项条目：拆行、去空行。空数组 = 卷面不印这一块（见 paper-layouts 的默认稿说明） */
const notices = computed(() => noticesDraft.value.split('\n').map((row) => row.trim()).filter(Boolean))
const meta = reactive({ owner: '', sharedSquare: false, status: 'draft' as OrgPaper['status'] })
const questions = ref<OrgQuestion[]>([])
const ownPaperIds = ref<number[]>([])
const collabTasks = ref<OrgCollabTask[]>([])
const loading = ref(true)
const saving = ref(false)
let sectionSeq = 1

function nowText(): string {
  return new Date().toLocaleString('zh-CN', { hour12: false }).replace(/\//g, '-')
}

/** 渲染 / 导出 / 预览共用的试卷对象（编辑期是内存态，保存时才落库） */
const paper = computed<OrgPaper>(() => ({
  id: form.id,
  name: form.name.trim() || '未命名试卷',
  subject: form.subject,
  grade: form.grade,
  duration: form.duration,
  status: meta.status,
  sections: sections.value,
  attachments: attachments.value,
  extras: extras.value,
  notices: notices.value,
  owner: meta.owner || '当前用户',
  updatedAt: nowText(),
  sharedSquare: meta.sharedSquare,
}))

function itemOf(questionId: number): OrgQuestion | undefined {
  return questions.value.find((row) => row.id === questionId)
}

const totalCount = computed(() => sections.value.reduce((sum, row) => sum + row.questions.length, 0))
const totalScore = computed(() =>
  sections.value.reduce((sum, row) => sum + row.questions.reduce((t, q) => t + (Number(q.score) || 0), 0), 0),
)
const objectiveScore = computed(() =>
  sections.value.reduce(
    (sum, row) =>
      sum +
      row.questions.reduce((t, q) => {
        const item = itemOf(q.questionId)
        return t + (item && ['单选', '多选', '判断'].includes(item.type) ? Number(q.score) || 0 : 0)
      }, 0),
    0,
  ),
)
const inPaperIds = computed(() => new Set(sections.value.flatMap((row) => row.questions.map((q) => q.questionId))))

/** 本卷对应的协同组卷任务（有则「协同组卷」按钮直接进任务，而不是又建一个） */
const currentTask = computed(() => collabTasks.value.find((row) => row.paperId === form.id) ?? null)

/* ================= 版式（全文设置） ================= */

const layoutKey = ref(PAPER_LAYOUTS[0].key)
const sizeKey = ref<PaperSizeKey>('A4')
const orientation = ref<PaperOrientation>('portrait')
const panelPick = ref(0)
/** 卷首 / 分值位置 / 答题留白 / 页码可单独覆盖版式预设，不必为了改一项换整套样式 */
const headOverride = ref<PaperLayoutPreset['headStyle'] | ''>('')
const scoreOverride = ref<PaperLayoutPreset['scoreStyle'] | ''>('')
const spaceOverride = ref<boolean | null>(null)
const panelRail = ref<'' | 'settings' | 'bank' | 'media' | 'basket' | 'import' | 'history'>('settings')
const outlineOpen = ref(true)
const zoom = ref(1)
const autoFit = ref(true)

const preset = computed<PaperLayoutPreset>(() => {
  const base = presetOf(layoutKey.value)
  return {
    ...base,
    headStyle: headOverride.value || base.headStyle,
    scoreStyle: scoreOverride.value || base.scoreStyle,
    answerSpace: spaceOverride.value === null ? base.answerSpace : spaceOverride.value,
  }
})
const size = computed(() => PAPER_SIZES.find((row) => row.key === sizeKey.value) ?? PAPER_SIZES[0])
const geo = computed(() => paperGeometry(size.value, orientation.value, preset.value, panelPick.value))
const vars = computed(() => presetVars(preset.value))

/* ================= 纸面块 ================= */

/**
 * 排版块 + 归属信息。用交叉类型而不是 interface extends：`PaperBlock` 是联合类型，
 * interface 不能继承联合；交叉类型会自动分配到每个成员（A|B & C = (A&C)|(B&C)）。
 */
type EditBlock = PaperBlockModel & {
  /** 归属：大题下标 / 小题下标（卷头为空） */
  si?: number
  qi?: number
}
const NUMBERS = '一二三四五六七八九十'
const NUMBERED_TITLE = /^([一二三四五六七八九十]+[、.．]|（[一二三四五六七八九十]+）|第[一二三四五六七八九十百]+[部分章节]|\d+[、.．])/

const paperBlocks = computed<EditBlock[]>(() => {
  const list: EditBlock[] = [{ key: 'p-head', kind: 'head', span: 2 }]
  let no = 0
  sections.value.forEach((section, si) => {
    const rows = section.questions.map((entry, qi) => {
      no += 1
      return { no, qi, questionId: entry.questionId, score: Number(entry.score) || 0 }
    })
    const score = rows.reduce((sum, row) => sum + row.score, 0)
    const first = rows[0]?.score ?? 0
    const perScore = rows.length > 0 && rows.every((row) => row.score === first) ? first : null
    const raw = section.title.trim()
    list.push({
      key: `p-s-${si}`,
      kind: 'section',
      span: 2,
      si,
      title: NUMBERED_TITLE.test(raw) ? section.title : `${NUMBERS[si] ?? si + 1}、${raw}`,
      count: rows.length,
      score,
      perScore,
    })
    const material = section.material?.trim() ?? ''
    const hint = section.materialHint?.trim() ?? ''
    if (material || hint) list.push({ key: `p-m-${si}`, kind: 'material', span: 2, si, hint, text: material })
    rows.forEach((row) => {
      list.push({
        key: `p-q-${si}-${row.qi}`,
        kind: 'question',
        span: geo.value.subCols === 2 && isObjective(itemOf(row.questionId)) ? 1 : 2,
        si,
        qi: row.qi,
        no: row.no,
        questionId: row.questionId,
        score: row.score,
      })
    })
  })
  /* 附加区块（表格 / 四线格 / 横线）排在全部答题区之后。
     顺序必须与 PaperPreviewModal 一致（那里也是 append 在最后），否则预览里的换页位置
     与本页对不上 —— 而本页的卖点就是「所见即所得」。 */
  extras.value.forEach((extra) => list.push({ key: `p-extra-${extra.id}`, kind: 'extra', span: 2, extra }))
  return list
})

/* ================= 测量 + 分版（与整卷预览同一套算法） ================= */

const measureHost = ref<HTMLElement | null>(null)
const heights = ref<Record<string, number>>({})
const measured = ref(false)
let frame = 0

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

function scheduleMeasure() {
  if (frame) return
  frame = requestAnimationFrame(() => {
    frame = 0
    measureNow()
  })
}

function measureWidth(block: EditBlock): string {
  return `${block.span === 1 ? geo.value.colW : geo.value.panelW}px`
}

function heightOf(block: EditBlock): number {
  return (heights.value[block.key] ?? 0) + preset.value.gap
}

const pages = computed<PaperPage[]>(() =>
  paperBlocks.value.length ? paginateBlocks({ blocks: paperBlocks.value, heightOf, pageHeight: geo.value.contentH }) : [],
)
const sheets = computed(() => {
  const perSheet = geo.value.panels
  const out: Array<{ key: string; index: number; total: number; pages: PaperPage[] }> = []
  const total = Math.ceil(pages.value.length / perSheet)
  for (let i = 0; i < pages.value.length; i += perSheet) {
    out.push({ key: `sheet-${i}`, index: i / perSheet + 1, total, pages: pages.value.slice(i, i + perSheet) })
  }
  return out
})

const overflowBlocks = computed(() =>
  paperBlocks.value.filter((block) => (heights.value[block.key] ?? 0) + preset.value.gap > geo.value.contentH),
)

/* ================= 缩放 ================= */

const canvas = ref<HTMLElement | null>(null)
const canvasW = ref(1000)

function fitZoom() {
  const usable = Math.max(280, canvasW.value - 72)
  return Math.min(1.2, Math.max(0.25, usable / geo.value.sheetW))
}

function nudgeZoom(delta: number) {
  /* 手调过缩放就不再是「适应宽度」—— 留着选中会让下一次窗口变化把用户的缩放悄悄冲掉 */
  autoFit.value = false
  zoom.value = Math.min(1.6, Math.max(0.25, Number((zoom.value + delta).toFixed(2))))
}

/** 输入框里的纯数字（`%` 由旁边的 span 画，两者才好在同一行里上下居中） */
const zoomText = computed(() => String(Math.round(zoom.value * 100)))

/**
 * 手输缩放百分比。非法输入（空、非数字、0 或负数）不改 `zoom`，
 * 但**必须把输入框写回显示值** —— `:value` 绑的是 `zoom`，值没变 Vue 就不会重渲染这一格，
 * 浏览器里会一直留着用户敲进去的那串乱码。
 */
function onZoomInput(event: Event) {
  const input = event.target as HTMLInputElement
  const value = Number(input.value.replace(/[^\d.]/g, ''))
  if (Number.isFinite(value) && value > 0) {
    autoFit.value = false
    zoom.value = Math.min(1.6, Math.max(0.25, Number((value / 100).toFixed(2))))
  }
  input.value = zoomText.value
}

const sheetStyle = computed(() => ({
  width: `${geo.value.sheetW}px`,
  height: `${geo.value.sheetH}px`,
  paddingTop: `${geo.value.padTop}px`,
  paddingRight: `${geo.value.padRight}px`,
  paddingBottom: `${geo.value.padBottom}px`,
  paddingLeft: `${geo.value.padLeft}px`,
  transform: `scale(${zoom.value})`,
  '--pp-col-gap': `${geo.value.panelW - geo.value.colW * 2}px`,
  '--pp-panel-gap': `${geo.value.panelGap}px`,
  '--pp-panel-w': `${geo.value.panelW}px`,
  ...vars.value,
}))
const sheetWrapStyle = computed(() => ({
  width: `${geo.value.sheetW * zoom.value}px`,
  height: `${geo.value.sheetH * zoom.value}px`,
}))
const bodyStyle = computed(() => ({ height: `${geo.value.contentH}px` }))
const colGap = computed(() => geo.value.panelW - geo.value.colW * 2)

/* ================= 选中与块操作 ================= */

type Selection =
  | { kind: 'head' }
  | { kind: 'section'; si: number }
  | { kind: 'material'; si: number }
  | { kind: 'question'; si: number; qi: number }
  /** 附加区块（表格 / 四线格 / 横线）：按 id 选中，不归任何大题 */
  | { kind: 'extra'; id: number }

const selected = ref<Selection | null>({ kind: 'head' })

/** 块 key → 编辑块（带归属）：分版后的块是基础类型，靠 key 反查回带归属的那一份 */
const blockMap = computed(() => new Map(paperBlocks.value.map((row) => [row.key, row])))

function selectKey(key: string) {
  const block = blockMap.value.get(key)
  if (block) selectBlock(block)
}

function isSelectedKey(key: string): boolean {
  const block = blockMap.value.get(key)
  return block ? isSelected(block) : false
}

function selectBlock(block: EditBlock) {
  if (block.kind === 'head') selected.value = { kind: 'head' }
  else if (block.kind === 'section' && block.si != null) selected.value = { kind: 'section', si: block.si }
  else if (block.kind === 'material' && block.si != null) selected.value = { kind: 'material', si: block.si }
  else if (block.kind === 'question' && block.si != null && block.qi != null) {
    selected.value = { kind: 'question', si: block.si, qi: block.qi }
  } else if (block.kind === 'extra') selected.value = { kind: 'extra', id: block.extra.id }
  scrollToKey(block.key)
}

function isSelected(block: EditBlock): boolean {
  const sel = selected.value
  if (!sel) return false
  if (sel.kind === 'head') return block.kind === 'head'
  if (sel.kind === 'extra') return block.kind === 'extra' && block.extra.id === sel.id
  if (block.si !== sel.si) return false
  if (sel.kind === 'section') return block.kind === 'section'
  if (sel.kind === 'material') return block.kind === 'material'
  return block.kind === 'question' && block.qi === sel.qi
}

const selectedQuestion = computed(() => {
  const sel = selected.value
  if (sel?.kind !== 'question') return null
  const entry = sections.value[sel.si]?.questions[sel.qi]
  return entry ? { ...entry, item: itemOf(entry.questionId) } : null
})
const selectedSection = computed(() => {
  const sel = selected.value
  if (sel?.kind !== 'section' && sel?.kind !== 'material') return null
  return sections.value[sel.si] ?? null
})

/* ================= 附加区块（表格 / 四线格 / 横线） ================= */

/** 「插入」下拉的菜单项：与 paper-layouts 的 PAPER_EXTRAS 同一份，加第四种格型只改那一处 */
const extraItems = PAPER_EXTRAS.map((row) => ({ key: row.kind, label: row.text, icon: row.icon }))

const selectedExtra = computed(() => {
  const sel = selected.value
  return sel?.kind === 'extra' ? extras.value.find((row) => row.id === sel.id) ?? null : null
})
/** 块工具条上的块名（取菜单里那份文案，不另写一份中文） */
const selectedExtraText = computed(() => extraTextOf(selectedExtra.value?.kind))

/** 附加区块的显示名：菜单里那份文案是唯一一份，各处都从这里取 */
function extraTextOf(kind: PaperExtraKind | undefined): string {
  return PAPER_EXTRAS.find((row) => row.kind === kind)?.text ?? '附加区块'
}

/** 附加区块的图标：与菜单同一份配置，目录行与菜单里长得一样 */
function extraIconOf(kind: PaperExtraKind | undefined): string {
  return PAPER_EXTRAS.find((row) => row.kind === kind)?.icon ?? 'grid'
}

/**
 * 插入一个附加区块：**追加到卷末**并立刻选中它（选中才会出现块工具条，行列数在那里调）。
 *
 * 为什么不做「插到当前选中块之后」：卷面顺序由大题、小题决定，插在中间就得把 `extras`
 * 与 `sections` 的次序交织起来存，保存格式、分版、预览三处都得跟着改；而实际用法就是
 * 「给最后那道作文题配一张作文纸」，追加到卷末已经够用。
 *
 * 不 commit 进撤销栈 —— 与 `attachments` 同一口径（见 `extras` 的声明）。插错了，
 * 在块工具条上删掉即可，比「先撤销卷面改动、再重来一遍」轻得多。
 */
function insertExtra(kind: string) {
  const extra = makePaperExtra(kind as PaperExtraKind, extraSeq++)
  extras.value = [...extras.value, extra]
  selected.value = { kind: 'extra', id: extra.id }
  scrollToKey(`p-extra-${extra.id}`)
  /* 只有表格有列数可调，四线格与横线都是通栏 —— 提示里别报一个调不了的量 */
  const sizeText = extra.kind === 'table' ? '行列数' : '行数'
  showToast(`${extraTextOf(extra.kind)}已加在卷末，可在块工具条里调${sizeText}`, 'success')
}

/** 把某个块滚进视野（`nearest`：已经在视野里就不动，别把老师正在看的地方推走） */
function scrollToKey(key: string) {
  nextTick(() => {
    document.querySelector(`[data-block="${key}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  })
}

/** 改**当前选中**附加区块的行 / 列数：夹在 1~40，防止手滑输入 0 或 999 把分版算爆 */
function setExtraSize(key: 'rows' | 'cols', value: number) {
  const target = selectedExtra.value
  if (!target) return
  const size = Math.min(40, Math.max(1, Math.round(Number(value) || 0)))
  extras.value = extras.value.map((row) => (row.id === target.id ? { ...row, [key]: size } : row))
}

function removeExtra() {
  const target = selectedExtra.value
  if (!target) return
  extras.value = extras.value.filter((row) => row.id !== target.id)
  /* 块没了就把选中退回卷头，否则块工具条会停在卷面上已经不存在的那个块上 */
  selected.value = { kind: 'head' }
}

/* ================= 本地历史（撤销 / 重做 / 历史记录面板） ================= */

interface Snapshot {
  label: string
  time: string
  data: PaperSection[]
}

const snapshots = ref<Snapshot[]>([])
const pointer = ref(-1)

function commit(label: string) {
  snapshots.value = snapshots.value.slice(0, pointer.value + 1)
  snapshots.value.push({ label, time: nowText(), data: JSON.parse(JSON.stringify(sections.value)) as PaperSection[] })
  if (snapshots.value.length > 60) snapshots.value.shift()
  pointer.value = snapshots.value.length - 1
}

function applySnapshot(index: number) {
  const row = snapshots.value[index]
  if (!row) return
  pointer.value = index
  sections.value = JSON.parse(JSON.stringify(row.data)) as PaperSection[]
  selected.value = { kind: 'head' }
  nextTick(scheduleMeasure)
}

const canUndo = computed(() => pointer.value > 0)
const canRedo = computed(() => pointer.value < snapshots.value.length - 1)

function undo() {
  if (!canUndo.value) return
  applySnapshot(pointer.value - 1)
  showToast(`已撤销：${snapshots.value[pointer.value + 1]?.label ?? ''}`)
}
function redo() {
  if (!canRedo.value) return
  applySnapshot(pointer.value + 1)
}

/* ================= 卷面编辑操作 ================= */

function ensureSectionFor(type: string): number {
  const hit = findSectionIndex(sections.value, sectionLabelOf(type), sectionKeywordsOf(type))
  if (hit >= 0) return hit
  if (sections.value.length >= MAX_SECTIONS) {
    showToast(`大题已达 ${MAX_SECTIONS} 个上限，题目已加入最后一个大题`, 'error')
    return sections.value.length - 1
  }
  sections.value.push({
    id: sectionSeq++,
    title: makeSectionTitle(sectionLabelOf(type), sections.value.length),
    questions: [],
  })
  return sections.value.length - 1
}

function addQuestion(row: OrgQuestion, silent = false): boolean {
  if (inPaperIds.value.has(row.id)) {
    if (!silent) showToast('该题已在卷中', 'error')
    return false
  }
  const si = ensureSectionFor(row.type)
  sections.value[si].questions.push({ questionId: row.id, score: defaultScore(row.type) })
  if (!silent) commit(`加入「${truncateRich(row.stem, 14)}…」到${sections.value[si].title}`)
  nextTick(scheduleMeasure)
  return true
}

function removeQuestion(si: number, qi: number) {
  const [removed] = sections.value[si].questions.splice(qi, 1)
  if (!removed) return
  selected.value = { kind: 'head' }
  commit(`移除第 ${qi + 1} 题`)
  nextTick(scheduleMeasure)
}

function moveQuestion(si: number, qi: number, delta: number) {
  const target = qi + delta
  const list = sections.value[si].questions
  if (target < 0 || target >= list.length) {
    showToast(delta < 0 ? '已经是本大题第一题' : '已经是本大题最后一题')
    return
  }
  const [row] = list.splice(qi, 1)
  list.splice(target, 0, row)
  selected.value = { kind: 'question', si, qi: target }
  commit('调整题目顺序')
  nextTick(scheduleMeasure)
}

/** 跨大题移动：把题移到相邻大题的末尾/开头（题型与大题不一致时由教师自行负责） */
function moveQuestionAcross(si: number, qi: number, delta: number) {
  const target = si + delta
  if (target < 0 || target >= sections.value.length) {
    showToast('已经是第一个/最后一个大题')
    return
  }
  const [row] = sections.value[si].questions.splice(qi, 1)
  const list = sections.value[target].questions
  if (delta < 0) list.push(row)
  else list.unshift(row)
  selected.value = { kind: 'question', si: target, qi: delta < 0 ? list.length - 1 : 0 }
  commit(`移到${sections.value[target].title}`)
  nextTick(scheduleMeasure)
}

function setScore(si: number, qi: number, value: number) {
  const score = Number(value)
  if (!(score >= 0.5 && score <= 100)) {
    showToast('单题分值须在 0.5 ~ 100 之间', 'error')
    return
  }
  sections.value[si].questions[qi].score = score
  commit(`调整第 ${qi + 1} 题分值为 ${score} 分`)
  nextTick(scheduleMeasure)
}

/** 整题分值批量套用：同题型统一改分是命题时的高频动作 */
function applySectionScore(si: number, value: number) {
  const score = Number(value)
  if (!(score >= 0.5 && score <= 100)) {
    showToast('单题分值须在 0.5 ~ 100 之间', 'error')
    return
  }
  sections.value[si].questions.forEach((row) => (row.score = score))
  commit(`「${sections.value[si].title}」每题统一 ${score} 分`)
  nextTick(scheduleMeasure)
}

function addSection() {
  if (sections.value.length >= MAX_SECTIONS) {
    showToast(`大题最多 ${MAX_SECTIONS} 个`, 'error')
    return
  }
  sections.value.push({ id: sectionSeq++, title: makeSectionTitle('新大题', sections.value.length), questions: [] })
  selected.value = { kind: 'section', si: sections.value.length - 1 }
  commit('新增大题')
  nextTick(scheduleMeasure)
}

async function removeSection(si: number) {
  if (sections.value.length <= 1) {
    showToast('至少保留 1 个大题', 'error')
    return
  }
  if (!(await appConfirm(`删除《${sections.value[si].title}》及其 ${sections.value[si].questions.length} 道题？`, { type: 'danger' }))) return
  sections.value.splice(si, 1)
  selected.value = { kind: 'head' }
  commit('删除大题')
  nextTick(scheduleMeasure)
}

function moveSection(si: number, delta: number) {
  const target = si + delta
  if (target < 0 || target >= sections.value.length) return
  const [row] = sections.value.splice(si, 1)
  sections.value.splice(target, 0, row)
  selected.value = { kind: 'section', si: target }
  commit('调整大题顺序')
  nextTick(scheduleMeasure)
}

function renameSection(si: number, title: string) {
  sections.value[si].title = title
  commit(`大题改名为「${title}」`)
}

function setMaterial(si: number, text: string) {
  sections.value[si].material = text
  commit('编辑大题材料')
  nextTick(scheduleMeasure)
}

/** 右侧材料框：写入当前选中的大题（材料块与大题块都指向同一个 si） */
function updateMaterial(text: string) {
  const sel = selected.value
  if (sel?.kind !== 'section' && sel?.kind !== 'material') return
  setMaterial(sel.si, text)
}

async function onSwap() {
  const sel = selected.value
  if (sel?.kind !== 'question' || !form.id) {
    showToast('请先保存草稿后再使用「换一题」', 'error')
    return
  }
  const entry = sections.value[sel.si].questions[sel.qi]
  try {
    const { newId } = await swapPaperQuestion(form.id, entry.questionId)
    entry.questionId = newId
    await refreshQuestions()
    commit(`第 ${sel.qi + 1} 题换为同构题 #${newId}`)
    showToast(`已替换为同构题 #${newId}（消耗 1 次额度）`, 'success')
  } catch (error) {
    showToast(error instanceof Error ? error.message : '替换失败', 'error')
  }
}

/* ================= 右侧面板：试题库 ================= */

const bankFilter = reactive({ type: '', difficulty: '', keyword: '' })
const bankPool = computed(() =>
  questions.value.filter(
    (row) =>
      row.status === 'approved' &&
      (!bankFilter.type || row.type === bankFilter.type) &&
      (!bankFilter.difficulty || row.difficulty === bankFilter.difficulty) &&
      (!bankFilter.keyword || toPlainText(row.stem).includes(bankFilter.keyword)),
  ),
)

/* ================= 右侧面板：媒体库 ================= */

const media = ref<OrgMedia[]>([])
const mediaOpen = ref<OrgMedia | null>(null)

/* ================= 右侧面板：导入文档 ================= */

const importText = ref('')
const importGrade = ref('')
const importDifficulty = ref('')
const importRunning = ref(false)

interface ParsedItem {
  stem: string
  type: string
  options: string[]
}

/**
 * 粘贴文本 → 题目。
 *
 * 只做**确定性**的切分与题型判定，不调用 AI：教师从 Word 复制来的题目大多已带题号，
 * 能靠规则切准；猜不出的（无题号又无空行）宁可整段作为一道题交给人工改，也不擅自拆散。
 */
function parseImportText(text: string): ParsedItem[] {
  const raw = text.replace(/\r\n?/g, '\n').trim()
  if (!raw) return []
  const numbered = /^(?:\d{1,2}[、.．)）]|第\s*\d{1,2}\s*题)/m.test(raw)
  const chunks = numbered
    ? raw.split(/\n(?=\s*(?:\d{1,2}[、.．)）]|第\s*\d{1,2}\s*题))/)
    : raw.split(/\n{2,}/)
  return chunks
    .map((chunk) => {
      const lines = chunk
        .split('\n')
        .map((row) => row.trim())
        .filter(Boolean)
      const options: string[] = []
      const stemLines: string[] = []
      lines.forEach((line) => {
        /* 选项行：A．/ A./ A、/ A) 开头 */
        const opt = line.match(/^([A-F])[、.．)）]\s*(.+)$/)
        if (opt) options.push(opt[2].trim())
        else stemLines.push(line.replace(/^\s*(?:\d{1,2}[、.．)）]|第\s*\d{1,2}\s*题)\s*/, ''))
      })
      const stem = stemLines.join(' ').trim()
      if (!stem) return null
      const type = options.length
        ? /[（(]\s*[）)]/.test(stem) || options.length >= 4
          ? '单选'
          : '多选'
        : /_{2,}|＿{2,}|（\s*）/.test(stem)
          ? '填空'
          : '解答'
      return { stem, type, options }
    })
    .filter((row): row is ParsedItem => row !== null)
}

const parsed = computed(() => parseImportText(importText.value))

async function runImport() {
  if (!parsed.value.length) {
    showToast('没有解析出题目，请检查文本格式', 'error')
    return
  }
  importRunning.value = true
  let added = 0
  try {
    for (const row of parsed.value) {
      const created = await saveQuestion({
        stem: row.stem,
        type: row.type,
        options: row.options,
        answer: '',
        analysis: '',
        knowledge: [],
        difficulty: importDifficulty.value || pick(difficulties.value, '中等'),
        subject: form.subject,
        grade: importGrade.value || form.grade,
        submit: false,
      })
      questions.value.unshift(created)
      if (addQuestion(created, true)) added += 1
    }
    commit(`从文档导入 ${added} 道题`)
    showToast(`已解析 ${parsed.value.length} 道，成功入卷 ${added} 道（其余已在卷中）`, 'success')
    importText.value = ''
    panelRail.value = ''
  } catch (error) {
    showToast(error instanceof Error ? error.message : '导入失败', 'error')
  } finally {
    importRunning.value = false
    nextTick(scheduleMeasure)
  }
}

/* ================= 右侧面板：资源篮（组卷车） ================= */

function basketAddAll() {
  let added = 0
  basket.entries.value.forEach((entry) => {
    const row = itemOf(entry.questionId)
    if (row && addQuestion(row, true)) added += 1
  })
  if (!added) {
    showToast('组卷车里的题目都已在卷中', 'error')
    return
  }
  commit(`从资源篮批量加入 ${added} 道题`)
  showToast(`已加入 ${added} 道题`, 'success')
}

function basketAddOne(questionId: number) {
  const row = itemOf(questionId)
  if (row) addQuestion(row)
}

/* ===== 参考资料（组卷车里的图片 / 视频 / 小程序）=====
   组卷车的「清空」是全清（步骤、抽题池一类的场景靠它），但这里的资源篮只列题目 ——
   若在这里调 `clear()`，用户看不见的资源会被一起清掉，属于静默丢东西。故只清题目。 */

const ATTACHMENT_KIND_TEXT: Record<MediaKind, string> = { image: '图片', animation: '小程序', video: '视频' }

/** 组卷车里尚未并入本卷的资源（按 类型+id 去重，重复点「并入」不会攒出重复项） */
const pendingAttachments = computed(() => {
  const have = new Set(attachments.value.map((row) => `${row.kind}-${row.mediaId}`))
  return basket.resources.value.filter((row) => !have.has(`${row.kind}-${row.id}`))
})

function mergeBasketAttachments() {
  const added = pendingAttachments.value.map((row) => ({
    mediaId: row.id,
    kind: row.kind,
    name: row.name,
    sizeMb: row.sizeMb,
  }))
  if (!added.length) {
    showToast('组卷车里的参考资料都已在卷中', 'error')
    return
  }
  attachments.value = [...attachments.value, ...added]
  showToast(`已并入 ${added.length} 个参考资料，保存试卷后生效`, 'success')
}

function removeAttachment(row: PaperAttachment) {
  attachments.value = attachments.value.filter((item) => !(item.kind === row.kind && item.mediaId === row.mediaId))
}

/* ================= 版本记录（协同组卷才有） ================= */

const versions = ref<Awaited<ReturnType<typeof fetchPaperVersions>>>([])
const versionOpen = ref(false)
const replaceNote = ref('')
const replaceTarget = ref<number | null>(null)

async function loadVersions() {
  if (!form.id) return
  try {
    versions.value = await fetchPaperVersions(form.id)
  } catch {
    versions.value = []
  }
}

async function onRestore(versionId: number) {
  try {
    const { paper: next, versions: list } = await restorePaperVersion({ paperId: form.id, versionId })
    sections.value = JSON.parse(JSON.stringify(next.sections)) as PaperSection[]
    versions.value = list
    commit('撤销到历史版本')
    showToast('已撤销到所选版本（撤销动作本身也记为一版）', 'success')
  } catch (error) {
    showToast(error instanceof Error ? error.message : '撤销失败', 'error')
  }
}

async function onReplace() {
  if (replaceTarget.value == null) return
  try {
    const { paper: next, versions: list } = await replacePaperVersion({
      paperId: form.id,
      versionId: replaceTarget.value,
      note: replaceNote.value,
    })
    sections.value = JSON.parse(JSON.stringify(next.sections)) as PaperSection[]
    versions.value = list
    commit('以历史版本替换当前卷面')
    replaceTarget.value = null
    replaceNote.value = ''
    showToast('已用所选版本替换当前卷面', 'success')
    nextTick(scheduleMeasure)
  } catch (error) {
    showToast(error instanceof Error ? error.message : '替换失败', 'error')
  }
}

/* ================= 保存 / 预览 ================= */

const previewOpen = ref(false)
const previewInitial = reactive({ opened: false })

function validate(): boolean {
  if (form.name.trim().length < 2 || form.name.trim().length > 50) {
    showToast('试卷名称须为 2-50 字', 'error')
    return false
  }
  if (totalCount.value === 0) {
    showToast('试卷至少需要 1 道题目', 'error')
    return false
  }
  return true
}

async function save(submit = false) {
  if (!validate()) return
  saving.value = true
  try {
    const saved = await savePaper({
      id: form.id || undefined,
      name: form.name.trim(),
      subject: form.subject,
      grade: form.grade,
      duration: form.duration,
      sections: JSON.parse(JSON.stringify(sections.value)) as PaperSection[],
      /* 随卷参考资料：显式传数组（空数组 = 清空），不传的话 savePaper 会保留原值 */
      attachments: JSON.parse(JSON.stringify(attachments.value)) as PaperAttachment[],
      /* 卷面附加区块（表格 / 四线格 / 横线）同上：`[]` = 这次把它们全删了 */
      extras: JSON.parse(JSON.stringify(extras.value)) as PaperExtra[],
      /* 注意事项：空数组是「老师把这一块删了」，不能省成 undefined —— 那会被当成「没配过」印回默认稿 */
      notices: notices.value,
      submit,
    })
    form.id = saved.id
    meta.status = saved.status
    ownPaperIds.value = [...ownPaperIds.value, saved.id]
    showToast(submit ? '已提交：AI 九项检测通过后推送人工审核' : '试卷已保存', 'success')
    await loadVersions()
    commit('保存到试卷库')
    if (submit) router.push('/paper/list')
  } catch (error) {
    showToast(error instanceof Error ? error.message : '保存失败', 'error')
  } finally {
    saving.value = false
  }
}

/* 顶栏原先的「导出 / 打印 / 卷面版本」三个控件已移除 —— 它们是**重复入口**：
   导出 Word / PDF 与「学生版 / 教师版 / 纯答案」这套参数，预览弹窗（PaperPreviewModal）
   里本来就有一整套，而预览正是从本页顶栏进的。
   页面底部的 `@media print` 与 `body.pe-print-open` 仍然保留：那是给浏览器自带的
   Ctrl/⌘+P 用的（类只在编辑页挂载，其它页面打印不受影响），与顶栏有没有按钮无关。 */

/** 全文设置 → 预览的初始值：点预览时不该把刚设好的版式重置掉 */
const previewSize = computed(() => sizeKey.value)
const previewLayout = computed(() => layoutKey.value)

function openCollab() {
  if (!form.id) {
    showToast('请先保存试卷，再发起协同组卷', 'error')
    return
  }
  if (currentTask.value) {
    router.push(`/paper/collab/task?id=${currentTask.value.id}`)
    return
  }
  router.push(`/paper/collab?paperId=${form.id}`)
}

async function refreshQuestions() {
  questions.value = await fetchQuestions()
}

/* ================= 生命周期 ================= */

async function load() {
  loading.value = true
  const id = Number(route.query.id ?? 0)
  try {
    await ensure()
    const [questionRows, paperRows, tasks] = await Promise.all([fetchQuestions(), fetchPapers(), fetchCollabTasks()])
    questions.value = questionRows
    ownPaperIds.value = paperRows.map((row) => row.id)
    collabTasks.value = tasks
    const source = paperRows.find((row) => row.id === id)
    if (!source) {
      showToast('试卷不存在或已删除', 'error')
      router.replace('/paper/list')
      return
    }
    form.id = source.id
    form.name = source.name
    form.subject = pick(subjects.value, source.subject)
    form.grade = pick(grades.value, source.grade)
    form.duration = source.duration
    meta.owner = source.owner
    meta.sharedSquare = source.sharedSquare
    meta.status = source.status
    sections.value = JSON.parse(JSON.stringify(source.sections)) as PaperSection[]
    attachments.value = JSON.parse(JSON.stringify(source.attachments ?? [])) as PaperAttachment[]
    extras.value = JSON.parse(JSON.stringify(source.extras ?? [])) as PaperExtra[]
    /* 自增源从既有区块的最大 id 之后接着发号：否则新插入的块会和已有的撞 id，
       blockMap 里同 key 的块互相顶替，选中与高度就全乱了 */
    extraSeq = Math.max(0, ...extras.value.map((row) => row.id)) + 1
    /* 没配过注意事项的卷子（`undefined`）用默认稿**回填输入框**：卷面上印着默认稿、
       面板里却是空的，老师会以为设置没生效。存过的（含空数组）原样带出。 */
    noticesDraft.value = (source.notices ?? DEFAULT_PAPER_NOTICES).join('\n')
    sectionSeq = Math.max(...sections.value.map((row) => row.id), 0) + 1
    /* 撤销栈需要一个起点：把「刚打开时」的卷面记为第一版，否则第一次撤销是空的 */
    snapshots.value = []
    pointer.value = -1
    commit('打开试卷')
    await loadVersions()
    await nextTick()
    scheduleMeasure()
  } finally {
    loading.value = false
  }
}

function onKeydown(event: KeyboardEvent) {
  const meta2 = event.metaKey || event.ctrlKey
  if (meta2 && event.key.toLowerCase() === 'z') {
    event.preventDefault()
    if (event.shiftKey) redo()
    else undo()
  }
  if (meta2 && event.key.toLowerCase() === 's') {
    event.preventDefault()
    void save(false)
  }
}

let resizeObserver: ResizeObserver | null = null
let bodyOverflow = ''

onMounted(async () => {
  document.addEventListener('keydown', onKeydown)
  bodyOverflow = document.body.style.overflow
  document.body.style.overflow = 'hidden'
  document.body.classList.add('pe-print-open')
  await load()
  if (panelRail.value === 'media') void loadMedia()
  if (canvas.value) {
    canvasW.value = canvas.value.clientWidth
    resizeObserver = new ResizeObserver(() => {
      canvasW.value = canvas.value?.clientWidth ?? canvasW.value
      if (autoFit.value) zoom.value = fitZoom()
    })
    resizeObserver.observe(canvas.value)
  }
  zoom.value = fitZoom()
  document.fonts?.ready.then(scheduleMeasure).catch(() => {})
})

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown)
  document.body.style.overflow = bodyOverflow
  document.body.classList.remove('pe-print-open')
  resizeObserver?.disconnect()
  if (frame) cancelAnimationFrame(frame)
})

async function loadMedia() {
  if (media.value.length) return
  media.value = await fetchMedia()
}

/* 卷面（或纸张 / 版式 / 页眉样式）一变就要重新量块高 —— 块高决定分页。
   **但这里绝不能把 `measured` 打回 false**：那会让下面的 `v-for="sheet in measured ? sheets : []"`
   在一帧之内把整叠纸页卸载掉，画布里只剩「正在按…纸面排版」那一行，滚动容器的内容高度瞬间塌掉，
   浏览器的 scrollTop 被钳回 0 —— 用户看到的就是「在工具条里改个分值，画布自己弹回顶部」。
   宁可让旧高度多撑一帧（分页下一帧 rAF 量完就自正），也不要把滚动位置弄丢。 */
watch([paperBlocks, () => `${geo.value.panelW}|${preset.value.key}|${preset.value.headStyle}`], () => {
  nextTick(scheduleMeasure)
})
watch([geo, canvasW, autoFit], () => {
  if (autoFit.value) zoom.value = fitZoom()
})
watch(panelRail, (value) => {
  if (value === 'media') void loadMedia()
})

const RAIL = [
  { key: 'settings', label: '全文设置', icon: 'sliders' },
  { key: 'bank', label: '试题库', icon: 'edit' },
  { key: 'media', label: '媒体库', icon: 'image' },
  { key: 'basket', label: '资源篮', icon: 'cart' },
  { key: 'import', label: '导入文档', icon: 'upload' },
  { key: 'history', label: '历史记录', icon: 'clock' },
] as const

const outlineRows = computed(() =>
  sections.value.map((section, si) => ({
    si,
    title: section.title,
    count: section.questions.length,
    score: section.questions.reduce((sum, row) => sum + (Number(row.score) || 0), 0),
  })),
)

function scrollToBlock(key: string) {
  document.querySelector(`[data-block="${key}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
}

function mmOf(px: number): number {
  return Math.round(px / (96 / 25.4))
}
</script>

<template>
  <div class="pe-shell">
    <!-- ===== 顶部：卷名 + 主操作 ===== -->
    <header class="pe-head">
      <div class="pe-title-wrap">
        <input v-model="form.name" class="pe-title" maxlength="50" placeholder="试卷名称（2-50 字）" />
        <div class="pe-title-meta">
          <span>{{ form.subject }} · {{ form.grade }} · {{ totalCount }} 题 · {{ totalScore }} 分 · {{ form.duration }} 分钟</span>
          <span class="pe-owner">出卷人 {{ meta.owner }}</span>
          <span v-if="currentTask" class="tag tag-blue">协同组卷 · {{ currentTask.members.length }} 人</span>
        </div>
      </div>

      <!-- 顶栏只留「这一页独有、别处进不去」的动作：
           撤销/重做下面工具条里有，导出/打印/卷面版本在预览弹窗里有（那里本来就是导出的发起点），
           返回也没必要 —— 本页是别人的新标签页，关掉即可。 -->
      <div class="pe-head-ops">
        <button class="btn btn-ghost btn-sm" type="button" @click="openCollab">
          <AppIcon name="users" :size="14" /> {{ currentTask ? '协同任务' : '协同组卷' }}
        </button>
        <button class="btn btn-ghost btn-sm" type="button" @click="previewOpen = true">
          <AppIcon name="eye" :size="14" /> 预览
        </button>
        <button class="btn btn-primary btn-sm" type="button" :disabled="saving" @click="save(false)">
          {{ saving ? '保存中…' : '保存' }}
        </button>
      </div>
    </header>

    <!-- ===== 工具栏（对标 Word 式功能条：插入 / 视图） =====
         刻意不再摆「版式 / 纸张 / 方向」：那三项是**卷级**设置，全文设置面板与底部版式条里
         都已经有了，工具栏再放一份，改完不知道以哪一处为准。这里只留随手要用的动作。
         「目录」开关也不在这里 —— 它挪到了左边框上（见 .pe-outline-tab）。 -->
    <div class="pe-toolbar">
      <div class="pe-tool-group">
        <button class="pe-tool" type="button" :disabled="!canUndo" @click="undo"><AppIcon name="undo" :size="14" /> 撤销</button>
        <button class="pe-tool" type="button" :disabled="!canRedo" @click="redo"><AppIcon name="redo" :size="14" /> 重做</button>
      </div>
      <span class="pe-tool-sep" />
      <div class="pe-tool-group">
        <!-- 表格 / 四线格 / 横线：格型会越加越多，用下拉而不是平铺三个按钮 -->
        <AppDropdownMenu :items="extraItems" align="left" :width="186" @select="insertExtra">
          <button class="pe-tool" type="button">
            <AppIcon name="grid" :size="14" /> 插入格子 <AppIcon name="chevron-down" :size="12" />
          </button>
        </AppDropdownMenu>
        <button class="pe-tool" type="button" @click="panelRail = panelRail === 'bank' ? '' : 'bank'">
          <AppIcon name="plus" :size="14" /> 插入题目
        </button>
        <button class="pe-tool" type="button" @click="addSection"><AppIcon name="list-ol" :size="14" /> 插入大题</button>
        <button
          class="pe-tool"
          type="button"
          :disabled="!sections.length"
          @click="panelRail = 'import'"
        >
          <AppIcon name="upload" :size="14" /> 导入文档
        </button>
      </div>
      <span class="pe-tool-sep" />
      <div class="pe-tool-group">
        <span class="pe-tool-label">缩放</span>
        <div class="pe-seg pe-zoom-seg">
          <button type="button" title="缩小" @click="nudgeZoom(-0.1)"><AppIcon name="minus" :size="13" /></button>
          <!-- 数字可手输：`%` 单独一个 span，才能和数字在同一行里上下居中对齐 -->
          <label class="pe-zoom-cell" title="可直接输入百分比">
            <input :value="zoomText" inputmode="numeric" aria-label="缩放百分比" @change="onZoomInput" />
            <span>%</span>
          </label>
          <button type="button" title="放大" @click="nudgeZoom(0.1)"><AppIcon name="plus" :size="13" /></button>
        </div>
        <button class="pe-tool" type="button" :class="{ on: autoFit }" @click="autoFit = true">适应</button>
      </div>
      <div class="pe-tool-group pe-tool-right">
        <span class="pe-tool-hint">共 {{ sheets.length }} 页 · 一面 {{ geo.panels }} 版</span>
      </div>
    </div>

    <div class="pe-body">
      <!-- 目录开关：钉在左边框上的竖把手，只在目录**收起**时露出来。
           展开后由目录自带的「收起」按钮接管 —— 同一时刻只有一个开关，
           不会出现「两个都能点、点了还不知道会怎样」的重复入口。 -->
      <button v-if="!outlineOpen" class="pe-outline-tab" type="button" title="展开目录" @click="outlineOpen = true">
        <AppIcon name="list-ul" :size="14" />
        <span>目录</span>
      </button>

      <!-- ===== 左：目录（大纲） ===== -->
      <aside v-if="outlineOpen" class="pe-outline">
        <div class="pe-outline-head">
          <span>目录</span>
          <button class="pe-icon-btn" type="button" title="收起" @click="outlineOpen = false">
            <AppIcon name="close" :size="13" />
          </button>
        </div>
        <button class="pe-ol-row" type="button" @click="scrollToBlock('p-head')">
          <AppIcon name="file" :size="13" /> 卷头与注意事项
        </button>
        <div v-for="row in outlineRows" :key="row.si" class="pe-ol-group">
          <button class="pe-ol-row strong" type="button" @click="scrollToBlock(`p-s-${row.si}`)">
            {{ row.title }}
            <em>{{ row.count }} 题 / {{ row.score }} 分</em>
          </button>
          <button
            v-for="(entry, qi) in sections[row.si].questions"
            :key="qi"
            class="pe-ol-sub"
            type="button"
            @click="scrollToBlock(`p-q-${row.si}-${qi}`)"
          >
            第 {{ qi + 1 }} 题 · {{ itemOf(entry.questionId)?.type ?? '未知' }} · {{ entry.score }} 分
          </button>
        </div>
        <!-- 附加区块列在最后：卷面上它们也排在各答题区之后，目录顺序跟卷面一致 -->
        <button
          v-for="row in extras"
          :key="row.id"
          class="pe-ol-row"
          type="button"
          @click="scrollToBlock(`p-extra-${row.id}`)"
        >
          <AppIcon :name="extraIconOf(row.kind)" :size="13" /> {{ extraTextOf(row.kind) }}
          <em v-if="row.kind === 'table'">{{ row.rows }} × {{ row.cols }}</em>
          <em v-else>{{ row.rows }} 行</em>
        </button>
        <p class="pe-outline-tip">点击目录可定位到卷面对应位置</p>
      </aside>

      <!-- ===== 中：纸面画布 =====
           两级结构：上面那条块工具条是**钉死的**（不随纸面滚动），下面 .pe-canvas 才是滚动区。
           原先工具条在画布内部用 `position: sticky`，于是它既被纸页滚动拖着走、又参与内容重排 ——
           在工具条里改个分值，卷面重新分版、整叠纸页卸载重建，滚动位置就被一起带走了。
           拆成兄弟节点后，滚动只发生在下方，工具条的高度变化也再也影响不到画布的滚动几何。 -->
      <div class="pe-stage">
        <!-- 块工具条：选中块的即时操作 -->
        <div v-if="selected" class="pe-blockbar">
          <template v-if="selected.kind === 'head'">
            <span class="pe-bb-label">卷头</span>
            <input v-model="form.subject" class="f-input pe-bb-input" style="width: 96px" placeholder="学科" list="pe-subjects" />
            <datalist id="pe-subjects">
              <option v-for="s in subjects" :key="s" :value="s" />
            </datalist>
            <input v-model="form.grade" class="f-input pe-bb-input" style="width: 90px" placeholder="年级" list="pe-grades" />
            <datalist id="pe-grades">
              <option v-for="g in grades" :key="g" :value="g" />
            </datalist>
            <input v-model.number="form.duration" type="number" min="10" max="300" class="f-input pe-bb-input" style="width: 76px" />
            <span class="pe-bb-hint">分钟</span>
          </template>

          <!-- 附加区块：行列数就地改。只有表格有列数，四线格与横线都是通栏 -->
          <template v-else-if="selectedExtra">
            <span class="pe-bb-label">{{ selectedExtraText }}</span>
            <input
              type="number"
              min="1"
              max="40"
              class="f-input pe-bb-input"
              style="width: 70px"
              :value="selectedExtra.rows"
              @change="setExtraSize('rows', Number(($event.target as HTMLInputElement).value))"
            />
            <span class="pe-bb-hint">行</span>
            <template v-if="selectedExtra.kind === 'table'">
              <input
                type="number"
                min="1"
                max="40"
                class="f-input pe-bb-input"
                style="width: 70px"
                :value="selectedExtra.cols"
                @change="setExtraSize('cols', Number(($event.target as HTMLInputElement).value))"
              />
              <span class="pe-bb-hint">列</span>
            </template>
            <button class="mini-btn danger" type="button" @click="removeExtra">删除此块</button>
          </template>

          <template v-else-if="selected.kind === 'section' && selectedSection">
            <span class="pe-bb-label">大题标题</span>
            <input
              class="f-input pe-bb-input"
              style="width: 220px"
              :value="selectedSection.title"
              @change="renameSection(selected.si, ($event.target as HTMLInputElement).value)"
            />
            <span class="pe-bb-hint">{{ selectedSection.questions.length }} 题</span>
            <input
              type="number"
              min="0.5"
              max="100"
              step="0.5"
              class="f-input pe-bb-input"
              style="width: 74px"
              placeholder="每题分"
              @change="applySectionScore(selected.si, Number(($event.target as HTMLInputElement).value))"
            />
            <span class="pe-bb-hint">统一分值</span>
            <button class="pe-bb-btn" type="button" @click="moveSection(selected.si, -1)">上移</button>
            <button class="pe-bb-btn" type="button" @click="moveSection(selected.si, 1)">下移</button>
            <button class="pe-bb-btn danger" type="button" @click="removeSection(selected.si)">删除大题</button>
          </template>

          <template v-else-if="selected.kind === 'material' && selectedSection">
            <span class="pe-bb-label">大题材料</span>
            <input
              class="f-input pe-bb-input"
              style="width: 180px"
              placeholder="作答提示，如「阅读下面的文字，完成 1～3 题。」"
              :value="selectedSection.materialHint ?? ''"
              @change="selectedSection.materialHint = ($event.target as HTMLInputElement).value"
            />
            <button class="pe-bb-btn" type="button" @click="panelRail = panelRail === '' ? 'settings' : panelRail">在右侧编辑正文</button>
          </template>

          <template v-else-if="selected.kind === 'question' && selectedQuestion">
            <span class="pe-bb-label">第 {{ selected.qi + 1 }} 题</span>
            <span class="tag tag-gray">{{ selectedQuestion.item?.type ?? '未知' }}</span>
            <span class="tag tag-gray">{{ selectedQuestion.item?.difficulty ?? '—' }}</span>
            <input
              type="number"
              min="0.5"
              max="100"
              step="0.5"
              class="f-input pe-bb-input"
              style="width: 74px"
              :value="selectedQuestion.score"
              @change="setScore(selected.si, selected.qi, Number(($event.target as HTMLInputElement).value))"
            />
            <span class="pe-bb-hint">分</span>
            <button class="pe-bb-btn" type="button" @click="moveQuestion(selected.si, selected.qi, -1)">上移</button>
            <button class="pe-bb-btn" type="button" @click="moveQuestion(selected.si, selected.qi, 1)">下移</button>
            <button class="pe-bb-btn" type="button" @click="moveQuestionAcross(selected.si, selected.qi, -1)">并入上一大题</button>
            <button class="pe-bb-btn" type="button" title="同知识点 / 题型 / 难度替换" @click="onSwap">换一题</button>
            <button class="pe-bb-btn danger" type="button" @click="removeQuestion(selected.si, selected.qi)">移除</button>
          </template>
        </div>

        <div ref="canvas" class="pe-canvas">
          <div v-if="loading" class="pe-empty">正在载入试卷…</div>
          <div v-else-if="totalCount === 0 && !sections.length" class="pe-empty">该试卷还没有大题</div>
          <div v-else-if="!measured" class="pe-empty">正在按 {{ size.name }} 纸面排版…</div>

          <div v-for="sheet in measured ? sheets : []" :key="sheet.key" class="pe-page">
            <div class="pe-page-tag">第 {{ sheet.index }} 页 / 共 {{ sheet.total }} 页</div>
            <div class="pe-sheet-wrap" :style="sheetWrapStyle">
              <div class="pe-sheet" :style="sheetStyle">
                <div v-if="preset.headStyle === 'seal'" class="pe-seal">
                  <span>姓名＿＿＿＿＿ 班级＿＿＿＿＿ 考号＿＿＿＿＿ 密封线内不要答题</span>
                </div>
                <div class="pe-body-inner" :style="bodyStyle">
                  <div class="pe-panels" :class="{ 'is-multi': geo.panels > 1 }">
                    <div v-for="(panel, pi) in sheet.pages" :key="pi" class="pe-panel">
                      <template v-for="(row, ri) in panel.rows" :key="ri">
                        <div
                          v-if="row.kind === 'full'"
                          class="pe-row"
                          :class="{ 'is-sel': isSelectedKey(row.block.key) }"
                          :data-block="row.block.key"
                          @click="selectKey(row.block.key)"
                        >
                          <PaperBlock :block="row.block" :paper="paper" :questions="questions" :preset="preset" :teacher="false" />
                        </div>
                        <div v-else class="pe-row pe-cols" :style="{ gap: `${colGap}px` }">
                          <div v-for="(col, ci) in [row.left, row.right]" :key="ci" class="pe-col">
                            <div
                              v-for="block in col"
                              :key="block.key"
                              class="pe-col-block"
                              :class="{ 'is-sel': isSelectedKey(block.key) }"
                              :data-block="block.key"
                              @click="selectKey(block.key)"
                            >
                              <PaperBlock :block="block" :paper="paper" :questions="questions" :preset="preset" :teacher="false" />
                            </div>
                          </div>
                        </div>
                      </template>
                    </div>
                  </div>
                </div>
                <div v-if="preset.pageNumber" class="pe-foot">第 {{ sheet.index }} 页 · 共 {{ sheet.total }} 页</div>
              </div>
            </div>
          </div>

          <!-- 隐藏测量层：与纸面同组件同变量同宽度 -->
          <div ref="measureHost" class="pe-measure" :style="vars">
            <div
              v-for="block in paperBlocks"
              :key="block.key"
              class="pe-measure-item"
              :data-block-key="block.key"
              :style="{ width: measureWidth(block) }"
            >
              <PaperBlock :block="block" :paper="paper" :questions="questions" :preset="preset" :teacher="false" />
            </div>
          </div>
        </div>
      </div>

      <!-- ===== 右：面板 + 图标竖栏 ===== -->
      <aside v-if="panelRail" class="pe-side">
        <template v-if="panelRail === 'settings'">
          <div class="pe-side-head">
            <h3>全文设置</h3>
            <button class="pe-icon-btn" type="button" @click="panelRail = ''"><AppIcon name="close" :size="13" /></button>
          </div>
          <div class="pe-side-body">
            <div class="pe-field">
              <label>排版样式</label>
              <div class="pe-style-list">
                <button
                  v-for="row in PAPER_LAYOUTS"
                  :key="row.key"
                  class="pe-style"
                  :class="{ on: layoutKey === row.key }"
                  type="button"
                  @click="layoutKey = row.key"
                >
                  <span class="pe-style-name">
                    {{ row.name }}
                    <AppIcon v-if="layoutKey === row.key" name="check" :size="12" />
                  </span>
                  <span class="pe-style-desc">{{ row.desc }}</span>
                  <span class="pe-style-tags">
                    <i>{{ row.fontSize }}px</i>
                    <i>{{ row.optionColumns === 2 ? '选项双列' : '选项单列' }}</i>
                    <i v-if="row.twoColumn && geo.panels === 1">双栏</i>
                  </span>
                </button>
              </div>
            </div>

            <div class="pe-field">
              <label>纸张</label>
              <select v-model="sizeKey" class="f-select">
                <option v-for="row in PAPER_SIZES" :key="row.key" :value="row.key">{{ row.name }}（{{ row.mm }}）· {{ row.note }}</option>
              </select>
            </div>

            <div class="pe-field row2">
              <div>
                <label>方向</label>
                <div class="pe-seg full">
                  <button type="button" :class="{ on: orientation === 'portrait' }" @click="orientation = 'portrait'">纵向</button>
                  <button type="button" :class="{ on: orientation === 'landscape' }" @click="orientation = 'landscape'">横向</button>
                </div>
              </div>
              <div>
                <label>一面版数</label>
                <select v-model.number="panelPick" class="f-select">
                  <option :value="0">自动（{{ size.panels }} 版）</option>
                  <option :value="1">1 版</option>
                  <option :value="2">2 版</option>
                  <option :value="3">3 版</option>
                </select>
              </div>
            </div>

            <div class="pe-field row2">
              <div>
                <label>卷首样式</label>
                <select v-model="headOverride" class="f-select">
                  <option value="">跟随版式（{{ presetOf(layoutKey).headStyle === 'seal' ? '密封线' : presetOf(layoutKey).headStyle === 'form' ? '表格式' : '简洁' }}）</option>
                  <option value="simple">简洁</option>
                  <option value="form">表格式</option>
                  <option value="seal">密封线</option>
                </select>
              </div>
              <div>
                <label>分值位置</label>
                <select v-model="scoreOverride" class="f-select">
                  <option value="">跟随版式</option>
                  <option value="inline">紧跟题号</option>
                  <option value="trail">题干末尾</option>
                </select>
              </div>
            </div>

            <!-- 卷首注意事项：卷面上印在卷头正下方的那一块，一行一条。空着就不印 -->
            <div class="pe-field">
              <label>卷首注意事项</label>
              <textarea
                v-model="noticesDraft"
                class="f-textarea"
                rows="4"
                placeholder="一行一条，卷面按 1．2．3． 顺序印在卷头下方；全部清空则卷面不再印这一块"
              />
              <p class="f-hint">一行一条，同一条内不要换行。清空后卷面不再印这一块。</p>
              <button class="mini-btn" type="button" @click="noticesDraft = DEFAULT_PAPER_NOTICES.join('\n')">
                恢复默认说明
              </button>
            </div>

            <label class="pe-check">
              <input
                type="checkbox"
                :checked="spaceOverride === null ? preset.answerSpace : spaceOverride"
                @change="spaceOverride = ($event.target as HTMLInputElement).checked"
              />
              解答题留作答空白
            </label>

            <div class="pe-facts">
              <p><span>版心</span>每版 {{ mmOf(geo.panelW) }} mm 宽 · 版心高 {{ mmOf(geo.contentH) }} mm</p>
              <p><span>页边距</span>上 {{ preset.margin.top }} / 右 {{ preset.margin.right }} / 下 {{ preset.margin.bottom }} / 左 {{ preset.margin.left }} mm</p>
              <p><span>页数</span>共 {{ sheets.length }} 页（自动分版）</p>
              <p><span>分值</span>总分 {{ totalScore }} 分 · 客观题 {{ objectiveScore }} 分</p>
            </div>

            <p v-if="overflowBlocks.length" class="pe-warn">
              <AppIcon name="warning" :size="13" />
              有 {{ overflowBlocks.length }} 处内容高于整版（如解答题过长），会被纸面裁切；建议换更大纸张或选「紧凑省纸」样式。
            </p>

            <div v-if="selectedSection" class="pe-field">
              <label>「{{ selectedSection.title }}」材料正文</label>
              <textarea
                class="f-textarea"
                rows="6"
                placeholder="阅读材料 / 文言文 / 英语短文（本大题各小题共用，空行分段）"
                :value="selectedSection.material ?? ''"
                @change="updateMaterial(($event.target as HTMLTextAreaElement).value)"
              />
              <p class="f-hint">先在卷面点选大题或材料块，再在这里编辑正文。</p>
            </div>
          </div>
        </template>

        <template v-else-if="panelRail === 'bank'">
          <div class="pe-side-head">
            <h3>试题库</h3>
            <button class="pe-icon-btn" type="button" @click="panelRail = ''"><AppIcon name="close" :size="13" /></button>
          </div>
          <div class="pe-side-body">
            <div class="pe-filters">
              <select v-model="bankFilter.type" class="f-select">
                <option value="">全部题型</option>
                <!-- 题型随试卷学科收窄（英语才有完形填空 / 七选五 / 短文改错）；已选值并入，换学科不会渲染成空白 -->
                <option v-for="t in withCurrent(questionTypesFor(form.subject), bankFilter.type)" :key="t" :value="t">{{ t }}</option>
              </select>
              <select v-model="bankFilter.difficulty" class="f-select">
                <option value="">全部难度</option>
                <option v-for="d in difficulties" :key="d" :value="d">{{ d }}</option>
              </select>
            </div>
            <input v-model="bankFilter.keyword" class="f-input" placeholder="搜索题干关键词" style="margin-bottom: 10px" />
            <p class="f-hint" style="margin-bottom: 8px">仅显示已入库题目 · 共 {{ bankPool.length }} 道</p>
            <div class="pe-bank-list">
              <div v-for="row in bankPool" :key="row.id" class="pe-bank-card">
                <div class="pe-bank-meta">
                  <span class="tag tag-gray">{{ row.type }}</span>
                  <span class="tag tag-gray">{{ row.difficulty }}</span>
                  <span v-if="row.grade" class="tag tag-gray">{{ row.grade }}</span>
                </div>
                <p class="pe-bank-stem">{{ truncateRich(row.stem, 70) }}</p>
                <div class="pe-bank-foot">
                  <span class="f-hint">{{ row.knowledge[0] ?? '' }}</span>
                  <button class="mini-btn" :disabled="inPaperIds.has(row.id)" @click="addQuestion(row)">
                    {{ inPaperIds.has(row.id) ? '已在卷中' : '+ 加入试卷' }}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </template>

        <template v-else-if="panelRail === 'media'">
          <div class="pe-side-head">
            <h3>媒体库</h3>
            <button class="pe-icon-btn" type="button" @click="panelRail = ''"><AppIcon name="close" :size="13" /></button>
          </div>
          <div class="pe-side-body">
            <p class="f-hint" style="margin-bottom: 10px">
              机构媒体库资源。题干配图请在录题中心编辑题目正文时插入（题目正文支持公式与插图）。
            </p>
            <div class="pe-media-grid">
              <button v-for="row in media" :key="row.id" class="pe-media" type="button" @click="mediaOpen = row">
                <div class="pe-media-thumb">
                  <img v-if="row.kind === 'image' && row.url" :src="row.url" :alt="row.name" />
                  <AppIcon v-else :name="row.kind === 'video' ? 'image' : 'smartphone'" :size="18" />
                </div>
                <span class="pe-media-name">{{ truncateRich(row.name, 12) }}</span>
                <span class="pe-media-kind">{{ row.kind === 'image' ? '图片' : row.kind === 'video' ? '视频' : '动画' }}</span>
              </button>
            </div>
            <p v-if="!media.length" class="f-hint">媒体库暂无资源</p>
          </div>
        </template>

        <template v-else-if="panelRail === 'basket'">
          <div class="pe-side-head">
            <h3>资源篮（组卷车）</h3>
            <button class="pe-icon-btn" type="button" @click="panelRail = ''"><AppIcon name="close" :size="13" /></button>
          </div>
          <div class="pe-side-body">
            <div class="pe-basket-bar">
              <span>{{ basket.count.value }} 题 · {{ basket.scoreTotal.value }} 分</span>
              <div class="op-group">
                <button class="mini-btn" :disabled="!basket.count.value" @click="basketAddAll">全部加入试卷</button>
                <!-- 只清题目：这个面板看不见资源，全清会把用户没看到的东西一起丢掉 -->
                <button class="mini-btn danger" :disabled="!basket.count.value" @click="basket.clear('questions')">清空题目</button>
              </div>
            </div>
            <p v-if="!basket.count.value" class="f-hint">
              组卷车是空的。可先在「题库组卷」工作台把题目加入组卷车，再回到这里一次性并入本卷。
            </p>
            <div v-for="entry in basket.entries.value" :key="entry.questionId" class="pe-basket-row">
              <div>
                <p class="pe-bank-stem">{{ truncateRich(itemOf(entry.questionId)?.stem ?? `题目 #${entry.questionId}`, 54) }}</p>
                <span class="f-hint">{{ itemOf(entry.questionId)?.type ?? '' }} · {{ entry.score }} 分</span>
              </div>
              <div class="op-group">
                <button class="mini-btn" :disabled="inPaperIds.has(entry.questionId)" @click="basketAddOne(entry.questionId)">加入</button>
                <button class="mini-btn danger" @click="basket.remove(entry.questionId)">移除</button>
              </div>
            </div>

            <!-- 参考资料：图片 / 视频 / 小程序，随卷保存（不参与卷面排版） -->
            <div class="pe-basket-bar pe-att-bar">
              <span>参考资料 {{ attachments.length }} 个</span>
              <div class="op-group">
                <button class="mini-btn" :disabled="!pendingAttachments.length" @click="mergeBasketAttachments">
                  并入本卷{{ pendingAttachments.length ? ` (${pendingAttachments.length})` : '' }}
                </button>
              </div>
            </div>
            <p v-if="!attachments.length" class="f-hint">
              还没有参考资料。在「题库组卷」工作台的图片 / 视频 / 小程序页签里加入组卷车，再回这里并入。
            </p>
            <div v-for="row in attachments" :key="`${row.kind}-${row.mediaId}`" class="pe-basket-row">
              <div>
                <p class="pe-bank-stem">{{ row.name }}</p>
                <span class="f-hint">{{ ATTACHMENT_KIND_TEXT[row.kind] }} · {{ row.sizeMb.toFixed(1) }} MB</span>
              </div>
              <div class="op-group">
                <button class="mini-btn danger" @click="removeAttachment(row)">移出</button>
              </div>
            </div>
          </div>
        </template>

        <template v-else-if="panelRail === 'import'">
          <div class="pe-side-head">
            <h3>导入文档</h3>
            <button class="pe-icon-btn" type="button" @click="panelRail = ''"><AppIcon name="close" :size="13" /></button>
          </div>
          <div class="pe-side-body">
            <p class="f-hint" style="margin-bottom: 10px">
              从 Word / 网页复制题目文本粘贴到下面，按题号（或空行）自动切题并入卷。原题型、选项会一并识别。
            </p>
            <textarea v-model="importText" class="f-textarea" rows="8" placeholder="1．已知函数 f(x)=x²-2x，则……&#10;A．0  B．1  C．2  D．3&#10;&#10;2．求……" />
            <div class="pe-filters" style="margin-top: 10px">
              <select v-model="importGrade" class="f-select">
                <option value="">年级跟随试卷（{{ form.grade }}）</option>
                <option v-for="g in grades" :key="g" :value="g">{{ g }}</option>
              </select>
              <select v-model="importDifficulty" class="f-select">
                <option value="">难度：中等</option>
                <option v-for="d in difficulties" :key="d" :value="d">{{ d }}</option>
              </select>
            </div>
            <div v-if="parsed.length" class="pe-parsed">
              <p class="pe-parsed-head">解析出 {{ parsed.length }} 道题：</p>
              <div v-for="(row, i) in parsed.slice(0, 5)" :key="i" class="pe-parsed-row">
                <span class="tag tag-gray">{{ row.type }}</span>
                <span>{{ truncateRich(row.stem, 40) }}</span>
              </div>
              <p v-if="parsed.length > 5" class="f-hint">…等共 {{ parsed.length }} 道</p>
            </div>
            <button class="btn btn-primary" style="width: 100%; margin-top: 12px" type="button" :disabled="importRunning || !parsed.length" @click="runImport">
              {{ importRunning ? '导入中…' : `入库并加入试卷（${parsed.length} 道）` }}
            </button>
          </div>
        </template>

        <template v-else-if="panelRail === 'history'">
          <div class="pe-side-head">
            <h3>历史记录</h3>
            <button class="pe-icon-btn" type="button" @click="panelRail = ''"><AppIcon name="close" :size="13" /></button>
          </div>
          <div class="pe-side-body">
            <template v-if="versions.length">
              <div class="pe-side-sub">协同版本（可撤销 / 替换）</div>
              <div class="pe-timeline">
                <div v-for="row in versions.slice().reverse()" :key="row.id" class="pe-tl-row" :class="{ replaced: row.replaced }">
                  <div class="pe-tl-head">
                    <b>v{{ row.no }}</b>
                    <span>{{ row.actor }}</span>
                    <em>{{ row.time }}</em>
                  </div>
                  <p class="pe-tl-sum">{{ row.summary }}</p>
                  <p class="f-hint">{{ row.questionCount }} 题 · {{ row.totalScore }} 分<template v-if="row.note"> · 备注：{{ row.note }}</template></p>
                  <div class="op-group">
                    <button class="mini-btn" @click="onRestore(row.id)">撤销到此版</button>
                    <button class="mini-btn" @click="replaceTarget = row.id">替换当前</button>
                  </div>
                </div>
              </div>
            </template>

            <div class="pe-side-sub">本次编辑（点击回退）</div>
            <div class="pe-timeline">
              <button
                v-for="(row, i) in snapshots.slice().reverse()"
                :key="`${row.time}-${i}`"
                class="pe-tl-row as-button"
                :class="{ on: pointer === snapshots.length - 1 - i }"
                type="button"
                @click="applySnapshot(snapshots.length - 1 - i)"
              >
                <div class="pe-tl-head">
                  <b>{{ row.label }}</b>
                  <em>{{ row.time }}</em>
                </div>
              </button>
            </div>
          </div>
        </template>
      </aside>

      <nav class="pe-rail">
        <button
          v-for="item in RAIL"
          :key="item.key"
          class="pe-rail-btn"
          :class="{ on: panelRail === item.key }"
          type="button"
          :title="item.label"
          @click="panelRail = panelRail === item.key ? '' : item.key"
        >
          <AppIcon :name="item.icon" :size="17" />
          <span>{{ item.label }}</span>
        </button>
      </nav>
    </div>

    <!-- 底部样式快捷条（对标文档编辑器的段落样式条） -->
    <footer class="pe-footbar">
      <span class="pe-footbar-label">版式</span>
      <button
        v-for="row in PAPER_LAYOUTS"
        :key="row.key"
        class="pe-footstyle"
        :class="{ on: layoutKey === row.key }"
        type="button"
        @click="layoutKey = row.key"
      >
        {{ row.name }}
      </button>
      <span class="pe-footbar-right">{{ totalCount }} 题 · {{ totalScore }} 分 · 共 {{ sheets.length }} 页</span>
    </footer>

    <!-- 整卷预览：带编辑页已选定的纸张 / 版式 -->
    <PaperPreviewModal
      v-if="previewOpen"
      :paper="paper"
      :questions="questions"
      :initial-size="previewSize"
      :initial-layout="previewLayout"
      :initial-orientation="orientation"
      :initial-panels="panelPick"
      initial-mode="both"
      @close="previewOpen = false"
    />

    <!-- 媒体预览 -->
    <AppModal v-if="mediaOpen" :title="mediaOpen.name" :width="620" @close="mediaOpen = null">
      <img v-if="mediaOpen.kind === 'image' && mediaOpen.url" :src="mediaOpen.url" :alt="mediaOpen.name" style="max-width: 100%; border-radius: 10px" />
      <p v-else class="f-hint">该{{ mediaOpen.kind === 'video' ? '视频' : '动画' }}资源为演示数据，暂无可播放地址。</p>
      <p class="f-hint" style="margin-top: 10px">
        {{ mediaOpen.subject }} · {{ mediaOpen.knowledge.join('、') }} · {{ mediaOpen.sizeMb }} MB · 被引用 {{ mediaOpen.linkedCount }} 次
      </p>
      <template #footer>
        <button class="btn btn-ghost" @click="mediaOpen = null">关闭</button>
      </template>
    </AppModal>

    <!-- 替换版本：说明为什么替换，留痕给协作者看 -->
    <AppModal v-if="replaceTarget != null" title="以所选版本替换当前卷面" :width="460" @close="replaceTarget = null">
      <p class="f-hint" style="margin-bottom: 12px">
        替换后当前卷面会被该版本内容覆盖，原卷面仍保留在版本记录里（标记为「已被替换」），可再次撤销回来。
      </p>
      <div class="f-field">
        <label class="f-label">替换说明（可选）</label>
        <input v-model="replaceNote" class="f-input" placeholder="如：改用 v3 的分值方案" />
      </div>
      <template #footer>
        <button class="btn btn-ghost" @click="replaceTarget = null">取消</button>
        <button class="btn btn-primary" @click="onReplace">确认替换</button>
      </template>
    </AppModal>
  </div>
</template>

<style scoped>
.pe-shell {
  height: 100vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--bg);
}

/* ===== 顶部标题栏 ===== */
.pe-head {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 18px;
  background: #fff;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
  z-index: 30;
}
.pe-title-wrap { flex: 1; min-width: 0; }
.pe-title {
  width: 100%;
  border: none;
  background: transparent;
  font-size: 16px;
  font-weight: 700;
  color: var(--ink);
  padding: 2px 4px;
  border-radius: 7px;
}
.pe-title:hover { background: #f4f7fb; }
.pe-title:focus { outline: none; background: #fff; box-shadow: 0 0 0 2px var(--brand-soft); }
.pe-title-meta {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 12px;
  color: var(--sub);
  padding: 0 4px;
  margin-top: 2px;
}
.pe-owner { color: var(--sub); }
.pe-head-ops { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }

/* ===== 工具栏 ===== */
.pe-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 18px;
  background: #fff;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
  flex-wrap: wrap;
  z-index: 29;
}
.pe-tool-group { display: flex; align-items: center; gap: 6px; }
.pe-tool-group.pe-tool-right { margin-left: auto; }
.pe-tool-sep { width: 1px; height: 20px; background: var(--border); }
.pe-tool-label { font-size: 12px; color: var(--sub); }
.pe-tool-hint { font-size: 12px; color: var(--sub); }
.pe-tool {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 32px;
  padding: 0 10px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  font-size: 12.5px;
  color: var(--ink-2);
}
.pe-tool:hover:not(:disabled) { background: #f2f5fa; }
.pe-tool:disabled { color: #c3cad8; cursor: not-allowed; }
.pe-tool.on { background: var(--brand-soft); color: var(--brand-deep); border-color: var(--brand); }
.pe-seg { display: inline-flex; border: 1.5px solid var(--border); border-radius: 9px; overflow: hidden; background: #fff; }
.pe-seg.full { width: 100%; }
.pe-seg button {
  border: none;
  background: transparent;
  padding: 5px 11px;
  font-size: 12.5px;
  color: var(--ink-2);
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
}
.pe-seg button + button { border-left: 1px solid var(--border); }
.pe-seg button:hover { background: #f2f5fa; }
.pe-seg button.on { background: var(--brand-soft); color: var(--brand-deep); font-weight: 600; }

/* 缩放输入格：数字可手输，`%` 单独一个 span。
   两者都在 flex 行里 `align-items: center` 对齐 —— 早先把「100%」当一整块文本居中，
   数字与百分号各按自己的基线落位，看着是歪的。输入框去掉了行高与内边距，
   免得它自带的 line-height 把整格顶高。 */
.pe-zoom-seg { align-items: stretch; }
.pe-zoom-cell {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 1px;
  padding: 0 6px;
  border-left: 1px solid var(--border);
  border-right: 1px solid var(--border);
  background: #fff;
  font-size: 12.5px;
  color: var(--ink-2);
}
.pe-zoom-cell input {
  width: 30px;
  border: none;
  background: transparent;
  padding: 0;
  font: inherit;
  line-height: 1;
  color: inherit;
  text-align: right;
}
.pe-zoom-cell input:focus { outline: none; color: var(--brand-deep); font-weight: 600; }

/* ===== 主体三区 ===== */
/* relative 是给左边框上那个目录把手做定位基准 */
.pe-body { flex: 1; display: flex; min-height: 0; position: relative; }

/* 目录开关：贴在左边界上的竖把手。
   绝对定位浮在画布之上，**不占版面宽度** —— 目录收起时画布是满宽的，
   为一条开关留 30px 的白边反而更碍眼。只在目录收起时出现（v-if），
   展开后由目录自带的「收起」按钮接管，同一时刻只有一个出口。 */
.pe-outline-tab {
  position: absolute;
  left: 0;
  top: 50%;
  transform: translateY(-50%);
  z-index: 25;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 10px 5px;
  border: 1px solid var(--border);
  border-left: none;
  border-radius: 0 10px 10px 0;
  background: #fff;
  color: var(--ink-2);
  font-size: 12px;
  /* 竖排：把手窄，横排的「目录」两字会把条撑得很宽 */
  writing-mode: vertical-rl;
  letter-spacing: 2px;
  box-shadow: 2px 0 8px rgba(20, 30, 60, 0.07);
}
.pe-outline-tab:hover { color: var(--brand-deep); border-color: var(--brand); }

/* 左：目录 */
.pe-outline {
  width: 226px;
  flex-shrink: 0;
  border-right: 1px solid var(--border);
  background: #fff;
  padding: 10px;
  overflow-y: auto;
}
.pe-outline-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12.5px;
  font-weight: 700;
  color: var(--ink);
  padding: 4px 6px 8px;
}
.pe-icon-btn {
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--sub);
  display: flex;
  align-items: center;
  justify-content: center;
}
.pe-icon-btn:hover { background: #f2f5fa; color: var(--ink); }
.pe-ol-group { margin-top: 8px; }
.pe-ol-row {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  border: none;
  background: transparent;
  text-align: left;
  font-size: 13px;
  color: var(--ink-2);
  padding: 7px 8px;
  border-radius: 8px;
}
.pe-ol-row:hover { background: #f2f5fa; }
.pe-ol-row.strong { font-weight: 700; color: var(--ink); }
/* 行尾的附注（大题的「N 题 / M 分」、附加区块的「3 × 4」）：靠到最右边，不吃斜体 */
.pe-ol-row em { margin-left: auto; font-style: normal; font-size: 11px; color: var(--sub); font-weight: 400; }
.pe-ol-sub {
  display: block;
  width: 100%;
  border: none;
  background: transparent;
  text-align: left;
  font-size: 12px;
  color: var(--sub);
  padding: 4px 8px 4px 22px;
  border-radius: 7px;
}
.pe-ol-sub:hover { background: #f2f5fa; color: var(--brand-deep); }
.pe-outline-tip { font-size: 11.5px; color: var(--sub); padding: 12px 8px 0; line-height: 1.6; }

/* 中：画布。
   两级：.pe-stage 是「块工具条 + 画布」这一列，.pe-canvas 才是滚动区。
   背景色与 flex: 1 归 .pe-stage —— 工具条要铺满整个中栏宽度，不能被画布的左右内边距夹住。 */
.pe-stage {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: #eef1f6;
}
.pe-canvas {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 18px 32px 60px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 22px;
}
.pe-empty { margin: auto; font-size: 13px; color: var(--sub); }

/* 块工具条：钉在中栏顶部，**不在画布的滚动区里**（画布是下面那个 .pe-canvas）。
   早先它是画布内容里的 `position: sticky` —— 既要跟着纸页滚，又要在内容重排时跟着重排；
   结果「在工具条里改个数值 → 卷面重新分版」这一下连滚动位置一起带走了。
   现在它是 flex 列的一项、`flex-shrink: 0`，高度变化只挤压下面的画布，碰不到滚动几何。
   左右不留内边距、底边留一条描边：它是钉住的条，不是浮在纸面上的卡片。 */
.pe-blockbar {
  flex-shrink: 0;
  z-index: 20;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  background: #fff;
  border-bottom: 1px solid var(--border);
  padding: 8px 18px;
}
.pe-bb-label { font-size: 12.5px; font-weight: 700; color: var(--ink); }
.pe-bb-hint { font-size: 11.5px; color: var(--sub); }
.pe-bb-input { height: 30px !important; font-size: 12.5px !important; }
.pe-bb-btn {
  height: 28px;
  padding: 0 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: #fff;
  font-size: 12px;
  color: var(--ink-2);
}
.pe-bb-btn:hover { border-color: var(--brand); color: var(--brand-deep); }
.pe-bb-btn.danger { color: var(--danger); }
.pe-bb-btn.danger:hover { border-color: var(--danger); background: var(--danger-soft); }

.pe-page { display: flex; flex-direction: column; align-items: center; gap: 8px; }
.pe-page-tag { font-size: 11.5px; color: var(--sub); }
.pe-sheet-wrap { position: relative; }
.pe-sheet {
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
.pe-body-inner { position: relative; }
.pe-panels { display: flex; align-items: flex-start; gap: var(--pp-panel-gap); }
.pe-panel { flex: 0 0 auto; position: relative; width: var(--pp-panel-w); }
.pe-panels.is-multi .pe-panel + .pe-panel::before {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: calc(var(--pp-panel-gap) / -2);
  border-left: 1px dashed #d3d9e6;
}
.pe-row { margin-bottom: var(--pp-gap); cursor: pointer; border-radius: 4px; transition: box-shadow 0.12s; }
.pe-row:hover { box-shadow: 0 0 0 2px var(--brand-soft); }
/* 选中态用 box-shadow 而非 border：边框会改变块高，量到的高度就不再等于画出来的高度 */
.pe-row.is-sel { box-shadow: 0 0 0 2px var(--brand); }
.pe-row.pe-cols { display: flex; align-items: flex-start; margin-bottom: 0; cursor: default; box-shadow: none !important; }
.pe-col { flex: 1 1 0; min-width: 0; }
.pe-col-block { margin-bottom: var(--pp-gap); border-radius: 4px; cursor: pointer; }
.pe-col-block:hover { box-shadow: 0 0 0 2px var(--brand-soft); }
.pe-col-block.is-sel { box-shadow: 0 0 0 2px var(--brand); }

.pe-seal {
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
.pe-seal span {
  writing-mode: vertical-rl;
  font-size: 11px;
  letter-spacing: 2px;
  color: #6b7280;
  font-family: var(--pp-head-font);
  white-space: nowrap;
}
.pe-foot {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 6px;
  text-align: center;
  font-size: 11px;
  color: #6b7280;
}

/* 隐藏测量层 */
.pe-measure {
  position: fixed;
  top: 0;
  left: -20000px;
  visibility: hidden;
  pointer-events: none;
  font-family: var(--pp-font);
  color: var(--pp-accent);
}
.pe-measure-item { margin: 0 0 var(--pp-gap); }

/* 右：侧边面板（.pe-side）+ 竖栏 */
.pe-side {
  width: 312px;
  flex-shrink: 0;
  border-left: 1px solid var(--border);
  background: #fff;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.pe-side-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.pe-side-head h3 { font-size: 13.5px; font-weight: 700; }
.pe-side-body { flex: 1; overflow-y: auto; padding: 14px; }
.pe-side-sub { font-size: 12.5px; font-weight: 700; color: var(--ink); margin: 14px 0 8px; }
.pe-side-sub:first-child { margin-top: 0; }
.pe-field { margin-bottom: 14px; }
.pe-field > label { display: block; font-size: 12.5px; font-weight: 600; color: var(--ink-2); margin-bottom: 6px; }
.pe-field.row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.pe-field.row2 label { display: block; font-size: 12.5px; font-weight: 600; color: var(--ink-2); margin-bottom: 6px; }
.pe-check { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; color: var(--ink-2); margin-bottom: 14px; }
.pe-check input { accent-color: var(--brand); }
.pe-style-list { display: flex; flex-direction: column; gap: 8px; }
.pe-style {
  text-align: left;
  border: 1.5px solid var(--border);
  border-radius: 11px;
  background: #fff;
  padding: 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.pe-style:hover { border-color: var(--brand); }
.pe-style.on { border-color: var(--brand); background: var(--brand-soft); }
.pe-style-name { display: flex; align-items: center; gap: 5px; font-size: 12.5px; font-weight: 600; color: var(--ink); }
.pe-style.on .pe-style-name { color: var(--brand-deep); }
.pe-style-desc { font-size: 11.5px; color: var(--sub); line-height: 1.5; }
.pe-style-tags { display: flex; gap: 5px; flex-wrap: wrap; }
.pe-style-tags i {
  font-style: normal;
  font-size: 10.5px;
  color: var(--sub);
  border: 1px solid var(--border);
  border-radius: 5px;
  padding: 0 5px;
}
.pe-facts { display: flex; flex-direction: column; gap: 5px; font-size: 12px; color: var(--ink-2); margin-top: 6px; }
.pe-facts p { display: flex; gap: 8px; }
.pe-facts span { color: var(--sub); width: 42px; flex-shrink: 0; }
.pe-warn {
  display: flex;
  gap: 6px;
  font-size: 11.5px;
  line-height: 1.6;
  color: var(--warn);
  background: var(--warn-soft);
  border-radius: 8px;
  padding: 7px 9px;
  margin-bottom: 14px;
}
.pe-filters { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 10px; }
.pe-bank-list { display: flex; flex-direction: column; gap: 9px; }
.pe-bank-card { border: 1.5px solid var(--border); border-radius: 10px; padding: 9px 11px; background: #fff; }
.pe-bank-meta { display: flex; gap: 5px; margin-bottom: 5px; flex-wrap: wrap; }
.pe-bank-stem { font-size: 12.5px; color: var(--ink-2); line-height: 1.6; }
.pe-bank-foot { display: flex; align-items: center; justify-content: space-between; margin-top: 6px; }
.pe-media-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.pe-media {
  border: 1.5px solid var(--border);
  border-radius: 10px;
  background: #fff;
  padding: 6px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  align-items: center;
}
.pe-media:hover { border-color: var(--brand); }
.pe-media-thumb {
  width: 100%;
  height: 68px;
  border-radius: 7px;
  background: #f4f7fb;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  color: var(--sub);
}
.pe-media-thumb img { width: 100%; height: 100%; object-fit: cover; }
.pe-media-name { font-size: 11.5px; color: var(--ink-2); }
.pe-media-kind { font-size: 10.5px; color: var(--sub); }
.pe-basket-bar { display: flex; align-items: center; justify-content: space-between; font-size: 12.5px; color: var(--ink-2); margin-bottom: 10px; }
/* 参考资料一栏与上面的题目列表隔开：两类东西各自的「加入 / 移出」互不相干 */
.pe-att-bar { margin-top: 18px; padding-top: 14px; border-top: 1px solid var(--border); }
.pe-basket-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
  border-bottom: 1px dashed var(--border);
  padding: 9px 0;
}
.pe-parsed { margin-top: 10px; border: 1px dashed var(--border); border-radius: 10px; padding: 9px 11px; }
.pe-parsed-head { font-size: 12px; font-weight: 600; color: var(--ink-2); margin-bottom: 6px; }
.pe-parsed-row { display: flex; gap: 6px; font-size: 12px; color: var(--sub); line-height: 1.7; }
.pe-timeline { display: flex; flex-direction: column; gap: 8px; }
.pe-tl-row {
  border: 1.5px solid var(--border);
  border-radius: 10px;
  padding: 8px 10px;
  background: #fff;
  text-align: left;
  width: 100%;
}
.pe-tl-row.as-button:hover { border-color: var(--brand); }
.pe-tl-row.on { border-color: var(--brand); background: var(--brand-soft); }
.pe-tl-row.replaced { opacity: 0.62; }
.pe-tl-head { display: flex; align-items: center; gap: 8px; font-size: 12.5px; color: var(--ink-2); }
.pe-tl-head b { color: var(--ink); }
.pe-tl-head em { margin-left: auto; font-style: normal; font-size: 11px; color: var(--sub); }
.pe-tl-sum { font-size: 12px; color: var(--sub); line-height: 1.6; margin: 3px 0; }

.pe-rail {
  width: 76px;
  flex-shrink: 0;
  border-left: 1px solid var(--border);
  background: #fff;
  padding: 10px 6px;
  display: flex;
  flex-direction: column;
  gap: 4px;
  overflow-y: auto;
}
.pe-rail-btn {
  border: none;
  background: transparent;
  border-radius: 10px;
  padding: 9px 4px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--ink-2);
}
.pe-rail-btn:hover { background: #f2f5fa; }
.pe-rail-btn.on { background: var(--brand-soft); color: var(--brand-deep); font-weight: 600; }

/* 底部样式条 */
.pe-footbar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 7px 18px;
  background: #fff;
  border-top: 1px solid var(--border);
  flex-shrink: 0;
}
.pe-footbar-label { font-size: 12px; color: var(--sub); margin-right: 4px; }
.pe-footstyle {
  border: 1px solid var(--border);
  border-radius: 999px;
  background: #fff;
  font-size: 12px;
  color: var(--ink-2);
  padding: 4px 12px;
}
.pe-footstyle:hover { border-color: var(--brand); color: var(--brand-deep); }
.pe-footstyle.on { border-color: var(--brand); background: var(--brand-soft); color: var(--brand-deep); font-weight: 600; }
.pe-footbar-right { margin-left: auto; font-size: 12px; color: var(--sub); }
</style>

<!--
  打印：只留纸面，剥掉工具条、目录、面板、测量层与缩放变换。
  用 body.pe-print-open 兜住 —— 该类只在编辑页挂载，其它页面 Ctrl+P 不受影响。
-->
<style>
@media print {
  body.pe-print-open { overflow: visible !important; background: #fff !important; }
  body.pe-print-open > *:not(#app) { display: none !important; }

  .pe-head,
  .pe-toolbar,
  .pe-outline,
  .pe-outline-tab,
  .pe-side,
  .pe-rail,
  .pe-footbar,
  .pe-blockbar,
  .pe-page-tag,
  .pe-measure { display: none !important; }

  .pe-shell { height: auto !important; overflow: visible !important; }
  .pe-body { display: block !important; }
  .pe-stage { display: block !important; background: none !important; }
  .pe-canvas {
    display: block !important;
    overflow: visible !important;
    padding: 0 !important;
  }
  .pe-page { display: block !important; }
  .pe-sheet-wrap { width: auto !important; height: auto !important; }
  /* 这两条曾是用来绕开 .pe-panel 同名冲突的补丁：隐藏右侧栏的规则把纸面分栏
     也一起藏了，于是这里再强行显示回来。侧栏已改名 .pe-side，冲突消失，补丁删除。 */
  .pe-sheet {
    position: relative !important;
    transform: none !important;
    box-shadow: none !important;
    break-inside: avoid;
    page-break-inside: avoid;
    break-after: page;
    page-break-after: always;
  }
  .pe-page:last-child .pe-sheet { break-after: auto; page-break-after: auto; }
  .pe-row, .pe-col-block { box-shadow: none !important; }

  @page { margin: 0; }
}
</style>
