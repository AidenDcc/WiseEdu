/**
 * 试卷预览左栏「推荐试卷」：正在看的那份卷的**同年级同学科**卷，按浏览数取前几份。
 *
 * 试卷库与组卷工作台「试卷」页签的预览都要这一段。两处的卷池来源不同（试卷库用自己那份
 * 已审核列表，工作台用 `useComposeData` 的全量卷），但筛选与排序的口径必须一致 ——
 * 同一份卷在两个入口推荐出不同的卷，正是「同一件事两处实现」慢慢漂移的典型（本仓把这类
 * 算法收在一处，见同目录的 `paper-stats.ts` / `paper-layouts.ts`）。
 *
 * 取「同年级同学科」而不是按当前筛选条件：筛选是用户为**找卷**设的（比如限定「竞赛 + 2026 年」），
 * 拿它当推荐条件，切一次筛选推荐就换一批，反而像另一个搜索结果列表；年级学科是卷的固有属性，
 * 推荐的是「同一批人能用的卷」。排除当前卷本身，浏览数相同时按 id 排，保证顺序稳定。
 */
import type { OrgPaper } from '@aiteach/shared'

/** 侧栏只放得下这么多：再多就把「试题统计」挤到需要滚动才看得见 */
export const RECOMMEND_COUNT = 3

export function recommendPapers(
  pool: OrgPaper[],
  current: OrgPaper | null,
  count = RECOMMEND_COUNT,
): OrgPaper[] {
  if (!current) return []
  return pool
    .filter((row) => row.id !== current.id && row.grade === current.grade && row.subject === current.subject)
    .sort((a, b) => (b.viewCount ?? 0) - (a.viewCount ?? 0) || a.id - b.id)
    .slice(0, count)
}
