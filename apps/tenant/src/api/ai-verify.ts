/**
 * AI 批量质检编排层（生成/识别结果的「检查轮次」机制）。
 *
 * 背景：AI 出题/拍照识题/文档识别的结果偶发答案错误、解析过于简略或超出年级水平，
 * 人工逐题复核成本高。这里提供可配置轮次的自动质检：
 * - 每一轮调用质检模型重新独立演算答案、审查解析（必须符合对应年级能看懂的方法），
 *   并产出逐题修正版；修正版作为下一轮输入（有错才继续，没错提前结束）。
 * - 检查轮次可设置（0~3，localStorage 持久化，默认 1 轮）；超过设定轮次仍有
 *   error 级异常时，报告 needsManual=true，由页面提醒人工介入处理。
 *
 * 引擎选择与其它编排层一致：已配置 Deepseek → 真实调用；未配置 → 本地启发式演示，
 * 保证无 Key 环境也能演示「多轮检查 → 提醒人工介入」的完整交互。
 */
import { isDeepseekConfigured, chatCompletion } from './deepseek'
import { VERIFY_SYSTEM_PROMPT, buildVerifyUserPrompt } from './ai-prompts'
import { extractJsonObject, normalizeQuestionList } from './ai-normalize'
import type { GeneratedQuestion } from '@aiteach/shared'

export type VerifyEngine = 'deepseek' | 'mock'
export type VerifyLevel = 'ok' | 'warn' | 'error'

/** 单条质检结论：index 为题目下标（0 起） */
export interface VerifyIssue {
  index: number
  /** 审查维度：答案 / 解析 / 题干 / 选项 */
  aspect: string
  level: VerifyLevel
  message: string
}

export interface VerifyRound {
  round: number
  issues: VerifyIssue[]
  tokens: number
}

export interface VerifyContext {
  /** 业务场景：AI 出题 / 拍照识别 / 文档识别（写进提示词语境） */
  scene: string
  /** 单学科场景（AI 出题）给出全局学科/年级；识别场景留空，按每题标注判断 */
  subject?: string
  grade?: string
}

export interface AiVerifyReport {
  engine: VerifyEngine
  /** 实际执行的轮次记录（rounds=0 时为空数组） */
  rounds: VerifyRound[]
  /** 最后一轮的逐题修正版（与输入逐题对齐；无修正时为原题） */
  corrected: GeneratedQuestion[]
  /** 超出设定轮次后仍存在的 error 级异常 → 需要人工介入 */
  remaining: VerifyIssue[]
  /** true → 页面应提醒人工介入处理 */
  needsManual: boolean
  tokens: number
}

/* ==================== 检查轮次设置（可配置，localStorage 持久化） ==================== */

const ROUNDS_KEY = 'aiteach.ai-check-rounds'
const MAX_ROUNDS = 3

/** 当前设置的检查轮次（0 = 关闭自动质检，1~3 轮） */
export function getCheckRounds(): number {
  const raw = Number(localStorage.getItem(ROUNDS_KEY))
  if (!Number.isFinite(raw)) return 1
  return Math.min(MAX_ROUNDS, Math.max(0, Math.round(raw)))
}

export function setCheckRounds(rounds: number): void {
  localStorage.setItem(ROUNDS_KEY, String(Math.min(MAX_ROUNDS, Math.max(0, Math.round(rounds)))))
}

/* ==================== 富文本 → 模型可读的纯文本（公式还原为 $LaTeX$） ==================== */

/**
 * toPlainText 会把公式节点直接换成 LaTeX 源码但不带 $ 定界，模型难以辨认；
 * 这里把公式节点还原成 $...$ / $$...$$ 后再剥标签，供质检提示词使用。
 */
