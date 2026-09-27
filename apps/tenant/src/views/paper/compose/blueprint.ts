/**
 * 双向细目表组卷：知识点（行）× 题型（列）的配额矩阵，以及按格自动抽题。
 *
 * 为什么单独抽一层纯函数：细目表的价值在「配额先行、抽题后行」——教师先填好每个知识点
 * 每个题型要几题、每题几分，再让系统去题库里凑。凑题的规则（难度贴近目标、优先高频题、
 * 一题不许被两个格子同时占用）必须与 UI 无关，否则「换一题」「重抽」「并入组卷车」三处
 * 各写一份，很快就会算出不同的结果。
 *
 * 只放纯函数与数据结构，副作用（Toast、写 localStorage）留在页签里。
 */
import type { OrgQuestion } from '@aiteach/shared'
import { defaultScore } from '@/views/paper/paper-sections'

/** 难度由易到难，用于把候选题按「与目标难度的接近程度」排序 */
export const DIFFICULTY_ORDER = ['容易', '较易', '中等', '较难', '困难'] as const

/** 难度 → 序号；字典外的值按「中等」处理，避免未知难度把排序打乱 */
export function difficultyRank(value: string): number {
  const index = (DIFFICULTY_ORDER as readonly string[]).indexOf(value)
  return index < 0 ? 2 : index
}

export interface BlueprintCell {
  knowledge: string
  type: string
  /** 计划题数；0 = 该格不配题 */
  count: number
  /** 单题分值 */
  score: number
  /** 已抽中的题目 id，顺序即出卷顺序 */
  picked: number[]
}

export interface Blueprint {
  /** 行：知识点 */
  knowledges: string[]
  /** 列：题型 */
  types: string[]
  /** key = cellKey(knowledge, type) */
  cells: Record<string, BlueprintCell>
}

/** 用不可见分隔符拼 key：知识点名里理论上可能出现 `|`，用 \u0001 不会撞 */
export function cellKey(knowledge: string, type: string): string {
  return `${knowledge}\u0001${type}`
}

export function emptyBlueprint(): Blueprint {
  return { knowledges: [], types: [], cells: {} }
}

export function cellOf(bp: Blueprint, knowledge: string, type: string): BlueprintCell | undefined {
  return bp.cells[cellKey(knowledge, type)]
}

/** 取格子，没有就按题型默认分建一个（题数 0，即默认不配题） */
export function ensureCell(bp: Blueprint, knowledge: string, type: string): BlueprintCell {
  const key = cellKey(knowledge, type)
  const found = bp.cells[key]
  if (found) return found
  const cell: BlueprintCell = { knowledge, type, count: 0, score: defaultScore(type), picked: [] }
  bp.cells[key] = cell
  return cell
}

/**
 * 删掉不存在的行/列对应的格子。
 * 行或列被移除后必须调一次：否则 cells 只增不减，统计里会出现「看不见的题」，
 * 而且把同名知识点加回来时会直接继承上次抽好的结果。
 */
export function pruneCells(bp: Blueprint): void {
  const alive = new Set<string>()
  bp.knowledges.forEach((knowledge) => bp.types.forEach((type) => alive.add(cellKey(knowledge, type))))
  bp.cells = Object.fromEntries(Object.entries(bp.cells).filter(([key]) => alive.has(key)))
}

export function clearPicked(bp: Blueprint): void {
  Object.values(bp.cells).forEach((cell) => {
    cell.picked = []
  })
}

/** 全表已占用的题目 id：一题只服务一个格子，换题与重抽都靠它避免撞题 */
export function usedIds(bp: Blueprint): Set<number> {
  const used = new Set<number>()
  Object.values(bp.cells).forEach((cell) => cell.picked.forEach((id) => used.add(id)))
  return used
}

export interface FillShortage {
  knowledge: string
  type: string
  /** 还差几题 */
  short: number
  /** 题库里该格实际可用的题数 */
  available: number
}

export interface FillResult {
  /** 新增抽中的题数 */
  added: number
  /** 因题库不足没抽满的格子 */
  shortages: FillShortage[]
}

/**
 * 按配额抽题：**只补空缺**，已抽中的题目保留。
 *
 * 「只补空缺」而不是每次重抽全表，是因为教师常常手动换掉了某一格里不顺眼的一道题，
 * 再点一次「自动抽题」时，那种手动调整不该被冲掉——这也是教研云这类工具的默认行为。
 * 要整体重来走 `clearPicked()`。
 */
