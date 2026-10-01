/**
 * 组卷车（题库组卷工作台的选题容器）。
 *
 * 全站唯一的选题容器（题库管理里那个基于 sessionStorage 的「组卷篮」已随其入口按钮一并移除，
 * 找题一律从工作台走）。三点设计都是被场景逼出来的：
 * 1. **存 localStorage 而不是 sessionStorage** —— 工作台本身跑在独立标签页里，sessionStorage 按标签页隔离，
 *    刷新或再开一个工作台标签页就会丢车；组卷是个跨标签页的编辑过程，必须能存活。
 * 2. **条目带分值与大题名** —— 裸题目 id 数组无法表达「这道题算 12 分」「这几道题归到课时一大题」，
 *    而工作台既要逐题改分，也要按课时组卷。
 * 3. **不跳路由** —— 工作台已经是全屏页面，加车就地更新右侧抽屉即可，没有跳转交接。
 *
 * 模块级单例：多处（页签、抽屉、浮动按钮）读同一份状态，计数与合计天然一致。
 */
import { computed, ref, watch } from 'vue'
import type { OrgPaper, OrgQuestion } from '@aiteach/shared'
import { showToast } from '@aiteach/shared'
import { buildSections, defaultScore, type BuiltSections } from '@/views/paper/paper-sections'

const STORAGE_KEY = 'aiteach.compose-basket'
const SAVED_KEY = 'aiteach.compose-basket-saved'

/** 加车来源：决定抽屉里怎么分组说明，也便于排查「这题从哪来的」 */
export type BasketSource = 'search' | 'pool' | 'knowledge' | 'sync' | 'paper' | 'blueprint'

export interface BasketEntry {
  questionId: number
  score: number
  source: BasketSource
  /** 指定大题名（同步练习按课时组卷）；缺省时生成试卷即按题型自动归类 */
  sectionTitle?: string
  /**
   * 加入顺序（单调递增）。排序功能会重排数组，而「恢复加入顺序」需要知道最初的先后，
   * 数组下标做不到这件事——排序后再按下标排只会得到当前的顺序。
   * 老数据没有这个字段，恢复顺序时按「无 seq 的排在前面、保持相对次序」处理。
   */
  seq?: number
}

/** 加入顺序计数器：只增不减，删题也不回收，避免复用同一个 seq */
let seqCursor = 1

function read(): BasketEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    /* 逐条校验：历史版本或手工改坏的条目直接丢弃，不让它把整个组卷车带崩 */
    return parsed.filter(
      (row): row is BasketEntry =>
        Boolean(row) && typeof row === 'object' && typeof (row as BasketEntry).questionId === 'number',
    )
  } catch {
    return []
  }
}

function readSaved(): number[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(SAVED_KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter((id): id is number => typeof id === 'number') : []
  } catch {
    return []
  }
}

const entries = ref<BasketEntry[]>(read())
/** 已保存过的试卷 id：避免同一车题反复生成重复试卷，仅作提示用 */
const savedPaperIds = ref<number[]>(readSaved())

/* 历史数据里可能已有 seq（本页刷新），把游标推到最大值之后，
   否则新加的题会从 1 重新开始编号，与旧题撞号，「恢复加入顺序」就排不出真正的先后。 */
seqCursor = entries.value.reduce((max, row) => Math.max(max, row.seq ?? 0), 0) + 1

watch(
  entries,
  (rows) => {
    if (rows.length) localStorage.setItem(STORAGE_KEY, JSON.stringify(rows))
    else localStorage.removeItem(STORAGE_KEY)
  },
  { deep: true },
)

/* 另一个工作台标签页改了车，本页跟着更新（同源同 localStorage） */
window.addEventListener('storage', (event) => {
  if (event.key === STORAGE_KEY) {
    const next = read()
    /* 自己写入也会触发 storage 事件吗？不会 —— storage 只在「其它」文档修改时触发，
       这里的判断纯属防御，避免未来有人改成 BroadcastChannel 时产生回环。 */
    if (JSON.stringify(next) !== JSON.stringify(entries.value)) entries.value = next
  }
})

const ids = computed(() => new Set(entries.value.map((row) => row.questionId)))
const count = computed(() => entries.value.length)
const scoreTotal = computed(() => entries.value.reduce((sum, row) => sum + (Number(row.score) || 0), 0))

