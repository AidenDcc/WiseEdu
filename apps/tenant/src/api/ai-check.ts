/**
 * AI 质检编排层（手动的「AI 检测」入口）。
 *
 * - 已配置 Deepseek：真实调用，模型返回 overall/items/修正版三段 JSON；
 *   修正版复用 ai-normalize 的归一化管线转富文本，与 AI 出题同一套公式/SVG 净化逻辑，
 *   可直接回写到录入表单（含缺失答案/解析的 AI 补充）。
 * - 未配置：回退本地启发式演示（缺答案/解析 → 给出 mock 补充；题干过短 → error），
 *   保证无 Key 环境也能演示完整交互。
 *
 * ## 独立单题 / 材料组合题（两套提示词、两套报告结构）
 *
 * 两类题在录入侧就是两种结构（见 question-draft 的文件头），检测同样分两条路：
 * - 独立单题：题干 / 选项 / 答案 / 解析四段并列的**一道题**，报告项直接叫「答案」「解析」；
 * - 材料组合题：母题只有一段共用材料，作答单位在子题里 —— 审查对象是「一段材料 + 若干道完整的题」，
 *   故报告项多一层 `scope`（`共用材料` / `第 N 题`），修正版也按子题逐题给出（`corrected.subQuestions`）。
 *
 * 判定入口只有一个（`checkQuestionByAi`），带 `subQuestions` 即按组合题走 ——
 * 三个调用方（录题中心 / 题目审核中心 / 试卷编辑页）都只负责把入参拼齐。
 */
import { isDeepseekConfigured, chatCompletion } from './deepseek'
import {
  CHECK_SYSTEM_PROMPT,
  COMPOSITE_CHECK_SYSTEM_PROMPT,
  buildCheckUserPrompt,
  buildCompositeCheckUserPrompt,
} from './ai-prompts'
import { extractJsonObject, normalizeQuestionList, normalizeSubCorrections, richField } from './ai-normalize'
import type { SubQuestionCorrection } from './ai-normalize'
import { toPlainText } from '@aiteach/shared'
import type { OrgQuestion } from '@aiteach/shared'

export type CheckEngine = 'deepseek' | 'mock'
export type CheckLevel = 'ok' | 'warn' | 'error'

export interface AiCheckItem {
  /** 审查维度：基本信息匹配 / 题干 / 选项 / 答案 / 解析 */
  aspect: string
  level: CheckLevel
  message: string
  /**
   * 被审查的单元，**仅材料组合题使用**：`共用材料` 或 `第 N 题`（N 从 1 起）。
   * 独立单题留空 —— 报告里按「scope · aspect」两级命名，一眼能看出问题出在哪一道子题上。
   */
  scope?: string
}

/** 子题入参：`OrgSubQuestion` 去掉只服务编辑器的 id / 选项排布 / 填空答案结构 */
export interface CheckSubQuestionInput {
  type: string
  difficulty: string
  knowledge: string[]
  stem: string
  options: string[]
  answer: string
  analysis: string
}

export interface CheckQuestionInput {
  subject: string
  grade: string
  type: string
  difficulty: string
  knowledge: string[]
  /** 独立单题 = 题干；材料组合题 = 共用题干 / 材料 */
  stem: string
  options: string[]
  answer: string
  analysis: string
  /**
   * 材料组合题的子题。**带上它即按材料组合题检测**（哪怕它是空数组 —— 那表示「一道子题都没有」）：
   * 此时 `stem` 被解释为共用题干 / 材料，母题自身的 options / answer / analysis 一律忽略
   * （组合题的作答单位在子题里）。独立单题**不要传这个字段**。
   */
  subQuestions?: CheckSubQuestionInput[]
}

/** 逐题修正补丁：字段可缺省 = 该字段没问题、按原题保留 */
export type AiCheckSubCorrection = SubQuestionCorrection

/**
 * AI 给出的修正版。
 *
 * 独立单题填 `stem` / `options` / `answer` / `analysis`，材料组合题填 `material` / `subQuestions`；
 * 学段与知识点两组（subject / grade / difficulty / knowledge）两类题都可能有。
 */
