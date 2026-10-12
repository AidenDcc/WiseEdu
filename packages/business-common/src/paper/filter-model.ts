/**
 * 试卷列表（平台端「公共试卷库」/ 机构端「试卷库」）的共用筛选模型。
 *
 * 与 `bank/filter-model.ts` 同一思路：两端的行定义、候选项来源、取值映射逐字相同，
 * 留在各自页面里必然漂移，所以放公共层；**数据查询本身（含 `tenant_id` 与权限）留在各端页面**。
 *
 * 一处与题库不同的地方：**面板里没有「考试类型」这一行**。那个维度的值由左侧的考试类型树写，
 * 面板里的筛选状态与树共用同一份 —— 同一个值两处都能改，必然出现「面板里清掉了、树上还亮着」。
 * 但考试类型**确实参与过滤**，所以它仍在 `PAPER_ALL_ROWS` 里（页面拿它算 `matches` 与左树计数），
 * 只是不进 `PAPER_PANEL_ROWS`（面板渲染的那几行）。
 */
import { PAPER_SOURCE_OPTIONS, type FilterRowDef, type OrgPaper } from '@aiteach/shared'

export interface PaperFilterRow {
  /** 各端可以加自己的 key，故不写成联合类型 */
  key: string
  label: string
  /** 候选项来自哪个字典；留空表示候选项写死在 `options` */
  dict?: string
  options?: string[]
  /** 放不下的行收回一行 + 「展开 / 收起」，见 `FilterRowDef.collapsible` */
  collapsible?: boolean
}

/** 主条件（产品指定的顺序：年级 / 科目 / 难度 / 地区）。考试类型不在这里 —— 它归左侧的树 */
export const PAPER_FILTER_ROWS: PaperFilterRow[] = [
  { key: 'grade', label: '年级', dict: 'grade' },
  { key: 'subject', label: '科目', dict: 'subject' },
  { key: 'difficulty', label: '难度', dict: 'difficulty' },
  /* 地区铺满 34 个省级行政区后一行放不下，收起态只留一行 */
  { key: 'region', label: '地区', dict: 'region', collapsible: true },
]

/** 次要条件：收在「更多查询」里 */
export const PAPER_MORE_ROWS: PaperFilterRow[] = [
  { key: 'competition', label: '杯赛', dict: 'competition' },
  { key: 'source', label: '来源', options: [...PAPER_SOURCE_OPTIONS] },
]

/** 面板里渲染的行：回写与「清空」按这份走 */
export const PAPER_PANEL_ROWS: PaperFilterRow[] = [...PAPER_FILTER_ROWS, ...PAPER_MORE_ROWS]

/** 参与过滤但不进面板的那一行（值由左侧考试类型树写） */
export const PAPER_EXAM_TYPE_ROW: PaperFilterRow = { key: 'examType', label: '考试类型', dict: 'examType' }

/** 参与过滤的全部维度 —— 比面板多一个考试类型 */
export const PAPER_ALL_ROWS: PaperFilterRow[] = [...PAPER_PANEL_ROWS, PAPER_EXAM_TYPE_ROW]

/** 已选值的初值（含不进面板的考试类型：树上选中的值就写在这里） */
export function defaultPaperFilterSelection(extraRows: PaperFilterRow[] = []): Record<string, string[]> {
  return Object.fromEntries([...PAPER_ALL_ROWS, ...extraRows].map((row) => [row.key, []]))
}

/** 展开给筛选面板的行定义（选项为空的字典行由面板显示「暂无可选项」） */
export function toPaperFilterRowDefs(
  rows: PaperFilterRow[],
  dictOptions: Record<string, string[]>,
): FilterRowDef[] {
  return rows.map((row) => ({
    key: row.key,
    label: row.label,
    options: row.options ?? dictOptions[row.dict ?? ''] ?? [],
    collapsible: row.collapsible,
  }))
}

/** 页面需要拉哪些字典（`examType` 除外：左树要 `paperCategory` 才能分组，走 useBaseData） */
export function paperDictTypes(rows: PaperFilterRow[]): string[] {
  return [...new Set(rows.map((row) => row.dict).filter((type): type is string => !!type && type !== 'examType'))]
}

/** 每个筛选 key 从试卷上取哪个值（可缺省的维度给空串，等价于「没有该属性」） */
export function paperFilterFields(): Record<string, (row: OrgPaper) => string> {
  return {
    grade: (row) => row.grade,
    subject: (row) => row.subject,
    difficulty: (row) => row.difficulty ?? '',
    examType: (row) => row.examType ?? '',
    competition: (row) => row.competition ?? '',
    region: (row) => row.region ?? '',
    source: (row) => row.source ?? '',
  }
}
