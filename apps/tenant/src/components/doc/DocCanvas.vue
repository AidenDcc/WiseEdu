<script setup lang="ts">
/**
 * 备课文档的**纸张画布**：Word 式多页纸张 + 顶部功能区 + 左侧目录 + 右侧贴边工具栏 + 划词 AI。
 *
 * 它是「编辑一份文档流 HTML」这件事的完整实现，不含任何业务外壳 —— 文档编辑器
 * （DocEditor.vue）在它上面加顶栏与全局设置，模板编辑器（TemplateEditDialog.vue）在它
 * 上面加模板元信息表单。两处需要的编辑体验完全一样（同一批排版按钮、同一套纸张参数、
 * 同一份正文渲染），所以只有一处实现。
 *
 * ## 多页是怎么叠出来的
 *
 * ProseMirror 的正文只有**一个**连续的编辑区，不能切成互不相邻的多块。所以：
 * - **纸**画在编辑区背后的一层绝对定位元素里（`.dc-sheets`，一页一个 `.dc-sheet`）；
 * - **正文**仍是那一条流（`.dc-flow`），由分页引擎（doc-paginate.ts）在分页处垫入空白，
 *   把它顶到下一页页心该在的位置。
 * 于是「屏幕上一张张纸 + 每张纸断开 + 页码对得上」成立，而文档本身没有被切开。
 *
 * ## 为什么用 `modelValue` 而不是「传一个对象进来改」
 *
 * 模板编辑的对象是**模板草稿**、文档编辑的对象是**文档草稿**，两者除了「有一段 HTML」之外
 * 没有共同字段。以字符串为界，画布就不必知道自己在编辑什么。
 *
 * 对外暴露一套极简的命令式 API（setHtml / insertHtml / getHtml），而不是把 editor 实例整个抛出去：
 * 父级要做的只有「换掉正文」「追加一段」「取出来打印」这三件事。
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { EditorContent, useEditor } from '@tiptap/vue-3'
import StarterKit from '@tiptap/starter-kit'
import { Mathematics } from '@tiptap/extension-mathematics'
import { FontFamily, FontSize, TextStyle } from '@tiptap/extension-text-style'
import { TableKit } from '@tiptap/extension-table'
import { AppIcon, normalizeRichHtml, showToast, toPlainText } from '@aiteach/shared'
import type { TeachAiTextAction, TeachDocPage } from '@aiteach/shared'

import DocOutline from './DocOutline.vue'
import DocToolbar from './DocToolbar.vue'
import DocToolbarTop from './DocToolbarTop.vue'
import DocAiMenu from './DocAiMenu.vue'
import DocAiRewriteDialog from './DocAiRewriteDialog.vue'
import DocParagraphDialog from './DocParagraphDialog.vue'
import { createDocExtensions } from './doc-extensions'
import { useDocPage } from './useDocPage'
import {
  DOC_PAGE_GUTTER_MM,
  DocPagination,
  applyPagination,
  clearPagination,
  computePageBreaks,
  measureBlocks,
  type PaginationSnapshot,
} from './doc-paginate'
import RichMediaDialogs from '@/components/ui/rte/RichMediaDialogs.vue'
import { useRichMediaPlumbing } from '@/components/ui/rte/useRichMediaPlumbing'

const props = withDefaults(
  defineProps<{
    modelValue: string
    /** 页面设置（档位 key）；缺省全用默认档 */
    page?: TeachDocPage
    /** 学科：公式库默认筛选与图片入库用 */
    subject?: string
    /** 目录面板第一行的文档名（只影响展示） */
    title?: string
    /** 图片入库的兜底文件名 */
    imageName?: string
    /** 是否显示左侧目录面板的开关（默认显示；模板编辑这类短文档可关掉） */
    outline?: boolean
    /** 是否允许收起工具栏 */
    collapsible?: boolean
    /**
     * 只读。校本 / 平台稿只能查看，此时不显示工具栏、编辑区不可写。
     * 由父级（DocEditor）按文档来源决定。
     */
    readonly?: boolean
    /**
     * 是否由本组件渲染**自带外壳**（左侧目录、缩放条、顶部功能区、右侧贴边工具栏）。
     *
     * 关掉时只剩「纸张舞台」这一块，外壳由外层页面提供 —— 全屏编辑页（PlanEditView）要把
     * 目录钉在整页左栏、把功能区钉在顶栏正下方、把竖排工具栏换成试卷编辑那套右侧图标栏，
     * 这三处都在画布盒子之外，靠 `position: fixed` 硬贴会在窗口变化时错位。
     * 本组件仍然持有 editor 与媒体弹层，因此外壳关掉后必须由外层通过 `defineExpose`
     * 拿到 `editor` / `media` / `openParagraph` 才能把工具栏接上。
     */
    chrome?: boolean
  }>(),
  { subject: '', title: '', imageName: '文档插图.png', outline: true, collapsible: true, readonly: false, chrome: true },
)