export interface AiCheckCorrection {
  subject?: string
  grade?: string
  difficulty?: string
  knowledge?: string[]
  /** 独立单题：修正后的题干 / 选项 / 答案 / 解析（富文本） */
  stem?: string
  options?: string[]
  answer?: string
  analysis?: string
  /** 材料组合题：修正后的共用题干 / 材料（富文本） */
  material?: string
  /** 材料组合题：逐题修正（按原题下标合并，未提到的下标按原题保留） */
  subQuestions?: AiCheckSubCorrection[]
}

export interface AiCheckReport {
  engine: CheckEngine
  overall: 'pass' | 'warn' | 'fail'
  items: AiCheckItem[]
  /** 修正后的题目，可回写表单；模型未给可用修正版时为 undefined */
  corrected?: AiCheckCorrection
  /** 消耗 token 数（mock 为 0） */
  tokens: number
}

export function checkEngine(): CheckEngine {
  return isDeepseekConfigured() ? 'deepseek' : 'mock'
}

/** 组合题判定：带了 subQuestions 就是组合题（空数组也算 —— 那是「没有子题的组合题」） */
function isCompositeInput(input: CheckQuestionInput): boolean {
  return input.subQuestions != null
}

/* ===== 入参拼装：三个调用方（录题 / 审核 / 试卷）共用一份口径 ===== */

/**
 * 题库里的题目 → 检测入参。
 *
 * 组合题与独立单题的差异只在这一处收口：组合题的 `stem` 就是共用题干 / 材料，
 * 选项 / 答案 / 解析在母题上恒为空（作答单位在子题里），照原样送过去会让模型
 * 把所有子题都判成「缺答案、缺解析」—— 这正是本函数存在的理由。
 */
export function checkInputOfQuestion(q: OrgQuestion): CheckQuestionInput {
  const composite = q.questionCategory === '材料组合题'
  const base: CheckQuestionInput = {
    subject: q.subject,
    grade: q.grade,
    type: q.type,
    difficulty: q.difficulty,
    knowledge: [...q.knowledge],
    stem: q.stem,
    options: composite ? [] : q.options,
    answer: composite ? '' : q.answer,
    analysis: composite ? '' : q.analysis,
  }
  return composite ? { ...base, subQuestions: (q.subQuestions ?? []).map(subInputOf) } : base
}

/** 子题（`OrgSubQuestion`）→ 子题入参：字段一一对应，不做任何折算 */
function subInputOf(sub: {
  type: string
  difficulty: string
  knowledge: string[]
  stem: string
  options: string[]
  answer: string
  analysis: string
}): CheckSubQuestionInput {
  return {
    type: sub.type,
    difficulty: sub.difficulty,
    knowledge: [...sub.knowledge],
    stem: sub.stem,
    options: [...sub.options],
    answer: sub.answer,
    analysis: sub.analysis,
  }
}

/* ===== 报告解析（两条路共用的小件） ===== */

interface RawCheck {
  overall?: string
  items?: Array<{ aspect?: string; scope?: string; level?: string; message?: string }>
}

function overallOf(value: unknown): AiCheckReport['overall'] {
  return value === 'fail' ? 'fail' : value === 'warn' ? 'warn' : 'pass'
}

/**
 * 归一化检测项的「被审单元」名（组合题专用）。
 *
 * 提示词要求 `共用材料` / `第 N 题` 两种写法，但模型偶尔会写成「第1题」「1」「材料」——
 * 它们必须落到同一个报告项名上：审核中心是按项名原位更新的，名字对不上就会在重跑检测时
 * 追加一条内容重复的行，报告越用越长。认不出的写法原样保留（宁可多一行，也不要张冠李戴）。
 */
function normalizeScope(raw: string): string {
  const text = raw.trim()
  if (!text) return ''
  if (text === '共用材料' || text === '材料') return '共用材料'
  const matched = /^第?\s*(\d+)\s*题?$/.exec(text)
  return matched ? `第 ${matched[1]} 题` : text
}

