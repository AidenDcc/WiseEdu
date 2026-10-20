/**
 * 试卷导入 · AI 识别编排层（卷面识别 + 试题识别 + 检查轮次）。
 *
 * ## 两段式识别（对应需求「试题识别和卷面识别」）
 *
 * 1. **卷面识别**（`SECTION_LAYOUT`）：读卷头与骨架 —— 试卷名、学科、年级、时长、满分、
 *    大题结构（标题 / 提示 / 材料 / 每小题分值）、注意事项、版式特征（分栏 / 页数 / 答题卡 / 密封线）。
 * 2. **试题识别**（`SECTION_QUESTIONS`）：逐题转录题干 / 选项 / 答案 / 解析，并带上所属大题与分值。
 *
 * 两步分开请求而不是合并成一次：合并时模型常常「顾着抄题、忘了大题标题」，最后整卷没有结构；
 * 分开后即便某一步失败，也可以只重跑那一步。
 *
 * ## 多页合并
 *
 * 一次导入可以是多张图 / 多页 PDF，一页一次请求（串行，避免额度与超时一起打满），
 * 结果按「大题标题」合并：跨页延续的同一道大题合成一项，题目按页序追加后统一重新编号。
 *
 * ## 引擎选择
 *
 * - 全是图片且配置了视觉通道 → `vision`（多模态直接看图）；
 * - 有 PDF / Word 文本且配置了文本通道 → `text`；
 * - 否则 → `mock` 本地演示（与拍照识题、文档识别同一套降级策略，保证无 Key 也能演示全流程）。
 */
import type { GeneratedQuestion } from '@aiteach/shared'
import { collectTags } from '@aiteach/business-common'
import { fetchKnowledgeTree } from './org'
import {
  PAPER_LAYOUT_SYSTEM_PROMPT,
  PAPER_QUESTIONS_SYSTEM_PROMPT,
  buildPaperLayoutUserPrompt,
  buildPaperQuestionsUserPrompt,
} from './ai-prompts'
import { extractJsonObject, normalizeQuestionList } from './ai-normalize'
import { persistEmbeddedImages } from './ai-photo'
import { chatCompletion, isDeepseekConfigured, isVisionConfigured, visionChat } from './deepseek'
import { verifyQuestionsByAi, type VerifyIssue } from './ai-verify'
import type { ChatContentPart } from './deepseek'
import type { PaperSourceFile } from '@/utils/paper-source'

export type PaperImportEngine = 'vision' | 'text' | 'mock'

/** 认识出的大题（卷面结构的一项） */
export interface RecognizedSection {
  id: string
  /** 卷面原编号的标题，如「一、单项选择题」 */
  title: string
  /** 作答提示，如「本题共 8 小题，每小题 5 分」 */
  hint: string
  /** 大题共用材料（现代文 / 文言文 / 英语阅读短文…） */
  material: string
}

/** 识别出的一道题（页面内的可编辑单元） */
export interface RecognizedQuestion {
  id: string
  sectionId: string
  /** 卷面题号（合并后统一重排，从 1 起） */
  number: number
  type: string
  stem: string
  options: string[]
  answer: string
  analysis: string
  knowledge: string[]
  difficulty: string
  subject: string
  grade: string
  score: number
  /** 是否纳入入库（取消勾选则丢弃） */
  include: boolean
  /** 教师是否二次编辑过 */
  edited: boolean
  /** AI 质检是否修正过这道题 */
  aiCorrected: boolean
  /** 这道题的质检结论（最后一轮，error / warn） */
  issues: VerifyIssue[]
}

/** 卷面识别得到的版式信息（预览页展示「识别到了什么」） */
export interface PaperLayoutInfo {
  pageCount: number
  columns: number
  hasAnswerSheet: boolean
  hasSealLine: boolean
  /** 版式提示（忽略了哪些区域、哪里模糊等） */
  notes: string[]
  /** 卷面标注的满分（与题目分值和可能不一致，界面会提示差额） */
  totalScore: number
}

export interface RecognizedPaper {
  engine: PaperImportEngine
  name: string
  subject: string
  grade: string
  duration: number
  notices: string[]
  layout: PaperLayoutInfo
  sections: RecognizedSection[]
  questions: RecognizedQuestion[]
  /** 质检汇总（ran=false 表示轮次设为 0，未做检查） */
  verify: { rounds: number; ran: boolean; error: number; warn: number; manual: boolean }
}

export interface PaperImportOptions {
  /** 是否做卷面识别 */
  layout: boolean
  /** 是否做试题识别 */
  questions: boolean
  /** AI 检查轮次（0 = 关闭，1~3） */
  rounds: number
  /** 识别不出学科 / 年级时的兜底（顶部栏 scope） */
  subject: string
  grade: string
}

