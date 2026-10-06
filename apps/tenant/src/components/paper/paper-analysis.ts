/**
 * 试卷分析的统计口径：把一份卷摊成「小事视图」，再按题型 / 难度 / 知识点三组口径统计。
 *
 * 放在 `components/paper/` 下而不是 `utils/`：它是试卷分析弹窗专用的算法，不是通用工具
 * （同目录的 `paper-stats.ts` / `paper-layouts.ts` / `paginate.ts` 也都是这个位置）。
 *
 * 三条贯穿全文件的口径，改数之前先读这三条：
 *
 * 1. **只统计能查到题目的小题**。卷里引用了、题库中已删除的历史题（`question` 为
 *    undefined）不进任何分布，只在弹窗页脚报一个数 —— 静默少算会让人以为分布算错了。
 * 2. **一题多知识点时会在多行重复计入**。一道题带「二次函数」「函数与导数」两个标签，
 *    它的 5 分与 1 次频数会同时算进两行，所以分值列 / 频数列的合计**允许超过 100%**。
 *    这是「知识点视角」的必然结果，不是 bug，页脚有说明。
 * 3. **频数按大题去重**：同一道大题里四道小题都带「阅读理解」时，频数只算 1（大题维度），
 *    而题数算 4。两个列因此回答的是不同问题：这卷「考了几处」与「出了几道」。
 */
import { paperTotalScore } from '@aiteach/shared'
import type { OrgKnowledgeNode, OrgPaper, OrgQuestion } from '@aiteach/shared'

/** 知识点档位：知识点树里的深度（根 = 一级）。固定五档，与题干的 chip 选项一一对应。 */
export const LEVEL_OPTIONS = ['一级', '二级', '三级', '四级', '五级'] as const
export type LevelName = (typeof LEVEL_OPTIONS)[number]
/** 卷内出现的、知识点树里查不到的知识标签：兜底成单独一档，不能静默丢掉 */
export const LEVEL_UNKNOWN = '未分级'

/**
 * 卷均考频的分母 = 参与分析的试卷数。
 * 目前只做单卷分析，恒为 1（即卷均考频 = 频数）；接入多卷对比后改成「勾选的试卷数」，
 * 表格里这一列才会与频数分开。
 */
export const PAPER_COUNT = 1

/** 卷内一道小题：题号 / 所属大题 / 卷内分值 / 对应题库题目（已删除的题没有） */
export interface PaperItem {
  /** 卷内题号：全卷连续编号（1 起），与纸面上印的题号一致 */
  number: number
  sectionIndex: number
  sectionTitle: string
  score: number
  question?: OrgQuestion
}

/** 卷内小题视图：题号按大题顺序连续编，跨大题不重置（与纸面一致） */
export function paperItems(paper: OrgPaper, questions: OrgQuestion[]): PaperItem[] {
  const byId = new Map(questions.map((row) => [row.id, row]))
  const items: PaperItem[] = []
  paper.sections.forEach((section, sectionIndex) => {
    section.questions.forEach((entry) => {
      items.push({
        number: items.length + 1,
        sectionIndex,
        sectionTitle: section.title,
        score: Number(entry.score) || 0,
        question: byId.get(entry.questionId),
      })
    })
  })
  return items
}

/** 能查到题目的小题（分布类统计只认它们） */
export function knownItems(items: PaperItem[]): PaperItem[] {
  return items.filter((item) => item.question)
}

/**
 * 知识标签 → 档位名。
 *
 * 档位不是题目数据（题目的 `knowledge` 只是扁平标签数组），只能从知识点树的深度推：
 * 一个 tag 挂在第几层，它就是几级。树里一个 tag 都没有时（历史 / 兜底树），
 * 退化为「叶子节点名」—— 与 `useKnowledgePool.collectTags` 同一套规则，否则同一棵树
 * 在两处会算出两套标签集合。
 *
 * 同一个 tag 可能挂在多处（如物理的「匀变速直线运动」在两个分类下各挂一次），取最浅的一档。
 */
export function knowledgeLevels(nodes: OrgKnowledgeNode[]): Map<string, string> {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const parentIds = new Set(nodes.map((node) => node.parentId).filter((id): id is string => id != null))
  const hasTag = nodes.some((node) => node.tag)

  function depthOf(node: OrgKnowledgeNode): number {
    let depth = 1
    let current = node
    /* 数据被改坏成环时最多爬 nodes.length 层，不会死循环 */
    for (let guard = 0; current.parentId && guard < nodes.length; guard += 1) {
      const parent = byId.get(current.parentId)
      if (!parent) break
      depth += 1
      current = parent
    }
    return depth
  }

  const map = new Map<string, string>()
  nodes.forEach((node) => {
    const label = hasTag ? node.tag : parentIds.has(node.id) ? undefined : node.name
    if (!label) return
    const level = LEVEL_OPTIONS[depthOf(node) - 1] ?? LEVEL_OPTIONS[LEVEL_OPTIONS.length - 1]
    const previous = map.get(label)
    /* 取最浅档：label 相同时比较档位在 LEVEL_OPTIONS 里的下标 */
    if (previous == null || LEVEL_OPTIONS.indexOf(level as LevelName) < LEVEL_OPTIONS.indexOf(previous as LevelName)) {
      map.set(label, level)
    }
  })
  return map
}

