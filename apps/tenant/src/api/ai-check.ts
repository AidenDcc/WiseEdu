/**
 * AI 质检编排层（手动录入的「AI 检测」入口）。
 *
 * - 已配置 Deepseek：真实调用，模型返回 overall/items/questions(修正版) 三段 JSON；
 *   修正版复用 ai-normalize 的归一化管线转富文本，与 AI 出题同一套公式/SVG 净化逻辑，
 *   可直接回写到录入表单（含缺失答案/解析的 AI 补充）。
 * - 未配置：回退本地启发式演示（缺答案/解析 → 给出 mock 补充；题干过短 → warn），
 *   保证无 Key 环境也能演示完整交互。
 */
import { isDeepseekConfigured, chatCompletion } from './deepseek'
import { CHECK_SYSTEM_PROMPT, buildCheckUserPrompt } from './ai-prompts'
import { extractJsonObject, normalizeQuestionList } from './ai-normalize'
import type { GeneratedQuestion } from '@aiteach/shared'

export type CheckEngine = 'deepseek' | 'mock'
export type CheckLevel = 'ok' | 'warn' | 'error'

export interface AiCheckItem {
  /** 审查维度：基本信息匹配 / 题干 / 选项 / 答案 / 解析 */
  aspect: string
  level: CheckLevel
  message: string
}

export interface AiCheckReport {
  engine: CheckEngine
  overall: 'pass' | 'warn' | 'fail'
  items: AiCheckItem[]
  /** 修正后的完整题目（富文本），可回写表单；模型未给 questions 时为 undefined */
  corrected?: GeneratedQuestion
  /** 消耗 token 数（mock 为 0） */
  tokens: number
}

export interface CheckQuestionInput {
  subject: string
  grade: string
  type: string
  difficulty: string
  knowledge: string[]
  stem: string
  options: string[]
  answer: string
  analysis: string
}

export function checkEngine(): CheckEngine {
  return isDeepseekConfigured() ? 'deepseek' : 'mock'
}

/* ===== 真实引擎 ===== */

interface RawCheck {
  overall?: string
  items?: Array<{ aspect?: string; level?: string; message?: string }>
}

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
  const overall = raw.overall === 'fail' ? 'fail' : raw.overall === 'warn' ? 'warn' : 'pass'
  const items: AiCheckItem[] = Array.isArray(raw.items)
    ? raw.items
        .filter((row) => row && typeof row === 'object')
        .map((row) => ({
          aspect: typeof row.aspect === 'string' ? row.aspect : '综合',
          level: row.level === 'error' ? 'error' : row.level === 'warn' ? 'warn' : 'ok',
          message: typeof row.message === 'string' ? row.message : '',
        }))
    : []
  /* 修正版缺了不致命：只意味着本次不能回写，审查结论仍然有效 */
  let corrected: GeneratedQuestion | undefined
  if (raw.questions != null) {
    try {
      const list = normalizeQuestionList(JSON.stringify(raw), { maxCount: 1, richAnswer: true })
      corrected = list[0]
    } catch {
      corrected = undefined
    }
  }
  return { engine: 'deepseek', overall, items, corrected, tokens }
}

/* ===== 本地演示引擎（无 Key）：按缺失情况给出可演示的质检结论 ===== */

function mockReport(input: CheckQuestionInput): AiCheckReport {
  const stemText = input.stem.replace(/<[^>]+>/g, '').trim()
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
  const corrected: GeneratedQuestion = {
    id: `check_${Date.now()}`,
    stem: input.stem || '<p>（演示）请补全题干后重新检测</p>',
    options: [...input.options],
    answer:
      input.answer ||
      (input.options.length ? 'A' : input.type === '填空题' ? '答案要点' : '由题意直接推导可得结论（演示答案，请替换）'),
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

/** 手动录入表单的 AI 检测入口（检测 + 缺失答案/解析补充一体） */
export async function checkQuestionByAi(input: CheckQuestionInput): Promise<AiCheckReport> {
  if (!isDeepseekConfigured()) return mockReport(input)
  return callDeepseek(input)
}