/** 进度回调：label 给用户看，percent 0-100 */
export type PaperImportProgress = (progress: { label: string; percent: number }) => void

/** 单页识别上限：防御模型把整本书都拆成题 */
const MAX_QUESTIONS_PER_PAGE = 60
/** 全卷题量上限（多页累计） */
const MAX_QUESTIONS_TOTAL = 200

/* ==================== 引擎选择 ==================== */

export function paperImportEngine(sources: PaperSourceFile[]): PaperImportEngine {
  if (!sources.length) return 'mock'
  const allImage = sources.every((row) => row.kind === 'image')
  if (allImage && isVisionConfigured()) return 'vision'
  if (!allImage && sources.every((row) => row.kind !== 'image') && isDeepseekConfigured()) return 'text'
  /* 图文混排时：视觉通道可用就整卷走视觉（PDF / Word 也先按文本降级处理不了），
     否则退到本地演示 —— 混排不是「部分真实部分演示」，那会让同一份卷子的题前后风格不一致 */
  if (allImage) return isVisionConfigured() ? 'vision' : 'mock'
  return isDeepseekConfigured() ? 'text' : 'mock'
}

/** 引擎的中文说明（页面标签用；不回显底层模型名） */
export function engineLabel(engine: PaperImportEngine): string {
  return engine === 'vision' ? '多模态识别' : engine === 'text' ? '文档文本识别' : '本地演示数据（未配置 AI 通道）'
}

/* ==================== 单页：卷面识别 ==================== */

interface PageLayout {
  name: string
  subject: string
  grade: string
  duration: number
  totalScore: number
  notices: string[]
  columns: number
  pageCount: number
  hasAnswerSheet: boolean
  hasSealLine: boolean
  notes: string[]
  sections: Array<{ title: string; hint: string; material: string; scorePer: number }>
}

const EMPTY_LAYOUT: PageLayout = {
  name: '',
  subject: '',
  grade: '',
  duration: 0,
  totalScore: 0,
  notices: [],
  columns: 1,
  pageCount: 1,
  hasAnswerSheet: false,
  hasSealLine: false,
  notes: [],
  sections: [],
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.trim() : fallback
}

function num(value: unknown, fallback = 0): number {
  const parsed = typeof value === 'number' ? value : Number(String(value ?? '').replace(/[^\d.-]/g, ''))
  return Number.isFinite(parsed) ? parsed : fallback
}

function bool(value: unknown): boolean {
  return value === true || value === 'true'
}

/** 模型返回的卷面 JSON → PageLayout（字段缺失一律兜底，不让脏数据拖垮整卷） */
function toPageLayout(raw: Record<string, unknown>): PageLayout {
  const sectionsRaw = Array.isArray(raw.sections) ? raw.sections : []
  const sections = sectionsRaw
    .map((item) => {
      const row = (item ?? {}) as Record<string, unknown>
      return {
        title: str(row.title),
        hint: str(row.hint),
        material: str(row.material),
        scorePer: num(row.score_per ?? row.scorePer, 0),
      }
    })
    .filter((row) => row.title)
  return {
    name: str(raw.paper_name ?? raw.name),
    subject: str(raw.subject),
    grade: str(raw.grade),
    duration: num(raw.duration, 0),
    totalScore: num(raw.total_score ?? raw.totalScore, 0),
    notices: Array.isArray(raw.notices) ? raw.notices.map((row) => str(row)).filter(Boolean) : [],
    columns: Math.min(3, Math.max(1, num(raw.columns, 1))),
    pageCount: Math.max(1, num(raw.page_count ?? raw.pageCount, 1)),
    hasAnswerSheet: bool(raw.has_answer_sheet ?? raw.hasAnswerSheet),
    hasSealLine: bool(raw.has_seal_line ?? raw.hasSealLine),
    notes: Array.isArray(raw.notes) ? raw.notes.map((row) => str(row)).filter(Boolean) : [],
    sections,
  }
}

/** 文本 / 图片两种入参合成同一份消息体（图片走 image_url 内容块） */
function userMessage(source: PaperSourceFile, prompt: string): { role: 'user'; content: string | ChatContentPart[] } {
  if (source.kind === 'image' && source.dataUrl) {
    return {
      role: 'user',
      content: [
        { type: 'text', text: prompt },
        { type: 'image_url', image_url: { url: source.dataUrl } },
      ],
    }
  }
  return { role: 'user', content: prompt }
}

