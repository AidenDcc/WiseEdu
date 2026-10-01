/**
 * 大题归类与试卷组装的共享纯函数。
 *
 * 两个消费方：协同组卷（`paper/CollabView.vue`）与题库组卷工作台（`paper/compose/*`）。
 * 抽出来是为了「加入一道题该归到哪个大题」只有一份实现 —— 之前它只在协同组卷里，
 * 工作台若各写一份，同一道单选题在两边可能落进不同大题。
 *
 * 只放纯函数：`showToast`、操作日志、id 自增计数器等副作用一律留在各自视图层，
 * 否则共享函数的签名会被两边的 UI 细节绑死。
 */
import type { OrgQuestion, PaperSection } from '@aiteach/shared'

/**
 * 组装大题所需的最小题目描述（组卷车的条目结构上兼容它）。
 * 刻意不收 `BasketEntry` 类型：那会让本模块与组卷车 composable 互相引用，
 * 而这里只需要「题目 + 分值 + 可选大题名」三件事。
 */
export interface SectionSeed {
  questionId: number
  /** 分值；缺省时按题型取默认分 */
  score?: number
  /** 指定大题名（同步练习按课时组卷）；缺省时按题型自动归类 */
  sectionTitle?: string
}

/** 题型 → 大题标准名（新建大题时用它命名；卷面大题名保留「题」字，是试卷惯例） */
export const SECTION_LABEL: Record<string, string> = {
  单选: '单项选择题',
  多选: '多项选择题',
  判断: '判断题',
  填空: '填空题',
  解答: '解答题',
  计算: '计算题',
  证明: '证明题',
  连线: '连线题',
  作文: '作文题',
  作图: '作图题',
  /* 英语专属题型；「七选五」「短文改错」在卷面上本就不带「题」字，不硬凑 */
  完形填空: '完形填空题',
  七选五: '七选五',
  短文改错: '短文改错题',
}

/** 题型名全集：用于从大题标题反查题型，避免各处再维护一份题型清单 */
export const SECTION_TYPES = Object.keys(SECTION_LABEL)

/** 题型 → 大题标题匹配关键词（兼容「选择题」「一、单选题」等用户自定义标题） */
export const SECTION_KEYWORDS: Record<string, string[]> = {
  单选: ['单选', '选择'],
  多选: ['多选'],
  判断: ['判断'],
  填空: ['填空'],
  解答: ['解答', '问答'],
  计算: ['计算'],
  证明: ['证明'],
  连线: ['连线'],
  作文: ['作文'],
  作图: ['作图'],
  完形填空: ['完形填空'],
  七选五: ['七选五'],
  短文改错: ['短文改错', '改错'],
}

export const SECTION_NUMBERS = '一二三四五六七八'

/** 大题数量上限（超出的题目退入最后一个大题，由调用方提示） */
export const MAX_SECTIONS = 8

/** 去掉标题编号前缀（「一、」），只留大题名用于题型匹配 */
export function sectionTypeKey(title: string): string {
  return title.replace(/^[一二三四五六七八九十]+、/, '').trim()
}

/** 题型对应的大题标准名；字典外的题型退化为「X大题」 */
export function sectionLabelOf(type: string): string {
  return SECTION_LABEL[type] ?? `${type}大题`
}

/** 题型对应的大题标题匹配关键词；字典外的题型退化为去掉「题」字后缀 */
export function sectionKeywordsOf(type: string): string[] {
  return SECTION_KEYWORDS[type] ?? [type.replace(/题$/, '')]
}

/**
 * 大题标题 → 题型名（认不出返回空串）。
 *
 * 命中最长者胜，而不是先到先得：「完形填空题」同时含「完形填空」与「填空」，
 * 若按短名先匹配，同一个大题会既算完形填空又算填空 —— 分工标签会挂出两个负责人，
 * 组卷时也会被塞错大题。长度比较不依赖清单顺序，新增题型不必考虑排序。
 */
export function typeOfSectionTitle(title: string): string {
  const matched = SECTION_TYPES.filter((type) => title.includes(type))
  return matched.reduce((longest, type) => (type.length > longest.length ? type : longest), '')
}