const emit = defineEmits<{
  'update:modelValue': [value: string]
  change: []
}>()

/* ================= 页面设置 → 画布样式 ================= */

/* key → mm / pt / 倍数的解析全在 useDocPage 里（打印端用的是同一份，两处不能各算各的） */
const { paper, marginMm, contentHeightMm, header, footer, showPageNo, pageNoPos, pageNoText, headerPos, headerRule, bodyFont, bodySize, bodyLine } =
  useDocPage(() => props.page)

/* ================= 缩放 / 面板开合 / 分页开关 ================= */

const zoom = ref(100)
const ZOOM_STEPS = [60, 75, 90, 100, 115, 130, 150]
function stepZoom(delta: number) {
  const index = ZOOM_STEPS.findIndex((row) => row >= zoom.value)
  zoom.value = ZOOM_STEPS[Math.max(0, Math.min(ZOOM_STEPS.length - 1, index + delta))] ?? 100
}

/** 直接设一个百分比（工具栏上可手输 / 一键回 100%）。上下限与档位表同一口径，免得纸被缩成一个点 */
function setZoom(value: number) {
  const next = Math.round(Number(value) || 100)
  zoom.value = Math.max(40, Math.min(200, next))
}

/** 画布滚动容器：`fitWidth` 要量它才知道「一页纸放得下多宽」 */
const scrollEl = ref<HTMLElement | null>(null)

/** 适应宽度：把纸缩到刚好铺满画布（宽度按 1mm = 96/25.4 px 从 mm 折回像素） */
function fitWidth() {
  const host = scrollEl.value
  if (!host) return
  const paperPx = paper.value.width * (96 / 25.4)
  if (paperPx <= 0) return
  /* 减掉左右各 4px 的内边距与竖滚动条，否则刚好压出一根横向滚动条 */
  setZoom(((host.clientWidth - 20) / paperPx) * 100)
}

/** 正文默认字号（页面设置里的「正文字号」），工具栏「默认字号」那一档与右侧栏都要显示它 */
const baseSize = computed(() => bodySize.value.label.split(' ')[1])

/** 分页视图：默认开（这是「完全按 Word 展示」的核心）。关掉即回到一条长纸，适合快速浏览 */
const paginated = ref(true)
function setPaginated(value: boolean) {
  paginated.value = value
}

const outlineOpen = ref(props.outline)
const railOpen = ref(true)

/** 事务计数：`editor.state.doc` 不是响应式的，「节数」要接进响应式系统才跟得上编辑 */
const revision = ref(0)

/* ================= 公式 / 图片 / 理科配图（与录题编辑器共用一份实现） ================= */

/**
 * 创建顺序有讲究：扩展的 `Mathematics.configure` 里要引用 `openMathEdit`（点公式节点就地开
 * 输入框），而扩展 options 必须先于实例传入 —— 这也是 plumbing 收 getter 而不是 Ref 的原因。
 */
const media = useRichMediaPlumbing({
  getEditor: () => editor.value,
  getSubject: () => props.subject,
  /* 工具栏在纸张之外、点按钮时 ProseMirror 已失焦，若不显式告诉它「焦点还在本画布内」，
     插入公式会落到文档末尾而不是光标处 */
  isFocused: () => true,
  imageName: props.imageName,
})

/* ================= 编辑器 ================= */

/** 最近一次由编辑器回写的 HTML：用来区分「外部改值」与「自己刚写的」，避免光标被重置 */
let lastEmitted = ''

/** 页数（分页引擎算出来后回填，纸背景层与页码都读它） */
const pageCount = ref(1)

/**
 * 分页扩展要在 `extensions` 里注册，而它的回调要写 `pageCount` ——
 * 这里用「稍后再写」的转发：扩展构造时 `pageCount` 已经存在，直接闭包引用即可。
 */