/** 单次 JSON 调用（解析失败重试一次；与出题 / 识题同一套容错策略） */
async function askJson(
  engine: Exclude<PaperImportEngine, 'mock'>,
  system: string,
  source: PaperSourceFile,
  prompt: string,
  maxTokens: number,
): Promise<Record<string, unknown>> {
  const messages = [
    { role: 'system' as const, content: system },
    userMessage(source, prompt),
  ]
  let lastError: unknown = null
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const result =
        engine === 'vision'
          ? await visionChat(messages, { json: true, maxTokens })
          : await chatCompletion(messages, { json: true, temperature: 0.2, maxTokens })
      return extractJsonObject(result.content)
    } catch (error) {
      lastError = error
    }
  }
  throw lastError instanceof Error ? lastError : new Error('AI 识别失败，请稍后重试')
}

async function recognizePageLayout(
  source: PaperSourceFile,
  pageNo: number,
  pageCount: number,
  engine: Exclude<PaperImportEngine, 'mock'>,
): Promise<PageLayout> {
  const prompt = buildPaperLayoutUserPrompt({ fileName: source.name, pageNo, pageCount, text: source.text })
  const raw = await askJson(engine, PAPER_LAYOUT_SYSTEM_PROMPT, source, prompt, 3000)
  return toPageLayout(raw)
}

/* ==================== 单页：试题识别 ==================== */

/** 模型给出的单题原始行（含 section / score / number 三个扩展字段） */
interface RawQuestionRow {
  section: string
  number: number
  score: number
  type: string
  question: GeneratedQuestion
}

/** 按选项结构反推题型（模型偶尔不给 type；与文档识别同一口径） */
function typeOfOptions(options: string[], answer: string): string {
  if (!options.length) return '解答'
  if (options.length === 2 && /正确|对/.test(options[0])) return '判断'
  return answer.replace(/[^A-F]/g, '').length > 1 ? '多选' : '单选'
}

async function recognizePageQuestions(
  source: PaperSourceFile,
  pageNo: number,
  pageCount: number,
  engine: Exclude<PaperImportEngine, 'mock'>,
  sections: string[],
): Promise<RawQuestionRow[]> {
  const prompt = buildPaperQuestionsUserPrompt({
    fileName: source.name,
    pageNo,
    pageCount,
    sections,
    text: source.text,
  })
  const raw = await askJson(engine, PAPER_QUESTIONS_SYSTEM_PROMPT, source, prompt, 8192)
  /* 这里**不开** normalizeQuestionList 的 mergeComposite（拍照识题 / 文档识题开着）：
     下面要按数组下标把 raw.questions 里的 section / score / number 补回每一题，
     一旦归一化阶段合并了两行，下标就整体错位，题会被归到别人的大题与分值上。
     组合题不拆靠提示词（PAPER_QUESTIONS_SYSTEM_PROMPT 继承 PHOTO_SYSTEM_PROMPT）保证。 */
  const list = normalizeQuestionList(JSON.stringify(raw), { maxCount: MAX_QUESTIONS_PER_PAGE, richAnswer: true })
  const rawRows = (Array.isArray(raw.questions) ? raw.questions : []).slice(0, list.length) as unknown as Array<
    Record<string, unknown>
  >

  const rows: RawQuestionRow[] = []
  for (const [i, question] of list.entries()) {
    const meta = (rawRows[i] ?? {}) as Record<string, unknown>
    /* 内联 SVG 配图转存媒体库：不走这一步，编辑器保存时会把 data URL 剥掉 */
    const subject = question.subject || ''
    const [stem, analysis] = await Promise.all([
      persistEmbeddedImages(question.stem, subject),
      persistEmbeddedImages(question.analysis, subject),
    ])
    const options = await Promise.all(question.options.map((opt) => persistEmbeddedImages(opt, subject)))
    rows.push({
      section: str(meta.section),
      number: num(meta.number, i + 1),
      score: num(meta.score, 0),
      type: str(meta.type) || typeOfOptions(options, question.answer),
      question: {
        ...question,
        stem,
        analysis,
        options,
        answer: options.length ? question.answer : await persistEmbeddedImages(question.answer, subject),
      },
    })
  }
  return rows
}

/* ==================== 合并多页结果 ==================== */

/** 大题标题归一化：去掉编号与标点后比较，避免「一、单项选择题」与「一．单项选择题」各自成项 */
function sectionKey(title: string): string {
  return title
    .replace(/^[一二三四五六七八九十百]+\s*[、.．)）]\s*/, '')
    .replace(/[\s，。、；：·．.()（）]/g, '')
    .toLowerCase()
}

