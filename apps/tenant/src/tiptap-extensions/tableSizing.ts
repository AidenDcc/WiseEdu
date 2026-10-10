/**
 * 表格尺寸：整表宽度、列宽（px，写进单元格的 colwidth）与行高（px，写进 `<tr style="height">`）。
 *
 * 列宽不能只改第一行：Tiptap 的 TableView 与序列化都只读**第一行**单元格的 colspan/colwidth 来生成
 * `<colgroup>`（@tiptap/extension-table 的 createColGroup / updateColumns），合并单元格后第一行未必
 * 覆盖到目标列。拖列边界时 prosemirror-tables 也是给整列每个单元格都写一遍 —— 下面 setColumnWidth
 * 就是它的 `updateColumnWidth` 的移植（prosemirror-tables@1.8.5 dist 里的同名函数），算法保持一致，
 * 面板输入与拖拽才不会互相覆盖。
 *
 * 行高挂在 `tr` 上而不是单元格：一行的高度是整行的属性，写到每个 td 上既冗余又会在合并 / 拆分时
 * 对不齐。`<tr style="height: 40px">` 是 Word 与浏览器都认的写法（净化白名单里 tr 的 height 已放行）。
 *
 * 整表宽度挂在 table 的 `tableWidth`（px）上，序列化成 `<table style="width: 400px">`。
 * 序列化这一头是现成的：Table.renderHTML 遇到 `HTMLAttributes.style` 就原样用它（否则才按列宽写
 * width / min-width），而属性自带的 renderHTML 正好产出这一段 style。
 *
 * **但光有属性不够，必须连 TableView 一起换掉** —— 编辑器里的宽度是运行时算出来的，不经序列化：
 * TableView 的 updateColumns 每次都按 colwidth 重写 `table.style.width / minWidth`（列宽都算得出来时
 * 写 width，否则写 min-width），会把我们的宽度盖掉，于是成了「编辑器里铺满整行、只读端与导出端却是
 * 400px」。所以 PaperTableView 在父类算完之后再把 tableWidth 写回去。
 *
 * PaperTableView 另外挂两个手柄（都在 .tableWrapper 里绝对定位，样式在 RichTextEditor.vue）：
 * - **整表宽度**：竖条，贴在表格右边缘，左右拖；
 * - **行高**：横条，跟着鼠标所在行的下边界走，上下拖 —— 与列宽拖拽一起构成「表格尺寸都能直接拖」。
 * 两者过程都只改 DOM、松手才派发事务，撤销才有得撤。
 */
import { getStyleProperty, type CommandProps } from '@tiptap/core'
import { Table, TableRow, TableView, type TableOptions } from '@tiptap/extension-table'
import { TableMap } from '@tiptap/pm/tables'
import type { Node as ProseMirrorNode, ResolvedPos } from '@tiptap/pm/model'
import type { EditorView, ViewMutationRecord } from '@tiptap/pm/view'
import type { Transaction } from '@tiptap/pm/state'

/** 列宽下限：与 Table 扩展的 cellMinWidth 默认值一致，再窄列就点不中拖拽手柄了 */
export const COL_WIDTH_MIN = 25
/** 列宽上限：对齐富文本净化白名单里 `width` 的上限（shared/utils/richtext.ts 的 isCssLength 传 2000）。
    超上限的宽度存库时会被整条剥掉 —— 用户拖/输的列宽重开就没了，所以在命令这一层就收住。 */
export const COL_WIDTH_MAX = 2000
/** 行高上下限：给个框，避免手输 0 或 9999 把表格撑坏 */
export const ROW_HEIGHT_MIN = 20
export const ROW_HEIGHT_MAX = 400
/** 整表宽度的上下限：上限同上（存库那关的 2000px），下限给一个还看得出是表格的值 */
export const TABLE_WIDTH_MIN = 80
export const TABLE_WIDTH_MAX = 2000

