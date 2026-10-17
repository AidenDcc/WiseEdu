/**
 * 题目草稿（QuestionDraft）：一处定义、三处共用的题目编辑数据与纯逻辑。
 *
 * 三个入口编辑的是同一件事 —— **一道题**：
 * - 录题中心「手动录入」标签页（页面上的长期表单）
 * - 录题中心「AI 出题」结果卡片的「编辑入库」（弹窗，草稿即开即弃）
 * - 图片识题校对区的「编辑」（弹窗，改完暂存回卡片）
 *
 * 它们的字段集、校验口径、题型推导原本各写一份，且已经开始分叉：题库里「题型」有三套推导
 * （AI 出题采纳时按答案长度、拍照识别按选项结构、显示徽标又是第三套），
 * 「学科必填」只有录题中心在管。所以**共用的是逻辑，不是组件**（同 QuestionResultList 的做法）：
 * 这里只放纯函数，不碰接口、不碰状态、不弹窗 —— `appConfirm` 这类 UI 副作用留在组件里。
 *
 * 刻意**不含** `library` / `categoryId`：那是「这题放哪个库、哪个分类」的归属信息，
 * 与编辑题目本身无关，三个入口的取值也不同（拍照识别固定个人库）。
 * 存档时由 `questionPayloadOf` 的 options 传入。
 *
 * ## 独立单题 / 材料组合题（`category`）
 *
 * 材料组合题 = **一段共用题干 / 材料 + 若干子题**；`stem` 仍留给母题自己的题干，
 * 共用题干 / 材料另存 `material`，子题在 `subQuestions` 里。两者在**结构上是同一件事**：
 * 子题的字段集（题型 / 题干 / 选项 / 答案 / 解析）与母题正文完全一致，所以这里把正文部分
 * 单独抽成 `QuestionBody`，判定与答案折算的纯函数一份，母题与子题共用。
 *
 * 存库时按两端约定收口（见 `questionPayloadOf`）：**组合题的 `stem` 存的是共用题干 / 材料**
 * —— 题库列表、试卷、导出这些只读 `stem` 的既有渲染端因此天然能显示组合题正文，
 * 不必逐个去认「这题是不是组合题」。
 */
import { hasImage, MAX_SUB_QUESTIONS, toPlainText } from '@aiteach/shared'
import type { FillBlankAnswer, GeneratedQuestion, OptionColumns, OrgQuestion, OrgSubQuestion, QuestionCategory, QuestionSource } from '@aiteach/shared'
import { judgeAnswerText } from '@aiteach/business-common'

/** 知识点上限（校验提示与此保持一致） */
export const MAX_KNOWLEDGE = 5

/**
 * 单道材料组合题的子题上限。
 *
 * 定义在 `@aiteach/shared` 的 models 里（mock 侧入库校验要用同一个数），这里只是转出去，
 * 让编辑组件继续按 `@/utils/question-draft` 一条路径引。产品理由：卷面上一道组合题挂几十个
 * 小问，学生根本做不完，大概率是「把一整份卷子塞进一道题」的误用。
 */
export { MAX_SUB_QUESTIONS } from '@aiteach/shared'

/** 走「题干 + 一段富文本参考答案」的题型 */
const ESSAY_TYPES = ['解答', '计算', '证明', '连线', '作文']
/** 有选项、答案存字母的题型 */
const CHOICE_TYPES = ['单选', '多选', '判断']

/* 选项排布的定义在 @aiteach/shared 的 models 里（`OrgQuestion.optionColumns` 用同一个联合类型），
   这里只把它转出去，方便编辑组件继续按老路径引 */
export type { OptionColumns }

export interface FillBlankDraft {
  value: string
  equivalents: string
}

/**
 * 题目正文：题干 + 作答结构 + 解析。
 *
 * 母题（`QuestionDraft`）与子题（`SubQuestionDraft`）都具备这一组字段，渲染组件与判定函数
 * 只依赖这个窄接口 —— 于是「一道选择题长什么样」只有一份实现，子题不必再抄一遍。
 */
export interface QuestionBody {
  type: string
  stem: string
  options: string[]
  optionColumns: OptionColumns
  /** 正确选项下标（0 = A）；答案字母串由 answerTextOf 折算 */
  answers: number[]
  /** 填空题每空的「答案 / 等价答案」，两者都是富文本 HTML */
  fillAnswers: FillBlankDraft[]
  /** 解答类题的参考答案（富文本） */
  essayAnswer: string
  analysis: string
}