function parseItems(raw: RawCheck['items']): AiCheckItem[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((row) => row && typeof row === 'object')
    .map((row): AiCheckItem => {
      /* scope 只由组合题给出；独立单题留空，报告项名因此仍是「答案」而不是「共用材料 · 答案」 */
      const scope = typeof row.scope === 'string' ? normalizeScope(row.scope) : ''
      return {
        aspect: typeof row.aspect === 'string' ? row.aspect : '综合',
        level: row.level === 'error' ? 'error' : row.level === 'warn' ? 'warn' : 'ok',
        message: typeof row.message === 'string' ? row.message : '',
        ...(scope ? { scope } : {}),
      }
    })
}

/** 修正版是否拿到了任何可用内容（全空则视为「本次没有可回写的东西」） */
function hasCorrection(corrected: AiCheckCorrection): boolean {
  return Object.values(corrected).some((value) => (Array.isArray(value) ? value.length > 0 : Boolean(value)))
}

/* ===== 真实引擎：独立单题 ===== */

async function callDeepseek(input: CheckQuestionInput): Promise<AiCheckReport> {
  const messages = [
    { role: 'system' as const, content: CHECK_SYSTEM_PROMPT },
    { role: 'user' as const, content: buildCheckUserPrompt(input) },
  ]
  let lastError: unknown = null
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const { content, usage } = await chatCompletion(messages, { json: true, maxTokens: 8192, temperature: 0.2 })
      return parseCheckReport(content, usage.totalTokens)
    } catch (error) {
      lastError = error
    }
  }
  throw lastError instanceof Error ? lastError : new Error('AI 检测失败，请稍后重试')
}

/** 解析质检 JSON：overall/items 直接取；questions 走归一化管线拿富文本修正版 */
function parseCheckReport(content: string, tokens: number): AiCheckReport {
  const raw = extractJsonObject(content) as RawCheck & { questions?: unknown }
  const items = parseItems(raw.items)
  /* 修正版缺了不致命：只意味着本次不能回写，审查结论仍然有效 */
  let corrected: AiCheckCorrection | undefined
  if (raw.questions != null) {
    try {
      const list = normalizeQuestionList(JSON.stringify(raw), { maxCount: 1, richAnswer: true })
      const row = list[0]
      if (row) {
        corrected = {
          subject: row.subject,
          grade: row.grade,
          difficulty: row.difficulty,
          knowledge: row.knowledge,
          stem: row.stem,
          options: row.options,
          answer: row.answer,
          analysis: row.analysis,
        }
      }
    } catch {
      corrected = undefined
    }
  }
  return { engine: 'deepseek', overall: overallOf(raw.overall), items, corrected, tokens }
}

/* ===== 真实引擎：材料组合题 ===== */

async function callDeepseekComposite(input: CheckQuestionInput): Promise<AiCheckReport> {
  const messages = [
    { role: 'system' as const, content: COMPOSITE_CHECK_SYSTEM_PROMPT },
    {
      role: 'user' as const,
      content: buildCompositeCheckUserPrompt({
        subject: input.subject,
        grade: input.grade,
        type: input.type,
        difficulty: input.difficulty,
        knowledge: input.knowledge,
        material: input.stem,
        subQuestions: input.subQuestions ?? [],
      }),
    },
  ]
  let lastError: unknown = null
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const { content, usage } = await chatCompletion(messages, { json: true, maxTokens: 8192, temperature: 0.2 })
      return parseCompositeReport(content, usage.totalTokens)
    } catch (error) {
      lastError = error
    }
  }
  throw lastError instanceof Error ? lastError : new Error('AI 检测失败，请稍后重试')
}

