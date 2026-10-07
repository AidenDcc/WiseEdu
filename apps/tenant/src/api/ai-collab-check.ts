/**
 * 协同组卷 · 提交前的合规核对。
 *
 * 与 `ai-check.ts` 是一对：那条审**一道题的质量**（答案对不对、解析全不全），
 * 这条审**一份卷子符不符合协同任务的基本要求**（分工交齐没有、难度配比、知识点覆盖、
 * 题目入库没有）。两者互不替代 —— 一道答案全对的题也可能压根没入库。
 *
 * 两个入口：
 * - `checkCollabRequirement`：**纯计算**，不发请求。打开检测弹窗就该看到结论，
 *   不该等模型。题数这类硬口径还必须是确定性的（要和后端的提交校验对得上）。
 * - `checkCollabPaperByAi`：把结构与要求交给模型判「像不像符合要求」（跑题、超纲这类
 *   算不准的活）。未配置密钥时**不装作有 AI** —— 直接把本地核对结果原样端出来，
 *   并在结尾说明这是规则核对，不编造一份看起来更聪明的东西。
 */
import { isDeepseekConfigured, chatCompletion } from './deepseek'
import { COLLAB_CHECK_SYSTEM_PROMPT, buildCollabCheckUserPrompt } from './ai-prompts'
import { extractJsonObject } from './ai-normalize'
import type { CollabRequirement } from '@aiteach/shared'

export type CollabCheckLevel = 'ok' | 'warn' | 'error'
export type CollabCheckEngine = 'deepseek' | 'mock'
export type CollabCheckOverall = 'pass' | 'warn' | 'fail'

export interface CollabCheckItem {
  /** 核对维度：题数与分工 / 题型与分值 / 难度配比 / 知识点覆盖 / 内容相符 / 入库与完整度 */
  aspect: string
  level: CollabCheckLevel
  message: string
}

export interface CollabCheckReport {
  engine: CollabCheckEngine
  overall: CollabCheckOverall
  items: CollabCheckItem[]
  /** 消耗 token 数（本地规则核对为 0） */
  tokens: number
}

/** 卷面上一道题的「精简画像」：只够判断是否合规，不带整段题干 */
export interface CollabCheckQuestion {
  /** 全卷流水号（卷面上印的那个），结论里点名用它 */
  no: number
  type: string
  difficulty: string
  knowledge: string[]
  /** 题干开头（已去标签、已截断），用于判断是否落在要求的学科年级范围内 */
  stem: string
  hasAnswer: boolean
  hasAnalysis: boolean
  /** 已入库（`approved`）。AI 新生成的题是「待审」，交出去会被审核退回 */
  approved: boolean
}

export interface CollabPaperCheckInput {
  requirement: CollabRequirement
  /** 本次以谁的名义交卷 */
  memberName: string
  /** 该成员负责的题型；为空 = 发起人视角，看整卷 */
  myTypes: string[]
  /**
   * 本人负责题型逐项的「要求 / 已有」，由调用方用 `paper-sections` 的 `memberQuotaOf` 算好 ——
   * 那个口径必须与 mock 的提交校验逐字一致，放在共享纯函数里才只有一处。
   */
  progress: Array<{ type: string; want: number; have: number }>
  totalCount: number
  totalScore: number
  sections: Array<{ title: string; count: number; score: number; types: string[] }>
  questions: CollabCheckQuestion[]
}

/** 从卷面事实里能直接算出来的几件事：本地核对与 AI 提示词共用一份 */
interface CheckFacts {
  difficultySpread: Array<{ level: string; count: number }>
  missingKnowledge: string[]
  unapproved: number[]
  incomplete: Array<{ no: number; missing: string }>
}

function deriveFacts(input: CollabPaperCheckInput): CheckFacts {
  const spread = new Map<string, number>()
  for (const row of input.questions) {
    const level = row.difficulty || '未标注'
    spread.set(level, (spread.get(level) ?? 0) + 1)
  }
  /* 卷面实际用到的知识点（不看要求，要求里的才算「该覆盖」） */
  const used = new Set(input.questions.flatMap((row) => row.knowledge))
  return {
    difficultySpread: [...spread].map(([level, count]) => ({ level, count })),
    missingKnowledge: input.requirement.knowledge.filter((point) => !used.has(point)),
    unapproved: input.questions.filter((row) => !row.approved).map((row) => row.no),
    incomplete: input.questions.flatMap((row) => {
      const missing = [!row.hasAnswer ? '答案' : '', !row.hasAnalysis ? '解析' : ''].filter(Boolean).join(' / ')
      return missing ? [{ no: row.no, missing }] : []
    }),
  }
}