/**
 * 子题草稿。学段 / 教材版本 / 学期 / 考试类型 / 来源 / 归属一律继承母题，故子题不持有它们；
 * 只有「会逐题不同」的四件事单独存：题型、难度、知识点、正文。
 */
export interface SubQuestionDraft extends QuestionBody {
  /** 本地自增编号，仅用于列表 key 与拖拽排序；卷面的 (1)(2)(3) 是按数组顺序现算的 */
  id: number
  difficulty: string
  knowledge: string[]
}

export interface QuestionDraft extends QuestionBody {
  /** 题目类别：独立单题 / 材料组合题。只有录题界面需要它 */
  category: QuestionCategory
  subject: string
  grade: string
  difficulty: string
  knowledge: string[]
  textbook: string
  /** 学期（上学期 / 下学期） */
  term: string
  examType: string
  source: QuestionSource
  sourceRemark: string
  /** 共用题干 / 材料（仅材料组合题用；独立单题恒为空串） */
  material: string
  /** 子题（仅材料组合题用；按数组顺序即卷面 (1)(2)(3) 的顺序） */
  subQuestions: SubQuestionDraft[]
}

/** 新草稿：只给结构初值，学段由调用方按「顶部栏 scope」或来源题填 */
export function emptyQuestionDraft(): QuestionDraft {
  return {
    category: '独立单题',
    subject: '',
    grade: '',
    type: '单选',
    difficulty: '中等',
    knowledge: [],
    textbook: '',
    term: '上学期',
    examType: '',
    source: '手动录入',
    sourceRemark: '',
    stem: '',
    options: ['', '', '', ''],
    optionColumns: 1,
    answers: [],
    fillAnswers: [{ value: '', equivalents: '' }],
    essayAnswer: '',
    analysis: '',
    material: '',
    subQuestions: [],
  }
}

/**
 * 新子题：**难度与知识点默认继承母题**（可以改）。
 * 题型不走母题（母题是「阅读理解」这类组合题型，子题取的是一组独立单题题型），由调用方传。
 */
export function emptySubQuestionDraft(
  id: number,
  base: { difficulty?: string; knowledge?: string[] } = {},
): SubQuestionDraft {
  return {
    id,
    type: '单选',
    difficulty: base.difficulty || '中等',
    knowledge: [...(base.knowledge ?? [])],
    options: ['', '', '', ''],
    optionColumns: 1,
    answers: [],
    fillAnswers: [{ value: '', equivalents: '' }],
    essayAnswer: '',
    analysis: '',
    stem: '',
  }
}

/**
 * 新子题的 id：取现有最大 id + 1。
 *
 * **不按条数走** —— 删掉中间一题后再新增会撞上后面那道题的 id，`v-for` 的 key 重复，
 * 右侧表单与拖拽排序都会串题。切类别时自动补的第一道子题也走这里，两处口径一致。
 */
export function nextSubQuestionId(subQuestions: readonly { id: number }[]): number {
  return Math.max(0, ...subQuestions.map((row) => row.id)) + 1
}

/* ==================== 判定（口径只此一份） ==================== */

/** 材料组合题：作答单位是子题，母题本身没有答案 */
export function isCompositeDraft(draft: { category?: QuestionCategory }): boolean {
  return draft.category === '材料组合题'
}

/** 有选项、答案存字母的题型 */
export function isChoiceDraft(draft: { type: string }): boolean {
  return CHOICE_TYPES.includes(draft.type)
}

/** 题干 + 一段参考答案的题型 */
export function isEssayDraft(draft: { type: string }): boolean {
  return ESSAY_TYPES.includes(draft.type)
}

/** 无选项判断题：题干前的（　　）里写对错，答案存「对 / 错」而不是选项字母 */
export function isJudgeNoOptionsDraft(draft: { type: string; options: readonly string[] }): boolean {
  return draft.type === '判断' && draft.options.length === 0
}

/** 富文本下 `<p></p>` 的 trim() 非空，判空必须看纯文本；只含图片的内容也算有值 */
export function hasContent(value: string): boolean {
  return Boolean(toPlainText(value).trim()) || hasImage(value)
}