const TYPE_ORDER = ['单选', '多选', '判断', '填空', '解答']
const TYPE_SECTION_TITLE: Record<string, string> = {
  单选: '单项选择题',
  多选: '多项选择题',
  判断: '判断题',
  填空: '填空题',
  解答: '解答题',
}
/** 兜底分组的编号（题目没能落到卷面大题时按题型归组） */
const GROUP_NO = ['一', '二', '三', '四', '五', '六']

function defaultScoreOf(type: string): number {
  return type === '解答' ? 10 : 5
}

/**
 * 把每页的卷面 + 题目合并成一份试卷。
 * - 大题按归一化标题合并（跨页延续的同一道大题不会分裂）；
 * - 题目按页序追加，未匹配到大题的按题型归入兜底大题；
 * - 合并后**重新编号**（1..N），卷面原编号只在「单页且编号连续」时保留意义，跨页合并后并不可靠。
 */
function mergePaper(
  layouts: PageLayout[],
  pages: RawQuestionRow[][],
  options: PaperImportOptions,
  sources: PaperSourceFile[],
): { name: string; subject: string; grade: string; duration: number; notices: string[]; layout: PaperLayoutInfo; sections: RecognizedSection[]; questions: RecognizedQuestion[] } {
  const first = layouts[0] ?? EMPTY_LAYOUT
  const name = layouts.map((row) => row.name).find(Boolean) ?? stripExt(sources[0]?.name ?? '导入试卷')
  /* 学科 / 年级取「第一个非空」：多页里通常只有第 1 页印了卷头 */
  const subject = layouts.map((row) => row.subject).find(Boolean) || options.subject
  const grade = layouts.map((row) => row.grade).find(Boolean) || options.grade
  const duration = layouts.reduce((max, row) => Math.max(max, row.duration), 0) || 120
  const notices = layouts.find((row) => row.notices.length)?.notices ?? []
  const layout: PaperLayoutInfo = {
    pageCount: layouts.reduce((max, row) => Math.max(max, row.pageCount), sources.length) || sources.length || 1,
    columns: Math.max(...layouts.map((row) => row.columns), 1),
    hasAnswerSheet: layouts.some((row) => row.hasAnswerSheet),
    hasSealLine: layouts.some((row) => row.hasSealLine),
    notes: dedupe(layouts.flatMap((row) => row.notes)).slice(0, 6),
    totalScore: layouts.reduce((max, row) => Math.max(max, row.totalScore), first.totalScore) || 0,
  }

  /* ---- 大题骨架：先按卷面顺序登记，再按标题合并 ---- */
  const sections: RecognizedSection[] = []
  const keyToId = new Map<string, string>()
  const ensureSection = (title: string, hint = '', material = ''): RecognizedSection => {
    const key = sectionKey(title)
    const existed = key ? sections.find((row) => row.id === keyToId.get(key)) : undefined
    if (existed) {
      if (!existed.hint && hint) existed.hint = hint
      if (!existed.material && material) existed.material = material
      return existed
    }
    const section: RecognizedSection = { id: `sec_${sections.length + 1}`, title, hint, material }
    sections.push(section)
    if (key) keyToId.set(key, section.id)
    return section
  }
  layouts.forEach((page) => page.sections.forEach((row) => ensureSection(row.title, row.hint, row.material)))

  /* ---- 题目：按页序落大题 ---- */
  const questions: RecognizedQuestion[] = []
  pages.forEach((rows) => {
    rows.forEach((row) => {
      const q = row.question
      const type = row.type || typeOfOptions(q.options, q.answer)
      let sectionId: string | null = row.section ? keyToId.get(sectionKey(row.section)) ?? null : null
      if (!sectionId) {
        /* 模型没给 / 给的标题对不上：按题型归组，宁可多一个大题也不把题丢掉 */
        const fallbackTitle = `${GROUP_NO[Math.min(sections.length, GROUP_NO.length - 1)]}、${TYPE_SECTION_TITLE[type] ?? `${type}题`}`
        sectionId = ensureSection(fallbackTitle).id
      }
      const score = row.score > 0 ? row.score : defaultScoreOf(type)
      questions.push({
        id: `q_${questions.length + 1}`,
        sectionId,
        number: questions.length + 1,
        type,
        stem: q.stem,
        options: q.options,
        answer: q.answer,
        analysis: q.analysis,
        knowledge: q.knowledge.slice(0, 3),
        difficulty: q.difficulty || '中等',
        subject: q.subject || subject,
        grade: q.grade || grade,
        score,
        include: true,
        edited: false,
        aiCorrected: false,
        issues: [],
      })
    })
  })

  /* ---- 空大题清理：卷面识别读到大题但这一批题一道都没落进来时，不摆空壳大题 ---- */
  const used = new Set(questions.map((row) => row.sectionId))
  const kept = sections.filter((row) => used.has(row.id))
  return {
    name,
    subject,
    grade,
    duration,
    notices,
    layout,
    sections: kept.length ? kept : sections,
    questions,
  }
}