/** 逐项数字对不上时的说法：列名字 + 差多少，不要只说「不符合」 */
function shortfallText(rows: Array<{ type: string; want: number; have: number }>): string {
  return rows.map((row) => `${row.type} ${row.have}/${row.want}`).join('；')
}

/**
 * 本地合规核对（纯函数，不发请求）。
 *
 * `aspect` 与 `COLLAB_CHECK_SYSTEM_PROMPT` 里那六个维度同名：本地先给一份确定性的说法，
 * AI 那一轮再在同一组维度上补充「算不准」的判断，两边的结论能并排看。
 */
export function checkCollabRequirement(input: CollabPaperCheckInput): CollabCheckItem[] {
  const facts = deriveFacts(input)
  const items: CollabCheckItem[] = []

  /* 1. 题数与分工：唯一一条硬口径 —— 就是后端提交时数的那几项 */
  if (!input.progress.length) {
    items.push({ aspect: '题数与分工', level: 'warn', message: '本任务没有分配题型给你，请先与发起人确认分工' })
  } else {
    const short = input.progress.filter((row) => row.have < row.want)
    const done = input.progress.reduce((sum, row) => sum + Math.min(row.have, row.want), 0)
    const quota = input.progress.reduce((sum, row) => sum + row.want, 0)
    items.push({
      aspect: '题数与分工',
      level: short.length ? 'error' : 'ok',
      message: short.length
        ? `还差 ${short.reduce((sum, row) => sum + (row.want - row.have), 0)} 题未完成：${shortfallText(short)}（已交 ${done}/${quota}）`
        : `已交齐 ${done}/${quota}：${shortfallText(input.progress)}`,
    })
  }

  /* 2. 题型与分值：题数归「题数与分工」管，这里只看**分值**是否按题型要求算。
        某人把 5 分的单选改成 8 分、或某个大题整体被改过总分，卷面上看不出来，审核时才炸 */
  const kindRows = input.progress.length
    ? input.requirement.structure.filter((row) => input.myTypes.length === 0 || input.myTypes.includes(row.type))
    : input.requirement.structure
  const scoreIssues: string[] = []
  for (const want of kindRows) {
    if (!want.score) continue
    const expect = want.count * want.score
    const have = input.sections.filter((row) => row.types.includes(want.type)).reduce((sum, row) => sum + row.score, 0)
    /* 没往卷面放过这种题就跳过：缺题数上面已经报过，这里再报一遍只是噪音 */
    if (!have) continue
    if (have !== expect) scoreIssues.push(`${want.type} 卷面 ${have} 分、按要求应为 ${want.count}×${want.score}=${expect} 分`)
  }
  items.push({
    aspect: '题型与分值',
    level: scoreIssues.length ? 'warn' : 'ok',
    message: scoreIssues.length
      ? scoreIssues.join('；')
      : `卷面 ${input.totalCount} 题 · ${input.totalScore} 分，各题型分值均按要求计算`,
  })

  /* 3. 难度配比：要求是占比，卷面是题数，换算成题数再比，避免「30% 到底差几题」说不清 */
  const reqDiff = input.requirement.difficulty
  if (!reqDiff.length || !input.totalCount) {
    items.push({ aspect: '难度配比', level: 'ok', message: '要求未限定难度配比，跳过' })
  } else {
    const actual = new Map(facts.difficultySpread.map((row) => [row.level, row.count]))
    const drift = reqDiff.flatMap((row) => {
      const want = Math.round((row.ratio / 100) * input.totalCount)
      const have = actual.get(row.level) ?? 0
      /* 允许 1 题的取整误差：15 题里 20% 是 3 题，写成 2 题不该被算成不合规 */
      return Math.abs(want - have) > 1 ? [`${row.level} 要求约 ${want} 题、实为 ${have} 题`] : []
    })
    items.push({
      aspect: '难度配比',
      level: drift.length > 1 ? 'warn' : 'ok',
      message: drift.length ? drift.join('；') : `各档题量与要求的占比基本相符（${facts.difficultySpread.map((r) => `${r.level} ${r.count} 题`).join('、')}）`,
    })
  }

  /* 4. 知识点覆盖 */
  items.push({
    aspect: '知识点覆盖',
    level: facts.missingKnowledge.length ? 'warn' : 'ok',
    message: facts.missingKnowledge.length
      ? `以下考纲知识点卷面里没有出现：${facts.missingKnowledge.join('、')}`
      : input.requirement.knowledge.length
        ? '要求的考查知识点卷面均有覆盖'
        : '要求未限定考查知识点，跳过',
  })

  /* 5. 内容相符：这一条本地只能做最浅的一层（学科年级字段对不对得上），
        跑题/超纲要靠 AI 那一轮 —— 说清楚边界，别让用户以为这里已经判过了 */
  const wrongScope = input.questions.filter(
    (row) => row.type && !input.requirement.structure.some((want) => want.type === row.type),
  )
  items.push({
    aspect: '内容相符',
    level: wrongScope.length ? 'warn' : 'ok',
    message: wrongScope.length
      ? `第 ${wrongScope.map((row) => row.no).join('、')} 题的题型不在本次组卷要求内`
      : '题干是否跑题、是否超纲需要点「AI 检测」判，本地只核对了题型归属',
  })

  /* 6. 入库与完整度：交出去会被审核退回的两件事 */
  const trouble: string[] = []
  if (facts.unapproved.length) trouble.push(`第 ${facts.unapproved.join('、')} 题还未入库（含 AI 新生成的待审题）`)
  if (facts.incomplete.length) {
    trouble.push(facts.incomplete.map((row) => `第 ${row.no} 题缺${row.missing}`).join('、'))
  }
  items.push({
    aspect: '入库与完整度',
    level: facts.unapproved.length ? 'error' : facts.incomplete.length ? 'warn' : 'ok',
    message: trouble.length ? trouble.join('；') : '全部题目均已入库，答案与解析齐全',
  })

  return items
}

