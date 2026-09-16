/**
 * AI 智能出题编排层（FR-TM-013）：组装提示词 → 调用 Deepseek → 解析归一化。
 *
 * 引擎选择：
 * - 已配置 VITE_DEEPSEEK_API_KEY → 真实调用 Deepseek（JSON Output 模式）；
 * - 未配置（如 CI / 演示环境）→ 回退到本地 mock 生成，页面功能不降级中断。
 * 解析失败自动重试一次：JSON 模式仍可能偶发产出不合规内容，重试比直接把
 * 错误甩给用户体验好，且成本可控（仅重试一次）。
 */
import type { GeneratedQuestion } from '@aiteach/shared'
import { chatCompletion, isDeepseekConfigured } from './deepseek'
import { buildUserPrompt, SYSTEM_PROMPT, type UserPromptParams } from './ai-prompts'
import { parseQuestionResponse } from './ai-normalize'
import { generateQuestions as mockGenerate } from './org'

export type AiEngine = 'deepseek' | 'mock'

export interface AiGenerateResult {
  list: GeneratedQuestion[]
  engine: AiEngine
  /** Deepseek 通道的 token 消耗（mock 通道为 0） */
  tokens: number
}

/** 当前 AI 出题引擎（页面用来展示「真实 AI / 本地演示」标识） */
export function aiEngine(): AiEngine {
  return isDeepseekConfigured() ? 'deepseek' : 'mock'
}

async function callDeepseek(params: UserPromptParams): Promise<AiGenerateResult> {
  const messages = [
    { role: 'system' as const, content: SYSTEM_PROMPT },
    { role: 'user' as const, content: buildUserPrompt(params) },
  ]
  let lastError: unknown = null
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const { content, usage } = await chatCompletion(messages, { json: true })
      return { list: parseQuestionResponse(content, params), engine: 'deepseek', tokens: usage.totalTokens }
    } catch (error) {
      lastError = error
    }
  }
  throw lastError instanceof Error ? lastError : new Error('AI 生成失败，请稍后重试')
}

export async function generateByAi(params: UserPromptParams): Promise<AiGenerateResult> {
  if (!isDeepseekConfigured()) {
    const list = await mockGenerate(Math.min(Math.max(params.count, 1), 10))
    return { list, engine: 'mock', tokens: 0 }
  }
  return callDeepseek(params)
}
