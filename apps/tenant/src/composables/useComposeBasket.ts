/**
 * 组卷车（题库组卷工作台的选题容器）。
 *
 * 全站唯一的选题容器（题库管理里那个基于 sessionStorage 的「组卷篮」已随其入口按钮一并移除，
 * 找题一律从工作台走）。四点设计都是被场景逼出来的：
 * 1. **存 localStorage 而不是 sessionStorage** —— 工作台本身跑在独立标签页里，sessionStorage 按标签页隔离，
 *    刷新或再开一个工作台标签页就会丢车；组卷是个跨标签页的编辑过程，必须能存活。
 * 2. **条目带分值与大题名** —— 裸题目 id 数组无法表达「这道题算 12 分」「这几道题归到课时一大题」，
 *    而工作台既要逐题改分，也要按课时组卷。
 * 3. **不跳路由** —— 工作台已经是全屏页面，加车就地更新右侧抽屉即可，没有跳转交接。
 * 4. **题目之外还装媒体**（图片 / 视频 / 小程序）—— 它们是「随卷参考资料」，不参与分值与大题结构，
 *    所以**另开一条 `resources` 集合**而不是塞进 `entries`：卷面归类的每一步（`buildSections`、
 *    拖拽排序、重复题检测、批量设分）都假定 `entries` 里只有题，混进资源会把这些逻辑全带歪。
 *
 * 模块级单例：多处（顶栏角标、各页签的「加入组卷车」、抽屉、卷面编辑页的资源篮）读同一份状态，
 * 计数与合计天然一致。
 */
import { computed, ref, watch } from 'vue'
import type { MediaKind, OrgMedia, OrgPaper, OrgQuestion, PaperAttachment } from '@aiteach/shared'
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

/**
 * 资源条目：图片 / 视频 / 小程序。进车是为了随卷留存引用，不参与分值与大题结构。
 *
 * `name` / `sizeMb` / `url` 是**加入时的快照**（媒体库里的资源被改名、删除后，车里和最终试卷上
 * 仍要能说清当初附了什么），与 `PaperAttachment` 冗余存名称 / 大小是同一个理由。
 */
export interface BasketResource {
  /** 媒体库资源 id（`OrgMedia.id`） */
  id: number
  kind: MediaKind
  name: string
  sizeMb: number
  /** 缩略图地址；无字节的存量媒体没有，前端回落到 kind 图标 */
  url?: string
  seq: number
}

/** 组卷车落盘形状。老版本是裸的 `BasketEntry[]`，`readBasket` 里做兼容 */
interface BasketState {
  questions: BasketEntry[]
  resources: BasketResource[]
}

const MEDIA_KINDS: readonly MediaKind[] = ['video', 'animation', 'image']

/** 加入顺序计数器：只增不减，删题也不回收，避免复用同一个 seq */
let seqCursor = 1

/* 逐条校验：历史版本或手工改坏的条目直接丢弃，不让它把整个组卷车带崩 */
function validEntries(list: unknown): BasketEntry[] {
  if (!Array.isArray(list)) return []
  return list.filter(
    (row): row is BasketEntry =>
      Boolean(row) && typeof row === 'object' && typeof (row as BasketEntry).questionId === 'number',
  )
}

function validResources(list: unknown): BasketResource[] {
  if (!Array.isArray(list)) return []
  return list.filter(
    (row): row is BasketResource =>
      Boolean(row) &&
      typeof row === 'object' &&
      typeof (row as BasketResource).id === 'number' &&
      typeof (row as BasketResource).name === 'string' &&
      MEDIA_KINDS.includes((row as BasketResource).kind),
  )
}