function stripExt(name: string): string {
  return name.replace(/\.(pdf|docx?|jpe?g|png|webp)$/i, '')
}

function dedupe(list: string[]): string[] {
  return [...new Set(list.map((row) => row.trim()).filter(Boolean))]
}

/* ==================== 知识点对齐 ==================== */

/** 年级+学科 → 机构知识点池（同一份卷里同年级同学科只查一次） */
const pools = new Map<string, Promise<string[]>>()

function poolOf(grade: string, subject: string): Promise<string[]> {
  const key = `${grade}|${subject}`
  if (!pools.has(key)) {
    pools.set(
      key,
      fetchKnowledgeTree(grade, subject, '')
        .then((tree) => collectTags(tree))
        .catch(() => []),
    )
  }
  return pools.get(key) ?? Promise.resolve([])
}

/**
 * 把模型自判的知识点对齐到机构知识点池（同义归并）。
 *
 * 对不上时**保留原值**而不是清空：知识点在题目编辑里可改，教师能看到模型判的是什么；
 * 清空等于把一条可用信息静默丢掉，且演示环境（知识点池未必覆盖全部章节）会整片变空。
 */
async function alignKnowledge(rows: RecognizedQuestion[]): Promise<void> {
  for (const row of rows) {
    const pool = await poolOf(row.grade, row.subject)
    if (!pool.length) continue
    const matched = row.knowledge.map(
      (name) =>
        pool.find((item) => item === name) ??
        pool.find((item) => item.includes(name) || name.includes(item)) ??
        name,
    )
    row.knowledge = dedupe(matched).slice(0, 3)
  }
}

/* ==================== AI 检查轮次 ==================== */

/**
 * 按设定轮次复核识别结果（沿用拍照识题那套：每轮修正版作为下一轮输入，无 error 提前结束）。
 * 修正字段回写题目，最后一轮的 warn / error 逐题留痕；超轮仍有 error → manual 提醒人工介入。
 */
async function verifyPaper(
  rows: RecognizedQuestion[],
  rounds: number,
  onRound: (round: number, rounds: number) => void,
): Promise<{ error: number; warn: number; manual: boolean }> {
  rows.forEach((row) => (row.issues = []))
  if (rounds <= 0 || !rows.length) return { error: 0, warn: 0, manual: false }

  let current: GeneratedQuestion[] = rows.map((row) => ({
    id: row.id,
    stem: row.stem,
    options: [...row.options],
    answer: row.answer,
    analysis: row.analysis,
    knowledge: [...row.knowledge],
    difficulty: row.difficulty,
    subject: row.subject,
    grade: row.grade,
  }))
  let lastIssues: VerifyIssue[] = []
  let manual = false
  for (let round = 1; round <= rounds; round += 1) {
    onRound(round, rounds)
    const report = await verifyQuestionsByAi(current, { scene: '试卷导入' }, 1)
    lastIssues = report.rounds[report.rounds.length - 1]?.issues ?? []
    if (report.corrected.length === current.length) {
      current = await Promise.all(
        report.corrected.map(async (fixed, index) => {
          const origin = current[index]
          const subject = origin.subject ?? ''
          const [stem, analysis] = await Promise.all([
            persistEmbeddedImages(fixed.stem, subject),
            persistEmbeddedImages(fixed.analysis, subject),
          ])
          const options = await Promise.all(fixed.options.map((opt) => persistEmbeddedImages(opt, subject)))
          return { ...origin, stem, options, analysis, answer: fixed.answer, knowledge: fixed.knowledge, difficulty: fixed.difficulty }
        }),
      )
    }
    manual = lastIssues.some((issue) => issue.level === 'error')
    if (!manual) break
  }

  /* 修正版回写：只判「内容是否变了」，没变的不打「AI 已修正」标签 */
  let errorCount = 0
  let warnCount = 0
  rows.forEach((row, index) => {
    const fixed = current[index]
    if (fixed) {
      const changed =
        fixed.stem !== row.stem || fixed.answer !== row.answer || fixed.analysis !== row.analysis || fixed.options.join('') !== row.options.join('')
      if (changed) {
        row.stem = fixed.stem
        row.options = fixed.options
        row.answer = fixed.answer
        row.analysis = fixed.analysis
        row.knowledge = fixed.knowledge.slice(0, 3)
        row.difficulty = fixed.difficulty || row.difficulty
        row.aiCorrected = true
      }
    }
    const issues = lastIssues.filter((issue) => issue.index === index)
    row.issues = issues
    issues.forEach((issue) => {
      if (issue.level === 'error') errorCount += 1
      else warnCount += 1
    })
  })
  return { error: errorCount, warn: warnCount, manual }
}