/**
 * 题型默认分值：演算型主观大题（解答 / 计算 / 证明）12 分，其余 5 分。
 * 只作「组卷车条目没带分值」时的兜底，实际分值以条目为准。
 */
const LARGE_SCORE_TYPES = new Set(['解答', '计算', '证明'])

export function defaultScore(type: string): number {
  return LARGE_SCORE_TYPES.has(type) ? 12 : 5
}

/** 大题标题：`${序号}、${大题名}` */
export function makeSectionTitle(key: string, index: number): string {
  return `${SECTION_NUMBERS[index] ?? index + 1}、${key}`
}

/**
 * 找到可容纳该大题的大题下标，返回 -1 表示需要新建。
 *
 * 两级匹配：先比大题名是否一致（同步练习按课时组卷时，同一课时再次加题走这条），
 * 再用题型关键词命中（这样用户手写的「一、选择题」也能接住单选题）。
 */
export function findSectionIndex(sections: PaperSection[], key: string, keywords: string[]): number {
  const needle = sectionTypeKey(key)
  const exact = sections.findIndex((row) => sectionTypeKey(row.title) === needle)
  if (exact >= 0) return exact
  return sections.findIndex((row) => {
    const title = sectionTypeKey(row.title)
    /* 大题已归到别的题型时不再用关键词接（「完形填空题」含「填空」）：
       否则完形填空题会把普通填空题一并吞下，或反过来把完形填空塞进填空大题 */
    const owner = typeOfSectionTitle(title)
    if (owner && !needle.includes(owner)) return false
    return keywords.some((kw) => title.includes(kw))
  })
}

export interface BuiltSections {
  sections: PaperSection[]
  /** 组卷车里指向已不存在的题目（题库被删除/回收）：由调用方提示，绝不静默丢题 */
  missing: number[]
  /** 因大题数达上限而并入最后一个大题的题数 */
  overflow: number
}

/**
 * 组卷车 → 试卷大题结构。
 *
 * 归类规则：条目带 `sectionTitle`（同步练习按课时组卷）时以课时名为大题名，
 * 否则按题型归入对应大题。题目按加车顺序排列，分值取条目分值、缺失时用题型默认分。
 */
export function buildSections(entries: SectionSeed[], questions: OrgQuestion[]): BuiltSections {
  const byId = new Map(questions.map((row) => [row.id, row]))
  const sections: PaperSection[] = []
  const missing: number[] = []
  let overflow = 0
  let seq = 1

  for (const entry of entries) {
    const question = byId.get(entry.questionId)
    if (!question) {
      missing.push(entry.questionId)
      continue
    }
    const chapterTitle = entry.sectionTitle?.trim()
    const key = chapterTitle || sectionLabelOf(question.type)
    /* 按课时组卷时用课时名精确匹配，避免落到「单项选择题」这类题型大题里 */
    const keywords = chapterTitle ? [sectionTypeKey(chapterTitle)] : sectionKeywordsOf(question.type)

    let index = findSectionIndex(sections, key, keywords)
    if (index < 0) {
      if (sections.length >= MAX_SECTIONS) {
        overflow += 1
        index = sections.length - 1
      } else {
        sections.push({ id: seq++, title: makeSectionTitle(key, sections.length), questions: [] })
        index = sections.length - 1
      }
    }
    sections[index].questions.push({
      questionId: question.id,
      score: entry.score || defaultScore(question.type),
    })
  }

  return { sections, missing, overflow }
}

/** 试卷总分 */
export function scoreOfSections(sections: PaperSection[]): number {
  return sections.reduce(
    (total, section) => total + section.questions.reduce((sum, q) => sum + (Number(q.score) || 0), 0),
    0,
  )
}

/** 客观题（单选/多选/判断）分值合计 */
export function objectiveScoreOfSections(sections: PaperSection[], questions: OrgQuestion[]): number {
  const OBJECTIVE = new Set(['单选', '多选', '判断'])
  const byId = new Map(questions.map((row) => [row.id, row]))
  return sections.reduce(
    (total, section) =>
      total +
      section.questions.reduce((sum, q) => {
        const item = byId.get(q.questionId)
        return sum + (item && OBJECTIVE.has(item.type) ? Number(q.score) || 0 : 0)
      }, 0),
    0,
  )
}
