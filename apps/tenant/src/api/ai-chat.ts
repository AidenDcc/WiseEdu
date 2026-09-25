/**
 * 全局 AI 问答编排层：检索机构自有资源 → 组装提示词 → 调用 Deepseek → 归一化为富文本。
 *
 * 与其它 AI 模块（ai-generate / ai-photo / ai-check）的三点不同：
 * 1. 回答是自由文本而非 JSON，所以不做结构校验，只经 richField() 转成富文本 HTML
 *    （说明见 ai-prompts.ts 的「AI 问答」一节：提示词已禁止 markdown，渲染器只认公式节点）；
 * 2. 调用模型前先检索机构资源库（复用全局搜索），把命中的题目/试卷/资料作为上下文，
 *    让回答能落在机构自己的资源上 —— 这是本功能与「直接问大模型」的核心差别；
 * 3. 检索是锦上添花：它失败或没命中都不能让对话失败，故整段吞异常并退回无资源作答。
 *
 * 引擎切换沿用仓库既有口径（见 ai-generate.ts）：未配置 Key 走本地演示回复，功能不中断。
 */
import type { OrgSearchResult } from '@aiteach/shared'
import { toPlainText } from '@aiteach/shared'
import { chatCompletion, isDeepseekConfigured } from './deepseek'
import {
  buildChatUserPrompt,
  buildResourceContext,
  CHAT_RESOURCE_LIMITS,
  CHAT_SYSTEM_PROMPT,
} from './ai-prompts'
import { richField } from './ai-normalize'
import { fetchGlobalSearch } from './org'

export type ChatEngine = 'deepseek' | 'mock'

/** 回答下方的来源卡片（点击跳转到对应资源所在页面） */
export interface ChatSource {
  key: string
  kind: '题目' | '试卷' | '同步备课' | '视频' | '我的文件'
  title: string
  path: string
}

/** 一轮对话。会话状态由 AiAssistant.vue 持有（不落 localStorage，见该组件注释） */
export interface ChatTurn {
  id: string
  role: 'user' | 'assistant'
  /** 用户消息为纯文本；助手消息为 richField() 产出的富文本 HTML（仅供渲染） */
  content: string
  /**
   * 助手消息的**模型原文**（LaTeX 原样、无 HTML 标签）。
   * 与 content 分开存是必须的：多轮对话要把历史回传给模型，若把带 <p> 与 data-latex 的
   * 富文本 HTML 回传，模型看到的就是一堆标签 —— 等于污染上下文。
   */
  raw?: string
  sources?: ChatSource[]
  engine?: ChatEngine
  tokens?: number
  /** 助手消息失败时的中文提示（气泡内展示，并提供重试） */
  error?: string
}

export interface AskInput {
  question: string
  /** 当前页面标题（route.meta.title），作为上下文告诉模型用户在看什么 */
  page?: string
  grade?: string
  subject?: string
  /** 之前的对话（助手侧用 raw 原文，不传富文本） */
  history?: Array<{ role: 'user' | 'assistant'; content: string }>
  /** 阶段回调：面板据此显示「正在检索机构资源…」这类进度文案 */
  onStage?: (stage: string) => void
}

export interface AskResult {
  /** richField() 产出的富文本 HTML，直接交给 RichTextViewer 渲染 */
  content: string
  /** 模型原文，用于下一轮回传上下文 */
  raw: string
  sources: ChatSource[]
  engine: ChatEngine
  tokens: number
}

/** 当前问答引擎（面板用来展示「真实 AI / 本地演示」标识） */
export function chatEngine(): ChatEngine {
  return isDeepseekConfigured() ? 'deepseek' : 'mock'
}

/* ==================== 检索关键词提取 ==================== */

/**
 * 口语提问里的「非主题词」。它们在这里当**分隔符**用：切开后剩下的片段才是知识点级的检索词。
 *
 * 为什么必须抽词：机构资源检索（mock 与后端）都是按关键词做子串匹配，
 * 直接把「一元二次方程有几种解法」整句丢进去必然零命中；切成「一元二次方程」「解法」才搜得到。
 * 顺序无关紧要 —— 使用前会按长度倒序排成 alternation，避免「什么」先于「什么是」命中。
 */