export function useComposeBasket() {
  function has(questionId: number): boolean {
    return ids.value.has(questionId)
  }

  /** 加题（幂等：已在车里的题重复点只提示，不重复计分） */
  function add(
    row: OrgQuestion,
    source: BasketSource = 'pool',
    sectionTitle?: string,
    score?: number,
  ): boolean {
    if (has(row.id)) {
      showToast('该题已在组卷车中', 'error')
      return false
    }
    entries.value.push({
      questionId: row.id,
      score: score ?? defaultScore(row.type),
      source,
      sectionTitle,
      seq: seqCursor++,
    })
    return true
  }

  /** 批量加题；返回实际新增数（已在车中的会被跳过） */
  function addMany(
    rows: OrgQuestion[],
    source: BasketSource = 'pool',
    sectionTitle?: string,
    score?: number,
  ): number {
    let added = 0
    for (const row of rows) {
      if (has(row.id)) continue
      entries.value.push({
        questionId: row.id,
        score: score ?? defaultScore(row.type),
        source,
        sectionTitle,
        seq: seqCursor++,
      })
      added += 1
    }
    return added
  }

  /**
   * 整卷引用：把一份试卷的所有小题按原大题名与原分值搬进组卷车。
   * 已在车中的题目跳过，因此重复引用同一份卷不会产生重复题目。
   */
  function addFromPaper(paper: OrgPaper): number {
    let added = 0
    for (const section of paper.sections) {
      for (const item of section.questions) {
        if (has(item.questionId)) continue
        entries.value.push({
          questionId: item.questionId,
          score: Number(item.score) || 0,
          source: 'paper',
          sectionTitle: section.title,
          seq: seqCursor++,
        })
        added += 1
      }
    }
    return added
  }

  function remove(questionId: number) {
    const index = entries.value.findIndex((row) => row.questionId === questionId)
    if (index >= 0) entries.value.splice(index, 1)
  }

  /** 点在车里的题 = 移出车（题池卡片与搜索结果共用的开关语义） */
  function toggle(row: OrgQuestion, source: BasketSource = 'pool') {
    if (has(row.id)) remove(row.id)
    else add(row, source)
  }

  function setScore(questionId: number, score: number) {
    const target = entries.value.find((row) => row.questionId === questionId)
    if (target) target.score = score
  }

  /** 批量改分：只动传入的这批题，其余分值不动 */
  function setScoreMany(questionIds: number[], score: number) {
    const targets = new Set(questionIds)
    entries.value.forEach((row) => {
      if (targets.has(row.questionId)) row.score = score
    })
  }

  /**
   * 把某题挪到指定下标（拖拽排序）。
   * 用的是**整表重排**而不是交换相邻两项：组卷车最终由 `buildSections` 按题型归大题，
   * 大题内的题序 = 条目在表中的相对次序，所以只要改相对次序就等价于改卷面顺序，
   * 不需要理解「跨大题拖动」这种概念。
   */
  function move(fromIndex: number, toIndex: number) {
    const rows = [...entries.value]
    if (fromIndex < 0 || fromIndex >= rows.length) return
    const [row] = rows.splice(fromIndex, 1)
    const target = Math.max(0, Math.min(rows.length, toIndex))
    rows.splice(target, 0, row)
    entries.value = rows
  }

  /** 按题目 id 版本（拖拽时手上只有 id） */
  function moveById(questionId: number, toIndex: number) {
    move(entries.value.findIndex((row) => row.questionId === questionId), toIndex)
  }

  /**
   * 按给定题目顺序重排（自动排序）。
   * order 里没出现的题（理论上不会，防御用）保持原相对次序追加在末尾，绝不静默丢题。
   */
  function applyOrder(order: number[]) {
    const remaining = new Map(entries.value.map((row) => [row.questionId, row]))
    const next: BasketEntry[] = []
    order.forEach((id) => {
      const row = remaining.get(id)
      if (row) {
        next.push(row)
        remaining.delete(id)
      }
    })
    remaining.forEach((row) => next.push(row))
    entries.value = next
  }

  /** 恢复加入顺序：按 seq 升序，没有 seq 的历史数据视为最早加入 */
  function orderByAdded(): number[] {
    return [...entries.value]
      .sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0))
      .map((row) => row.questionId)
  }

  function clear() {
    entries.value = []
  }

  /** 组卷车 → 试卷大题结构（归类规则见 paper-sections.ts） */
  function toSections(questions: OrgQuestion[]): BuiltSections {
    return buildSections(entries.value, questions)
  }

  /** 回灌题库管理的 sessionStorage 组卷篮，供「转为协同组卷」跳转使用 */
  function toSessionBasket(): number[] {
    return entries.value.map((row) => row.questionId)
  }

  function markSaved(paperId: number) {
    if (!savedPaperIds.value.includes(paperId)) savedPaperIds.value.push(paperId)
    try {
      localStorage.setItem(SAVED_KEY, JSON.stringify(savedPaperIds.value))
    } catch {
      /* 存不下就算了：这个标记只用于提示，不影响保存流程 */
    }
  }

  return {
    entries,
    ids,
    count,
    scoreTotal,
    savedPaperIds,
    has,
    add,
    addMany,
    addFromPaper,
    remove,
    toggle,
    setScore,
    setScoreMany,
    move,
    moveById,
    applyOrder,
    orderByAdded,
    clear,
    toSections,
    toSessionBasket,
    markSaved,
  }
}