const editor = useEditor({
  content: props.modelValue,
  editable: !props.readonly,
  extensions: [
    ...createDocExtensions((node, pos, block) => media.openMathEdit(node, pos, block)),
    DocPagination((count) => {
      pageCount.value = count
    }),
  ],
  editorProps: {
    /* 两个类名各管一段：`rte-content` 是全局共用观感（styles/richtext-content.css），
       `doc-content` 是纸张内特有的（分页符等） */
    attributes: { class: 'rte-content doc-content' },
    handlePaste: (_view, event) => {
      if (props.readonly) return false
      const file = media.imageFromDataTransfer(event.clipboardData)
      if (!file) return false
      event.preventDefault()
      void media.uploadImage(file)
      return true
    },
    handleDrop: (_view, event) => {
      if (props.readonly) return false
      const file = media.imageFromDataTransfer((event as DragEvent).dataTransfer)
      if (!file) return false
      event.preventDefault()
      void media.uploadImage(file)
      return true
    },
  },
  onTransaction: () => {
    revision.value += 1
    scheduleMeasure()
  },
  onUpdate: ({ editor: instance }) => {
    /* Tiptap 把空文档序列化成 <p></p>，归一到空串，与存储口径一致 */
    lastEmitted = normalizeRichHtml(instance.getHTML())
    emit('update:modelValue', lastEmitted)
    emit('change')
  },
})

/* 编辑器就绪后挂上「双击配图节点 → 二次编辑」的回调（节点 NodeView 经 editor.storage 取） */
watch(
  () => editor.value,
  (instance) => media.attachEditor(instance),
  { immediate: true },
)

/* 外部改值（换文档 / 套用模板 / 应用 AI 草稿）时同步进编辑器 */
watch(
  () => props.modelValue,
  (value) => {
    const instance = editor.value
    if (!instance || value === lastEmitted) return
    instance.commands.setContent(value || '', { emitUpdate: false })
    lastEmitted = value
    scheduleMeasure()
  },
)

watch(
  () => props.readonly,
  (value) => editor.value?.setEditable(!value),
)

onBeforeUnmount(() => {
  cancelMeasure()
  resizeObserver?.disconnect()
  editor.value?.destroy()
})

/**
 * 把编辑器里的内容同步回 `modelValue`。
 *
 * `setContent(..., { emitUpdate: false })` 不触发 `onUpdate`，所以命令式改完正文后必须手动同步一次 ——
 * 漏掉的表现是「页面显示改了，保存下来还是旧的」。
 */
function syncOut() {
  const instance = editor.value
  if (!instance) return
  lastEmitted = normalizeRichHtml(instance.getHTML())
  emit('update:modelValue', lastEmitted)
  emit('change')
}

/* ================= 分页：摘垫片 → 量原始版面 → 算断点 → 落垫片 ================= */

/** 正在落分页事务时不要再被自己的事务叫起来量一遍（否则自我循环） */
let measuring = false
/** 收敛上限：原始版面与垫片无关，实测第二轮就同签名；给 5 轮是给「超长文档 + 频繁换页」留余量 */
const MAX_ROUNDS = 5

const stageHeightMm = computed(() => {
  const count = Math.max(1, pageCount.value)
  return count * paper.value.height + (count - 1) * DOC_PAGE_GUTTER_MM
})

let rafId = 0
function cancelMeasure() {
  if (rafId) cancelAnimationFrame(rafId)
  rafId = 0
}

/**
 * 安排一次分页测量。
 *
 * 一律走 requestAnimationFrame：分页要读真实布局，而布局在同一个事件循环里还没结算完
 * （ProseMirror 的事务、Vue 的 DOM 更新都在其后），立刻量只会拿到上一帧的位置。
 * 连续多次调用合并成一次。
 */
function scheduleMeasure() {
  if (measuring) return
  if (rafId) return
  rafId = requestAnimationFrame(() => {
    rafId = 0
    measure()
  })
}

/** 最近一次落下的断点。测量中途发现 DOM 与文档不同步时用它把垫片补回去（不能留一个没垫片的版面） */
let lastSnapshot: PaginationSnapshot | null = null

