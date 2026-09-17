/**
 * 文档识别编排层（我的文件 → AI 识别 → 结构化确认 → 入库）。
 *
 * 引擎选择：
 * - 已配置视觉通道（VITE_VISION_*）且上传的是真实图片文件 → 真实调用多模态模型，
 *   输出 questions + is_paper + paper_name（试卷/题目类型自动判定）；
 * - 未配置或是模拟上传（仅有文件名）→ 本地演示引擎：按文件名模拟结构化结果
 *   （文件名含「卷/试卷/试题」→ 识别为试卷，同时生成题目 + 草稿试卷）。
 *
 * 真实识别出的富文本内嵌图片会先持久化到素材库（复用拍照识题的 persistEmbeddedImages），
 * 避免 data URL 进存储后编辑器加载不出来。
 */
import type { OrgFile } from '@aiteach/shared'
import { isVisionConfigured, visionChat } from './deepseek'
import { FILE_SYSTEM_PROMPT, buildFileUserPrompt } from './ai-prompts'
import { extractJsonObject, normalizeQuestionList } from './ai-normalize'
import { fileToDataUrl, persistEmbeddedImages } from './ai-photo'

export type FileRecognizeEngine = 'ai' | 'mock'

/** 识别出的单题（确认弹窗可编辑；stem/options/answer/analysis 为富文本） */
export interface RecognizedQuestion {
  key: string
  stem: string
  options: string[]
  answer: string
  analysis: string
  knowledge: string[]
  difficulty: string
  subject: string
  grade: string
  /** 按选项结构推导的题型，确认弹窗里可改 */
  type: string
  score: number
  /** 确认弹窗里的入库勾选 */
  include: boolean
}

export interface FileRecognizeResult {
  engine: FileRecognizeEngine
  /** 是否为完整试卷（AI 判定；mock 引擎按文件名启发） */
  isPaper: boolean
  paperName: string
  questions: RecognizedQuestion[]
}

/* 上传时保留的原始 File（按 OrgFile.id 索引；模拟上传无实体文件） */
const fileContent = new Map<number, File>()

export function registerFileContent(id: number, file: File): void {
  fileContent.set(id, file)
}

export function fileContentOf(id: number): File | undefined {
  return fileContent.get(id)
}

export function recognizeEngine(file: OrgFile): FileRecognizeEngine {
  return isVisionConfigured() && file.kind === 'image' && fileContent.has(file.id) ? 'ai' : 'mock'
}

const MAX_QUESTIONS_PER_FILE = 12
const TYPE_BY_OPTIONS = (options: string[], answer: string): string => {
  if (!options.length) return '解答题'
  if (options.length === 2 && options[0] === '正确') return '判断题'
  return answer.replace(/[^A-F]/g, '').length > 1 ? '多选题' : '单选题'
}

/* ===== 真实引擎（图片 + 视觉通道） ===== */

async function recognizeByAi(file: OrgFile): Promise<FileRecognizeResult> {
  const raw = fileContent.get(file.id)
  if (!raw) throw new Error('找不到上传的文件内容')
  const dataUrl = await fileToDataUrl(raw)
  const messages = [
    { role: 'system' as const, content: FILE_SYSTEM_PROMPT },
    {
      role: 'user' as const,
      content: [
        { type: 'text' as const, text: buildFileUserPrompt(file.name) },
        { type: 'image_url' as const, image_url: { url: dataUrl } },
      ],
    },
  ]
  let lastError: unknown = null
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const { content } = await visionChat(messages, { json: true, maxTokens: 8192 })
      return await parseRecognized(content, file)
    } catch (error) {
      lastError = error
    }
  }
  throw lastError instanceof Error ? lastError : new Error('AI 识别失败，请稍后重试')
}

/** 解析识别 JSON：questions 走归一化管线；is_paper / paper_name 取顶层字段；内嵌图片转存素材库 */
async function parseRecognized(content: string, file: OrgFile): Promise<FileRecognizeResult> {
  const raw = extractJsonObject(content) as { is_paper?: unknown; paper_name?: unknown }
  const list = normalizeQuestionList(content, { maxCount: MAX_QUESTIONS_PER_FILE, richAnswer: true })
  if (!list.length) throw new Error('AI 未识别出题目')
  const paperName = typeof raw.paper_name === 'string' && raw.paper_name.trim() ? raw.paper_name.trim() : file.name.replace(/\.\w+$/, '')
  const questions: RecognizedQuestion[] = []
  for (const [i, q] of list.entries()) {
    const subject = q.subject ?? '数学'
    const [stem, analysis] = await Promise.all([
      persistEmbeddedImages(q.stem, subject),
      persistEmbeddedImages(q.analysis, subject),
    ])
    const options = await Promise.all(q.options.map((opt) => persistEmbeddedImages(opt, subject)))
    questions.push({
      key: `r${i}`,
      stem,
      options,
      answer: q.answer,
      analysis,
      knowledge: q.knowledge.slice(0, 3),
      difficulty: q.difficulty,
      subject,
      grade: q.grade ?? '高一',
      type: TYPE_BY_OPTIONS(options, q.answer),
      score: options.length ? 5 : 12,
      include: true,
    })
  }
  return { engine: 'ai', isPaper: raw.is_paper === true, paperName, questions }
}

/* ===== 本地演示引擎 ===== */

const DEMO_STEMS = [
  '已知集合 A={x | 1<x<5}，B={2,3,4,5}，则 A∩B 中元素的个数为',
  '函数 f(x)=√(x-2) 的定义域为',
  '已知等差数列 {aₙ} 中 a₁=2，公差 d=3，求 a₁₀ 及前 10 项和 S₁₀',
]

function recognizeByMock(file: OrgFile): FileRecognizeResult {
  const base = file.name.replace(/\.\w+$/, '')
  /* 文件名带「卷/试卷/试题/测试」→ 判为完整试卷；否则判为题集（只入题库） */
  const isPaper = /卷|试题|测试/.test(base)
  const questions: RecognizedQuestion[] = DEMO_STEMS.map((stemText, i) => {
    const isChoice = i === 0
    const isFill = i === 1
    const options = isChoice ? ['1 个', '2 个', '3 个', '4 个'] : []
    const answer = isChoice ? 'C' : isFill ? '(2,+∞)' : 'a₁₀=29，S₁₀=155'
    return {
      key: `m${i}`,
      stem: `<p>${stemText}${isChoice ? '（ ）' : ''}</p>`,
      options,
      answer,
      analysis: `<p>（AI 补）演示解析：第 ${i + 1} 题按文档识别结果生成，入库前请核对。</p>`,
      knowledge: ['集合', '函数', '数列'].slice(i, i + 1),
      difficulty: '中等',
      subject: '数学',
      grade: '高一',
      type: TYPE_BY_OPTIONS(options, answer),
      score: isChoice ? 5 : isFill ? 5 : 12,
      include: true,
    }
  })
  return { engine: 'mock', isPaper, paperName: base, questions }
}

/**
 * 文档识别入口：返回结构化结果（确认弹窗展示并可编辑）。
 * 注意：此处不入库 —— 入库在用户确认后走 org.importRecognizedFile。
 */
export async function recognizeFileContent(file: OrgFile): Promise<FileRecognizeResult> {
  if (recognizeEngine(file) === 'ai') return recognizeByAi(file)
  /* 模拟两拍，让进度条有个过程 */
  await new Promise((resolve) => window.setTimeout(resolve, 900))
  return recognizeByMock(file)
}