/**
 * 由「选项 + 一条答案字符串」推导题型 —— 全站唯一一份。
 *
 * 生成结果与识别结果都不带题型字段，只能反推；此前录题中心、拍照识别、结果徽标各写一份，
 * 三套规则在多选/判断题上给出的答案并不一致。
 */
export function typeOfDraft(item: { options: readonly string[]; answer: string }): string {
  if (!item.options.length) return '解答'
  /* 判断题的两项固定是「正确 / 错误」，与一般选择题的两项区分得开 */
  if (item.options.length === 2 && item.options[0] === '正确') return '判断'
  return answerLettersOf(item.answer).length > 1 ? '多选' : '单选'
}

/** 答案字母串 → 下标数组（多余字符丢弃） */
export function answerIndicesOf(answer: string): number[] {
  return answerLettersOf(answer)
    .split('')
    .map((ch) => 'ABCDEF'.indexOf(ch))
    .filter((i) => i >= 0)
}

export function answerLettersOf(answer: string): string {
  return answer.toUpperCase().replace(/[^A-F]/g, '')
}

/**
 * 答案的三形态折叠成一条字符串 —— 存储口径的唯一出口。
 *
 * - 无选项判断题：学生写的是对错，存的也是这两个字（不是选项字母）
 * - 选择题：字母串
 * - 填空题：各空纯文本以「｜」分隔（富文本另存在 fillAnswers 里）
 * - 解答类：整段参考答案富文本
 */
export function answerTextOf(draft: QuestionBody): string {
  if (isJudgeNoOptionsDraft(draft)) {
    return draft.answers.length ? (draft.answers[0] === 0 ? '对' : '错') : ''
  }
  if (isChoiceDraft(draft)) {
    if (!draft.answers.length) return ''
    return [...draft.answers].sort((a, b) => a - b).map((i) => 'ABCDEF'[i]).join('')
  }
  if (draft.type === '填空') return draft.fillAnswers.map((row) => toPlainText(row.value).trim()).join('｜')
  return draft.essayAnswer
}

/* ==================== 写入 ==================== */

/**
 * 把「选项 + 一条答案字符串」塞进草稿的作答结构：题型、选项、答题区三处必须一起改。
 * 生成结果 / 识别结果 → 草稿，以及题型切换后的重建，走的都是这一条路。
 */
export function applyAnswerToDraft(
  draft: QuestionBody,
  options: readonly string[],
  answer: string,
  type?: string,
): void {
  const nextType = type ?? typeOfDraft({ options, answer })
  draft.type = nextType
  draft.options = [...options]
  draft.answers = []
  draft.fillAnswers = [{ value: '', equivalents: '' }]
  draft.essayAnswer = ''

  if (nextType === '填空') {
    /* 存量题没有 fillAnswers，按旧的「｜」分隔回退 */
    draft.fillAnswers = answer.split('｜').map((value) => ({ value: value.trim(), equivalents: '' }))
    return
  }
  if (nextType === '判断' && !options.length) {
    /* 无选项判断题：答案存的是「对 / 错」（也可能是存量/模型给的 A、T、√） */
    draft.answers = [judgeAnswerText(answer) === '对' ? 0 : 1]
    return
  }
  if (!options.length) {
    draft.essayAnswer = answer
    return
  }
  draft.answers = answerIndicesOf(answer)
}

/**
 * 换题型后重建该题型专属的作答结构（选项 / 答案 / 每空答案）。
 * 母题与子题共用 —— 子题换题型时同样要清掉上一种题型的作答结构。
 */
export function resetBodyStructure(draft: QuestionBody, nextType: string): void {
  draft.type = nextType
  draft.answers = []
  draft.options = nextType === '判断' ? ['正确', '错误'] : ['', '', '', '']
  draft.fillAnswers = [{ value: '', equivalents: '' }]
  draft.essayAnswer = ''
}

/**
 * 切题目类别时把题型落到新类别的候选里。
 *
 * 两类题型互不通用（「阅读理解」不能当独立单题的题型、「单选」也不能当材料组合题的题型），
 * 所以切类别后原来的题型必然失效。规则：候选里还有原值就保留（切回原类别时能复原上一次的选择），
 * 否则落回该类别下最通用的一项 —— 独立单题取「单选」、材料组合题取「材料分析」。
 */