/** 由逐条结论汇总总判定：有 error 就是 fail，只有 warn 是 warn */
export function overallOf(items: CollabCheckItem[]): CollabCheckOverall {
  if (items.some((row) => row.level === 'error')) return 'fail'
  return items.some((row) => row.level === 'warn') ? 'warn' : 'pass'
}

/* ===== AI 那一轮 ===== */

interface RawCollabCheck {
  overall?: string
  items?: Array<{ aspect?: string; level?: string; message?: string }>
}

async function callDeepseek(input: CollabPaperCheckInput): Promise<CollabCheckReport> {
  const facts = deriveFacts(input)
  const messages = [
    { role: 'system' as const, content: COLLAB_CHECK_SYSTEM_PROMPT },
    {
      role: 'user' as const,
      content: buildCollabCheckUserPrompt({ ...input, ...facts }),
    },
  ]
  let lastError: unknown = null
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const { content, usage } = await chatCompletion(messages, { json: true, maxTokens: 4096, temperature: 0.2 })
      return parseReport(content, usage.totalTokens)
    } catch (error) {
      lastError = error
    }
  }
  throw lastError instanceof Error ? lastError : new Error('AI 检测失败，请稍后重试')
}

function parseReport(content: string, tokens: number): CollabCheckReport {
  const raw = extractJsonObject(content) as RawCollabCheck
  const items: CollabCheckItem[] = Array.isArray(raw.items)
    ? raw.items
        .filter((row) => row && typeof row === 'object')
        .map((row) => ({
          aspect: typeof row.aspect === 'string' ? row.aspect : '综合',
          level: row.level === 'error' ? 'error' : row.level === 'warn' ? 'warn' : 'ok',
          message: typeof row.message === 'string' ? row.message : '',
        }))
    : []
  /* 模型没给结论时不要假装通过：空 items 按 warn 报，让人知道这一轮没拿到东西 */
  const overall: CollabCheckOverall = items.length
    ? raw.overall === 'fail'
      ? 'fail'
      : raw.overall === 'warn'
        ? 'warn'
        : raw.overall === 'pass'
          ? 'pass'
          : overallOf(items)
    : 'warn'
  return { engine: 'deepseek', overall, items: items.length ? items : [{ aspect: '综合', level: 'warn', message: '模型没有返回可用的结论，请重试' }], tokens }
}

/**
 * 提交前的 AI 合规检测。
 *
 * 未配置密钥时返回本地核对结果 + 一句说明。**刻意不编造 AI 结论** ——
 * 演示环境里让人以为「AI 看过了」，比明说「没配密钥」危险得多。
 */
export async function checkCollabPaperByAi(input: CollabPaperCheckInput): Promise<CollabCheckReport> {
  const items = checkCollabRequirement(input)
  if (!isDeepseekConfigured()) {
    return {
      engine: 'mock',
      overall: overallOf(items),
      items: [...items, { aspect: '说明', level: 'ok', message: '未配置 AI 密钥，以上为本地规则核对的结果（未调用模型）' }],
      tokens: 0,
    }
  }
  return callDeepseek(input)
}