function richToModelText(html: string): string {
  if (!html) return ''
  const doc = new DOMParser().parseFromString(html, 'text/html')
  doc.querySelectorAll('[data-type="inline-math"]').forEach((el) => {
    el.replaceWith(doc.createTextNode(`$${el.getAttribute('data-latex') ?? ''}$`))
  })
  doc.querySelectorAll('[data-type="block-math"]').forEach((el) => {
    el.replaceWith(doc.createTextNode(`$$${el.getAttribute('data-latex') ?? ''}$$`))
  })
  doc.querySelectorAll('br').forEach((el) => el.replaceWith('\n'))
  doc.querySelectorAll('p,div,li,blockquote,tr').forEach((el) => el.append('\n'))
  return (doc.body.textContent ?? '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
}

/* ==================== 真实引擎（Deepseek 多轮检查） ==================== */

interface RawVerify {
  issues?: Array<{ index?: unknown; aspect?: unknown; level?: unknown; message?: unknown }>
  questions?: unknown
}

function parseIssues(raw: RawVerify, count: number): VerifyIssue[] {
  if (!Array.isArray(raw.issues)) return []
  const issues: VerifyIssue[] = []
  for (const row of raw.issues) {
    if (!row || typeof row !== 'object') continue
    const index = Number(row.index)
    if (!Number.isInteger(index) || index < 0 || index >= count) continue
    issues.push({
      index,
      aspect: typeof row.aspect === 'string' && row.aspect ? row.aspect : '综合',
      level: row.level === 'error' ? 'error' : row.level === 'warn' ? 'warn' : 'ok',
      message: typeof row.message === 'string' ? row.message : '',
    })
  }
  return issues.filter((issue) => issue.level !== 'ok')
}

/** 修正版防「截肢」：质检改写不应让题干/解析大幅变短（短过原稿一半说明改残缺了，
    典型如把小问从题干里改丢、把长解析改成残句），这类字段保留原稿，只采纳其余修正 */
function mergeGuarded(origin: GeneratedQuestion, fixed: GeneratedQuestion): GeneratedQuestion {
  const plainLen = (html: string) => html.replace(/<[^>]+>/g, '').length
  const stemKept = plainLen(fixed.stem) >= plainLen(origin.stem) * 0.5
  const analysisKept = plainLen(fixed.analysis) >= plainLen(origin.analysis) * 0.5
  if (stemKept && analysisKept) return fixed
  return { ...fixed, stem: stemKept ? fixed.stem : origin.stem, analysis: analysisKept ? fixed.analysis : origin.analysis }
}

/** 单轮质检调用：JSON 解析失败重试一次（与出题/识别同一套容错策略） */
async function runVerifyRound(list: GeneratedQuestion[], ctx: VerifyContext): Promise<{ issues: VerifyIssue[]; corrected: GeneratedQuestion[]; tokens: number }> {
  const payload = list.map((q) => ({
    subject: q.subject,
    grade: q.grade,
    knowledge: q.knowledge,
    difficulty: q.difficulty,
    stem: richToModelText(q.stem),
    options: q.options.map(richToModelText),
    answer: richToModelText(q.answer),
    analysis: richToModelText(q.analysis),
  }))
  const messages = [
    { role: 'system' as const, content: VERIFY_SYSTEM_PROMPT },
    { role: 'user' as const, content: buildVerifyUserPrompt(payload, ctx) },
  ]
  let lastError: unknown = null
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      /* 低温度：复核是确定性演算任务，0.2 比默认 0.7 更稳定，减少「答案一套解析另一套」的幻觉 */
      const { content, usage } = await chatCompletion(messages, { json: true, maxTokens: 8192, temperature: 0.2 })
      const raw = extractJsonObject(content) as RawVerify
      /* 修正版解析失败不致命：本轮审查结论仍有效，只是无法回写修正 */
      let corrected = list
      if (raw.questions != null) {
        try {
          const parsed = normalizeQuestionList(JSON.stringify(raw), { maxCount: list.length, richAnswer: true })
          if (parsed.length === list.length) corrected = parsed.map((fix, i) => mergeGuarded(list[i], fix))
        } catch {
          corrected = list
        }
      }
      return { issues: parseIssues(raw, list.length), corrected, tokens: usage.totalTokens }
    } catch (error) {
      lastError = error
    }
  }
  throw lastError instanceof Error ? lastError : new Error('AI 质检失败，请稍后重试')
}