/* ==================== 本地演示引擎 ==================== */

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

/** 演示用的卷面骨架：高一数学单元测试（与知识点池的「数学 / 高一」对得上） */
const DEMO_SECTIONS: Array<{ title: string; hint: string; material: string; type: string; score: number }> = [
  {
    title: '一、单项选择题',
    hint: '本题共 5 小题，每小题 5 分，共 25 分。在每小题给出的四个选项中，只有一项是符合题目要求的。',
    material: '',
    type: '单选',
    score: 5,
  },
  {
    title: '二、填空题',
    hint: '本题共 2 小题，每小题 5 分，共 10 分。',
    material: '',
    type: '填空',
    score: 5,
  },
  {
    title: '三、解答题',
    hint: '本题共 2 小题，共 30 分。解答应写出文字说明、证明过程或演算步骤。',
    material: '',
    type: '解答',
    score: 15,
  },
]

const DEMO_QUESTIONS: Array<{
  type: string
  stem: string
  options: string[]
  answer: string
  analysis: string
  knowledge: string[]
  difficulty: string
}> = [
  {
    type: '单选',
    stem: '<p>已知集合 A = {x | 1 &lt; x &lt; 5}，B = {2, 3, 4, 5}，则 A ∩ B 中元素的个数为（　　）</p>',
    options: ['1 个', '2 个', '3 个', '4 个'],
    answer: 'C',
    analysis: '<p>A ∩ B = {2, 3, 4}，共 3 个元素，故选 C。</p>',
    knowledge: ['集合'],
    difficulty: '容易',
  },
  {
    type: '单选',
    stem: '<p>函数 f(x) = √(x − 2) + 1/(x − 4) 的定义域为（　　）</p>',
    options: ['[2, +∞)', '(2, 4) ∪ (4, +∞)', '[2, 4) ∪ (4, +∞)', '(4, +∞)'],
    answer: 'C',
    analysis:
      '<p>被开方数非负得 x ≥ 2；分母不为零得 x ≠ 4。两者同时满足，故定义域为 [2, 4) ∪ (4, +∞)，选 C。</p>',
    knowledge: ['函数的概念与表示'],
    difficulty: '中等',
  },
  {
    type: '单选',
    stem: '<p>已知等差数列 {aₙ} 中 a₁ = 2，公差 d = 3，则 a₁₀ = （　　）</p>',
    options: ['26', '29', '32', '35'],
    answer: 'B',
    analysis: '<p>a₁₀ = a₁ + 9d = 2 + 27 = 29，故选 B。</p>',
    knowledge: ['等差数列'],
    difficulty: '容易',
  },
  {
    type: '单选',
    stem: '<p>函数 f(x) = x² − 2x + 3 在区间 [0, 3] 上的最小值为（　　）</p>',
    options: ['1', '2', '3', '6'],
    answer: 'B',
    analysis:
      '<p>f(x) = (x − 1)² + 2，对称轴 x = 1 落在 [0, 3] 内，故最小值为 f(1) = 2，选 B。（端点值 f(0) = 3、f(3) = 6 都更大。）</p>',
    knowledge: ['二次函数'],
    difficulty: '中等',
  },
  {
    type: '单选',
    stem: '<p>若 log₂x = 3，则 x 的值为（　　）</p>',
    options: ['6', '8', '9', '12'],
    answer: 'B',
    analysis: '<p>由对数定义，log₂x = 3 等价于 x = 2³ = 8，故选 B。</p>',
    knowledge: ['对数函数'],
    difficulty: '容易',
  },
  {
    type: '填空',
    stem: '<p>已知等比数列 {aₙ} 中 a₁ = 3，公比 q = 2，则前 5 项和 S₅ = ______。</p>',
    options: [],
    answer: '93',
    analysis: '<p>S₅ = 3(2⁵ − 1)/(2 − 1) = 3 × 31 = 93。</p>',
    knowledge: ['等比数列'],
    difficulty: '中等',
  },
  {
    type: '填空',
    stem: '<p>不等式 x² − 5x + 6 &lt; 0 的解集为 ______。</p>',
    options: [],
    answer: '{x | 2 &lt; x &lt; 3}',
    /* 刻意留短：演示「解析过于简略」这类 warn 级质检提醒 */
    analysis: '<p>因式分解后取解集。</p>',
    knowledge: ['一元二次不等式'],
    difficulty: '容易',
  },
  {
    type: '解答',
    stem:
      '<p>已知函数 f(x) = x³ − 3x² + 2。</p><p>（1）求 f(x) 的单调区间；</p><p>（2）求 f(x) 在区间 [−1, 3] 上的最大值与最小值。</p>',
    options: [],
    answer: '<p>（1）单调递增区间为 (−∞, 0) 与 (2, +∞)，单调递减区间为 (0, 2)；（2）最大值为 2，最小值为 −2。</p>',
    analysis:
      '<p>（1）f′(x) = 3x² − 6x = 3x(x − 2)。令 f′(x) &gt; 0 得 x &lt; 0 或 x &gt; 2，令 f′(x) &lt; 0 得 0 &lt; x &lt; 2。故增区间为 (−∞, 0)、(2, +∞)，减区间为 (0, 2)。</p><p>（2）f(0) = 2，f(2) = 8 − 12 + 2 = −2；端点 f(−1) = −1 − 3 + 2 = −2，f(3) = 27 − 27 + 2 = 2。比较得最大值为 2，最小值为 −2。</p>',
    knowledge: ['导数与单调性'],
    difficulty: '困难',
  },
  {
    type: '解答',
    stem: '<p>在 △ABC 中，角 A、B、C 的对边分别为 a、b、c，且 a = 3，b = 4，C = 60°。</p><p>（1）求边 c；</p><p>（2）求 △ABC 的面积。</p>',
    options: [],
    answer: '<p>（1）c = √13；（2）面积为 3√3。</p>',
    analysis:
      '<p>（1）由余弦定理 c² = a² + b² − 2ab·cos C = 9 + 16 − 2 × 3 × 4 × 1/2 = 13，故 c = √13。</p><p>（2）S = ½ ab·sin C = ½ × 3 × 4 × (√3/2) = 3√3。</p>',
    knowledge: ['解三角形'],
    difficulty: '中等',
  },
]

