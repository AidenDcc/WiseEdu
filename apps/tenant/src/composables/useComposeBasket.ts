/**
 * 组卷车（题库组卷工作台的选题容器）。
 *
 * 与题库管理的组卷篮（`BankView.vue` 的 `aiteach.paper-basket`）有三点不同，都是被场景逼出来的：
 * 1. **存 localStorage 而不是 sessionStorage** —— 工作台本身跑在独立标签页里，sessionStorage 按标签页隔离，
 *    刷新或再开一个工作台标签页就会丢车；组卷是个跨标签页的编辑过程，必须能存活。
 * 2. **条目带分值与大题名** —— 裸题目 id 数组无法表达「这道题算 12 分」「这几道题归到课时一大题」，
 *    而工作台既要逐题改分，也要按课时组卷。
 * 3. **不跳路由** —— 工作台已经是全屏页面，加车就地更新右侧抽屉即可，没有 `goCollab()` 那种交接。
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
export type BasketSource = 'search' | 'pool' | 'knowledge' | 'sync' | 'paper'

export interface BasketEntry {
  questionId: number
  score: number
  source: BasketSource
  /** 指定大题名（同步练习按课时组卷）；缺省时生成试卷即按题型自动归类 */
  sectionTitle?: string
}

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
    clear,
    toSections,
    toSessionBasket,
    markSaved,
  }
}