async function verifyByDeepseek(list: GeneratedQuestion[], ctx: VerifyContext, rounds: number): Promise<AiVerifyReport> {
  let current = list
  const report: AiVerifyReport = {
    engine: 'deepseek',
    rounds: [],
    corrected: list,
    remaining: [],
    needsManual: false,
    tokens: 0,
  }
  for (let round = 1; round <= rounds; round += 1) {
    const result = await runVerifyRound(current, ctx)
    report.rounds.push({ round, issues: result.issues, tokens: result.tokens })
    report.tokens += result.tokens
    current = result.corrected
    /* 本轮没有 error 级问题即视为通过（warn 只是提醒，不继续消耗轮次） */
    if (!result.issues.some((issue) => issue.level === 'error')) {
      report.corrected = current
      return report
    }
  }
  report.corrected = current
  const last = report.rounds[report.rounds.length - 1]
  report.remaining = last ? last.issues.filter((issue) => issue.level === 'error') : []
  report.needsManual = report.remaining.length > 0
  return report
}

/* ==================== 本地演示引擎（无 Key）：启发式规则演示多轮检查 ==================== */

function mockVerify(list: GeneratedQuestion[], rounds: number): AiVerifyReport {
  const report: AiVerifyReport = {
    engine: 'mock',
    rounds: [],
    corrected: list,
    remaining: [],
    needsManual: false,
    tokens: 0,
  }
  const plain = (html: string) => html.replace(/<[^>]+>/g, '').trim()
  for (let round = 1; round <= rounds; round += 1) {
    const issues: VerifyIssue[] = []
    list.forEach((q, index) => {
      if (!plain(q.answer)) {
        issues.push({ index, aspect: '答案', level: 'error', message: '答案为空，本地演示引擎无法推算（真实引擎将自动重算并修正）' })
      } else if (plain(q.analysis).length < 20) {
        issues.push({ index, aspect: '解析', level: 'warn', message: '解析过于简略，建议补充关键步骤' })
      } else if (q.analysis.includes('（AI 补）')) {
        issues.push({ index, aspect: '解析', level: 'warn', message: '解析由 AI 补充生成，入库前请人工核对' })
      }
    })
    report.rounds.push({ round, issues, tokens: 0 })
    /* 演示引擎不具备自修正能力：error 级问题会持续存在，用于演示「超轮提醒人工介入」 */
    if (!issues.some((issue) => issue.level === 'error')) return report
  }
  const last = report.rounds[report.rounds.length - 1]
  report.remaining = last ? last.issues.filter((issue) => issue.level === 'error') : []
  report.needsManual = report.remaining.length > 0
  return report
}

/* ==================== 入口 ==================== */

/**
 * 批量质检入口：对 AI 生成/识别出的题目执行最多 rounds 轮检查。
 * - rounds=0：跳过质检，返回空报告（corrected 原样返回）；
 * - 每轮修正版作为下一轮输入，无 error 提前通过；
 * - 轮次用尽仍有 error → needsManual=true，由页面提醒人工介入。
 */
export async function verifyQuestionsByAi(list: GeneratedQuestion[], ctx: VerifyContext, rounds: number): Promise<AiVerifyReport> {
  if (rounds <= 0 || !list.length) {
    return { engine: isDeepseekConfigured() ? 'deepseek' : 'mock', rounds: [], corrected: list, remaining: [], needsManual: false, tokens: 0 }
  }
  if (!isDeepseekConfigured()) return mockVerify(list, rounds)
  return verifyByDeepseek(list, ctx, rounds)
}