function measure() {
  const instance = editor.value
  if (!instance || instance.isDestroyed) return
  const root = instance.view.dom as HTMLElement
  if (!root.isConnected) return

  /* 顶层块的位置与「其后是否强制换页」「是否要与下一块同页」：装饰要落在这些位置上，
     顺序必须与 DOM 子元素一一对应 */
  const positions: number[] = []
  const forced: boolean[] = []
  const keepWithNext: boolean[] = []
  instance.state.doc.forEach((node, offset) => {
    positions.push(offset)
    forced.push(node.type.name === 'pageBreak')
    /* 标题与下一段同页：少这一步，落在页底的标题会孤零零留在上一页（见 computePageBreaks） */
    keepWithNext.push(node.type.name === 'heading')
  })

  const metrics = {
    enabled: paginated.value,
    paperHeight: paper.value.height,
    margin: marginMm.value,
    scale: zoom.value / 100,
    gutter: DOC_PAGE_GUTTER_MM,
  }
  const content = contentHeightMm.value
  if (content <= 0) return

  measuring = true
  try {
    for (let round = 0; round < MAX_ROUNDS; round += 1) {
      /* **先摘垫片再量**：量到的必须是「一个垫片都没有的原始版面」，
         否则算法会以为块已经落在下一页顶端，把垫片算成 0 毫米（见 doc-paginate 的说明） */
      clearPagination(instance.view, pageCount.value)
      const blocks = measureBlocks(root, metrics.scale)
      if (!blocks) {
        /* 空文档：清干净，一页 */
        lastSnapshot = { breaks: [], pageCount: 1, signature: '' }
        applyPagination(instance.view, lastSnapshot, content)
        return
      }
      const next = computePageBreaks(blocks, positions, forced, metrics, keepWithNext)
      if (!next) {
        /* DOM 与文档不同步（ProseMirror 正在重排）：把上一轮的结果补回去，等下一次事务再量 */
        if (lastSnapshot) applyPagination(instance.view, lastSnapshot, content)
        return
      }
      /* 断点稳定 → 收工。原始版面与垫片无关，所以第二轮必然与第一轮同签名 */
      const stable = lastSnapshot !== null && next.signature === lastSnapshot.signature
      lastSnapshot = next
      if (stable) break
    }
    if (lastSnapshot) applyPagination(instance.view, lastSnapshot, content)
  } finally {
    measuring = false
  }
}

/* 缩放 / 纸张 / 页边距 / 分页开关一变，页心高与测量尺度都变了，必须重排 */
watch([zoom, paginated, paper, marginMm, contentHeightMm], () => scheduleMeasure())

/** 纸张宽度变化（窗口缩放、缩放档位）也会改变每行字数与块高，用 ResizeObserver 兜住 */
let resizeObserver: ResizeObserver | null = null
onMounted(() => {
  const root = editor.value?.view.dom as HTMLElement | undefined
  if (root) {
    resizeObserver = new ResizeObserver(() => scheduleMeasure())
    resizeObserver.observe(root)
  }
  void nextTick(scheduleMeasure)
})

/* ================= 纸张 / 页眉页脚样式 ================= */

/** 第 index 张纸（从 0 起）的定位与尺寸。高度用 mm —— 与纸张参数同一口径，缩放下等比 */
function sheetStyle(index: number) {
  return {
    top: `${index * (paper.value.height + DOC_PAGE_GUTTER_MM)}mm`,
    width: `${paper.value.width}mm`,
    height: `${paper.value.height}mm`,
  }
}

/** 页眉页脚都落在页边距里：取页边距的 30% 作为距纸边的距离（页边距为 0 时贴边，可接受） */
const bandInset = computed(() => `${Math.max(0, marginMm.value * 0.3)}mm`)

/**
 * 页脚文字落在哪一格。
 *
 * 页码可以选左 / 中 / 右（页面设置），页脚文字则固定「另一侧」——两者都在页脚这一行，
 * 挤在同一个位置上只会叠字。页码在中间时两侧都空着，文字仍取左侧；页码在左时文字让到右。
 * 默认（页码在右）时页脚文字在左，与改造前完全一致。
 */
const footerSlot = computed<'left' | 'right'>(() => (showPageNo.value && pageNoPos.value === 'left' ? 'right' : 'left'))

/**
 * 正文流的样式。
 *
 * 正文基线（字体 / 字号 / 行距）写在正文流上而不是每个段落上：这几个属性都是继承的，
 * 挂在容器上即成为**整篇的默认值**，而段落上单独设过的内联样式优先级更高、自动覆盖它 ——
 * 这正是 Word 里「正文样式 + 局部改格式」的同一套层级关系，不必自己写覆盖逻辑。
 *
 * 上下内边距 = 页边距：让第 0 页的第一行正好落在页心里；左右同理，保证一行文字的宽度
 * 与纸张版心一致（分页测量也按这个宽度算块高）。
 */
const flowStyle = computed(() => ({
  padding: `${marginMm.value}mm`,
  fontFamily: bodyFont.value.value ?? undefined,
  fontSize: bodySize.value.value ?? undefined,
  lineHeight: bodyLine.value.value ?? undefined,
  color: 'var(--ink)',
}))

/**
 * 屏幕缩放。
 *
 * 用 `zoom` 而不是 `transform: scale()`：后者不改变布局盒子，纸的滚动高度会算错；
 * 而 `zoom` 会连布局一起缩放，滚动条与测量都自洽（测量端按 `zoom/100` 折回去，见 measure）。
 */
const stageStyle = computed(() => ({
  width: `${paper.value.width}mm`,
  minHeight: `${stageHeightMm.value}mm`,
  zoom: zoom.value / 100,
}))

/* ================= 段落对话框 ================= */

const paragraphOpen = ref(false)

