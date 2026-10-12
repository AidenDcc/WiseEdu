/**
 * 题库列表（平台端「公共题库」/ 机构端「题库管理」）的共用筛选模型。
 *
 * 两端的筛选条件是同一套：主条件「题型 / 难度 / 考试类型 / 杯赛」，收在「更多查询」里的
 * 「状态 / 纠错题目 / 使用次数 / 地区 / 来源 / 学期」。这些**行定义**与**候选项怎么算**
 * 逐字相同；留在各自页面里只会漂移（题库那边新增一个来源，另一端的下拉就少一个取值，
 * 搜不到还说不出哪里不对），所以连同「取哪个字段参与比对」一起放进公共层。
 *
 * 分界线很清楚：
 * - **本模块**：行定义、候选项解析（按学段 / 学科收窄）、取值映射（`bankFilterFields`）。
 * - **各端页面**：自己取数（含 `tenant_id` 与机构 / 平台权限）、自己决定要不要多出几行专属条件、
 *   自己写 `filtered`。平台端与机构端当前的过滤口径一致，但那是页面自己的查询逻辑，不从这里走。
 *
 * 页面要用哪几行都是显式传的（`BankFilterBar` 的 `rows` / `moreRows` / `extraRows`），
 * 所以「平台端想多筛一个维度」不需要动公共层，加一行进 `extraRows` 就行。
 */
import { QUESTION_SOURCE_OPTIONS, type FilterRowDef, type OrgQuestion } from '@aiteach/shared'
import type { TenantDictItem } from '../types'
import { examTypesFor, scopedQuestionTypes } from '../composables/useBaseData'

/**
 * 列表只呈现这两种状态，中文标签同时就是筛选面板里的取值（见 `bankFilterFields().status`）。
 * 草稿 / 校验中 / 待终审 / 已驳回属于审核流，去题目审核页看。
 */
export const BANK_STATUS_LABEL: Record<string, string> = { approved: '已入库', offline: '已下架' }

/** 列表的硬性可见性：只有这两个状态才进列表，其余状态无论怎么筛都不出现 */
export const BANK_VISIBLE_STATUS = Object.keys(BANK_STATUS_LABEL)

/** 使用次数没法按精确值做筛选项，按档给；档位边界贴着种子分布，保证每档都有题 */
export const USE_COUNT_BUCKETS: Array<{ label: string; match: (count: number) => boolean }> = [
  { label: '从未使用', match: (count) => count === 0 },
  { label: '1-9 次', match: (count) => count >= 1 && count <= 9 },
  { label: '10-19 次', match: (count) => count >= 10 && count <= 19 },
  { label: '20 次以上', match: (count) => count >= 20 },
]

/** 某道题落在哪个使用次数档（找不到档给空串：空串不落在任何候选项里 = 不命中） */
export function useCountBucketOf(count: number): string {
  return USE_COUNT_BUCKETS.find((bucket) => bucket.match(count))?.label ?? ''
}

export interface BankFilterRow {
  /** 各端可以加自己的 key，故不写成联合类型 */
  key: string
  label: string
  /** 候选项来自哪个字典；留空表示候选项写死在 `options` */
  dict?: string
  options?: string[]
  /** 放不下的行收回一行 + 「展开 / 收起」，见 `FilterRowDef.collapsible` */
  collapsible?: boolean
}

/** 主条件：顺序即产品指定的顺序（题型 / 难度 / 考试类型 / 杯赛） */
export const BANK_FILTER_ROWS: BankFilterRow[] = [
  { key: 'type', label: '题型', dict: 'questionType' },
  { key: 'difficulty', label: '难度', dict: 'difficulty' },
  { key: 'examType', label: '考试类型', dict: 'examType' },
  { key: 'competition', label: '杯赛', dict: 'competition' },
]

/** 次要条件：收在「更多查询」里，选中后靠折叠开关上的角标露出 */
export const BANK_MORE_ROWS: BankFilterRow[] = [
  { key: 'status', label: '状态', options: Object.values(BANK_STATUS_LABEL) },
  /* 「纠错题目」= 有没有老师提交过纠错反馈；要处理这些题时选「已提交纠错」把它们捞出来。
     两端都有这份数据（纠错记录由机构端老师提交，平台端在公共库里复核），所以算共有条件。 */
  { key: 'correction', label: '纠错题目', options: ['已提交纠错', '未提交纠错'] },
  { key: 'useCount', label: '使用次数', options: USE_COUNT_BUCKETS.map((row) => row.label) },
  /* 地区铺满 34 个省级行政区，一行放不下 —— 收起态只留一行，需要时再展开 */
  { key: 'region', label: '地区', dict: 'region', collapsible: true },
  { key: 'source', label: '来源', options: [...QUESTION_SOURCE_OPTIONS] },
  { key: 'term', label: '学期', options: ['上学期', '下学期'] },
]

