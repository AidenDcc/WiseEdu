/**
 * 备课文档的**真分页**：把一份连续的文档流按页心高切成 N 张纸。
 *
 * 这件事为什么不能交给 CSS：浏览器原生的多列 / 分页属性只在**打印**时生效，屏幕上是连续的一条，
 * 而老师要的是「屏幕上一张一张纸、每张纸断开、页码对得上」—— 与 Word 的页面视图同义。
 * 试卷走过的路（见 business-common/components/paper/paginate.ts）已经证明：这类需求在浏览器里
 * 只能自己量、自己装，交给原生属性只会得到不可控的断点。
 *
 * ## 怎么在不切开 contenteditable 的前提下做到「纸张断开」
 *
 * ProseMirror 的内容是**一个**连续的编辑区，不能把它塞进多个互不相邻的容器还保持可编辑。
 * 所以这里不切内容，而是**用装饰（Decoration.widget）在分页处垫入一段空白**，
 * 把本该落在下一页的块整体顶到下一页的位置；纸面本身则画在编辑区**背后**的一层
 * 绝对定位的「纸」里（见 DocCanvas 的 .dc-sheets）。
 * 结果是：内容仍是一份文档，视觉上却是一张张独立的纸，页码与页眉页脚按纸来画。
 *
 * ## 坐标口径（很容易算错，集中写在这里）
 *
 * - 一切以**毫米**为准。纸宽高、页边距、页间距都是 mm；测量出来的像素要换算回 mm，
 *   即 `mm = px / (pxPerMm * scale)`（`scale` 是屏幕缩放倍数）。
 * - 位置以**第 0 页页心左上角为原点**：第 0 页页心的顶边就是 0，
 *   第 i 页页心的顶边 = `i * stride`，其中 `stride = 纸高 + 页间距`。
 * - 每页可放的内容高 = `纸高 - 2 × 页边距`。
 *
 * 因为装饰会改变布局，断点要算在**没有装饰的版面上**：
 * 每轮测量前先清掉上一轮的垫片，量一次「原始版面」，再用纯算术把断点推一遍。
 * 早先是「带着垫片再量一遍、再算一遍」，那会让算法看到「这块已经在新页顶端了、不必再垫」，
 * 于是第一处垫片被算成 0 毫米、正文漏进下一页的页边距 —— 必须先把垫片摘掉再量。
 */
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { EditorState } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { EditorView } from '@tiptap/pm/view'

/** CSS 里 1mm 等于多少 px（96dpi 下的固定换算，与浏览器缩放无关） */
export const PX_PER_MM = 96 / 25.4

/** 两张纸之间的间距（mm）。屏幕上要给足，否则「这是一张纸」这件事看不出来 */
export const DOC_PAGE_GUTTER_MM = 10

/** 垫片元素与容器的类名，测量时要能把它从子元素里滤掉 */
export const DOC_GAP_CLASS = 'doc-page-gap'

/** 分页计算所需的版式参数 */
export interface PaginationMetrics {
  /** 关掉分页（不分页视图）时不垫任何东西 */
  enabled: boolean
  /** 纸高（mm） */
  paperHeight: number
  /** 页边距（mm），上下同值 */
  margin: number
  /** 屏幕缩放倍数（1 = 100%） */
  scale: number
  /** 纸间距（mm） */
  gutter: number
}

/** 一处分页断点：在第 pos 个顶层节点**之前**垫 heightMm 毫米 */
export interface DocPageBreak {
  pos: number
  heightMm: number
}

/** 一个顶层块在「无垫片版面」里的位置与高度（都是相对正文根元素顶边的毫米数） */
export interface BlockBox {
  topMm: number
  heightMm: number
}

export interface PaginationSnapshot {
  breaks: DocPageBreak[]
  pageCount: number
  /** 断点签名，用于判断是否已收敛 */
  signature: string
}

interface PaginationState {
  decorations: DecorationSet
  pageCount: number
  signature: string
}

export const docPaginationKey = new PluginKey<PaginationState>('docPagination')

/** 与 DOM 无关的稳定签名：位置 + 高度（毫米，取整到 0.1） */
function sign(breaks: DocPageBreak[]): string {
  return breaks.map((row) => `${row.pos}:${Math.round(row.heightMm * 10) / 10}`).join('|')
}