/* ================= 划词 AI =================
   菜单只负责「选哪个动作」；真正的调用、结果预览与替换 / 弃用交给 DocAiRewriteDialog ——
   改一段话的结果值得先看一眼再决定落不落进正文。画布在这里只记下「这次改的是哪一段」。 */

interface AiRewriteTarget {
  action: TeachAiTextAction
  from: number
  to: number
  /** 选区的纯文本：AI 的输入，也是弹窗里「原文」那一栏的展示内容 */
  source: string
}

const aiTarget = ref<AiRewriteTarget | null>(null)

function onAiAction(action: TeachAiTextAction) {
  const instance = editor.value
  if (!instance) return
  const { from, to } = instance.state.selection
  if (from === to) return
  const source = instance.state.doc.textBetween(from, to, '\n').trim()
  if (!source) return
  aiTarget.value = { action, from, to, source }
}

/** AI 返回的是纯文本（可能带换行）：转成段落再插 —— 不然 `<` 会被当成标签、整段也会挤成一行 */
function aiTextToHtml(text: string): string {
  const escape = (value: string) => value.replace(/[&<>]/g, (ch) => (ch === '&' ? '&amp;' : ch === '<' ? '&lt;' : '&gt;'))
  return text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `<p>${escape(line)}</p>`)
    .join('')
}

/**
 * 替换：把 AI 的结果写回选区。
 *
 * 仍用 `insertContentAt` 一次事务完成替换 —— 比先删后插少一步，撤销栈里也只留一步，
 * 老师按一次撤销就能回到改写前。
 */
function applyAiRewrite(text: string) {
  const instance = editor.value
  const target = aiTarget.value
  if (!instance || !target) return
  instance.chain().focus().insertContentAt({ from: target.from, to: target.to }, aiTextToHtml(text)).run()
  syncOut()
  scheduleMeasure()
  showToast('已替换为 AI 版本', 'success')
}

/* ================= 对外的极简 API ================= */

/** 整篇换掉（引用模板 / AI 重生成）：光标跳到末尾，方便接着写 */
function setHtml(html: string) {
  const instance = editor.value
  if (!instance) return
  instance.commands.setContent(html, { emitUpdate: false })
  instance.commands.focus('end')
  syncOut()
  scheduleMeasure()
}

/**
 * 追加到文档末尾。
 *
 * 不插在光标处：模板与 AI 草稿都是**一整篇的骨架**，插在段落中间会把原文劈成两半
 * （那几乎肯定不是用户要的）。
 */
function insertHtml(html: string) {
  const instance = editor.value
  if (!instance) return
  instance.chain().focus('end').insertContent(html).run()
  syncOut()
  scheduleMeasure()
}

/**
 * 插到光标处（无光标时落到末尾）。
 *
 * 与 `insertHtml` 的分工：模板与 AI 草稿是「一整篇骨架」，插在段落中间会把原文劈成两半；
 * 而从题库 / 媒体库挑来的一个块是**局部的**，就该落在你正看着的地方。
 */
function insertAtCursor(html: string) {
  const instance = editor.value
  if (!instance) return
  const { to } = instance.state.selection
  instance.chain().focus().insertContentAt(to, html).run()
  syncOut()
  scheduleMeasure()
}

function getHtml(): string {
  return lastEmitted || props.modelValue
}

/** 正文字数（列表卡片与顶栏都用它） */
const charCount = computed(() => {
  void revision.value
  return toPlainText(getHtml()).length
})

/** 标题数（左侧目录的节数，收起目录时也看得到「文档有几节」） */
const headCount = computed(() => {
  void revision.value
  let count = 0
  editor.value?.state.doc.descendants((node) => {
    if (node.type.name === 'heading') count += 1
    return true
  })
  return count
})

/**
 * 对外暴露的 API。
 *
 * 除了命令式的三个（换正文 / 追加 / 取出），这里还把 `editor`、`media`（公式 / 图片 / 配图的
 * 弹层状态）、`openParagraph` 与缩放、分页开关一并交出去 —— 外壳关掉时（`chrome: false`）
 * 顶部功能区与右侧栏由外层页面渲染，它们必须够得着这些状态。不暴露整个组件实例，
 * 是为了让外层的用法**收在一张清单里**：多用一个内部字段就会在清单里露出来。
 */
defineExpose({
  editor,
  media,
  baseSize,
  setHtml,
  insertHtml,
  insertAtCursor,
  getHtml,
  charCount,
  headCount,
  pageCount,
  measure,
  zoom,
  setZoom,
  stepZoom,
  fitWidth,
  paginated,
  setPaginated,
  openParagraph: () => (paragraphOpen.value = true),
})
</script>