function demoPaper(sources: PaperSourceFile[], options: PaperImportOptions): RecognizedPaper {
  const name = stripExt(sources[0]?.name ?? '') || '高一数学单元测试（演示识别）'
  /* 卷面识别关掉时，大题仍按题型分组给出 —— 没有大题结构的试卷在预览里读不出层次 */
  const sections: RecognizedSection[] = DEMO_SECTIONS.map((row, index) => ({
    id: `sec_${index + 1}`,
    title: options.layout ? row.title : `${GROUP_NO[index]}、${TYPE_SECTION_TITLE[row.type] ?? row.type}`,
    hint: options.layout ? row.hint : '',
    material: '',
  }))
  const questions: RecognizedQuestion[] = options.questions
    ? DEMO_QUESTIONS.map((row, index) => {
        const sectionIndex = DEMO_SECTIONS.findIndex((sec) => sec.type === row.type)
        return {
          id: `q_${index + 1}`,
          sectionId: sections[Math.max(0, sectionIndex)]?.id ?? sections[0].id,
          number: index + 1,
          type: row.type,
          stem: row.stem,
          options: [...row.options],
          answer: row.answer,
          analysis: row.analysis,
          knowledge: [...row.knowledge],
          difficulty: row.difficulty,
          subject: options.subject || '数学',
          grade: options.grade || '高一',
          score: DEMO_SECTIONS[Math.max(0, sectionIndex)]?.score ?? defaultScoreOf(row.type),
          include: true,
          edited: false,
          aiCorrected: false,
          issues: [],
        }
      })
    : []
  const totalScore = sections.reduce(
    (sum, section) => sum + questions.filter((row) => row.sectionId === section.id).reduce((t, row) => t + row.score, 0),
    0,
  )
  return {
    engine: 'mock',
    name,
    subject: options.subject || '数学',
    grade: options.grade || '高一',
    duration: 60,
    notices: options.layout
      ? ['答题前请将姓名、班级填写在密封线内。', '选择题用 2B 铅笔填涂，非选择题用黑色签字笔作答。', '考试结束后，将试卷与答题卡一并交回。']
      : [],
    layout: {
      pageCount: Math.max(sources.length, 2),
      columns: 1,
      hasAnswerSheet: true,
      hasSealLine: true,
      notes: options.layout ? ['已忽略页眉、页码与考生信息栏', '第 2 页顶部的装订线区域不计入题目'] : [],
      totalScore,
    },
    sections,
    questions,
    verify: { rounds: 0, ran: false, error: 0, warn: 0, manual: false },
  }
}

/* ==================== 入口 ==================== */

