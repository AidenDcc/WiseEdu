/**
 * 题库组卷工作台的筛选模型与页签定义。
 *
 * 8 个页签共用**同一份** `ComposeFilter`：一次搜索（文本 / 图片 / AI）写进它，切页签时条件保持，
 * 这样「搜到的东西换个页签还在」是默认行为，而不是要用户在每个页签里重搜一遍。
 */
import { toPlainText, type MediaKind, type OrgMaterial, type OrgMedia, type OrgPaper, type OrgQuestion } from '@aiteach/shared'

export interface ComposeFilter {
  /** 关键词：文本搜索输入、图片搜索识别结果、AI 解读的关键词都会落在这里 */
  keyword: string
  subject: string
  grade: string
  difficulty: string
  /** 题型，多选；空数组 = 不限 */
  types: string[]
  /** 知识点，命中其一即算命中；空数组 = 不限 */
  knowledge: string[]
  /** 是否包含未入库（待审/驳回）题目。默认关，与协同组卷选题池「仅已入库可入卷」口径一致 */
  includeUnapproved: boolean
}

export type TabKey =
  | 'questions'
  | 'papers'
  | 'materials'
  | 'miniapp'
  | 'videos'
  | 'images'
  | 'knowledge'
  | 'sync'

export interface ComposeTab {
  key: TabKey
  label: string
  icon: string
  /**
   * resource = 检索浏览类（结果由 ComposeFilter 筛选）
   * compose  = 出题组卷类（先按知识点/课时定位，再出题）
   * 用于页签条上分组显示与加分隔线。
   */
  group: 'resource' | 'compose'
}

export const COMPOSE_TABS: ComposeTab[] = [
  { key: 'questions', label: '试题', icon: 'edit', group: 'resource' },
  { key: 'papers', label: '试卷', icon: 'file', group: 'resource' },
  { key: 'materials', label: '教辅', icon: 'book', group: 'resource' },
  { key: 'miniapp', label: '小程序', icon: 'chart', group: 'resource' },
  { key: 'videos', label: '视频', icon: 'smartphone', group: 'resource' },
  { key: 'images', label: '图片', icon: 'image', group: 'resource' },
  { key: 'knowledge', label: '知识点组卷', icon: 'branch', group: 'compose' },
  { key: 'sync', label: '同步练习组卷', icon: 'list-ol', group: 'compose' },
]

export function defaultComposeFilter(): ComposeFilter {
  return {
    keyword: '',
    subject: '',
    grade: '',
    difficulty: '',
    types: [],
    knowledge: [],
    includeUnapproved: false,
  }
}

/** 关键词命中判定（任一字段包含即算命中，英文不区分大小写），与 mock 的全局检索同一口径 */
export function hitKeyword(keyword: string, ...fields: Array<string | string[] | undefined>): boolean {
  const kw = keyword.trim().toLowerCase()
  if (!kw) return true
  return fields.some((field) =>
    (Array.isArray(field) ? field.join(' ') : field ?? '').toLowerCase().includes(kw),
  )
}

/**
 * 题目是否命中当前筛选。
 *
 * 题干是富文本（公式、配图），比对前必须转纯文本 —— 否则搜「函数」会漏掉带公式的题干。
 */
export function matchesQuestionFilter(row: OrgQuestion, filter: ComposeFilter): boolean {
  if (!filter.includeUnapproved && row.status !== 'approved') return false
  if (filter.subject && row.subject !== filter.subject) return false
  if (filter.grade && row.grade !== filter.grade) return false
  if (filter.difficulty && row.difficulty !== filter.difficulty) return false
  if (filter.types.length && !filter.types.includes(row.type)) return false
  if (filter.knowledge.length && !row.knowledge.some((tag) => filter.knowledge.includes(tag))) return false
  return hitKeyword(filter.keyword, toPlainText(row.stem), row.knowledge, row.type, row.answer)
}

/*
 * 以下三个谓词同样被两处消费：对应的页签（决定列表里显示什么）与 shell 的页签命中数
 * （决定页签上那个角标）。**必须共用同一份实现** —— 各写一份的话，角标写着 5 条、点进去
 * 只有 2 条，用户会以为资源丢了。这也是它们放在本模块而不是各自页签里的原因。
 */

/** 试卷命中：关键词可命中卷名 / 出卷人 / 卷内任一题的题干与知识点（「我记得那道题在哪份卷里」） */
export function matchesPaperFilter(
  row: OrgPaper,
  filter: ComposeFilter,
  questionOf: (id: number) => OrgQuestion | undefined,
): boolean {
  if (filter.grade && row.grade !== filter.grade) return false
  if (filter.subject && row.subject !== filter.subject) return false
  const inner = row.sections.flatMap((section) =>
    section.questions.flatMap((item) => {
      const question = questionOf(item.questionId)
      return question ? [toPlainText(question.stem), ...question.knowledge] : []
    }),
  )
  return hitKeyword(filter.keyword, row.name, row.owner, inner)
}

/** 教辅命中：关键词可命中教辅名 / 上传人 / 知识点 / 各章节课时名与知识点 */
export function matchesMaterialFilter(row: OrgMaterial, filter: ComposeFilter): boolean {
  if (filter.subject && row.subject !== filter.subject) return false
  return hitKeyword(
    filter.keyword,
    row.name,
    row.owner,
    row.knowledge,
    row.chapters.flatMap((chapter) => [chapter.title, ...chapter.knowledge]),
  )
}

/** 媒体命中：三个媒体页签共用，kind 由页签指定；媒体无 grade 字段，只按学科收窄 */
export function matchesMediaFilter(row: OrgMedia, filter: ComposeFilter, kind: MediaKind): boolean {
  if (row.kind !== kind) return false
  if (filter.subject && row.subject !== filter.subject) return false
  return hitKeyword(filter.keyword, row.name, row.owner, row.knowledge, row.subject)
}