/** 整表宽度拖拽手柄的类名（样式在 RichTextEditor.vue 里，带 data-v 作用域，只能按类名认） */
const GRIP_CLASS = 'rte-table-grip'
/** 行高拖拽手柄的类名（同上） */
const ROW_GRIP_CLASS = 'rte-row-grip'
/** 行高的判定带：鼠标进到行下边界上下 5px 内才亮出行高手柄 */
const ROW_GRIP_TOLERANCE = 5
/** 拖动阈值：位移小于它不算拖过，避免「点一下就把自然高度钉成固定值」 */
const DRAG_THRESHOLD = 3

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    tableSizing: {
      /** 把 pos 所在列整列设为该宽度（px）；pos 省略时用当前选区 */
      setColumnWidth: (width: number, pos?: number) => ReturnType
      /** 把 pos 所在行设为该高度（px）；null 表示取消高度限制 */
      setRowHeight: (height: number | null, pos?: number) => ReturnType
      /** 把 pos 所在的表整体设为该宽度（px）；null 表示交还给列宽 / 铺满整行 */
      setTableWidth: (width: number | null, pos?: number) => ReturnType
    }
  }
}

function clampHeight(value: number): number {
  return Math.min(Math.max(Math.round(value), ROW_HEIGHT_MIN), ROW_HEIGHT_MAX)
}

function clampTableWidth(value: number): number {
  return Math.min(Math.max(Math.round(value), TABLE_WIDTH_MIN), TABLE_WIDTH_MAX)
}

/**
 * 从文档里的某个位置往上找它所在的表：返回表的节点与在文档里的位置。
 * 四个调用方共用这一套定位：尺寸命令、边框命令（tableCellStyle.ts）、拖拽手柄（findSelf 除外，
 * 那个认 DOM）、以及工具栏的锚点校验。
 */
export function findTableAt($from: ResolvedPos): { pos: number; node: ProseMirrorNode } | null {
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const node = $from.node(depth)
    if (node.type.name === 'table') return { pos: $from.before(depth), node }
  }
  return null
}

/**
 * 命令的作用点：显式给了 `pos` 就用它，否则用当前选区。
 *
 * `pos` 是给表格面板用的 —— 面板里的输入框会把正文焦点抢走，「当前选区」在提交那一刻未必还是
 * 用户打开面板时看着的那张表（命令串自己的 `.focus()` 还会在下一帧把焦点抢回正文、让浏览器
 * 顺手恢复 DOM 选区）。所以面板在打开那一刻记下位置，提交时按**位置**落下去。
 * pos 越界（面板里删过行列）返回 null，调用方退回当前选区。
 */
export function resolveTarget(tr: Transaction, pos?: number): ResolvedPos | null {
  if (pos === undefined) return tr.selection.$from
  if (pos < 0 || pos > tr.doc.content.size) return null
  return tr.doc.resolve(pos)
}

/** 改宽度：值没变返回 false（不让调用方白白派发一个空事务） */
function applyTableWidth(
  tr: Transaction,
  pos: number,
  node: ProseMirrorNode,
  width: number | null,
  dispatch?: boolean,
): boolean {
  const next = width === null ? null : clampTableWidth(width)
  if (node.attrs.tableWidth === next) return false
  if (dispatch) tr.setNodeMarkup(pos, undefined, { ...node.attrs, tableWidth: next })
  return true
}

