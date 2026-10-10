/**
 * 单元格底纹（背景色）与单元格边框颜色：
 * `<td style="background-color: #fef3c7; border-color: #c0272d">`。
 *
 * **为什么都挂在单元格上而不是整表上**：试卷里真正要上色的是「表头的灰底」「某个重点格的黄底」
 * 这类局部；而单元格属性天然覆盖整表这个用法 —— 用鼠标从表格一角拖到对角，框选全部格子再点色块，
 * 就是整表上色。一个属性两种用法，不必再养一个 table 级属性（那个还会被表头自身的
 * `th { background }` 盖住，看着像没生效）。
 *
 * 边框颜色反而是**整表铺一遍**（`setTableBorderColor`）：三端的 `td, th { border: 1px solid … }`
 * 是作者样式，`border-collapse: collapse` 下相邻格子的边框还要按「宽 → 样式 → 位置」的规则仲裁，
 * 写在 table 上压不住单元格自己那条；而 `border-color: inherit` 在 Word 里不生效
 * （Word 只认落在单元格上的行内样式）。改边框在试卷里就是「整张表换个颜色」，逐格写正好。
 *
 * **为什么不用官方的 `setCellAttribute`**：它开头有一句
 * `if ($cell.nodeAfter.attrs[name] === value) return false`，而 `$cell` 取的是**选区锚点那一格** ——
 * 框选一片颜色不一的格子时，只要锚点那格恰好已是目标色，整次操作会被判成「没变化」直接吞掉。
 * 这里自己走一遍选区逐格比对，不做这个提前返回。
 *
 * 取值只认 `#hex`（与字色同一个口径，见 tiptap-extensions/color.ts）：Word 只认 #hex，
 * 净化白名单（shared/utils/richtext.ts 的 STYLE_PROPS.background-color / border-color）也只放行 #hex。
 */
import { getStyleProperty, type CommandProps } from '@tiptap/core'
import { TableCell, TableHeader } from '@tiptap/extension-table'
import { CellSelection } from '@tiptap/pm/tables'
import type { Transaction } from '@tiptap/pm/state'
import { toHexColor } from '@aiteach/shared'
import { findTableAt, resolveTarget } from './tableSizing'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    tableCellStyle: {
      /** 给当前单元格（或框选的多个单元格）设底纹；null 表示清除 */
      setCellBackground: (color: string | null) => ReturnType
      /** 给 pos 所在的整张表设边框颜色（逐格写）；pos 省略时用当前选区；null 表示回到默认边框色 */
      setTableBorderColor: (color: string | null, pos?: number) => ReturnType
    }
  }
}

/** td / th 共用一份属性定义，免得两边的解析口径漂移 */
const cellStyleAttributes = {
  background: {
    default: null,
    parseHTML: (element: HTMLElement) => {
      /* 只读行内样式：表头那层灰底来自样式表（RichTextViewer / 导出 CSS 里的 `th { background }`），
         不该被当成「用户设过的底纹」回填进文档 */
      const value = getStyleProperty(element, 'background-color') ?? element.style.backgroundColor
      if (!value) return null
      return toHexColor(value) ?? value.replace(/['"]+/g, '')
    },
    renderHTML: (attributes: { background?: string | null }) =>
      attributes.background ? { style: `background-color: ${attributes.background}` } : {},
  },

  borderColor: {
    default: null,
    parseHTML: (element: HTMLElement) => {
      /* 与底纹同一口径：只认行内 `border-color`，不认样式表里那条（`border: 1px solid var(--border)`）。
         第二个取值兜住 `border: 1px solid #c0272d` 这种简写粘贴进来的情形 */
      const value = getStyleProperty(element, 'border-color') ?? element.style.borderColor
      return value ? (toHexColor(value) ?? null) : null
    },
    renderHTML: (attributes: { borderColor?: string | null }) =>
      attributes.borderColor ? { style: `border-color: ${attributes.borderColor}` } : {},
  },
}

/**
 * 选区里的单元格位置：框选时是每一格，普通光标时是光标所在那一格。
 *
 * 一律读**事务**上的 selection（`tr.selection` / `tr.doc`）而不是 `state.selection`：
 * Tiptap 的链式调用里，后续命令拿到的 `state` 始终是链开始那一刻的，链中间改过的选区只体现在
 * `tr` 上 —— 读 state 的话，任何「先改选区再上色」的链（`chain().setCellSelection(...).setCellBackground(...)`）
 * 都会退化成「只给链开始那一刻光标所在的那一格上色」。
 */
function selectedCellPositions(tr: Transaction): number[] {
  const { selection } = tr
  if (selection instanceof CellSelection) {
    const positions: number[] = []
    /* forEachCell 给的 pos 就是单元格在文档里的起始位置（map 偏移 + 表格内容起点） */
    selection.forEachCell((_node, pos) => positions.push(pos))
    return positions
  }
  const $from = selection.$from
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    const role = $from.node(depth).type.spec.tableRole
    if (role === 'cell' || role === 'header_cell') return [$from.before(depth)]
  }
  return []
}

function setCellBackground(color: string | null) {
  return ({ tr, dispatch }: CommandProps): boolean => {
    const positions = selectedCellPositions(tr)
    let changed = false
    for (const pos of positions) {
      /* 逐格从 **tr.doc** 上取：前一次 setNodeMarkup 之后，后面几格的属性以最新的一份为准 */
      const cell = tr.doc.nodeAt(pos)
      if (!cell || cell.attrs.background === color) continue
      if (dispatch) tr.setNodeMarkup(pos, undefined, { ...cell.attrs, background: color })
      changed = true
    }
    return changed
  }
}

/** 整表边框换色：与底纹同一套「逐格比对」，铺满表格的每一格（含嵌套表格里的） */
function setTableBorderColor(color: string | null, pos?: number) {
  return ({ tr, dispatch }: CommandProps): boolean => {
    const table = findTableAt(resolveTarget(tr, pos) ?? tr.selection.$from)
    if (!table) return false

    /* descendants 给的偏移是相对**表格内容起点**的，所以文档位置 = 表的位置 + 1 + 偏移
       （与 PaperTableView.commitRowHeight 里改行高是同一套换算） */
    const positions: number[] = []
    table.node.descendants((node, offset) => {
      const role = node.type.spec.tableRole
      if (role === 'cell' || role === 'header_cell') positions.push(table.pos + 1 + offset)
      return true
    })

    let changed = false
    for (const pos of positions) {
      const cell = tr.doc.nodeAt(pos)
      if (!cell || cell.attrs.borderColor === color) continue
      if (dispatch) tr.setNodeMarkup(pos, undefined, { ...cell.attrs, borderColor: color })
      changed = true
    }
    return changed
  }
}

export const PaperTableCell = TableCell.extend({
  addAttributes() {
    return { ...this.parent?.(), ...cellStyleAttributes }
  },

  addCommands() {
    return {
      ...this.parent?.(),
      /* 命令注册在 tableCell 上就够：命令挂在编辑器上，与光标落在 td 还是 th 无关；
         两边各注册一次会撞名（Tiptap 对同名命令会告警） */
      setCellBackground,
      setTableBorderColor,
    }
  },
})

export const PaperTableHeader = TableHeader.extend({
  addAttributes() {
    return { ...this.parent?.(), ...cellStyleAttributes }
  },
})
