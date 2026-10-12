/**
 * 试卷自动分版（分页）：把排版块按「实测高度」贪心装箱到固定高度的版面里。
 *
 * 这里的一「页」= 一个版面（版）：8K / A3 一面两版时，调用方把两个版拼到一张纸面上。
 * 分版对版数透明，因此换纸张只影响拼版（谁和谁同处一张纸），不影响分版结果。
 *
 * 为什么不用 CSS 多列 / 分页属性：卷面必须严格等于纸面尺寸并显示版框，
 * 浏览器原生的列 / 分页断点不可控（会产生跨版残行、版框对不齐）。
 * 这里改为：先在隐藏的测量层按各块的真实宽度量高，再自己装箱，
 * 于是每一个版的内容高度必然 ≤ 版心高，版框严格成立。
 *
 * 装箱规则：
 * 1. 通栏块（卷头、大题标题、解答题）各占一行，放不下就换版；
 * 2. 版内双栏块（客观题）先填满左栏再填右栏，两栏都满才换版；
 * 3. 卷头与大题标题不留孤行——放它之前顺带看紧跟的下一块放不放得下。
 */
import type { PaperBlock } from './paper-layouts'

export type PaperRow =
  | { kind: 'full'; block: PaperBlock }
  | { kind: 'cols'; left: PaperBlock[]; right: PaperBlock[] }

export interface PaperPage {
  rows: PaperRow[]
}

export interface PaginateInput {
  blocks: PaperBlock[]
  /** 块高（含块间距），由测量层给出 */
  heightOf: (block: PaperBlock) => number
  /** 每页可填充的高度（版心高） */
  pageHeight: number
}

export function paginateBlocks({ blocks, heightOf, pageHeight }: PaginateInput): PaperPage[] {
  const pages: PaperPage[] = []
  let rows: PaperRow[] = []
  /** 当前双栏行：左/右栏已放块与已用高度 */
  let cols: { left: PaperBlock[]; right: PaperBlock[] } | null = null
  let used: [number, number] = [0, 0]
  /** 开这一行时本页已用高度：双栏行的可用高度 = pageHeight − colBase */
  let colBase = 0
  /** 当前页已闭合行的累计高度 */
  let pageUsed = 0

  function closeCols() {
    if (cols && (cols.left.length || cols.right.length)) {
      rows.push({ kind: 'cols', left: cols.left, right: cols.right })
      pageUsed += Math.max(used[0], used[1])
    }
    cols = null
    used = [0, 0]
    colBase = 0
  }

  function spill() {
    pages.push({ rows })
    rows = []
    pageUsed = 0
    cols = null
    used = [0, 0]
    colBase = 0
  }

  blocks.forEach((block, index) => {
    const h = heightOf(block)
    /** 标题类块不留孤行：连同紧随的下一块一起判断 */
    const header = block.kind !== 'question'
    const next = index + 1 < blocks.length ? blocks[index + 1] : null
    const need = header && next ? h + heightOf(next) : h

    if (block.span === 2) {
      closeCols()
      if (rows.length && pageUsed + need > pageHeight) spill()
      rows.push({ kind: 'full', block })
      pageUsed += h
      return
    }

    if (!cols) {
      if (rows.length && pageUsed + need > pageHeight) spill()
      cols = { left: [], right: [] }
      colBase = pageUsed
    }
    /* 栏内可填高度是「本页剩余」而不是整页：双栏行常接在卷头 / 大题标题之后 */
    const cap = pageHeight - colBase
    if (used[0] === 0 || used[0] + h <= cap) {
      cols.left.push(block)
      used[0] += h
    } else if (used[1] === 0 || used[1] + h <= cap) {
      cols.right.push(block)
      used[1] += h
    } else {
      /* 两栏都满：闭合本行后另起一页继续 */
      closeCols()
      spill()
      cols = { left: [block], right: [] }
      colBase = 0
      used = [h, 0]
    }
  })

  closeCols()
  if (rows.length) pages.push({ rows })
  return pages.length ? pages : [{ rows: [] }]
}
