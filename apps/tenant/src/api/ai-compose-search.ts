/**
 * 题库组卷工作台的 AI 搜索编排：自然语言 / 图片 → 结构化检索意图。
 *
 * 引擎选择与 `ai-generate.ts` / `ai-search.ts` 同一口径：
 * - 已配置 Deepseek Key → 真实调用（文本走 chatCompletion，图片走 visionChat 多模态）；
 * - 未配置 → 回退本地 mock 解读，页面功能不降级中断。
 * 解析失败自动重试一次：JSON 模式仍可能偶发产出不合规内容。
 *
 * 模型输出一律经过归一化与白名单收敛后才交给界面：模型可能给出「选择题」这种不在字典里的
 * 题型、或超出范围的难度，直接放进筛选条件会让下拉框显示空值、结果永远为空。
 */
import type { ComposeSearchIntent } from '@aiteach/shared'
import { chatCompletion, isDeepseekConfigured, isVisionConfigured, visionChat } from './deepseek'
import {
  COMPOSE_SEARCH_SYSTEM_PROMPT,
  buildComposeSearchImagePrompt,
  buildComposeSearchUserPrompt,
} from './ai-prompts'
import { extractJsonObject } from './ai-normalize'
import { fileToDataUrl } from './ai-photo'
import { interpretComposeSearch as mockInterpret } from './org'

export type ComposeSearchEngine = 'deepseek' | 'mock'

/** 题型白名单（与字典 questionType 的取值一致） */
export const COMPOSE_TYPE_OPTIONS = ['单选题', '多选题', '判断题', '填空题', '解答题']
/** 难度白名单（与字典 difficulty 的取值一致） */
export const COMPOSE_DIFFICULTY_OPTIONS = ['容易', '较易', '中等', '较难', '困难']

const EMPTY_INTENT: ComposeSearchIntent = {
  keywords: [],
  subject: '',
  grade: '',
  questionTypes: [],
  difficulty: '',
  knowledge: [],
  reason: '',
}

/** 当前 AI 搜索引擎（界面用来标注「真实 AI 解读 / 本地演示解读」） */
export function composeSearchEngine(): ComposeSearchEngine {
  return isDeepseekConfigured() ? 'deepseek' : 'mock'
}

/** 图片解读是否走真实多模态通道（与拍照识题共用视觉配置） */
export function composeImageEngine(): ComposeSearchEngine {
  return isVisionConfigured() ? 'deepseek' : 'mock'
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.trim() : fallback
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((row): row is string => typeof row === 'string') : []
}

/** 去掉标点与空白，只留可检索的正文字符 */
function cleanKeyword(value: string): string {
  return value.replace(/[\s，。、！？；：""''（）()【】《》·,.;:!?"'`]/g, '').trim()
}

/** 模型输出 → 收敛后的检索意图：白名单过滤 + 长度与数量裁剪 */
export function normalizeIntent(raw: Record<string, unknown>): ComposeSearchIntent {
  const keywords = asStringArray(raw.keywords)
    .map(cleanKeyword)
    .filter((word) => word.length >= 2 && word.length <= 12)
    .slice(0, 3)
  const knowledge = asStringArray(raw.knowledge)
    .map((tag) => tag.trim())
    .filter(Boolean)
    .slice(0, 5)
  const questionTypes = asStringArray(raw.questionTypes).filter((type) => COMPOSE_TYPE_OPTIONS.includes(type))
  const difficultyRaw = asString(raw.difficulty)
  const difficulty = COMPOSE_DIFFICULTY_OPTIONS.includes(difficultyRaw) ? difficultyRaw : ''
  const reason = asString(raw.reason).slice(0, 60)

  return {
    keywords,
    subject: asString(raw.subject),
    grade: asString(raw.grade),
    questionTypes,
    difficulty,
    knowledge,
    reason,
  }
}

export interface ComposeAiSearchResult {
  intent: ComposeSearchIntent
  engine: ComposeSearchEngine
}

/**
 * 检索意图解析（真实 AI 优先，失败或未配置时回退本地演示口径）。
 *
 * `image` 存在时以图片为准：文本与图片同时给出时图片信息更具体，且图片路径本来就会
 * 先识别出关键词再回填输入框（见搜索栏），二者不会同时有意义。
 */
export async function aiComposeSearch(input: {
  text?: string
  image?: File
}): Promise<ComposeAiSearchResult> {
  const text = (input.text ?? '').trim()
  if (!input.image && !text) return { intent: { ...EMPTY_INTENT }, engine: composeSearchEngine() }

  if (input.image) {
    /* 视觉通道未配置时退回 mock：此时用文件名生成关键词（org.interpretComposeSearch 内部处理） */
    if (!isVisionConfigured()) {
      return { intent: await mockInterpret({ name: input.image.name }), engine: 'mock' }
    }
    return callAi([
      { role: 'system' as const, content: COMPOSE_SEARCH_SYSTEM_PROMPT },
      {
        role: 'user' as const,
        content: [
          { type: 'text' as const, text: buildComposeSearchImagePrompt(input.image.name) },
          { type: 'image_url' as const, image_url: { url: await fileToDataUrl(input.image) } },
        ],
      },
    ])
  }

  if (!isDeepseekConfigured()) return { intent: await mockInterpret({ text }), engine: 'mock' }

  return callAi([
    { role: 'system' as const, content: COMPOSE_SEARCH_SYSTEM_PROMPT },
    { role: 'user' as const, content: buildComposeSearchUserPrompt(text) },
  ])
}

type ComposeMessages = Parameters<typeof chatCompletion>[0]

/** 调模型 + 解析，失败重试一次（与 ai-generate.ts 同一策略） */
async function callAi(messages: ComposeMessages): Promise<ComposeAiSearchResult> {
  let lastError: unknown = null
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      /* 多模态消息只能走 visionChat，纯文本走 chatCompletion —— 两者的 maxTokens 默认值相同 */
      const isVision = messages.some((message) => Array.isArray(message.content))
      const { content } = isVision
        ? await visionChat(messages as Parameters<typeof visionChat>[0], { json: true, maxTokens: 512 })
        : await chatCompletion(messages, { json: true, maxTokens: 512 })
      return { intent: normalizeIntent(extractJsonObject(content)), engine: 'deepseek' }
    } catch (error) {
      lastError = error
    }
  }
  throw lastError instanceof Error ? lastError : new Error('AI 解读失败，请稍后重试')
}
