<script setup lang="ts">
/**
 * 试卷整卷预览（模拟真实纸面的弹窗）。
 *
 * 与「侧边抽屉列题目」的区别在于这里模拟的是**打印稿**：纸面按真实纸张（mm→px），
 * 8K / A3 等大纸一面印两版（先左版后右版），内容按版心宽度实测高度后自动分版；
 * 左侧可切换内置排版样式（字体 / 字号 / 栏数 / 卷头），并可切换「试卷 / 答题卡」。
 *
 * 排版流程：blocks（卷头 + 大题 + 题目）→ 隐藏测量层量高 → paginateBlocks 装箱到「版」
 *          → 按一面版数拼版成纸面 → 逐页渲染。
 * 测量层与纸面页面共用 PaperBlock 组件与同一份 --pp-* 变量，因此量到多少、画出来就是多少。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { AppIcon, showToast } from '@aiteach/shared'
import type { OrgPaper, OrgQuestion } from '@aiteach/shared'
import AppSwitch from '@/components/ui/AppSwitch.vue'
import PaperBlock from './PaperBlock.vue'
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

const props = defineProps<{ paper: OrgPaper; questions: OrgQuestion[] }>()
const emit = defineEmits<{ close: [] }>()

/* ===== 排版设置 ===== */

/** 卷面内容：只印试卷 / 只印答题卡 / 两者都印 */
type PaperMode = 'paper' | 'card' | 'both'

const layoutKey = ref(PAPER_LAYOUTS[0].key)
const sizeKey = ref<PaperSizeKey>('A4')
const orientation = ref<PaperOrientation>('portrait')
/** 版数覆盖：0 = 按纸张习惯版数（8K / A3 一面两版） */
const panelPick = ref(0)
const mode = ref<PaperMode>('paper')
/** 教师版：题目后附答案与解析、答题卡标出正确选项（打印前记得关掉） */
const teacher = ref(false)
const zoom = ref(1)
const autoFit = ref(true)

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

/* ===== 缩放（默认适应宽度） ===== */

const canvas = ref<HTMLElement | null>(null)
const canvasW = ref(900)

function fitZoom() {
  const usable = Math.max(240, canvasW.value - 56)
  return Math.min(1.25, Math.max(0.25, usable / geo.value.sheetW))
}

function nudgeZoom(delta: number) {
  autoFit.value = false
  zoom.value = Math.min(1.6, Math.max(0.3, Number((zoom.value + delta).toFixed(2))))
}

watch([geo, canvasW, autoFit], () => {
  if (autoFit.value) zoom.value = fitZoom()
})

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

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') emit('close')
}

let resizeObserver: ResizeObserver | null = null
let canvasObserver: ResizeObserver | null = null
let bodyOverflow = ''

function onPrint() {
  if (teacher.value) showToast('当前为教师版（含答案解析），打印前建议关闭', 'error')
  window.print()
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
  zoom.value = fitZoom()
  measureNow()
  /* 图片 / 公式 / 字体加载完成后高度会变，RO 兜底重排 */
  resizeObserver = new ResizeObserver(scheduleMeasure)
  if (measureHost.value) resizeObserver.observe(measureHost.value)
  document.fonts?.ready.then(scheduleMeasure).catch(() => {})
})

onBeforeUnmount(() => {
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
    <div class="pp-mask" @click.self="emit('close')">
      <div class="pp-dialog">
        <!-- 头部 -->
        <header class="pp-head">
          <div class="pp-head-main">
            <h3 class="pp-title">{{ paper.name }}</h3>
            <p class="pp-sub">
              {{ paper.subject }} · {{ paper.grade }} · {{ totalCount }} 题 · 满分 {{ totalScore }} 分 ·
              {{ paper.duration }} 分钟 · 出卷人 {{ paper.owner }}
            </p>
          </div>
          <div class="pp-head-ops">
            <span class="pp-chip">
              <AppIcon name="file" :size="14" /> {{ size.name }} · 一面 {{ geo.panels }} 版 · 共 {{ sheets.length }} 页
            </span>
            <button class="btn btn-primary btn-sm" @click="onPrint"><AppIcon name="print" :size="15" /> 打印 / 导出 PDF</button>
            <button class="pp-x" type="button" @click="emit('close')"><AppIcon name="close" :size="16" /></button>
          </div>
        </header>

        <!-- 工具栏 -->
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
              <span class="pp-zoom">{{ Math.round(zoom * 100) }}%</span>
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
          <!-- 排版样式（直接选项） -->
          <aside class="pp-side">
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
                          <div v-if="row.kind === 'full'" class="pp-row">
                            <PaperBlock :block="row.block" :paper="paper" :questions="questions" :preset="preset" :teacher="teacher" />
                          </div>
                          <div v-else class="pp-row pp-cols">
                            <div v-for="(col, ci) in [row.left, row.right]" :key="ci" class="pp-col">
                              <PaperBlock
                                v-for="block in col"
                                :key="block.key"
                                :block="block"
                                :paper="paper"
                                :questions="questions"
                                :preset="preset"
                                :teacher="teacher"
                              />
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
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.pp-mask {
  position: fixed;
  inset: 0;
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
.pp-sub { font-size: 12.5px; color: var(--sub); margin-top: 4px; }
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
.pp-zoom { font-size: 12.5px; color: var(--ink-2); min-width: 42px; text-align: center; }
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
.pp-style-tags { display: flex; flex-wrap: wrap; gap: 5px; }
.pp-style-tags i {
  font-style: normal;
  font-size: 10.5px;
  color: var(--sub);
  border: 1px solid var(--border);
  border-radius: 5px;
  padding: 0 5px;
}
.pp-facts { display: flex; flex-direction: column; gap: 6px; font-size: 12px; color: var(--ink-2); }
.pp-facts li { display: flex; gap: 8px; line-height: 1.5; }
.pp-facts span { color: var(--sub); flex-shrink: 0; width: 42px; }
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