export function pickCategoryType(options: string[], current: string, category: QuestionCategory): string {
  if (!options.length || options.includes(current)) return current
  const preferred = category === '材料组合题' ? '材料分析' : '单选'
  return options.includes(preferred) ? preferred : (options[0] ?? current)
}

/**
 * 把 AI 检测给出的「子题修正版」合并进一道子题草稿（组合题 AI 修正回写的唯一入口）。
 *
 * 补丁语义：**字段缺省 = 该项没问题、保持原值**（见 ai-normalize 的 SubQuestionCorrection）。
 * 调用方应当先按差异过滤出真正要改的字段再传进来 —— 补丁里带上与原值相同的字段虽然不会改错内容，
 * 却会触发下面的作答结构重建（例：填空题的答案会被按「｜」重新拆空，等价答案丢掉）。
 *
 * 题型 / 选项 / 答案三者一体：任一被修正就按修正后的题型重建整套作答结构，否则会出现
 * 「答案字母指向不存在的选项」这种半截状态。只有题型被单独改动时，按编辑器切换题型的同一套规则重建。
 */
export function applySubQuestionCorrection(
  draft: SubQuestionDraft,
  patch: {
    type?: string
    difficulty?: string
    knowledge?: string[]
    stem?: string
    options?: string[]
    answer?: string
    analysis?: string
  },
): void {
  if (patch.difficulty) draft.difficulty = patch.difficulty
  if (patch.knowledge?.length) draft.knowledge = [...new Set(patch.knowledge)].slice(0, MAX_KNOWLEDGE)
  if (patch.stem != null) draft.stem = patch.stem
  if (patch.analysis != null) draft.analysis = patch.analysis

  if (patch.options == null && patch.answer == null && patch.type == null) return
  const nextType = patch.type ?? draft.type
  if (patch.options == null && patch.answer == null) {
    resetBodyStructure(draft, nextType)
    return
  }
  /* 填空题的答案在存储上是纯文本（各空以「｜」分隔），富文本答案先折回纯文本再拆空 */
  const answer = patch.answer ?? answerTextOf(draft)
  applyAnswerToDraft(
    draft,
    nextType === '填空' ? [] : (patch.options ?? draft.options),
    nextType === '填空' ? toPlainText(answer) : answer,
    nextType,
  )
}

/**
 * 年级变更的**唯一入口**：年级变了就按新年级收窄学科，当前学科在新年级不存在则**清空**
 * （不落到该年级第一个学科 —— 那等于替用户做了「换成物理」这种决定）。
 *
 * 调用方有两处：编辑器里的年级 chip，以及页面的顶部栏 scope watcher / AI 纠错回写。
 * `optionsForGrade` 由调用方注入（来自 useBaseData），纯函数不碰字典单例。
 */
export function setDraftGrade(
  draft: QuestionDraft,
  nextGrade: string,
  nextSubject: string | undefined,
  optionsForGrade: (grade: string) => string[],
): void {
  draft.grade = nextGrade
  const options = optionsForGrade(nextGrade)
  const candidate = nextSubject ?? draft.subject
  draft.subject = candidate && options.includes(candidate) ? candidate : ''
}

/* ==================== 校验 ==================== */

export interface DraftErrors {
  errors: Record<string, string>
  /** 子题的红字，按子题 id 分组（展开态才看得见，故校验失败时会自动打开那一题） */
  subErrors: Record<number, Record<string, string>>
  /** 解析为空。要不要拦由调用方决定 —— 组件里会为此弹一次 confirm（题目审核建议补解析） */
  analysisMissing: boolean
}

/**
 * 校验「题目正文」那一块（母题与子题同一套口径）。
 * 写进传入的 `errors`，便于母题与子题各拿一份自己的红字表。
 */
function collectBodyErrors(draft: QuestionBody, full: boolean, errors: Record<string, string>): void {
  if (!hasContent(draft.stem)) errors.stem = '题干不能为空'
  if (isChoiceDraft(draft) && draft.options.length) {
    if (draft.options.some((opt) => !hasContent(opt))) errors.options = '每项选项必填'
    if (draft.answers.length === 0 || (draft.type === '多选' && draft.answers.length < 2)) {
      errors.options = errors.options || (draft.type === '多选' ? '多选须标记 ≥2 个正确答案' : '请设置正确答案')
    }
  }
  /* 等价答案是选填，只看每空的答案本身 */
  if (draft.type === '填空' && draft.fillAnswers.some((row) => !hasContent(row.value))) {
    errors.answer = '每空答案必填'
  }
  if (isEssayDraft(draft) && !hasContent(draft.essayAnswer)) errors.answer = '参考答案必填'
}

