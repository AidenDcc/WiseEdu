/**
 * 试卷「年份」候选项的**唯一一份实现**：组卷工作台「试卷」页签的年份筛选行与智能组卷的
 * 「优先年份」共用它。
 *
 * 年份不是字典，取值域只能是**卷池里实际出现过的值** —— 照抄一串年份会造出点进去必然为空的档。
 * 具体年份按已入库的卷推导：近三届逐届列出（倒序，新的在前），更早的年份不再逐个列，
 * 统一并进 `EARLIER_YEAR` 哨兵（否则这一行会年年越铺越长）。
 *
 * 两处共用同一份而不是各写一遍：「智能组卷优先 2026 年」和「试卷库筛 2026 年」说的必须是
 * 同一批卷，各算各的迟早对不上。
 */
import { EARLIER_YEAR, isEarlierYear } from '@aiteach/shared'
import type { OrgPaper } from '@aiteach/shared'

/**
 * 年份候选项：近三届倒序 + 末尾的「更早以前」。
 *
 * 「更早以前」固定给一条（即使当前一份老卷也没有）：它是兜底的尾档，时有时无会让人
 * 以为年份只能选那几届。种子卷里留了老卷，这一档在演示里点得动。
 */
export function paperYearOptions(papers: OrgPaper[]): string[] {
  const years = new Set<string>()
  papers.forEach((row) => {
    if (row.year && !isEarlierYear(row.year)) years.add(row.year)
  })
  return [...years].sort().reverse().concat(EARLIER_YEAR)
}

/**
 * 年份行的 chip 文案：普通年份加「年」后缀，哨兵译成「更早以前」。
 *
 * 只改显示、不改取值 —— 回传给后端（或写进筛选项）的仍是 `'2026'` / `'earlier'`。
 */
export function yearOptionLabels(options: string[]): Record<string, string> {
  return Object.fromEntries(options.map((value) => [value, value === EARLIER_YEAR ? '更早以前' : `${value} 年`]))
}