/** 主条件 + 更多查询 = 参与过滤的全部共有行（回写、清空、取值映射都按这份走） */
export const BANK_ALL_ROWS: BankFilterRow[] = [...BANK_FILTER_ROWS, ...BANK_MORE_ROWS]

/**
 * 已选值的初值。以「共有行 + 本端专属行」一起铺开，
 * 免得页面漏写一个 key —— 漏了的话那一行的选中值会静默失效（筛得动却回写不回去）。
 */
export function defaultBankFilterSelection(extraRows: BankFilterRow[] = []): Record<string, string[]> {
  return Object.fromEntries([...BANK_ALL_ROWS, ...extraRows].map((row) => [row.key, []]))
}

/** 候选项解析所需的上下文：字典是异步到达的，行定义只写「去哪取」，运行时才展开 */
export interface BankFilterContext {
  /** 题型字典原始项（含适用学科），候选项按当前学科实时收窄 */
  typeItems: TenantDictItem[]
  grade: string
  subject: string
  /** 其余字典：type → 名称列表 */
  dictOptions: Record<string, string[]>
}

/** 某一行此刻的可选值 */
export function bankRowOptions(row: BankFilterRow, ctx: BankFilterContext): string[] {
  if (row.options) return row.options
  /* 题型按学科收窄：通用题型 + 当前学科的专属题型（英语的完形填空 / 七选五 / 短文改错） */
  if (row.dict === 'questionType') return scopedQuestionTypes(ctx.typeItems, ctx.subject)
  /* 考试类型按学段 / 学科收窄：字典项带「适配学段 / 学科」后，高一·数学下不该出现
     「小升初真题」这类点进去必然为空的取值。候选项走 useBaseData（页面顶部栏已 ensure 过字典） */
  if (row.dict === 'examType') return examTypesFor(ctx.grade, ctx.subject)
  return ctx.dictOptions[row.dict ?? ''] ?? []
}

/** 展开给筛选面板的行定义（选项为空的字典行由面板显示「暂无可选项」） */
export function toBankFilterRowDefs(rows: BankFilterRow[], ctx: BankFilterContext): FilterRowDef[] {
  return rows.map((row) => ({
    key: row.key,
    label: row.label,
    options: bankRowOptions(row, ctx),
    collapsible: row.collapsible,
  }))
}

/** 页面需要拉哪些字典（`examType` 除外：候选项要按学段 / 学科实时收窄，走 useBaseData） */
export function bankDictTypes(rows: BankFilterRow[]): string[] {
  return [...new Set(rows.map((row) => row.dict).filter((type): type is string => !!type && type !== 'examType'))]
}

/**
 * 每个筛选 key 从题目上取哪个值。
 *
 * 杯赛 / 地区是可选字段，缺省给空串 —— 空串永远不落在任何候选项里，等价于「这题没有这个属性」。
 * 状态用中文标签（面板里显示的也是标签），使用次数用桶名（精确值做不了筛选项）。
 * 纠错取自**纠错记录**而不是题目自身的字段：有记录 = 已提交纠错，故由页面把 id 集合传进来。
 */
export function bankFilterFields(ctx: {
  correctedIds: ReadonlySet<number>
}): Record<string, (row: OrgQuestion) => string> {
  return {
    type: (row) => row.type,
    difficulty: (row) => row.difficulty,
    examType: (row) => row.examType ?? '',
    competition: (row) => row.competition ?? '',
    status: (row) => BANK_STATUS_LABEL[row.status] ?? '',
    correction: (row) => (ctx.correctedIds.has(row.id) ? '已提交纠错' : '未提交纠错'),
    useCount: (row) => useCountBucketOf(row.useCount),
    region: (row) => row.region ?? '',
    source: (row) => row.source,
    term: (row) => row.term ?? '',
  }
}