const STOP_PATTERNS = [
  '一下', '一些', '一个', '这个', '那个', '这些', '那些', '有什么',
  '有几种', '有哪些', '有多少', '是什么', '什么是', '多少种',
  '帮我', '帮忙', '请问', '请教', '我想', '我要', '给我', '麻烦', '能不能', '可以', '你能',
  '讲解', '解释', '讲讲', '说说', '介绍', '分析', '梳理', '总结', '归纳', '整理', '罗列',
  '哪些', '哪个', '几种', '多少', '是否', '有没有', '怎么', '怎样', '如何', '怎么样', '怎么办',
  '为什么', '谢谢', '你好', '请', '的', '了', '吗', '呢', '吧', '啊', '嘛', '呀', '和', '与', '及',
  /* 第二组：提问的口语外壳（「我对三角函数有点疑惑」这类句子若不切开，
     整句 11 个字会被当成检索词，子串匹配必然零命中） */
  '我对', '我想问', '想问', '问下', '关于', '有关', '有点', '有些', '一点', '不太', '不是很',
]

/** 单个检索词的长度上限：再长就超出「知识点」的量级，子串匹配反而命中不到 */
const MAX_KEYWORD_LENGTH = 12
/** 每次提问最多检索几个词（每个词一次检索请求） */
const MAX_KEYWORDS = 3

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function charSum(text: string): number {
  let sum = 0
  for (let i = 0; i < text.length; i += 1) sum += text.charCodeAt(i)
  return sum
}

/** 按提问内容稳定取一条演示话术（同一问题每次结果一致，便于演示复现） */
function pick<T>(list: readonly T[], seed: string): T {
  return list[charSum(seed) % list.length] as T
}

/**
 * 从提问里抽出检索词：去标点 → 按口语词切开 → 取最长的 2~3 段。
 *
 * 长的片段更具体、子串匹配命中率更高，故优先取长的；全是口语词（如「怎么做」）时
 * 退回清洗后的整句，至少给检索一次机会 —— 宁可搜不到，也不能没搜就说「没有」。
 */