/**
 * 校验草稿。**不弹窗、不写状态**，把结论原样交回调用方。
 * `full=false` 只校验必填属性（存草稿），`full=true` 全量校验（提交审核）。
 */
export function collectDraftErrors(draft: QuestionDraft, full: boolean): DraftErrors {
  const errors: Record<string, string> = {}
  const subErrors: Record<number, Record<string, string>> = {}
  /* 学科必须校验：切年级会把不适用的学科清空，少了这一条能存出 subject: '' 的题 */
  if (!draft.subject) errors.subject = '请选择学科（切换年级后原学科可能已不适用）'
  if (!draft.knowledge.length) errors.knowledge = `请选择知识点（最多 ${MAX_KNOWLEDGE} 个）`
  let analysisMissing = false

  if (isCompositeDraft(draft)) {
    /* 组合题：母题没有作答结构，要校验的是共用材料与每一道子题 */
    if (!hasContent(draft.material)) errors.material = '共用题干 / 材料不能为空'
    /* 上限两边都拦：它是数据完整性问题，不该靠「按钮点不动」这一个界面防线 */
    if (draft.subQuestions.length > MAX_SUB_QUESTIONS) {
      errors.subQuestions = `子题最多 ${MAX_SUB_QUESTIONS} 道`
    }
    if (full) {
      /* 「至少一道子题」只在**提交审核**时拦。录题中途把子题删空、先存个草稿明天接着写
         是正常操作；存草稿也拦的话这条路走不通（切类别时已自动补第一道，见 QuestionEditor） */
      if (!draft.subQuestions.length) {
        errors.subQuestions = errors.subQuestions || '材料组合题至少需要一个子题'
      }
      draft.subQuestions.forEach((sub, index) => {
        const row: Record<string, string> = {}
        if (!sub.knowledge.length) row.knowledge = '请选择知识点'
        collectBodyErrors(sub, full, row)
        if (Object.keys(row).length) subErrors[sub.id] = row
        /* 子题解析为空也算——它照样要给学生看 */
        if (!hasContent(sub.analysis)) analysisMissing = true
        void index
      })
    } else {
      /* 存草稿只看子题的知识点（必填属性），正文类问题留给提交时的全量校验 */
      draft.subQuestions.forEach((sub) => {
        if (!sub.knowledge.length) subErrors[sub.id] = { knowledge: '请选择知识点' }
      })
    }
  } else {
    if (full) {
      collectBodyErrors(draft, full, errors)
      if (!hasContent(draft.analysis)) analysisMissing = true
    }
  }

  if (draft.sourceRemark.length > 100) errors.sourceRemark = '来源备注 ≤100 字'
  return { errors, subErrors, analysisMissing }
}

/* ==================== 草稿 ⇄ 各来源 ==================== */

/** 子题草稿 → 入参（`OrgSubQuestion`） */
function subQuestionPayloadOf(sub: SubQuestionDraft): OrgSubQuestion {
  return {
    id: sub.id,
    type: sub.type,
    difficulty: sub.difficulty,
    knowledge: [...sub.knowledge],
    stem: sub.stem,
    /* 过滤空选项：教师删空后不该残留空选项 */
    options: isChoiceDraft(sub) ? sub.options.filter((opt) => hasContent(opt)) : [],
    optionColumns: sub.optionColumns,
    answer: answerTextOf(sub),
    fillAnswers:
      sub.type === '填空'
        ? sub.fillAnswers.map((row) => ({ value: row.value, equivalents: row.equivalents }))
        : undefined,
    analysis: sub.analysis,
  }
}

/**
 * 草稿 → `saveQuestion` 入参。
 * 选项与填空答案的折叠口径只此一份：三个入口存进去的形状必须一模一样。
 *
 * 组合题按「母题只留材料」收口：`stem` = 共用题干 / 材料，选项 / 答案 / 解析留空，
 * 子题整包放进 `subQuestions`（见文件头的说明）。
 */