function readBasket(): BasketState {
  const empty: BasketState = { questions: [], resources: [] }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return empty
    const parsed: unknown = JSON.parse(raw)
    /* 老版本（裸数组）只有题目 —— 直接按题目读、资源为空，不用改写存储：
       下一次写入自然升级成新形状，用户不会因为这次改动丢车。 */
    if (Array.isArray(parsed)) return { questions: validEntries(parsed), resources: [] }
    if (!parsed || typeof parsed !== 'object') return empty
    const shape = parsed as Partial<BasketState>
    return { questions: validEntries(shape.questions), resources: validResources(shape.resources) }
  } catch {
    return empty
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

const initial = readBasket()
const entries = ref<BasketEntry[]>(initial.questions)
/** 随卷参考资料（图片 / 视频 / 小程序），与 `entries` 并列，见文件头注释第 4 点 */
const resources = ref<BasketResource[]>(initial.resources)
/** 已保存过的试卷 id：避免同一车题反复生成重复试卷，仅作提示用 */
const savedPaperIds = ref<number[]>(readSaved())

/* 历史数据里可能已有 seq（本页刷新），把游标推到最大值之后，
   否则新加的条目会从 1 重新开始编号，与旧条目撞号，「恢复加入顺序」就排不出真正的先后。
   题与资源共用一个游标：两者放在一起看时也有稳定的先后。 */
seqCursor =
  [...entries.value, ...resources.value].reduce((max, row) => Math.max(max, row.seq ?? 0), 0) + 1

watch(
  [entries, resources],
  ([rows, items]) => {
    if (!rows.length && !items.length) localStorage.removeItem(STORAGE_KEY)
    else localStorage.setItem(STORAGE_KEY, JSON.stringify({ questions: rows, resources: items }))
  },
  { deep: true },
)

/* 另一个工作台标签页改了车，本页跟着更新（同源同 localStorage） */
window.addEventListener('storage', (event) => {
  if (event.key !== STORAGE_KEY) return
  /* 自己写入也会触发 storage 事件吗？不会 —— storage 只在「其它」文档修改时触发，
     这里的判断纯属防御，避免未来有人改成 BroadcastChannel 时产生回环。 */
  const next = readBasket()
  if (JSON.stringify(next.questions) !== JSON.stringify(entries.value)) entries.value = next.questions
  if (JSON.stringify(next.resources) !== JSON.stringify(resources.value)) resources.value = next.resources
})

const ids = computed(() => new Set(entries.value.map((row) => row.questionId)))
const count = computed(() => entries.value.length)
const scoreTotal = computed(() => entries.value.reduce((sum, row) => sum + (Number(row.score) || 0), 0))
/** 资源的唯一键：kind + id（同一 id 在不同类型下互不相干） */
function resourceKey(kind: MediaKind, id: number): string {
  return `${kind}:${id}`
}
const resourceKeys = computed(() => new Set(resources.value.map((row) => resourceKey(row.kind, row.id))))
const resourceTotal = computed(() => resources.value.length)
/** 顶栏角标用：题 + 资源 */
const totalCount = computed(() => entries.value.length + resources.value.length)

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
   *
   * ⚠️ 当前**没有调用方**：唯一的入口是组卷工作台「试卷」页签的「整卷引用」按钮，
   * 产品已把它换成「平行组卷 / 试卷分析」（`PapersTab.vue`）。那一页现在只做**逐题**取用
   * ——阅读式预览里逐题点「加入组卷车」（走 `add(item, 'paper')`），不整卷搬。
   * 函数保留：「拿现成卷当底稿」这个用法随时可能从别处（如协同组卷）再开入口。
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

  /* ===== 资源（图片 / 视频 / 小程序）：随卷留存引用 ===== */

  function hasResource(kind: MediaKind, id: number): boolean {
    return resourceKeys.value.has(resourceKey(kind, id))
  }

  /** 资源进车（幂等：已在车里的重复点只提示）。只为随卷留存，不参与分值与大题结构。 */
  function addResource(row: OrgMedia): boolean {
    if (hasResource(row.kind, row.id)) {
      showToast('该资源已在组卷车中', 'error')
      return false
    }
    resources.value.push({
      id: row.id,
      kind: row.kind,
      name: row.name,
      sizeMb: row.sizeMb,
      url: row.url,
      seq: seqCursor++,
    })
    return true
  }

  function removeResource(kind: MediaKind, id: number) {
    const index = resources.value.findIndex((row) => row.kind === kind && row.id === id)
    if (index >= 0) resources.value.splice(index, 1)
  }

  /** 点在车里的资源 = 移出车（媒体卡片开关语义，与 `toggle` 对题目一致） */
  function toggleResource(row: OrgMedia) {
    if (hasResource(row.kind, row.id)) removeResource(row.kind, row.id)
    else addResource(row)
  }

  function resourceCount(kind: MediaKind): number {
    return resources.value.filter((row) => row.kind === kind).length
  }

  /** 清空某一类资源（抽屉里资源段的「清空本类」；不传则清空全部资源），不动题目 */
  function clearResources(kind?: MediaKind) {
    if (kind == null) resources.value = []
    else resources.value = resources.value.filter((row) => row.kind !== kind)
  }

  /** 组卷车里的资源 → 试卷随附的参考资料快照（见 `PaperAttachment`） */
  function toAttachments(): PaperAttachment[] {
    return resources.value.map((row) => ({
      mediaId: row.id,
      kind: row.kind,
      name: row.name,
      sizeMb: row.sizeMb,
    }))
  }

  /**
   * 清空组卷车。默认全清（工作台抽屉的语义）；
   * 卷面编辑页的「资源篮」只能传 `'questions'` —— 那个面板只列题目，
   * 把看不见的资源一并清掉就是静默丢东西。
   */
  function clear(scope: 'all' | 'questions' = 'all') {
    entries.value = []
    if (scope === 'all') resources.value = []
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
    /* 资源（随卷参考资料） */
    resources,
    resourceTotal,
    totalCount,
    hasResource,
    addResource,
    removeResource,
    toggleResource,
    resourceCount,
    clearResources,
    toAttachments,
    clear,
    toSections,
    toSessionBasket,
    markSaved,
  }
}