export function extractKeywords(question: string): string[] {
  const cleaned = question
    .replace(/[，。？！、；：""''（）【】《》〈〉「」,、\.!\?;:"'()[\]{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!cleaned) return []

  const splitter = new RegExp(
    [...STOP_PATTERNS].sort((a, b) => b.length - a.length).map(escapeRegExp).join('|'),
    'g',
  )
  const segments = cleaned
    .split(splitter)
    .map((segment) => segment.trim().slice(0, MAX_KEYWORD_LENGTH))
    .filter((segment) => segment.length >= 2)
    .sort((a, b) => b.length - a.length)

  const seen = new Set<string>()
  const keywords: string[] = []
  for (const segment of segments) {
    if (seen.has(segment)) continue
    seen.add(segment)
    keywords.push(segment)
    if (keywords.length >= MAX_KEYWORDS) break
  }
  if (!keywords.length) keywords.push(cleaned.slice(0, MAX_KEYWORD_LENGTH))
  return keywords
}

/* ==================== 机构资源检索 ==================== */

const EMPTY_RESULT: OrgSearchResult = { questions: [], papers: [], preparations: [], videos: [], files: [] }

/** 逐词检索并合并去重（同一资源可能被多个关键词命中） */
function mergeResults(results: OrgSearchResult[]): OrgSearchResult {
  const merge = <T extends { id: number }>(lists: T[][], limit: number): T[] => {
    const seen = new Set<number>()
    const merged: T[] = []
    for (const list of lists) {
      for (const row of list) {
        if (seen.has(row.id)) continue
        seen.add(row.id)
        merged.push(row)
        if (merged.length >= limit) return merged
      }
    }
    return merged
  }
  return {
    questions: merge(results.map((r) => r.questions), CHAT_RESOURCE_LIMITS.questions),
    papers: merge(results.map((r) => r.papers), CHAT_RESOURCE_LIMITS.papers),
    preparations: merge(results.map((r) => r.preparations), CHAT_RESOURCE_LIMITS.preparations),
    videos: merge(results.map((r) => r.videos), CHAT_RESOURCE_LIMITS.videos),
    files: merge(results.map((r) => r.files), CHAT_RESOURCE_LIMITS.files),
  }
}

/**
 * 检索机构资源。检索失败一律返回空结果：问答本身不该因为「搜不到」而失败，
 * 顶多是回答少了一层机构上下文（提示词里会写明「未检索到」）。
 */
async function retrieveResources(keywords: string[]): Promise<OrgSearchResult> {
  if (!keywords.length) return EMPTY_RESULT
  try {
    return mergeResults(await Promise.all(keywords.map((keyword) => fetchGlobalSearch(keyword))))
  } catch {
    return EMPTY_RESULT
  }
}

/** 题目的跳转关键词：优先用它的知识点（比题干片段更能定位到同类题） */
function questionKeyword(row: { knowledge: string[] }, fallback: string): string {
  return row.knowledge[0] || fallback
}

/**
 * 检索结果 → 来源卡片。
 * 只有题库管理支持按关键词深链（BankView 读 ?keyword=），其余分类跳到各自的列表页。
 */
function toSources(result: OrgSearchResult, keywords: string[]): ChatSource[] {
  const fallback = keywords[0] ?? ''
  const sources: ChatSource[] = []

  result.questions.forEach((row) => {
    const plain = toPlainText(row.stem).replace(/\s+/g, ' ').trim()
    sources.push({
      key: `question-${row.id}`,
      kind: '题目',
      title: plain.length > 24 ? `${plain.slice(0, 24)}…` : plain,
      path: `/question/bank?keyword=${encodeURIComponent(questionKeyword(row, fallback))}`,
    })
  })
  result.papers.forEach((row) => {
    sources.push({ key: `paper-${row.id}`, kind: '试卷', title: row.name, path: '/paper/list' })
  })
  result.preparations.forEach((row) => {
    sources.push({ key: `material-${row.id}`, kind: '同步备课', title: row.name, path: '/material/list' })
  })
  result.videos.forEach((row) => {
    sources.push({ key: `media-${row.id}`, kind: '视频', title: row.name, path: '/material/media/video' })
  })
  result.files.forEach((row) => {
    sources.push({ key: `file-${row.id}`, kind: '我的文件', title: row.name, path: '/file' })
  })
  return sources
}

/* ==================== 模型输出的兜底清洗 ==================== */

/** 单段文本的 markdown 擦除（公式段不经过这里，见 stripMarkdown） */
function stripMarkdownChunk(text: string): string {
  return text
    .replace(/```[a-zA-Z]*\n?/g, '')
    /* 行首缩进一律写 [ \t]{0,3} 而不是 \s{0,3}：\s 会连换行一起吃掉 ——
       分段后每段自己的开头也算「行首」，用 \s 时 `\n\n- 项` 会整段匹配上，
       把空行与列表符号一起删掉，段落分隔随之消失（段里若正好跟着独占一行的
       $$公式$$，公式会被并进上一行，渲染成行内节点）。 */
    .replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, '')
    .replace(/^[ \t]{0,3}>[ \t]?/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1$2')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/^[ \t]{0,3}[-*+][ \t]+/gm, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
}

/**
 * 兜底擦掉模型仍然漏出来的 markdown。
 *
 * 系统提示词已明确禁止 markdown，但模型（尤其写列表和长回答时）仍会零星输出
 * `**加粗**`、`- 列表`、`### 小标题`。这些标记 RichTextViewer 不解析，只会原样显示成
 * 星号与井号，所以在渲染前统一擦掉。
 *
 * 公式段（$...$ / $$...$$）整体跳过：LaTeX 里的 * _ \ 都是合法字符，
 * 按 markdown 规则擦会把公式改坏（如 $a*b$ 的乘号被当成斜体标记）。
 */
export function stripMarkdown(text: string): string {
  return text
    .split(/(\$\$[\s\S]+?\$\$|\$[^$\n]+?\$)/g)
    .map((part) => (part.startsWith('$') ? part : stripMarkdownChunk(part)))
    .join('')
}

/**
 * 把「位置不成立」的块级公式降级成行内公式。
 *
 * 提示词（复用 FORMULA_RULES）要求块级公式独立成行，但模型常把它写在句中，
 * 如「由判别式 $$\\Delta=b^2-4ac$$ 决定」。richField 只在**整行就是一个 $$...$$** 时
 * 才产出块级节点，否则会生成一个嵌在 <p> 里的 <div data-type="block-math"> ——
 * 而 HTML 规定 <div> 起始标签会隐式闭合外层 <p>：浏览器解析后段落被拦腰截断，
 * 公式后面的文字掉到段落外，还多出一个空 <p>（空段落会被样式加上下边距）。
 * 这里提前把这类公式降级为行内，渲染结构才是对的；独占一行的仍走块级。
 */
function demoteMidLineBlockMath(text: string): string {
  return text
    .split('\n')
    .map((line) =>
      /^\s*\$\$[\s\S]+\$\$\s*$/.test(line)
        ? line
        : line.replace(/\$\$([\s\S]+?)\$\$/g, (_match, latex: string) => `$${latex}$`),
    )
    .join('\n')
}

/**
 * 已擦除 markdown 的模型原文 → 富文本 HTML。
 * 顺序不能换：stripMarkdown 必须跑在 richField 之前（它按 $ 分段保护 LaTeX，
 * 而 richField 一旦把 $...$ 变成公式节点，就再也没法判断哪段是公式了）。
 */
function toRichText(raw: string): string {
  return richField(demoteMidLineBlockMath(raw))
}

/* ==================== 本地演示引擎（无 Key） ==================== */

/** 演示模式刻意留一点等待时间：否则回答瞬间出现，打字指示器一闪而过，看不出在「思考」 */
const MOCK_DELAY_MS = 600

const MOCK_LEADS = [
  '这个问题可以按「考点 → 方法 → 易错点」的顺序来看：',
  '先给结论，再说清来由与适用条件：',
  '按课堂上讲这类问题的顺序梳理一下：',
]

const MOCK_BODIES = [
  [
    '1. 定考点：先看题目问什么（求值、证明还是求取值范围），确定它属于哪一类模型；',
    '2. 找关系：把已知条件统一写成一个等式或函数，如一元二次方程的一般形式 $ax^2+bx+c=0$（其中 $a\\neq 0$），判别式 $\\Delta=b^2-4ac$ 决定根的个数；',
    '3. 求解并检验：算出结果后回代原条件，重点检查取值范围与定义域是否被漏掉。',
  ],
  [
    '1. 概念层面：先明确几个关键词的准确定义，概念不清时后面每一步都会歪；',
    '2. 方法层面：把问题归到你熟悉的模型上（如 $y=ax^2+bx+c$ 的图象与对称轴），再套用标准步骤；',
    '3. 易错层面：注意分类讨论是否穷尽、端点值能否取到，这两处是丢分最集中的地方。',
  ],
  [
    '1. 先讲思路：这类题通常由已知推未知，中间需要一个桥接关系；',
    '2. 再讲写法：分步书写、每步注明依据（如 $\\Delta>0$ 时方程有两个不相等的实根），便于学生复现；',
    '3. 最后补一道变式：把条件或问法改一处，让学生对比差异，效果比重复刷同类题更好。',
  ],
]

/**
 * 本地演示回复（未配置 AI Key 时）。
 *
 * 与其它 AI 模块的 mock 一样是「稳定可复现」的：话术按提问的字符码之和取模选取，
 * 同一问题每次得到同一段回复。命中资源时把资源清单原样列出来 —— 演示模式下
 * 也能看出「回答结合了机构自己的资源库」这个能力，而不是一段与资源无关的空话。
 */
function mockChatReply(question: string, result: OrgSearchResult): string {
  const context = buildResourceContext(result)
  const lines: string[] = [pick(MOCK_LEADS, question), ...pick(MOCK_BODIES, question)]
  if (context) {
    lines.push('', '机构资源库里检索到了下面这些相关内容，点开「参考」可直接跳转：', context)
  } else {
    lines.push('', '机构资源库里暂时没有直接对应的内容，以上是通用教学建议。')
  }
  lines.push('', '（本地演示回复：未配置 AI Key，接入模型后可针对你提的问题给出真实讲解。）')
  return lines.join('\n')
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

/* ==================== 对外入口 ==================== */

/**
 * 一次问答：先检索机构资源，再按引擎作答。
 * 检索失败不影响作答；模型调用失败会抛出中文错误（由面板在气泡内展示并提供重试）。
 */
export async function askAi(input: AskInput): Promise<AskResult> {
  const keywords = extractKeywords(input.question)
  input.onStage?.('正在检索机构资源…')
  const result = await retrieveResources(keywords)
  const sources = toSources(result, keywords)

  if (!isDeepseekConfigured()) {
    /* 演示回复同样过 stripMarkdown + toRichText，保证两条路径的渲染完全一致 */
    const raw = stripMarkdown(mockChatReply(input.question, result))
    input.onStage?.('正在生成回答…')
    await delay(MOCK_DELAY_MS)
    return { content: toRichText(raw), raw, sources, engine: 'mock', tokens: 0 }
  }

  input.onStage?.('AI 正在思考…')
  const { content, usage } = await chatCompletion(
    [
      { role: 'system', content: CHAT_SYSTEM_PROMPT },
      /* 历史回传的是 raw 原文：模型不该看到我们内部的富文本标签 */
      ...(input.history ?? []).map((turn) => ({ role: turn.role, content: turn.content })),
      {
        role: 'user',
        content: buildChatUserPrompt({
          question: input.question,
          page: input.page,
          grade: input.grade,
          subject: input.subject,
          resources: buildResourceContext(result),
        }),
      },
    ],
    { temperature: 0.6, maxTokens: 2048 },
  )
  /* 回答是自由文本：先擦掉漏出的 markdown，再经 richField 转义 + 公式节点化后渲染 */
  const raw = stripMarkdown(content)
  return { content: toRichText(raw), raw, sources, engine: 'deepseek', tokens: usage.totalTokens }
}