export const RowHeight = TableRow.extend({
  addAttributes() {
    /* TableRow 自身没有任何属性（不像 OrderedList 有 start / type），父级这里是空的 */
    return {
      ...this.parent?.(),

      rowHeight: {
        default: null,
        parseHTML: (element) => {
          const raw = getStyleProperty(element as HTMLElement, 'height')
          const matched = raw ? /^(\d{1,4})px$/.exec(raw.trim()) : null
          return matched ? clampHeight(Number(matched[1])) : null
        },
        renderHTML: (attributes) =>
          attributes.rowHeight ? { style: `height: ${attributes.rowHeight}px` } : {},
      },
    }
  },

  addCommands() {
    return {
      ...this.parent?.(),

      /* 三个尺寸命令的作用点一律走 resolveTarget（显式 pos 优先，见它的注释）；
         读的是 **事务** 上的 selection（`tr.selection`）而不是 `state.selection` —— Tiptap 的链式
         调用里，后续命令拿到的 `state` 始终是链开始那一刻的（与 tableCellStyle.ts 同一条口径）。 */
      setColumnWidth: (width, pos) => ({ tr, dispatch }: CommandProps) => {
        const $from = resolveTarget(tr, pos) ?? tr.selection.$from
        let tableDepth = -1
        let cellDepth = -1
        for (let depth = $from.depth; depth > 0; depth -= 1) {
          const role = $from.node(depth).type.spec.tableRole
          if (role === 'cell' || role === 'header_cell') cellDepth = depth
          if (role === 'table') {
            tableDepth = depth
            break
          }
        }
        if (tableDepth < 0 || cellDepth < 0) return false

        const table = $from.node(tableDepth)
        /* 表格内容的起始位置：map 里的偏移量都是相对它的 */
        const tableStart = $from.start(tableDepth)
        const map = TableMap.get(table)
        const col = map.colCount($from.before(cellDepth) - tableStart) + $from.node(cellDepth).attrs.colspan - 1
        if (col < 0 || col >= map.width) return false

        const target = Math.min(Math.max(Math.round(width), COL_WIDTH_MIN), COL_WIDTH_MAX)
        let changed = false
        for (let row = 0; row < map.height; row += 1) {
          const index = row * map.width + col
          /* 上一行同一格是同一个单元格（rowspan 跨过来的），跳过，别重复写 */
          if (row > 0 && map.map[index] === map.map[index - map.width]) continue
          const offset = map.map[index]
          const attrs = table.nodeAt(offset)?.attrs
          if (!attrs) continue
          /* 合并单元格里 colwidth 是「每个被占列各一格」的数组，取本列那一格 */
          const slot = attrs.colspan === 1 ? 0 : col - map.colCount(offset)
          if (attrs.colwidth && attrs.colwidth[slot] === target) continue
          const colwidth: number[] = attrs.colwidth ? attrs.colwidth.slice() : new Array(attrs.colspan).fill(0)
          colwidth[slot] = target
          if (dispatch) tr.setNodeMarkup(tableStart + offset, undefined, { ...attrs, colwidth })
          changed = true
        }
        return changed
      },

      setRowHeight: (height, pos) => ({ tr, dispatch }: CommandProps) => {
        const $from = resolveTarget(tr, pos) ?? tr.selection.$from
        for (let depth = $from.depth; depth > 0; depth -= 1) {
          const node = $from.node(depth)
          if (node.type.spec.tableRole !== 'row') continue
          const next = height === null ? null : clampHeight(height)
          if (node.attrs.rowHeight === next) return false
          if (dispatch) tr.setNodeMarkup($from.before(depth), undefined, { ...node.attrs, rowHeight: next })
          return true
        }
        return false
      },

      setTableWidth: (width, pos) => ({ tr, dispatch }: CommandProps) => {
        const found = findTableAt(resolveTarget(tr, pos) ?? tr.selection.$from)
        if (!found) return false
        /* 命令签名里的 dispatch 是「可选的派发函数」，这里只关心「有没有」（can() 时不派发） */
        return applyTableWidth(tr, found.pos, found.node, width, !!dispatch)
      },
    }
  },
})

/**
 * 编辑器里的 table 视图：父类负责列宽与列宽拖拽，这里补三件父类不管的事 ——
 * 整表宽度写回、整表宽度手柄、行高手柄。
 */
export class PaperTableView extends TableView {
  private readonly view: EditorView | undefined
  private grip: HTMLElement | null = null
  private rowGrip: HTMLElement | null = null
  private gripObserver: ResizeObserver | null = null
  /** 行高手柄当前贴着的那一行（按下时从它取起始高度） */
  private hoveredRow: HTMLTableRowElement | null = null
  /** 正在拖行高的那一行；非空即表示拖拽中（ignoreMutation 认这个标记） */
  private dragRow: HTMLTableRowElement | null = null