export function questionPayloadOf(
  draft: QuestionDraft,
  opts: { id?: number; library: 'personal' | 'org' | 'wrong'; categoryId?: number; submit: boolean },
) {
  const composite = isCompositeDraft(draft)
  return {
    id: opts.id,
    questionCategory: draft.category,
    stem: composite ? draft.material : draft.stem,
    subQuestions: composite ? draft.subQuestions.map(subQuestionPayloadOf) : [],
    subject: draft.subject,
    grade: draft.grade,
    type: draft.type,
    difficulty: draft.difficulty,
    knowledge: [...draft.knowledge],
    textbook: draft.textbook || undefined,
    term: draft.term,
    examType: draft.examType || undefined,
    source: draft.source,
    sourceRemark: draft.sourceRemark || undefined,
    /* 过滤空选项：教师删空后不该残留空选项 */
    options: !composite && isChoiceDraft(draft) ? draft.options.filter((opt) => hasContent(opt)) : [],
    optionColumns: draft.optionColumns,
    answer: composite ? '' : answerTextOf(draft),
    fillAnswers:
      !composite && draft.type === '填空'
        ? draft.fillAnswers.map((row) => ({ value: row.value, equivalents: row.equivalents }))
        : undefined,
    analysis: composite ? '' : draft.analysis,
    library: opts.library,
    categoryId: opts.categoryId,
    submit: opts.submit,
  }
}

/** 把一条已存的子题回填成子题草稿（题型反推、答案按题型分派与母题同一套） */
export function subDraftFromQuestion(row: OrgSubQuestion): SubQuestionDraft {
  const draft = emptySubQuestionDraft(row.id, { difficulty: row.difficulty, knowledge: row.knowledge })
  applyAnswerToDraft(draft, row.options ?? [], row.answer ?? '', row.type)
  draft.stem = row.stem
  draft.analysis = row.analysis
  draft.optionColumns = row.optionColumns ?? 1
  /* 每空的富文本答案单独存了一份，覆盖面较薄的重建结果 */
  if (draft.type === '填空' && row.fillAnswers?.length) {
    draft.fillAnswers = row.fillAnswers.map((item) => ({ value: item.value, equivalents: item.equivalents }))
  }
  return draft
}

/** 题库里的存量题 → 草稿（录题中心「编辑既有题目」与 AI 结果「重新编辑」共用） */
export function draftFromQuestion(q: OrgQuestion): QuestionDraft {
  const draft = emptyQuestionDraft()
  const composite = q.questionCategory === '材料组合题'
  /* 有意**不走 setDraftGrade**：这是「载入已存数据」而非「用户切年级」，
     按新规则校验会在打开一道学科已停用的存量题时把学科静默抹掉。 */
  Object.assign(draft, {
    category: composite ? ('材料组合题' as QuestionCategory) : ('独立单题' as QuestionCategory),
    subject: q.subject,
    grade: q.grade,
    type: q.type,
    difficulty: q.difficulty,
    knowledge: [...q.knowledge],
    textbook: q.textbook ?? '',
    term: q.term ?? '上学期',
    examType: q.examType ?? '',
    source: q.source ?? '手动录入',
    sourceRemark: q.sourceRemark ?? '',
    optionColumns: q.optionColumns ?? 1,
  })
  if (composite) {
    /* 组合题的 `stem` 就是共用题干 / 材料，正文在子题里 */
    draft.material = q.stem
    draft.subQuestions = (q.subQuestions ?? []).map(subDraftFromQuestion)
    draft.options = []
    draft.answers = []
    draft.essayAnswer = ''
    return draft
  }
  draft.stem = q.stem
  draft.analysis = q.analysis
  if (q.type === '填空') {
    draft.fillAnswers = q.fillAnswers?.length
      ? q.fillAnswers.map((row) => ({ value: row.value, equivalents: row.equivalents }))
      : q.answer.split('｜').map((value) => ({ value: value.trim(), equivalents: '' }))
    return draft
  }
  if (q.options.length > 0) {
    draft.options = [...q.options]
    draft.answers = answerIndicesOf(q.answer)
    return draft
  }
  if (q.type === '判断') {
    draft.options = []
    draft.answers = [judgeAnswerText(q.answer) === '对' ? 0 : 1]
    return draft
  }
  draft.essayAnswer = q.answer
  return draft
}