/**
 * 量一遍顶层块的原始版面。
 *
 * 调用前**必须先把上一轮的垫片清掉**（见 clearPagination）：本函数量的是「没有任何垫片时，
 * 每个块在哪、多高」，带着垫片量出来的位置会把断点算歪。
 *
 * 坐标以 `root`（编辑区根元素）的**顶边**为原点，单位毫米。正文的上下左右内边距挂在
 * 外层 `.dc-flow` 上，所以 root 的顶边就是第一页页心的顶边（第 0 页的可用区就是从 0 开始）。
 *
 * 返回 null 表示「这一轮量不了」（没有块、块数与文档不同步）；调用方应放弃本轮，
 * 而不是把 0 个断点当成结果。
 */
export function measureBlocks(root: HTMLElement, scale: number): BlockBox[] | null {
  const children = Array.from(root.children).filter(
    (el): el is HTMLElement => el instanceof HTMLElement && !el.classList.contains(DOC_GAP_CLASS),
  )
  if (!children.length) return null
  const toMm = (px: number) => px / (PX_PER_MM * (scale || 1))
  const rootTop = root.getBoundingClientRect().top
  return children.map((el) => {
    const rect = el.getBoundingClientRect()
    return { topMm: toMm(rect.top - rootTop), heightMm: toMm(rect.height) }
  })
}

/**
 * 按量好的原始版面算一遍断点。**纯算术，不碰 DOM。**
 *
 * @param blocks    每个顶层块在无垫片版面里的位置与高度（measureBlocks 的返回值）
 * @param positions 每个顶层块在文档里的起始位置（由调用方从 `doc.forEach` 取），与 blocks 一一对应
 * @param forced    某个块之后是否**强制**换页（手动分页符）。长度同 positions
 * @param metrics   版式参数
 * @param keepWithNext 某个块是否要与**下一块**同页（标题）。见下方「孤儿标题」的说明
 */
export function computePageBreaks(
  blocks: BlockBox[],
  positions: number[],
  forced: boolean[],
  metrics: PaginationMetrics,
  keepWithNext: boolean[] = [],
): PaginationSnapshot | null {
  if (!metrics.enabled) return { breaks: [], pageCount: 1, signature: '' }
  if (!blocks.length) return { breaks: [], pageCount: 1, signature: '' }
  /* 索引对不上说明 DOM 与文档不同步（ProseMirror 正在重排 / 还有别的装饰节点），
     此时算出来的位置会把垫片插错地方 —— 直接放弃这一轮，等下一次事务。 */
  if (blocks.length !== positions.length) return null

  const contentHeight = metrics.paperHeight - metrics.margin * 2
  if (contentHeight <= 0) return null
  const stride = metrics.paperHeight + metrics.gutter

  const breaks: DocPageBreak[] = []
  /** 已插入的垫片累计高度（毫米）：所有垫片都在它之后，算位置时要一起加上 */
  let shift = 0
  let page = 0
  /** 上一处断点落在哪个块之前：往回拉标题时不许越过它，否则会把上一页内容也拽下来 */
  let lastBreak = 0
  let i = 1

  while (i < blocks.length) {
    const top = blocks[i].topMm + shift
    const limit = page * stride + contentHeight
    /* 两种开新页的理由：上一块是手动分页符（强制），或本块装不进当前页（自然溢出）。
       0.5mm 容差：浮点测量误差不该让一个「刚好塞得下」的块跳页。 */
    const overflow = top + blocks[i].heightMm > limit + 0.5
    const manual = forced[i - 1]
    if (!overflow && !manual) {
      i += 1
      continue
    }

    /*
     * 断点位置：默认落在本块之前。
     *
     * 若上一块是标题，就把它一起带到下一页 —— Word 里的「与下段同页」。少了这一步，
     * 一个恰好落在页底的标题会留在上一页的最后一行，正文全在下一页，也就是排版上的
     * 「孤儿标题」。手动分页符不拉：那是用户明确要求的断点，位置就按他说的来。
     */
    let start = i
    if (!manual) {
      const floor = Math.max(1, lastBreak)
      while (start > floor && keepWithNext[start - 1]) start -= 1
    }

    page += 1
    const target = page * stride
    const gap = Math.max(0, target - (blocks[start].topMm + shift))
    shift += gap
    breaks.push({ pos: positions[start], heightMm: gap })
    lastBreak = start
    /* 被一起拉到新页的标题要按新页重新校验一遍，否则「标题 + 正文」整体超过一页时会算成放得下 */
    i = start + 1
  }

  return { breaks, pageCount: page + 1, signature: sign(breaks) }
}