/** 解析组合题质检 JSON：items 带 scope；material / subQuestions 走同一套富文本归一化 */
function parseCompositeReport(content: string, tokens: number): AiCheckReport {
  const raw = extractJsonObject(content) as RawCheck & {
    subject?: unknown
    grade?: unknown
    difficulty?: unknown
    knowledge?: unknown
    material?: unknown
    subQuestions?: unknown
  }
  const corrected: AiCheckCorrection = {}
  if (typeof raw.subject === 'string' && raw.subject.trim()) corrected.subject = raw.subject.trim()
  if (typeof raw.grade === 'string' && raw.grade.trim()) corrected.grade = raw.grade.trim()
  if (typeof raw.difficulty === 'string' && ['容易', '中等', '困难'].includes(raw.difficulty)) {
    corrected.difficulty = raw.difficulty
  }
  if (Array.isArray(raw.knowledge)) {
    const knowledge = raw.knowledge.filter((name): name is string => typeof name === 'string' && Boolean(name.trim()))
    if (knowledge.length) corrected.knowledge = knowledge.map((name) => name.trim()).slice(0, 5)
  }
  if (typeof raw.material === 'string' && raw.material.trim()) corrected.material = richField(raw.material)
  const subCorrections = normalizeSubCorrections(raw.subQuestions)
  if (subCorrections?.length) corrected.subQuestions = subCorrections
  return {
    engine: 'deepseek',
    overall: overallOf(raw.overall),
    items: parseItems(raw.items),
    corrected: hasCorrection(corrected) ? corrected : undefined,
    tokens,
  }
}

/* ===== 本地演示引擎（无 Key）：按缺失情况给出可演示的质检结论 ===== */

function mockReport(input: CheckQuestionInput): AiCheckReport {
  const stemText = toPlainText(input.stem).trim()
  const missingAnswer = !input.answer.trim()
  const missingAnalysis = !input.analysis.trim()
  const items: AiCheckItem[] = [
    {
      aspect: '基本信息匹配',
      level: stemText.length >= 10 ? 'ok' : 'warn',
      message:
        stemText.length >= 10
          ? '学科/年级/知识点与题干内容一致'
          : '题干过短，无法确认知识点归属是否准确，建议补充完整题干',
    },
    { aspect: '题干', level: 'ok', message: '表述完整，公式语法合法' },
    {
      aspect: '选项',
      level: input.options.length ? 'ok' : 'ok',
      message: input.options.length ? '选项数量与题型匹配，干扰项有效' : '非客观题，跳过选项审查',
    },
    {
      aspect: '答案',
      level: missingAnswer ? 'warn' : 'ok',
      message: missingAnswer ? '未提供答案，已生成参考答案（可回写）' : '答案与题干设问对应，复核一致',
    },
    {
      aspect: '解析',
      level: missingAnalysis ? 'warn' : 'ok',
      message: missingAnalysis ? '未提供解析，已生成参考解析（可回写）' : '解析步骤完整，与答案自洽',
    },
  ]
  const corrected: AiCheckCorrection = {
    stem: input.stem || '<p>（演示）请补全题干后重新检测</p>',
    options: [...input.options],
    answer:
      input.answer ||
      (input.options.length ? 'A' : input.type === '填空' ? '答案要点' : '由题意直接推导可得结论（演示答案，请替换）'),
    analysis:
      input.analysis || '<p>（AI 补）演示解析：依据题干条件逐步推导即可得出结论，请替换为真实解析。</p>',
    knowledge: input.knowledge.slice(0, 3),
    difficulty: input.difficulty,
  }
  return {
    engine: 'mock',
    overall: missingAnswer || missingAnalysis || stemText.length < 10 ? 'warn' : 'pass',
    items,
    corrected,
    tokens: 0,
  }
}

/**
 * 本地演示引擎（无 Key）：材料组合题。
 *
 * 与独立单题的演示口径一致 —— 只按「有没有内容」给出可演示的结论，不做真实判卷：
 * 共用材料按「题干 + 基本信息匹配」两项，每道子题按「题干 / 选项（客观题）/ 答案 / 解析」逐项，
 * 报告项与真实引擎同名同序（`共用材料 · X` / `第 N 题 · X`），切引擎时 UI 不需要有任何分支。
 */
