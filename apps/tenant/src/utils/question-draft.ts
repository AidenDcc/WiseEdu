/**
 * 题目草稿（QuestionDraft）：一处定义、三处共用的题目编辑数据与纯逻辑。
 *
 * 三个入口编辑的是同一件事 —— **一道题**：
 * - 录题中心「手动录入」标签页（页面上的长期表单）
 * - 录题中心「AI 出题」结果卡片的「编辑入库」（弹窗，草稿即开即弃）
 * - AI 识题校对区的「编辑」（弹窗，改完暂存回卡片）
 *
 * 它们的字段集、校验口径、题型推导原本各写一份，且已经开始分叉：题库里「题型」有三套推导
 * （AI 出题采纳时按答案长度、拍照识别按选项结构、显示徽标又是第三套），
 * 「学科必填」只有录题中心在管。所以**共用的是逻辑，不是组件**（同 QuestionResultList 的做法）：
 * 这里只放纯函数，不碰接口、不碰状态、不弹窗 —— `window.confirm` 这类 UI 副作用留在组件里。
 *
 * 刻意**不含** `library` / `categoryId`：那是「这题放哪个库、哪个分类」的归属信息，
 * 与编辑题目本身无关，三个入口的取值也不同（拍照识别固定个人库）。
 * 存档时由 `questionPayloadOf` 的 options 传入。
 */
import { hasImage, toPlainText } from '@aiteach/shared'
import type { FillBlankAnswer, GeneratedQuestion, OptionColumns, OrgQuestion, QuestionSource } from '@aiteach/shared'
import { judgeAnswerText } from '@/utils/question-card'

/** 知识点上限（校验提示与此保持一致） */
export const MAX_KNOWLEDGE = 5

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

export interface QuestionDraft {
  subject: string
  grade: string
  type: string
  difficulty: string
  knowledge: string[]
  textbook: string
  /** 学期（上学期 / 下学期） */
  term: string
  examType: string
  source: QuestionSource
  sourceRemark: string
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

/** 新草稿：只给结构初值，学段由调用方按「顶部栏 scope」或来源题填 */
export function emptyQuestionDraft(): QuestionDraft {
  return {
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
  }
}

/* ==================== 判定（口径只此一份） ==================== */

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
export function answerTextOf(draft: QuestionDraft): string {
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
  draft: QuestionDraft,
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
  /** 解析为空。要不要拦由调用方决定 —— 组件里会为此弹一次 confirm（题目审核建议补解析） */
  analysisMissing: boolean
}

/**
 * 校验草稿。**不弹窗、不写状态**，把结论原样交回调用方。
 * `full=false` 只校验必填属性（存草稿），`full=true` 全量校验（提交审核）。
 */
export function collectDraftErrors(draft: QuestionDraft, full: boolean): DraftErrors {
  const errors: Record<string, string> = {}
  /* 学科必须校验：切年级会把不适用的学科清空，少了这一条能存出 subject: '' 的题 */
  if (!draft.subject) errors.subject = '请选择学科（切换年级后原学科可能已不适用）'
  if (!draft.knowledge.length) errors.knowledge = `请选择知识点（最多 ${MAX_KNOWLEDGE} 个）`
  let analysisMissing = false
  if (full) {
    if (!hasContent(draft.stem)) errors.stem = '题干不能为空'
    if (isChoiceDraft(draft)) {
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
    if (!hasContent(draft.analysis)) analysisMissing = true
  }
  if (draft.sourceRemark.length > 100) errors.sourceRemark = '来源备注 ≤100 字'
  return { errors, analysisMissing }
}

/* ==================== 草稿 ⇄ 各来源 ==================== */

/**
 * 草稿 → `saveQuestion` 入参。
 * 选项与填空答案的折叠口径只此一份：三个入口存进去的形状必须一模一样。
 */
export function questionPayloadOf(
  draft: QuestionDraft,
  opts: { id?: number; library: 'personal' | 'org' | 'wrong'; categoryId?: number; submit: boolean },
) {
  return {
    id: opts.id,
    stem: draft.stem,
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
    options: isChoiceDraft(draft) ? draft.options.filter((opt) => hasContent(opt)) : [],
    optionColumns: draft.optionColumns,
    answer: answerTextOf(draft),
    fillAnswers:
      draft.type === '填空'
        ? draft.fillAnswers.map((row) => ({ value: row.value, equivalents: row.equivalents }))
        : undefined,
    analysis: draft.analysis,
    library: opts.library,
    categoryId: opts.categoryId,
    submit: opts.submit,
  }
}

/** 题库里的存量题 → 草稿（录题中心「编辑既有题目」与 AI 结果「重新编辑」共用） */
export function draftFromQuestion(q: OrgQuestion): QuestionDraft {
  const draft = emptyQuestionDraft()
  /* 有意**不走 setDraftGrade**：这是「载入已存数据」而非「用户切年级」，
     按新规则校验会在打开一道学科已停用的存量题时把学科静默抹掉。 */
  Object.assign(draft, {
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
    stem: q.stem,
    analysis: q.analysis,
    optionColumns: q.optionColumns ?? 1,
  })
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
 */
export function draftFromGenerated(item: GeneratedQuestion, base: Partial<QuestionDraft> = {}): QuestionDraft {
  const draft = { ...emptyQuestionDraft(), ...base }
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
  }
}