/**
 * AI 生成题 → 草稿。`base` 带入学段与来源标注（生成题本身不带学科/年级）。
 *
 * 无选项的生成题落进**解答**：旧实现沿用请求时的题型，于是「选了单选又拿到无选项的题」会停在
 * 「单选 + 四个空选项框」上，而 AI 给的答案存在 essayAnswer 里根本看不见。
 *
 * AI 出题只产出独立单题，故类别固定为「独立单题」。
 */
export function draftFromGenerated(item: GeneratedQuestion, base: Partial<QuestionDraft> = {}): QuestionDraft {
  const draft = { ...emptyQuestionDraft(), ...base, category: '独立单题' as QuestionCategory }
  draft.difficulty = item.difficulty || draft.difficulty
  draft.knowledge = item.knowledge.slice(0, MAX_KNOWLEDGE)
  draft.stem = item.stem
  draft.analysis = item.analysis
  /* 来源沿用旧草稿的标注，便于入库后追溯；枚举来源一并对齐，
     否则 AI 生成的题入库后会被来源筛选记成「手动录入」 */
  draft.source = 'AI 出题'
  draft.sourceRemark = 'AI 智能出题'
  applyAnswerToDraft(draft, item.options, item.answer)
  return draft
}

/**
 * 拍照识别结果 → 草稿。
 *
 * 结果行只有一条 `answer` 字符串（选项已在识别时写成 `A. xxx` 的形式），按题型分派到
 * 三个答题区；`type` 优先用教师上次改过的（`row.type`），否则按选项结构反推。
 *
 * `subject` / `grade` 缺省回落到 `fallback`（当前顶部栏 scope）—— 识别结果不带学段时，
 * 空着会直接被「学科必填」的校验拦下，那是能存的东西变成存不了。
 */
export function draftFromPhotoResult(
  row: {
    stem: string
    options: string[]
    answer: string
    analysis: string
    knowledge: string[]
    difficulty: string
    subject?: string
    grade?: string
    type?: string
    fillAnswers?: FillBlankAnswer[]
    optionColumns?: OptionColumns
  },
  fallback: { subject: string; grade: string } = { subject: '', grade: '' },
): QuestionDraft {
  const draft = emptyQuestionDraft()
  draft.subject = row.subject || fallback.subject
  draft.grade = row.grade || fallback.grade
  draft.difficulty = row.difficulty || draft.difficulty
  draft.knowledge = [...row.knowledge]
  draft.stem = row.stem
  draft.analysis = row.analysis
  draft.source = '拍照识别'
  draft.optionColumns = row.optionColumns ?? 1
  /* 选项文本里自带的「A. 」前缀（mock 演示数据带，真实 AI 不带）统一去掉，
     字母由界面按位置渲染 —— 留着会出现「A. A. 选项一」 */
  const options = row.options.map((opt) => opt.replace(/^[A-F]\s*[.、．)]\s*/, ''))
  applyAnswerToDraft(draft, options, row.answer, row.type)
  /* 每空的富文本答案单独存了一份，覆盖面较薄的重建结果 */
  if (draft.type === '填空' && row.fillAnswers?.length) {
    draft.fillAnswers = row.fillAnswers.map((b) => ({ value: b.value, equivalents: b.equivalents }))
  }
  return draft
}

/** 已保存的暂存改动覆盖识别原值：列表里看到的就该是提交时发出去的内容 */
export function mergeDraft(base: QuestionDraft, saved?: Partial<QuestionDraft>): QuestionDraft {
  if (!saved) return base
  return {
    ...base,
    ...saved,
    /* 数组字段必须换新引用：否则暂存的与展示的是同一个数组，
       再编辑一次会就地改掉「已保存」的那份，取消也退不回去 */
    knowledge: [...(saved.knowledge ?? base.knowledge)],
    options: [...(saved.options ?? base.options)],
    answers: [...(saved.answers ?? base.answers)],
    fillAnswers: (saved.fillAnswers ?? base.fillAnswers).map((row) => ({ ...row })),
    /* 子题同样按值拷：它是对象数组，浅拷一层仍会共享内层选项 / 知识点 */
    subQuestions: (saved.subQuestions ?? base.subQuestions).map((row) => ({
      ...row,
      knowledge: [...row.knowledge],
      options: [...row.options],
      answers: [...row.answers],
      fillAnswers: row.fillAnswers.map((item) => ({ ...item })),
    })),
  }
}