export function fillBlueprint(bp: Blueprint, pool: OrgQuestion[], targetDifficulty = '中等'): FillResult {
  const used = usedIds(bp)
  const rank = difficultyRank(targetDifficulty)
  const shortages: FillShortage[] = []
  let added = 0

  for (const knowledge of bp.knowledges) {
    for (const type of bp.types) {
      const cell = cellOf(bp, knowledge, type)
      if (!cell || cell.count <= 0) continue
      const need = cell.count - cell.picked.length
      if (need <= 0) continue

      const candidates = pool
        .filter(
          (row) =>
            row.status === 'approved' &&
            row.type === type &&
            row.knowledge.includes(knowledge) &&
            !used.has(row.id),
        )
        .sort(
          (a, b) =>
            Math.abs(difficultyRank(a.difficulty) - rank) -
              Math.abs(difficultyRank(b.difficulty) - rank) ||
            b.useCount - a.useCount ||
            a.id - b.id,
        )

      /* 该格题库里总共还有多少可用题（含已抽中的），用于「题库不足」的提示文案 */
      const available =
        candidates.length +
        cell.picked.length

      candidates.slice(0, need).forEach((row) => {
        used.add(row.id)
        cell.picked.push(row.id)
        added += 1
      })

      if (candidates.length < need) {
        shortages.push({ knowledge, type, short: need - candidates.length, available })
      }
    }
  }

  return { added, shortages }
}

/** 某格的候选题（含已被别的格子占用的，由 UI 置灰）：用于「换一题」 */
export function candidatesFor(cell: BlueprintCell, pool: OrgQuestion[]): OrgQuestion[] {
  return pool
    .filter((row) => row.status === 'approved' && row.type === cell.type && row.knowledge.includes(cell.knowledge))
    .sort((a, b) => difficultyRank(b.difficulty) - difficultyRank(a.difficulty) || b.useCount - a.useCount || a.id - b.id)
}

export interface BlueprintStats {
  /** 计划题数 / 计划总分 */
  plannedCount: number
  plannedScore: number
  /** 已抽题数 / 已抽总分 */
  pickedCount: number
  pickedScore: number
  /** 有计划题数的格子数 / 其中已抽满的格子数 */
  plannedCells: number
  filledCells: number
}

export function blueprintStats(bp: Blueprint): BlueprintStats {
  let plannedCount = 0
  let plannedScore = 0
  let pickedCount = 0
  let pickedScore = 0
  let plannedCells = 0
  let filledCells = 0

  Object.values(bp.cells).forEach((cell) => {
    if (cell.count <= 0) return
    plannedCells += 1
    plannedCount += cell.count
    plannedScore += cell.count * cell.score
    pickedCount += cell.picked.length
    pickedScore += cell.picked.length * cell.score
    if (cell.picked.length >= cell.count) filledCells += 1
  })

  return { plannedCount, plannedScore, pickedCount, pickedScore, plannedCells, filledCells }
}

/** 细目表 → 组卷车条目：行优先（先知识点行、再题型列），与卷面阅读顺序一致 */
export function blueprintEntries(bp: Blueprint): Array<{ questionId: number; score: number; knowledge: string }> {
  const out: Array<{ questionId: number; score: number; knowledge: string }> = []
  bp.knowledges.forEach((knowledge) => {
    bp.types.forEach((type) => {
      const cell = cellOf(bp, knowledge, type)
      if (!cell) return
      cell.picked.forEach((id) => out.push({ questionId: id, score: cell.score, knowledge }))
    })
  })
  return out
}

/**
 * 题库里可选的知识点（按题数从多到少）。
 * 细目表的行来自真实题库，手敲一个题库里没有的知识点只会得到一格永远抽不满的配额。
 */
export function availableKnowledges(pool: OrgQuestion[]): Array<{ name: string; count: number }> {
  const counter = new Map<string, number>()
  pool.forEach((row) => {
    if (row.status !== 'approved') return
    row.knowledge.forEach((tag) => counter.set(tag, (counter.get(tag) ?? 0) + 1))
  })
  return [...counter.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh'))
}
