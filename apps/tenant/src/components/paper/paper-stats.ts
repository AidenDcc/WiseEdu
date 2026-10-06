/**
 * 卷面分布统计：按某个取值把卷内题目分堆计数（题型 / 难度这类单维分布）。
 *
 * 两处在用 —— `PaperAnalysisModal`（试卷分析里的题型、难度分布条）与 `PaperPreviewModal`
 * 阅读模式的左栏「试题统计」（每个题型各多少道）。同一份卷在两处必须给出同一组数，
 * 各写一份 `Map` 累加迟早会漂移（本仓「同一件事只有一份实现」的既有做法）。
 *
 * 放在 `components/paper/` 下而不是 `utils/`：它是卷面这两个组件的共用算法，不是通用工具
 * （同目录的 `paper-layouts.ts` / `paginate.ts` 也是这个位置）。
 */
import type { OrgQuestion } from '@aiteach/shared'

/** 取值缺失时的归类名：缺失也要成一行，否则占比加起来不到 100% */
export const STAT_UNKNOWN = '未标注'

export interface StatRow {
  label: string
  count: number
  /** 占比（分母是传入的题量），展示时乘 100 */
  ratio: number
  /** 配色档位（目前只有难度给：易绿 / 中橙 / 难红） */
  tone?: string
}

export interface StatOptions {
  /** 给了就按它排序（难度等有固定读序的维度）；没给的（题型 / 知识点）按题量降序 */
  order?: readonly string[]
  /** 取值 → 配色档位，透传到 `StatRow.tone` */
  tones?: Record<string, string>
}

export function distributionOf(
  questions: OrgQuestion[],
  pick: (question: OrgQuestion) => string | undefined,
  options: StatOptions = {},
): StatRow[] {
  const map = new Map<string, number>()
  questions.forEach((question) => {
    const key = pick(question) || STAT_UNKNOWN
    map.set(key, (map.get(key) ?? 0) + 1)
  })
  const rows = [...map.entries()].map(([label, count]) => ({
    label,
    count,
    ratio: questions.length ? count / questions.length : 0,
    tone: options.tones?.[label],
  }))
  const order = options.order
  if (order) {
    return rows.sort((a, b) => {
      const ai = order.indexOf(a.label)
      const bi = order.indexOf(b.label)
      /* 不在次序里的（如「未标注」）压到最后 */
      return (ai < 0 ? order.length : ai) - (bi < 0 ? order.length : bi)
    })
  }
  /* 并列时按名称，保证每次渲染先后一致 */
  return rows.sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
}