export interface KnowledgeRow {
  label: string
  /** 档位名（LEVEL_OPTIONS 之一或 LEVEL_UNKNOWN） */
  level: string
  /** 频数：带该标签的**大题数**（大题内去重） */
  frequency: number
  /** 频率：频数 ÷ 当前题型范围内的总频数 */
  rate: number
  /** 卷均考频：频数 ÷ 试卷数（单卷口径下 = 频数） */
  perPaper: number
  /** 分值：带该标签的小题分值合计（一题多标签会重复计入） */
  score: number
  /** 分值占比：分值 ÷ 卷面总分值（分母固定为整卷总分，不随题型筛选变） */
  scoreRatio: number
  /** 覆盖的题号（卷内连续编号） */
  numbers: number[]
  /** 题数：带该标签的小题数量 */
  count: number
}

/**
 * 知识点统计表。`type` 传 `'全部'` 表示不按卷面题型过滤；层级过滤不在这里做
 * （调用方按 `row.level` 过滤即可，频率的分母不受层级 chip 影响 —— 见 `rate`）。
 */
export function knowledgeRows(
  paper: OrgPaper,
  items: PaperItem[],
  levels: Map<string, string>,
  type = '全部',
): KnowledgeRow[] {
  const scoped = knownItems(items).filter((item) => type === '全部' || item.question?.type === type)
  const totalScore = paperTotalScore(paper)

  const bucket = new Map<string, { sections: Set<number>; numbers: number[]; score: number; count: number }>()
  scoped.forEach((item) => {
    /* 同一道题的 knowledge 里可能有重复标签，先按题去重，否则题数会多算 */
    const tags = new Set(item.question?.knowledge ?? [])
    tags.forEach((tag) => {
      const row = bucket.get(tag) ?? { sections: new Set<number>(), numbers: [], score: 0, count: 0 }
      row.sections.add(item.sectionIndex)
      row.numbers.push(item.number)
      row.score += item.score
      row.count += 1
      bucket.set(tag, row)
    })
  })

  const totalFrequency = [...bucket.values()].reduce((sum, row) => sum + row.sections.size, 0)

  return [...bucket.entries()]
    .map(([label, row]) => ({
      label,
      level: levels.get(label) ?? LEVEL_UNKNOWN,
      frequency: row.sections.size,
      rate: totalFrequency ? row.sections.size / totalFrequency : 0,
      perPaper: row.sections.size / PAPER_COUNT,
      score: row.score,
      scoreRatio: totalScore ? row.score / totalScore : 0,
      numbers: [...row.numbers].sort((a, b) => a - b),
      count: row.count,
    }))
    .sort((a, b) => b.frequency - a.frequency || b.score - a.score || a.label.localeCompare(b.label))
}

/** 各档位下的知识点个数：层级 chip 的角标（0 也要显示，让人看出是数据没有而不是坏了） */
export function levelCounts(rows: KnowledgeRow[]): Record<string, number> {
  const counts: Record<string, number> = {}
  rows.forEach((row) => {
    counts[row.level] = (counts[row.level] ?? 0) + 1
  })
  return counts
}

export interface DifficultyRow {
  label: string
  count: number
  score: number
  scoreRatio: number
}

/**
 * 难度分布：按固定读序出满档（容易 → 困难），没有题的档位补 0 而不是不出现 ——
 * 柱状图要能横着比，缺档会让「这卷没有容易题」和「这卷没统计」看起来一样。
 * 卷内出现了读序之外的取值（如未标注）时缀在末尾。
 */
export function difficultyRows(
  paper: OrgPaper,
  items: PaperItem[],
  order: readonly string[],
): DifficultyRow[] {
  const totalScore = paperTotalScore(paper)
  const bucket = new Map<string, { count: number; score: number }>()
  knownItems(items).forEach((item) => {
    const label = item.question?.difficulty || '未标注'
    const row = bucket.get(label) ?? { count: 0, score: 0 }
    row.count += 1
    row.score += item.score
    bucket.set(label, row)
  })

  const extra = [...bucket.keys()].filter((label) => !order.includes(label)).sort()
  return [...order, ...extra].map((label) => {
    const row = bucket.get(label) ?? { count: 0, score: 0 }
    return {
      label,
      count: row.count,
      score: row.score,
      scoreRatio: totalScore ? row.score / totalScore : 0,
    }
  })
}

export interface TypeRow {
  label: string
  count: number
  score: number
}

/** 题型分布：卷内实际出现的题型，题量降序（并列按名称，保证每次渲染先后一致） */
export function typeRows(items: PaperItem[]): TypeRow[] {
  const bucket = new Map<string, TypeRow>()
  knownItems(items).forEach((item) => {
    const label = item.question?.type || '未标注'
    const row = bucket.get(label) ?? { label, count: 0, score: 0 }
    row.count += 1
    row.score += item.score
    bucket.set(label, row)
  })
  return [...bucket.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
}

/**
 * 题号串：连续三段以上压成区间（`1、3-5`），太长的列表读不出来也占地方。
 * 省略靠列的 CSS `text-overflow`，完整串放 `title` —— 这里不截断，截断处不可控。
 */
export function formatNumbers(numbers: number[]): string {
  if (!numbers.length) return '—'
  const parts: string[] = []
  let start = numbers[0]
  let prev = numbers[0]
  const flush = () => {
    if (prev - start >= 2) parts.push(`${start}-${prev}`)
    else for (let n = start; n <= prev; n += 1) parts.push(String(n))
  }
  for (let i = 1; i < numbers.length; i += 1) {
    if (numbers[i] === prev + 1) {
      prev = numbers[i]
      continue
    }
    flush()
    start = numbers[i]
    prev = numbers[i]
  }
  flush()
  return parts.join('、')
}