<template>
  <div class="dc" :class="{ 'no-outline': !outlineOpen, 'is-readonly': readonly, 'is-bare': !chrome }">
    <!-- 左：目录。由正文里的 h1~h5 现推导（DocOutline.vue），改标题即改目录。
         外壳关掉时由外层页面自己摆这一栏（见 chrome 的说明）。 -->
    <div v-if="chrome && outlineOpen && editor" class="dc-left">
      <DocOutline :editor="editor" :title="title" />
    </div>

    <!-- 中：纸张画布 -->
    <div ref="scrollEl" class="dc-scroll">
      <!-- 缩放条贴在画布上沿而不是顶栏：它与「纸」是一件事，与文档操作不是一件事。
           外壳关掉时缩放与分页开关挪到页面工具栏里（那里本来就是一整条工具带）。 -->
      <div v-if="chrome" class="dc-zoombar">
        <button v-if="outline" class="dc-zbtn" type="button" title="目录开合" :class="{ on: outlineOpen }" @click="outlineOpen = !outlineOpen">
          <AppIcon name="outline" :size="14" />
        </button>
        <button class="dc-zbtn" type="button" title="缩小" @click="stepZoom(-1)"><AppIcon name="minus" :size="14" /></button>
        <button class="dc-zbtn text" type="button" title="恢复 100%" @click="zoom = 100">{{ zoom }}%</button>
        <button class="dc-zbtn" type="button" title="放大" @click="stepZoom(1)"><AppIcon name="plus" :size="14" /></button>
        <span class="dc-zsep" />
        <button
          class="dc-zbtn"
          type="button"
          title="分页视图：按纸张把正文断开（与 Word 的页面视图同义）"
          :class="{ on: paginated }"
          @click="paginated = !paginated"
        >
          <AppIcon name="page-break" :size="14" />
        </button>
        <span class="dc-zinfo">
          {{ paper.label.split('（')[0] }} · 页边距 {{ marginMm }}mm · 共 {{ pageCount }} 页 · {{ headCount }} 节 · {{ charCount }} 字
        </span>
      </div>

      <!-- 顶部横向功能区：Word 式二层结构，与右侧竖排共用同一份功能注册表。
           外壳关掉时这一条由外层页面钉在顶栏正下方（见 chrome 的说明）。 -->
      <DocToolbarTop
        v-if="chrome && editor && !readonly"
        :editor="editor"
        :base-size="baseSize"
        @image="media.pickImage"
        @formula="media.openMathInsert"
        @draw="media.openDrawSelect"
        @paragraph="paragraphOpen = true"
      />

      <div class="dc-stage" :style="stageStyle">
        <!-- 纸背景层：一页一张，含页眉 / 页脚 / 页码。不可交互，纯观感 -->
        <div class="dc-sheets" aria-hidden="true">
          <div v-for="n in pageCount" :key="n" class="dc-sheet" :style="sheetStyle(n - 1)">
            <div
              v-if="header"
              class="dc-sheet-head"
              :class="{ rule: headerRule }"
              :style="{ top: bandInset, left: `${marginMm}mm`, right: `${marginMm}mm` }"
            >
              <!-- 页眉位置（左 / 中 / 右）：整行一个块，靠 text-align 摆 ——
                   页眉只有一行字，不必像页脚那样切成三格（页脚要同时放页码与页脚文字） -->
              <span class="dc-head-slot" :class="`is-${headerPos}`">{{ header }}</span>
            </div>
            <div
              v-if="footer || showPageNo"
              class="dc-sheet-foot"
              :style="{ bottom: bandInset, left: `${marginMm}mm`, right: `${marginMm}mm` }"
            >
              <!-- 三格：左 / 中 / 右。页码按页面设置落在其中一格，页脚文字占另一侧。
                   左格要同时容得下两种东西 —— 页码在左时它是页码格，否则它是页脚文字格 -->
              <span class="dc-foot-slot">
                <template v-if="footerSlot === 'left'">{{ footer }}</template>
                <template v-else-if="showPageNo && pageNoPos === 'left'">{{ pageNoText(n, pageCount) }}</template>
              </span>
              <span class="dc-foot-slot is-center">
                {{ showPageNo && pageNoPos === 'center' ? pageNoText(n, pageCount) : '' }}
              </span>
              <span class="dc-foot-slot is-end">
                <template v-if="footerSlot === 'right'">{{ footer }}</template>
                <template v-else-if="showPageNo && pageNoPos === 'right'">{{ pageNoText(n, pageCount) }}</template>
              </span>
            </div>
          </div>
        </div>

        <!-- 正文：仍是那一条连续的文档流，由分页引擎在分页处垫空白顶到下一页 -->
        <div class="dc-flow" :style="flowStyle">
          <EditorContent v-if="editor" :editor="editor" />
          <p v-else class="dc-loading">编辑器加载中…</p>
        </div>
      </div>
    </div>

    <!-- 右：贴边工具栏。收起后留一条窄把手，不占纸的宽度 —— 纸的宽度是有语义的（打印用）。
         外壳关掉时右侧那一栏由外层页面提供（试卷编辑同款的图标栏 + 面板）。 -->
    <div v-if="chrome && !readonly" class="dc-rail" :class="{ collapsed: !railOpen }">
      <button
        v-if="collapsible"
        class="dc-rail-toggle"
        type="button"
        :title="railOpen ? '收起工具栏' : '展开工具栏'"
        @click="railOpen = !railOpen"
      >
        <AppIcon :name="railOpen ? 'chevron-right' : 'menu'" :size="15" />
      </button>
      <div v-if="railOpen && editor" class="dc-side">
        <DocToolbar
          :editor="editor"
          :base-size="baseSize"
          @image="media.pickImage"
          @formula="media.openMathInsert"
          @draw="media.openDrawSelect"
          @paragraph="paragraphOpen = true"
        />
      </div>
    </div>

    <RichMediaDialogs v-if="editor" :media="media" :editor="editor" :subject="subject" />

    <!-- 划词 AI：选中一段话即浮出，改写 / 扩写 / 缩写 / 润色 / 纠错 -->
    <DocAiMenu v-if="editor && !readonly" :editor="editor" @action="onAiAction" />

    <!-- 划词 AI 的结果确认：先调 AI，再把结果显示出来让人决定替换还是弃用 -->
    <DocAiRewriteDialog
      v-if="aiTarget"
      :action="aiTarget.action"
      :source="aiTarget.source"
      :subject="subject"
      @close="aiTarget = null"
      @apply="applyAiRewrite"
    />

    <DocParagraphDialog v-if="editor && paragraphOpen" :editor="editor" @close="paragraphOpen = false" />
  </div>