/**
 * 分页扩展。
 *
 * 它只做两件事：把外部算好的断点渲染成垫片装饰，以及把页数回传给组件。
 * **测量留在组件里**（那边拿得到 DOM 与版式参数），插件保持「拿数据出装饰」的纯形态。
 */
export function DocPagination(onPages?: (count: number) => void) {
  return Extension.create({
    name: 'docPagination',

    addProseMirrorPlugins() {
      return [
        new Plugin<PaginationState>({
          key: docPaginationKey,

          state: {
            init: () => ({ decorations: DecorationSet.empty, pageCount: 1, signature: '' }),
            apply: (tr, value) => {
              const meta = tr.getMeta(docPaginationKey) as PaginationState | undefined
              if (meta) {
                if (meta.pageCount !== value.pageCount) onPages?.(meta.pageCount)
                return meta
              }
              /* 文档结构变了（增删块）→ 旧垫片的位置已失效，先清掉，等下一轮测量重新铺 */
              if (tr.docChanged && value.decorations !== DecorationSet.empty) {
                return { decorations: DecorationSet.empty, pageCount: value.pageCount, signature: '' }
              }
              return value
            },
          },

          props: {
            decorations(state: EditorState) {
              return docPaginationKey.getState(state)?.decorations ?? null
            },
          },
        }),
      ]
    },
  })
}

/** 把断点建成装饰集 */
export function buildGapDecorations(doc: EditorState['doc'], breaks: DocPageBreak[], contentHeight: number): DecorationSet {
  if (!breaks.length) return DecorationSet.empty
  const widgets = breaks.map((row) => {
    const height = Math.max(0, Math.round(row.heightMm * 10) / 10)
    return Decoration.widget(
      row.pos,
      () => {
        const el = document.createElement('div')
        el.className = DOC_GAP_CLASS
        el.setAttribute('aria-hidden', 'true')
        el.setAttribute('contenteditable', 'false')
        /* 高度写 mm：纸张本身就是 mm 尺寸，屏幕缩放下两者等比缩放，垫片不会跑偏 */
        el.style.height = `${height}mm`
        return el
      },
      /* side: -1 让它落在块**之前**；key 带上高度，高度一变就重建元素 */
      { side: -1, key: `gap-${row.pos}-${height}-${contentHeight}` },
    )
  })
  return DecorationSet.create(doc, widgets)
}

/** 落一次分页结果（不写历史：垫片是视图层的事，不该出现在撤销栈里） */
export function applyPagination(view: EditorView, snapshot: PaginationSnapshot, contentHeight: number) {
  const tr = view.state.tr
  tr.setMeta('addToHistory', false)
  tr.setMeta(docPaginationKey, {
    decorations: buildGapDecorations(view.state.doc, snapshot.breaks, contentHeight),
    pageCount: snapshot.pageCount,
    signature: snapshot.signature,
  } satisfies PaginationState)
  view.dispatch(tr)
}

/**
 * 摘掉垫片（保留页数不变，免得纸背景闪一下又回来）。
 *
 * 测量前必须走这一步：垫片会把后面所有块整体推下去，拿「带着垫片的位置」算断点，
 * 算法会以为那些块已经落在下一页的顶端，于是把垫片算成 0 毫米、断点整段失效。
 */
export function clearPagination(view: EditorView, keepPageCount: number) {
  const tr = view.state.tr
  tr.setMeta('addToHistory', false)
  tr.setMeta(docPaginationKey, {
    decorations: DecorationSet.empty,
    pageCount: keepPageCount,
    signature: '',
  } satisfies PaginationState)
  view.dispatch(tr)
}
