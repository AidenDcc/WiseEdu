/**
 * 题库组卷工作台的筛选模型与页签定义。
 *
 * 8 个页签共用**同一份** `ComposeFilter`：一次搜索（文本 / 图片 / AI）写进它，切页签时条件保持，
 * 这样「搜到的东西换个页签还在」是默认行为，而不是要用户在每个页签里重搜一遍。
 */
import {
  QUESTION_SOURCE_OPTIONS,
  toPlainText,
  type MediaKind,
  type OrgMaterial,
  type OrgMedia,
  type OrgPaper,
  type OrgQuestion,
} from '@aiteach/shared'

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
  /** 题目来源（手动录入 / AI 出题 / 拍照识别…），空 = 不限 */
  source: string
  /** 只看收藏：教师长期积累的好题，跨卷复用 */
  onlyFavorites: boolean
  /** 排除已在组卷车中的题目：避免同一道题被加两次（加车时会拦，但列表里先藏掉更省事） */
  excludePicked: boolean
  /* 以下四个维度与题库管理（BankView）同一套：多选 chip，空数组 = 不限 */
  examTypes: string[]
  competitions: string[]
  regions: string[]
  terms: string[]
  /**
   * 试卷年份（`'2026'`，另有哨兵 `EARLIER_YEAR` 表示「更早以前」）/ 月份（`'3'`，固定 1-12）：
   * 题目没有这两个字段，只有试卷页签用。
   * 抽出来单独放，是因为 `matchesQuestionFilter` 不判它们 —— 混在「与题库同口径」那组里会让人
   * 以为题目侧也有年份筛选。
   */
  years: string[]
  months: string[]
}

/**
 * 题目来源候选。改为引用共享层那份（`QUESTION_SOURCE_OPTIONS`，与 `QuestionSource` 同值域）——
 * 原先这里手抄了一份，题库那边新增「名校考试」时本页必然漏掉，下拉里就少一个取值。
 */
export const QUESTION_SOURCES = QUESTION_SOURCE_OPTIONS

export type TabKey =
  | 'questions'
  | 'papers'
  | 'materials'
  | 'miniapp'
  | 'videos'
  | 'images'
  | 'knowledge'
  | 'sync'
  | 'blueprint'

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
  { key: 'blueprint', label: '细目表组卷', icon: 'grid', group: 'compose' },
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
    source: '',
    onlyFavorites: false,
    excludePicked: false,
    examTypes: [],
    competitions: [],
    regions: [],
    terms: [],
    years: [],
    months: [],
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
 * 「只看收藏」与「排除已选」依赖题目 id 集合，而集合来自组卷车 / 收藏夹这类单例状态，
 * 不属于筛选条件本身，故作为**可选上下文**传入而不是塞进 `ComposeFilter`——
 * 否则筛选条件里会出现一组与「搜什么」无关的 id，重置筛选时还得记得清它。
 */
export interface QuestionFilterContext {
  favorites?: ReadonlySet<number>
  picked?: ReadonlySet<number>
}

/**
 * 题目是否命中当前筛选。
 *
 * 题干是富文本（公式、配图），比对前必须转纯文本 —— 否则搜「函数」会漏掉带公式的题干。
 */
export function matchesQuestionFilter(
  row: OrgQuestion,
  filter: ComposeFilter,
  ctx?: QuestionFilterContext,
): boolean {
  if (!filter.includeUnapproved && row.status !== 'approved') return false
  if (filter.subject && row.subject !== filter.subject) return false
  if (filter.grade && row.grade !== filter.grade) return false
  if (filter.difficulty && row.difficulty !== filter.difficulty) return false
  if (filter.types.length && !filter.types.includes(row.type)) return false
  if (filter.knowledge.length && !row.knowledge.some((tag) => filter.knowledge.includes(tag))) return false
  if (filter.source && row.source !== filter.source) return false
  /* 与题库管理同口径的四个维度：可缺省字段给空串，等价于「没有该属性」 */
  if (filter.examTypes.length && !filter.examTypes.includes(row.examType ?? '')) return false
  if (filter.competitions.length && !filter.competitions.includes(row.competition ?? '')) return false
  if (filter.regions.length && !filter.regions.includes(row.region ?? '')) return false
  if (filter.terms.length && !filter.terms.includes(row.term ?? '')) return false
  /* 上下文缺失时（如某些只读场景）这两条直接放行，而不是把题全滤掉 */
  if (filter.onlyFavorites && ctx?.favorites && !ctx.favorites.has(row.id)) return false
  if (filter.excludePicked && ctx?.picked?.has(row.id)) return false
  return hitKeyword(filter.keyword, toPlainText(row.stem), row.knowledge, row.type, row.answer)
}