/**
 * 试卷导入识别主流程。
 *
 * @param sources 已读好的源文件（图片 / PDF / Word），顺序即页序
 * @param options 卷面识别 / 试题识别开关、检查轮次、学科年级兜底
 * @param onProgress 进度回调（本地编排步骤，接口没有中间回报）
 */
export async function recognizePaperImport(
  sources: PaperSourceFile[],
  options: PaperImportOptions,
  onProgress: PaperImportProgress = () => {},
): Promise<RecognizedPaper> {
  if (!sources.length) throw new Error('请先选择要导入的试卷文件')
  const engine = paperImportEngine(sources)

  if (engine === 'mock') {
    /* 演示引擎也走一遍进度与质检，交互与真实引擎完全一致 */
    onProgress({ label: '卷面识别（本地演示）', percent: 20 })
    await sleep(420)
    onProgress({ label: '试题识别（本地演示）', percent: 45 })
    await sleep(520)
    const paper = demoPaper(sources, options)
    await alignKnowledge(paper.questions)
    const summary = await verifyPaper(paper.questions, options.rounds, (round, rounds) =>
      onProgress({ label: `AI 质检（第 ${round}/${rounds} 轮）`, percent: 65 + Math.round((round / rounds) * 28) }),
    )
    onProgress({ label: '生成试卷预览', percent: 100 })
    return { ...paper, verify: { rounds: options.rounds, ran: options.rounds > 0, ...summary } }
  }

  const pageCount = sources.length
  const layouts: PageLayout[] = []
  const pages: RawQuestionRow[][] = []

  /* ---- 阶段 1：卷面识别（逐页） ---- */
  for (const [index, source] of sources.entries()) {
    const label = options.layout ? `卷面识别（第 ${index + 1}/${pageCount} 页）` : '跳过卷面识别，按题型归组'
    onProgress({ label, percent: 8 + Math.round(((index + 1) / pageCount) * 26) })
    if (!options.layout) {
      layouts.push({ ...EMPTY_LAYOUT })
      continue
    }
    try {
      layouts.push(await recognizePageLayout(source, index + 1, pageCount, engine))
    } catch (error) {
      /* 单页卷面识别失败不拖垮整卷：该页按「无大题」处理，题目仍会被识别出来 */
      layouts.push({ ...EMPTY_LAYOUT, notes: [`第 ${index + 1} 页卷面识别失败：${error instanceof Error ? error.message : '未知原因'}`] })
    }
  }

  /* ---- 阶段 2：试题识别（逐页，带上该页已识别的大题标题） ---- */
  const sectionTitles = dedupe(layouts.flatMap((row) => row.sections.map((sec) => sec.title)))
  for (const [index, source] of sources.entries()) {
    onProgress({
      label: `试题识别（第 ${index + 1}/${pageCount} 页）`,
      percent: 36 + Math.round(((index + 1) / pageCount) * 32),
    })
    if (!options.questions) {
      pages.push([])
      continue
    }
    try {
      pages.push(await recognizePageQuestions(source, index + 1, pageCount, engine, sectionTitles))
    } catch (error) {
      throw new Error(`第 ${index + 1} 页试题识别失败：${error instanceof Error ? error.message : '未知原因'}`)
    }
  }

  const merged = mergePaper(layouts, pages, options, sources)
  if (merged.questions.length > MAX_QUESTIONS_TOTAL) merged.questions = merged.questions.slice(0, MAX_QUESTIONS_TOTAL)
  if (!merged.questions.length) throw new Error('没有识别出题目，请确认文件清晰、包含完整试题后重试')

  onProgress({ label: '对齐机构知识点', percent: 72 })
  await alignKnowledge(merged.questions)

  const summary = await verifyPaper(merged.questions, options.rounds, (round, rounds) =>
    onProgress({ label: `AI 质检（第 ${round}/${rounds} 轮）`, percent: 76 + Math.round((round / rounds) * 20) }),
  )
  onProgress({ label: '生成试卷预览', percent: 100 })
  return { engine, ...merged, verify: { rounds: options.rounds, ran: options.rounds > 0, ...summary } }
}

/** 重新质检（结果页调整轮次后用，不再重新识别，省一次识别额度） */
export async function recheckPaper(
  rows: RecognizedQuestion[],
  rounds: number,
  onProgress: PaperImportProgress = () => {},
): Promise<{ rounds: number; ran: boolean; error: number; warn: number; manual: boolean }> {
  if (!rows.length) return { rounds, ran: false, error: 0, warn: 0, manual: false }
  const summary = await verifyPaper(rows, rounds, (round, total) =>
    onProgress({ label: `AI 质检（第 ${round}/${total} 轮）`, percent: Math.round((round / total) * 100) }),
  )
  return { rounds, ran: rounds > 0, ...summary }
}