function mockCompositeReport(input: CheckQuestionInput): AiCheckReport {
  const subs = input.subQuestions ?? []
  const materialText = toPlainText(input.stem).trim()
  const items: AiCheckItem[] = []
  let hasError = false
  let hasWarn = false

  /* 共用材料：材料本身 + 母题级标注，两项各给一条 */
  items.push({
    scope: '共用材料',
    aspect: '题干',
    level: materialText.length >= 10 ? 'ok' : 'error',
    message:
      materialText.length >= 10
        ? '材料表述完整，公式语法合法'
        : '共用材料为空或过短，子题将缺少作答条件，请补全后再检测',
  })
  if (materialText.length < 10) hasError = true
  items.push({
    scope: '共用材料',
    aspect: '基本信息匹配',
    level: 'ok',
    message: '学科、年级与材料情境及子题内容一致',
  })

  const subCorrections: AiCheckSubCorrection[] = []
  subs.forEach((sub, index) => {
    const scope = `第 ${index + 1} 题`
    const stemText = toPlainText(sub.stem).trim()
    const stemOk = stemText.length >= 6
    items.push({
      scope,
      aspect: '题干',
      level: stemOk ? 'ok' : 'error',
      message: stemOk ? '表述完整，与共用材料自洽' : '子题题干为空或过短，请补全后再检测',
    })
    if (!stemOk) hasError = true

    if (sub.options.length) {
      const optionsOk = sub.options.every((opt) => toPlainText(opt).trim()) && sub.options.length >= 2
      items.push({
        scope,
        aspect: '选项',
        level: optionsOk ? 'ok' : 'error',
        message: optionsOk ? '选项数量与题型匹配，干扰项有效' : '存在空选项或选项数量不足',
      })
      if (!optionsOk) hasError = true
    }

    const missingAnswer = !toPlainText(sub.answer).trim()
    items.push({
      scope,
      aspect: '答案',
      level: missingAnswer ? 'warn' : 'ok',
      message: missingAnswer ? '未提供答案，已生成参考答案（可回写）' : '答案与设问对应，复核一致',
    })
    if (missingAnswer) hasWarn = true

    const missingAnalysis = !toPlainText(sub.analysis).trim()
    items.push({
      scope,
      aspect: '解析',
      level: missingAnalysis ? 'warn' : 'ok',
      message: missingAnalysis ? '未提供解析，已生成参考解析（可回写）' : '解析步骤完整，与答案自洽',
    })
    if (missingAnalysis) hasWarn = true

    const patch: AiCheckSubCorrection = { index }
    if (!stemOk) patch.stem = '（演示）请补全子题题干后重新检测'
    if (missingAnswer) patch.answer = sub.options.length ? 'A' : '答案要点（演示答案，请替换）'
    if (missingAnalysis) {
      patch.analysis = '<p>（AI 补）演示解析：依据共用材料与子题条件逐步推导即可得出结论，请替换为真实解析。</p>'
    }
    if (patch.stem || patch.answer || patch.analysis) subCorrections.push(patch)
  })

  const corrected: AiCheckCorrection = {}
  if (!materialText) corrected.material = '<p>（演示）请补全共用材料后重新检测</p>'
  if (subCorrections.length) corrected.subQuestions = subCorrections
  return {
    engine: 'mock',
    overall: hasError ? 'fail' : hasWarn || !materialText ? 'warn' : 'pass',
    items,
    corrected: hasCorrection(corrected) ? corrected : undefined,
    tokens: 0,
  }
}

/** 手动的 AI 检测入口（检测 + 缺失答案/解析补充一体）：带 subQuestions 即按材料组合题检测 */
export async function checkQuestionByAi(input: CheckQuestionInput): Promise<AiCheckReport> {
  const composite = isCompositeInput(input)
  if (!isDeepseekConfigured()) return composite ? mockCompositeReport(input) : mockReport(input)
  return composite ? callDeepseekComposite(input) : callDeepseek(input)
}