  constructor(node: ProseMirrorNode, defaultCellMinWidth: number, view?: EditorView) {
    super(node, defaultCellMinWidth)
    /* columnResizing 插件与 addNodeView 都用 (node, cellMinWidth, view, …) 实例化，第 3 个位置参数就是编辑器视图 */
    this.view = view
    this.syncWidth()
    this.mountHandles()
  }

  /** 父类按列宽算完 table.style 后，把「整表宽度」这一档盖回去 */
  private syncWidth(): void {
    const width = this.node.attrs.tableWidth as number | null
    if (!width) return
    this.table.style.width = `${width}px`
    this.table.style.minWidth = ''
  }

  private mountHandles(): void {
    /* 只读渲染（editor.isEditable 为 false 时 Tiptap 也会用同一个 View）不加手柄：那里不可编辑，拖了没意义 */
    if (!this.view?.editable) return

    const grip = document.createElement('div')
    grip.className = GRIP_CLASS
    grip.title = '拖动调整表格整体宽度'
    grip.addEventListener('mousedown', this.onGripDown)
    /* 手柄是 tableWrapper 里的绝对定位元素（wrapper 的 position: relative 见 RichTextEditor.vue），
       靠 left 跟着表格右边缘走 */
    this.dom.appendChild(grip)
    this.grip = grip

    /* 行高手柄：一根横条，跟着鼠标所在行的下边界走 —— 见 onHandleMove */
    const rowGrip = document.createElement('div')
    rowGrip.className = ROW_GRIP_CLASS
    rowGrip.title = '拖动调整行高'
    rowGrip.addEventListener('mousedown', this.onRowGripDown)
    this.dom.appendChild(rowGrip)
    this.rowGrip = rowGrip

    /* 鼠标在表格上移动时才判断该不该亮行高手柄：挂在 wrapper 上（表格里的事件都会冒到这里），
       手柄自己就在 wrapper 里，不会漏 */
    this.dom.addEventListener('mousemove', this.onHandleMove)
    this.dom.addEventListener('mouseleave', this.onWrapperLeave)

    /* 容器变宽变窄（窗口缩放、侧栏开合）时不会走 update()，用 ResizeObserver 兜住，
       否则手柄会停在旧位置上 */
    if (typeof ResizeObserver !== 'undefined') {
      this.gripObserver = new ResizeObserver(() => this.placeGrip())
      this.gripObserver.observe(this.table)
    }
    this.placeGrip()
  }

  private placeGrip(): void {
    if (this.grip) this.grip.style.left = `${this.table.offsetWidth}px`
  }

  /**
   * 鼠标落到「某一行的下边界」附近时，把行高手柄挪过去亮出来。
   *
   * 只认下边界：相邻两行共用一条边，认下边界就够覆盖到每一行，也顺手把表格顶边排除掉了
   * （那属于表头行，而表头行的下边界同样能表达「拖它」）。
   */
  private onHandleMove = (event: MouseEvent): void => {
    /* 拖拽中不重算（onRowGripDown 自己在跟着走）；指针已经落在手柄上时也不算 —— 手柄一显示就把
       指针接了过去，此时 event.target 是手柄而不是 <tr>，照常算会得出「不在行上」于是藏起来，
       藏起来指针又落回 <tr> 又显示，一帧一帧地闪 */
    if (this.dragRow || event.target === this.rowGrip) return
    const target = event.target as HTMLElement | null
    const row = (target?.closest?.('tr') ?? null) as HTMLTableRowElement | null
    /* parentElement 必须是 tbody 本身：嵌套表格里的行也叫 <tr>，拖它没有任何意义 */
    if (!row || row.parentElement !== this.contentDOM) return this.hideRowGrip()
    const rect = row.getBoundingClientRect()
    if (rect.bottom - event.clientY > ROW_GRIP_TOLERANCE) return this.hideRowGrip()
    this.showRowGrip(row)
  }

  private onWrapperLeave = (): void => {
    if (!this.dragRow) this.hideRowGrip()
  }

  private showRowGrip(row: HTMLTableRowElement): void {
    const grip = this.rowGrip
    if (!grip) return
    const offset = row.getBoundingClientRect().bottom - this.dom.getBoundingClientRect().top
    grip.style.top = `${Math.round(offset)}px`
    grip.classList.add('is-on')
    this.hoveredRow = row
  }