/*
 * 以下三个谓词同样被两处消费：对应的页签（决定列表里显示什么）与 shell 的页签命中数
 * （决定页签上那个角标）。**必须共用同一份实现** —— 各写一份的话，角标写着 5 条、点进去
 * 只有 2 条，用户会以为资源丢了。这也是它们放在本模块而不是各自页签里的原因。
 */

/**
 * 年份筛选里「更早以前」的哨兵值。
 *
 * 它不是年份，只是 `filter.years` 里的一个取值：年份行是**多选** chip，
 * 「2026 年」和「更早以前」可以同时选中（= 2026 年的卷，或比近三届更早的卷）。
 * 故意取一个不可能与真实年份相撞的字符串，判定见 `isEarlierYear`。
 */
export const EARLIER_YEAR = 'earlier'

/** 年份行里单列的最新几届：更早的年份都并进「更早以前」，这一行才不会年年越铺越长 */
export const RECENT_YEAR_COUNT = 3

/**
 * 年份是否落在「更早以前」这一档（比最近三届更早）。
 *
 * 阈值取自**当前年份**而不是卷池：谓词逐行判定，拿不到「这一屏里有哪些年份」；
 * 若按卷池推导，同一份卷会在卷池变化时改变归属，「更早以前」就不再是一个稳定档位。
 * 空年份（没有年份的卷）不算 —— 与其它可缺省维度同一口径：缺省值不命中任何档。
 */
export function isEarlierYear(year: string | undefined): boolean {
  if (!year) return false
  return Number(year) < new Date().getFullYear() - RECENT_YEAR_COUNT + 1
}

/**
 * 试卷命中：关键词可命中卷名 / 出卷人 / **杯赛名** / 卷内任一题的题干与知识点
 * （「我记得那道题在哪份卷里」）。
 *
 * 杯赛名放进关键词是因为它常被当卷名搜：教师找竞赛卷时输入的是「希望杯」，
 * 而卷名未必带这三个字（如「全国初中数学联赛初赛」挂在「希望杯」这个杯赛下）。
 * 地区 / 考试类型这些**同样打标签的维度刻意不入关键词**：它们取值少且几乎每份卷都有，
 * 一并参与匹配会让「高一」「中等」这类词把所有卷都搜出来，等于没有搜索。
 *
 * 各维度与 `matchesQuestionFilter` 同口径（可缺省字段给空串，等价于「没有该属性」）——
 * 试卷库的筛选面板与试题页签筛的是两类数据，但「难度」「来源」这些词在两边的含义必须一致，
 * 否则跨页签保留的同一份 `filter` 会在这边筛得动、那边筛不动。
 *
 * `filter.types` / `knowledge` / `onlyFavorites` 等题目专属维度不在此判定：试卷没有题型，
 * 试卷库的筛选面板也不提供这些项。反过来，`years` / `months` 是试卷独有的，只有这里判。
 */
export function matchesPaperFilter(
  row: OrgPaper,
  filter: ComposeFilter,
  questionOf: (id: number) => OrgQuestion | undefined,
): boolean {
  if (filter.grade && row.grade !== filter.grade) return false
  if (filter.subject && row.subject !== filter.subject) return false
  if (filter.difficulty && row.difficulty !== filter.difficulty) return false
  if (filter.source && row.source !== filter.source) return false
  /* 考试类型：工作台左树的选中值就写在这里（点分类 = 写入该分类下全部考试类型名） */
  if (filter.examTypes.length && !filter.examTypes.includes(row.examType ?? '')) return false
  if (filter.competitions.length && !filter.competitions.includes(row.competition ?? '')) return false
  if (filter.regions.length && !filter.regions.includes(row.region ?? '')) return false
  /* 年份 / 月份：试卷专属维度（题目没有这两个字段）。缺省给空串 = 「这份卷没有年份」，
     于是它在任何年份筛选下都不命中 —— 与其它可缺省维度同一口径。
     年份多一个「更早以前」档：它不比对具体年份，而是看这份卷是否老于最近三届 */
  const year = row.year ?? ''
  if (
    filter.years.length &&
    !filter.years.includes(year) &&
    !(filter.years.includes(EARLIER_YEAR) && isEarlierYear(year))
  ) {
    return false
  }
  if (filter.months.length && !filter.months.includes(row.month ?? '')) return false
  const inner = row.sections.flatMap((section) =>
    section.questions.flatMap((item) => {
      const question = questionOf(item.questionId)
      return question ? [toPlainText(question.stem), ...question.knowledge] : []
    }),
  )
  return hitKeyword(filter.keyword, row.name, row.owner, row.competition, inner)
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