</template>

<style scoped>
.dc { display: flex; align-items: flex-start; gap: 12px; }
.dc-left { width: 232px; flex-shrink: 0; }

/* ===== 无外壳模式（全屏编辑页把目录 / 功能区 / 右侧栏收进页面自己的骨架里） =====
   高度交给父级：父级是 `height: 100%` 的一栏，画布只负责「一列 + 自己滚」，不再按
   `100vh - 208px` 猜外壳有多高 —— 外壳高度一变（顶栏折行、工具栏换行）那个魔数就对不上了。

   `align-items: stretch` 必须显式写回来：外层 `.dc` 是「一列并排」的横向 flex，为了不让
   目录栏被拉高而设了 `align-items: flex-start`；转成纵向后，那条规则会变成横向上的对齐方式，
   把画布列压成内容宽度（794px 的纸 + 左右各 4px 内边距 = 802px），于是纸贴在左边、
   右侧空出一条灰带。纵向布局要的是「画布列撑满这一栏的宽度」。 */
.dc.is-bare {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  height: 100%;
  min-height: 0;
  gap: 0;
}
.dc.is-bare .dc-scroll {
  flex: 1 1 auto;
  min-height: 0;
  height: auto;
  max-height: none;
  /* 上下留白同值：滚到顶时第一张纸与顶栏之间要有一段空气，
     不然纸边直接贴着工具带下沿，看起来像被裁掉了（底部原本就有 28px，这里对齐它） */
  padding: 28px 4px;
}

.dc-scroll {
  flex: 1;
  min-width: 0;
  /* 画布自身滚动：目录与工具栏因此能各钉在自己那一栏，不跟着纸一起滚走 */
  max-height: calc(100vh - 208px);
  overflow: auto;
  padding: 0 4px 24px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
}

.dc-zoombar {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--card);
  box-shadow: var(--shadow);
  position: sticky;
  top: 0;
  z-index: 5;
}
.dc-zbtn {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 26px; height: 26px; padding: 0 6px;
  border: none; border-radius: 7px;
  background: transparent; color: var(--ink-2);
  font-size: 12px;
  transition: background 0.15s, color 0.15s;
}
.dc-zbtn:hover { background: var(--brand-soft); color: var(--brand-deep); }
.dc-zbtn.on { background: var(--brand-soft); color: var(--brand-deep); }
.dc-zbtn.text { min-width: 52px; font-weight: 600; }
.dc-zsep { width: 1px; height: 14px; background: var(--border); margin: 0 4px; }
.dc-zinfo { font-size: 11.5px; color: var(--sub); padding-right: 6px; white-space: nowrap; }