  private hideRowGrip = (): void => {
    this.hoveredRow = null
    this.rowGrip?.classList.remove('is-on')
  }

  /** 拖动改宽度：过程只改 DOM（不派发事务，跟 prosemirror-tables 拖列宽一个路子），松手才落库 */
  private onGripDown = (event: MouseEvent): void => {
    if (!this.view?.editable) return
    /* 必须连 mousedown 一起断掉：PM 在编辑区根节点上监听着 mousedown，漏过去就会把这次拖拽
       当成一次普通点击去重设选区 */
    event.preventDefault()
    event.stopPropagation()

    const startX = event.clientX
    const startWidth = this.table.getBoundingClientRect().width
    let width = Math.round(startWidth)
    let moved = false

    const onMove = (move: MouseEvent): void => {
      /* 抖动阈值：手一抖也算「拖过」的话，光点一下手柄就会把 100% 宽的表格钉成固定像素宽 */
      if (!moved && Math.abs(move.clientX - startX) < DRAG_THRESHOLD) return
      moved = true
      width = clampTableWidth(startWidth + move.clientX - startX)
      this.table.style.width = `${width}px`
      this.table.style.minWidth = ''
      this.placeGrip()
    }
    const onUp = (): void => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      /* 没拖动过就什么都不写：DOM 也从头到尾没被动过，表格保持原样 */
      if (moved) this.commitWidth(width)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  /** 拖动改行高：与宽度手柄同一套路子 —— 过程中改的是 <tr> 的行内 height，松手才落库 */
  private onRowGripDown = (event: MouseEvent): void => {
    const row = this.hoveredRow
    if (!this.view?.editable || !row) return
    event.preventDefault()
    event.stopPropagation()

    const startY = event.clientY
    const startHeight = row.getBoundingClientRect().height
    let height = Math.round(startHeight)
    let moved = false
    this.dragRow = row

    const onMove = (move: MouseEvent): void => {
      if (!moved && Math.abs(move.clientY - startY) < DRAG_THRESHOLD) return
      moved = true
      height = clampHeight(startHeight + move.clientY - startY)
      row.style.height = `${height}px`
      /* 手柄跟着新的下边界走（行的下边界正是被拖动的那条线） */
      this.showRowGrip(row)
    }
    const onUp = (): void => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      const target = this.dragRow
      this.dragRow = null
      if (moved && target) this.commitRowHeight(target, height)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  /** 反查自己：手柄是表格自己的 DOM，在文档里的位置得找回来 —— 全文档扫一遍，认 DOM 认到自己为止 */
  private findSelf(): { pos: number; node: ProseMirrorNode } | null {
    const view = this.view
    if (!view) return null
    const hits: { pos: number; node: ProseMirrorNode }[] = []
    view.state.doc.descendants((node, pos) => {
      if (hits.length) return false
      if (node.type.name !== 'table') return true
      const dom = view.nodeDOM(pos)
      /* nodeDOM 给的是 node view 的根（.tableWrapper）；两种形态都认一下，免得跟着实现细节走 */
      if (dom === this.dom || dom === this.table) hits.push({ pos, node })
      return true
    })
    return hits[0] ?? null
  }

  private commitWidth(width: number): void {
    const view = this.view
    const hit = this.findSelf()
    if (!view || !hit) return
    view.dispatch(view.state.tr.setNodeMarkup(hit.pos, undefined, {
      ...hit.node.attrs,
      tableWidth: clampTableWidth(width),
    }))
  }

  /** 落库：DOM 的行要换算成文档里的行 —— 按 **tbody 直接子元素**里的序号对齐，嵌套表格的行混不进来 */
  private commitRowHeight(row: HTMLTableRowElement, height: number): void {
    const view = this.view
    const self = this.findSelf()
    if (!view || !self) return
    const index = Array.from(this.contentDOM.children).indexOf(row)
    if (index < 0 || index >= self.node.childCount) return

    /* 行在表格内容里的偏移得**累加**（每行的 nodeSize 不同，不能拿序号当偏移） */
    let offset = -1
    let i = 0
    self.node.forEach((_child, childOffset) => {
      if (i === index) offset = childOffset
      i += 1
    })
    if (offset < 0) return

    const rowNode = self.node.child(index)
    const next = clampHeight(height)
    if (rowNode.attrs.rowHeight === next) return
    view.dispatch(view.state.tr.setNodeMarkup(self.pos + 1 + offset, undefined, {
      ...rowNode.attrs,
      rowHeight: next,
    }))
  }

  update(node: ProseMirrorNode): boolean {
    const ok = super.update(node)
    this.syncWidth()
    this.placeGrip()
    /* 文档变了，行高手柄贴的那一行可能已经不是原来那一行（或已经不存在）—— 先藏起来，
       下一次鼠标移动会重新判断。拖拽中不会有事务，所以这里不会打断手上的拖拽 */
    this.hideRowGrip()
    return ok
  }

  /**
   * 行高手柄拖拽时要放行 `<tr>` 的 style 改动。
   *
   * 父类（@tiptap/extension-table 的 TableView）只忽略 wrapper 内、contentDOM 外的改动 ——
   * 整表宽度手柄正好落在这一区里不用管，但 `tr` 在 contentDOM（tbody）**里面**，不改这一条的话,
   * 拖拽中每改一次行内 height，PM 都会拿 DOM 反推文档、把高度当场抹回去（并顺带派发一串事务）。
   * 只放行「正在拖的那一行」的属性变更：其余改动照旧交给父类判断。
   */
  ignoreMutation(mutation: ViewMutationRecord): boolean {
    if (super.ignoreMutation(mutation)) return true
    return this.dragRow !== null && mutation.type === 'attributes' && mutation.target === this.dragRow
  }

  destroy(): void {
    this.gripObserver?.disconnect()
    this.gripObserver = null
    this.dom.removeEventListener('mousemove', this.onHandleMove)
    this.dom.removeEventListener('mouseleave', this.onWrapperLeave)
    if (this.grip) {
      this.grip.removeEventListener('mousedown', this.onGripDown)
      this.grip.remove()
      this.grip = null
    }
    if (this.rowGrip) {
      this.rowGrip.removeEventListener('mousedown', this.onRowGripDown)
      this.rowGrip.remove()
      this.rowGrip = null
    }
    this.hoveredRow = null
    this.dragRow = null
  }
}

export const PaperTable = Table.extend({
  addOptions() {
    /* `this.parent?.()` 的类型带着 `| undefined`（运行时其实一定有 —— Tiptap 给每个扩展都挂了
       parent），摊开后 HTMLAttributes / resizable 这些必填项会全变成可选，对不上 TableOptions，
       所以在这里补一次断言 */
    return {
      ...(this.parent?.() as TableOptions),
      /* 换掉列宽拖拽用的 table 视图（见 PaperTableView 顶部注释） */
      View: PaperTableView,
    }
  },

  addAttributes() {
    return {
      /* Table 自己不带属性（列宽在单元格的 colwidth 上），显式摊开父级是防将来加属性时漏接 */
      ...this.parent?.(),

      tableWidth: {
        default: null,
        /* 只认自家落的纯 px 宽度：Tiptap 默认写的是 min-width，粘贴进来的多半是 `width: 100%`，
           都不该当成「用户设过的整表宽度」（% 也会让导出的 Word 与浏览器算出不同的宽度） */
        parseHTML: (element) => {
          const raw = getStyleProperty(element as HTMLElement, 'width')
          const matched = raw ? /^(\d{1,4})px$/.exec(raw.trim()) : null
          return matched ? clampTableWidth(Number(matched[1])) : null
        },
        /* 落成行内 width 后，三端都不必再额外写规则：只读端与导出端的 `table { width: 100% }`
           是作者样式，压不过行内样式；编辑器这端由 PaperTableView 保证不被列宽推算盖掉 */
        renderHTML: (attributes) =>
          attributes.tableWidth ? { style: `width: ${attributes.tableWidth}px` } : {},
      },
    }
  },
})