/* 纸张舞台：宽度 = 纸宽（mm），高度 = 所有纸 + 页间距 */
.dc-stage { position: relative; flex-shrink: 0; }

/* 纸背景层：一页一张白纸，投影给足才有「纸」的感觉 */
.dc-sheets { position: absolute; inset: 0; z-index: 0; }
.dc-sheet {
  position: absolute;
  left: 0;
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 2px;
  box-shadow: 0 6px 28px rgba(28, 36, 52, 0.1);
}
.dc-sheet-head {
  position: absolute;
  font-size: 10.5pt;
  color: #6b7280;
  padding-bottom: 3px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
/* 页眉文字的位置由这一格自己定：`display: block` 撑满整行，text-align 才有效 */
.dc-head-slot { display: block; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.dc-head-slot.is-left { text-align: left; }
.dc-head-slot.is-center { text-align: center; }
.dc-head-slot.is-right { text-align: right; }
.dc-sheet-head.rule { border-bottom: 1px solid #d7dce5; }
/* 页脚：三格等宽（左 / 中 / 右），页码按页面设置落在其中一格，页脚文字占另一侧。
   等宽三格是为了让「居中」真的居中 —— 用 flex + space-between 时中间那格会随两侧长短漂移。 */
.dc-sheet-foot {
  position: absolute;
  display: grid;
  grid-template-columns: 1fr 1fr 1fr;
  gap: 10px;
  font-size: 10pt;
  color: #6b7280;
}
.dc-foot-slot { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dc-foot-slot.is-center { text-align: center; }
.dc-foot-slot.is-end { text-align: right; }

/* 正文流：坐在纸背景层之上，靠 padding 让首行落在第一页页心里 */
.dc-flow { position: relative; z-index: 1; }
.dc-loading { padding: 40px; color: var(--sub); font-size: 13px; text-align: center; }

.dc-flow :deep(.doc-content) { outline: none; min-height: 40mm; }

/* 分页垫片：只是一段高度，不该被看见、也不该被选中（内容由文档编辑器写） */
.dc-flow :deep(.doc-page-gap) { display: block; width: 100%; pointer-events: none; }

/* 标题：一份教案的课题居中、字号比正文明显大，这是中文教学设计的通行写法 */
.dc-flow :deep(.doc-content h1) { font-size: 1.7em; text-align: center; margin: 0 0 16px; }
.dc-flow :deep(.doc-content h2) { font-size: 1.35em; margin: 18px 0 8px; }
.dc-flow :deep(.doc-content h3) { font-size: 1.15em; margin: 12px 0 6px; }
.dc-flow :deep(.doc-content h4) { font-size: 1.05em; margin: 10px 0 6px; }
.dc-flow :deep(.doc-content h5) { font-size: 1em; font-weight: 700; margin: 8px 0 5px; }

/* 分页符：编辑时是一条虚线记号，打印时换成真正的换页（见 DocEditor.onPrint 的打印样式） */
.dc-flow :deep(.doc-content [data-type='page-break']) {
  position: relative;
  height: 0;
  margin: 20px 0;
  border-top: 1px dashed #c2cbd9;
}
.dc-flow :deep(.doc-content [data-type='page-break']::after) {
  content: '分页符';
  position: absolute;
  top: -9px;
  left: 50%;
  transform: translateX(-50%);
  padding: 0 8px;
  background: #fff;
  color: var(--sub);
  font-size: 11px;
  letter-spacing: 0.5px;
  white-space: nowrap;
}

/* ===== 右侧贴边工具栏 ===== */
.dc-rail { flex-shrink: 0; display: flex; align-items: flex-start; }
.dc-rail-toggle {
  width: 24px;
  height: 42px;
  margin-top: 10px;
  border: 1px solid var(--border);
  border-right: none;
  border-radius: 9px 0 0 9px;
  background: var(--card);
  color: var(--sub);
  display: flex; align-items: center; justify-content: center;
  transition: color 0.15s, background 0.15s;
}
.dc-rail-toggle:hover { color: var(--brand-deep); background: var(--brand-soft); }
.dc-side {
  width: 188px;
  max-height: calc(100vh - 208px);
  overflow-y: auto;
  background: var(--card);
  border: 1px solid var(--border);
  border-radius: 12px 0 0 12px;
  box-shadow: var(--shadow);
}
.dc-rail.collapsed .dc-rail-toggle { border-right: 1px solid var(--border); border-radius: 9px; }

/* 只读（校本 / 平台稿）：纸照常显示，但没有任何编辑入口 */
.dc.is-readonly .dc-scroll { max-height: calc(100vh - 168px); }
</style>
