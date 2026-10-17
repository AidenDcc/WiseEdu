/**
 * AI 生成结果的解析与归一化。
 *
 * Deepseek 产出的是「约定格式的 JSON + 字符串字段里的 LaTeX / SVG」，而系统内部
 * 存储的是富文本 HTML（Tiptap 约定：公式为 <span data-type="inline-math" data-latex>，
 * 见 packages/shared/src/utils/richtext.ts）。模型输出是不可信输入，这里负责：
 * 1. 从模型回复中抠出 JSON 并做结构校验（缺字段/类型错直接判失败重试）；
 * 2. 把 $...$ / $$...$$ LaTeX 转成公式节点 HTML（RichTextViewer 负责 KaTeX 渲染）；
 * 3. 把 diagram 里的 SVG 先白名单净化、再打包成 data:image/svg+xml 的 <img> —
 *    走 <img> 而不是内联 <svg>，是因为全局富文本白名单 sanitizeRichHtml 不含 svg 标签，
 *    内联 SVG 会在渲染前被解包销毁；data URL 只允许图片协议，天然挡掉脚本注入；
 * 4. 普通文本先 HTML 转义再分段，杜绝把模型输出的裸标签当 HTML 解析。
 */
import { isRichContent, sanitizeRichHtml } from '@aiteach/shared'
import type { GeneratedQuestion } from '@aiteach/shared'
import type { UserPromptParams } from './ai-prompts'

/* ==================== JSON 提取与结构校验 ==================== */

/** 从模型回复中定位 JSON 对象：容忍 ```json 围栏与首尾散文 */
export function extractJsonObject(text: string): Record<string, unknown> {
  let source = text.trim()
  const fence = source.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fence) source = fence[1].trim()
  const start = source.indexOf('{')
  const end = source.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('AI 未返回 JSON 内容')
  let parsed: unknown
  try {
    parsed = JSON.parse(source.slice(start, end + 1))
  } catch {
    throw new Error('AI 返回的 JSON 无法解析')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('AI 返回的 JSON 结构不正确')
  }
  return parsed as Record<string, unknown>
}

interface RawQuestion {
  stem: string
  options: string[]
  answer: string
  analysis: string
  knowledge: string[]
  difficulty: string
  /** 拍照识别场景模型判定的学科 / 年级（AI 出题场景不存在） */
  subject?: string
  grade?: string
  diagram: string | null
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []
}

/** 单题字段校验，不合格抛错交由上层重试（比静默丢弃更安全，避免数量缺斤短两） */
function toRawQuestion(value: unknown, index: number): RawQuestion {
  if (!value || typeof value !== 'object') throw new Error(`第 ${index + 1} 题不是对象`)
  const q = value as Record<string, unknown>
  const stem = asString(q.stem).trim()
  if (!stem) throw new Error(`第 ${index + 1} 题题干为空`)
  const difficulty = asString(q.difficulty)
  if (!['容易', '中等', '困难'].includes(difficulty)) {
    throw new Error(`第 ${index + 1} 题难度非法：${difficulty || '(空)'}`)
  }
  return {
    stem,
    options: asStringArray(q.options).map((s) => s.trim()).filter(Boolean).slice(0, 6),
    answer: asString(q.answer).trim(),
    analysis: asString(q.analysis).trim() || '（AI 未提供解析，请人工补充）',
    knowledge: asStringArray(q.knowledge).map((s) => s.trim()).filter(Boolean).slice(0, 3),
    difficulty,
    subject: asString(q.subject).trim() || undefined,
    grade: asString(q.grade).trim() || undefined,
    diagram: typeof q.diagram === 'string' && q.diagram.includes('<svg') ? q.diagram : null,
  }
}

/* ==================== 文本字段 → 富文本 HTML ==================== */

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] as string
  ))
}

/**
 * 富文本形态的字段里，散落的 `$...$` 也要还原成公式节点。
 *
 * 模型只被要求「按 FORMULA_RULES 用 $ 写公式」，它并不知道我们内部还有公式节点这回事 ——
 * 于是「HTML 结构 + `$latex$` 公式」的混搭是常态（题干整段抄回来，公式却改写成 `$` 形式）。
 * 只保留结构不做这一步，公式就会以源码形式显示在界面上。
 *
 * 为什么不能对整段 HTML 直接跑正则：`data-latex` 里可能出现成对 `$`，正则替换会把公式源码
 * 一起吞进新节点的属性值。DOMParser 走文本节点是唯一能把「正文」与「标签属性」分开的做法。
 * `$$...$$` 也按行内节点落 —— 检测结果里一段话中出现块级公式本就罕见，而 `<div>` 落进 `<p>`
 * 反而会撑破段落结构。
 */
const MATH_IN_TEXT = /\$\$([\s\S]+?)\$\$|(?<!\$)\$([^$\n]+?)\$(?!\$)/g

function mathInTextNodes(html: string): string {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT)
  const nodes: Text[] = []
  while (walker.nextNode()) nodes.push(walker.currentNode as Text)
  nodes.forEach((node) => {
    const text = node.nodeValue ?? ''
    if (!text.includes('$')) return
    /* test 会用掉 lastIndex，两处都归零后再用（同一个全局正则） */
    MATH_IN_TEXT.lastIndex = 0
    if (!MATH_IN_TEXT.test(text)) return
    MATH_IN_TEXT.lastIndex = 0
    const holder = doc.createElement('span')
    /* 文本节点取出来时实体已解码，拼回 innerHTML 必须重新转义；转义后 `$` 的位置不变，
       公式仍能配对成功，latex 部分也就自带正确的属性编码（`&lt;` / `&quot;`） */
    holder.innerHTML = escapeHtml(text).replace(
      MATH_IN_TEXT,
      (_match, block: string | undefined, inline: string | undefined) =>
        `<span data-type="inline-math" data-latex="${(block ?? inline ?? '').trim()}"></span>`,
    )
    node.replaceWith(...Array.from(holder.childNodes))
  })
  return doc.body.innerHTML
}

/**
 * 把单个文本字段转成富文本 HTML。
 *
 * 模型给的字段有两种形态，都必须接住（这是本函数唯一的分支点）：
 * - **纯文本**（AI 出题 / 拍照识别 / 文档识别的常态）：先转义、再还原公式、最后按换行分段。
 *   转义是安全底线 —— 模型输出的裸标签不能被当 HTML 解析。
 * - **本身就是富文本 HTML**（AI 检测的常态）：检测的入参就是当前表单的富文本（题干 / 选项 /
 *   共用材料 / 解析里都含 `<p>`、公式节点、加粗），提示词又要求「即使无需修正也原样转写一遍」，
 *   模型于是把这些标签照抄回输出。若照旧转义，界面上就会出现字面的 `</p><p>` ——
 *   组合题的「共用题干 / 材料」建议行上真翻过这个车。这里改为净化后保结构，段落与公式都不丢。
 *
 * 判据用 `isRichContent`（要求容器标签**成对闭合**），所以纯文本里孤立的 `<b>`（如「已知 a<b>c」）
 * 仍走转义分支，行为与改造前逐字节一致。
 */
export function richField(text: string): string {
  /* 模型在 JSON 里双转义换行（\\n），parse 后变成字面「\n」两个字符，若不处理会原样显示。
     负向断言 (?![a-zA-Z]) 保护 LaTeX 命令：\ne \not \tan \times \theta 等后跟字母的不动 */
  const normalized = text.replace(/\\n(?![a-zA-Z])/g, '\n').replace(/\\t(?![a-zA-Z])/g, ' ')
  /* 已是富文本：净化（白名单）保结构，再把里面残留的 `$...$` 落成公式节点 */
  if (isRichContent(normalized)) return mathInTextNodes(sanitizeRichHtml(normalized))
  let html = escapeHtml(normalized)
  /* 块级公式独立成行；inline 用非贪婪且禁止跨 $ 配对（避免 `$a$ 和 $b$` 被整段吞掉）。
     注意：latex 内容取自上方已转义的 html，禁止再次 escapeHtml ——
     二次转义会把 &lt; 变成 &amp;lt;，KaTeX 会把它渲染成字面量 「&lt;」。 */
  html = html.replace(/\$\$([\s\S]+?)\$\$/g, (_m, latex: string) =>
    `<div data-type="block-math" data-latex="${latex.trim()}"></div>`)
  html = html.replace(/(?<!\$)\$([^$\n]+?)\$(?!\$)/g, (_m, latex: string) =>
    `<span data-type="inline-math" data-latex="${latex.trim()}"></span>`)
  /* 块级公式本身已带换行语义，其余按行聚合成段落 */
  const blocks = html.split(/\n{2,}|\n/)
  return blocks
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => (line.startsWith('<div data-type="block-math"') ? line : `<p>${line}</p>`))
    .join('')
}

/* ==================== SVG 净化与打包 ==================== */

/** 允许出现在题目配图里的 SVG 标签与属性（与提示词中的约定一致） */
const SVG_TAGS = new Set([
  'svg', 'g', 'line', 'rect', 'circle', 'ellipse', 'polygon', 'polyline',
  'path', 'text', 'tspan', 'defs', 'marker', 'title', 'desc',
])
const SVG_ATTRS = new Set([
  'viewBox', 'width', 'height', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy',
  'r', 'rx', 'ry', 'd', 'points', 'fill', 'stroke', 'stroke-width', 'stroke-dasharray',
  'stroke-linecap', 'stroke-linejoin', 'fill-opacity', 'stroke-opacity', 'opacity',
  'transform', 'font-size', 'font-family', 'text-anchor', 'marker-end', 'orient', 'refX', 'refY',
])

/**
 * SVG 白名单净化。剥离一切脚本能力与事件属性；根节点 width/height 一律剥掉，
 * 显示尺寸由 <img> 标签上的 width/height 属性承担（见 diagramImg 的默认尺寸）。
 *
 * 返回净化后的字符串与 viewBox 宽高 —— 默认尺寸要按 viewBox 的原始纵横比换算，
 * 否则高瘦的几何图（如 200×400）会被压成扁条。
 */
function sanitizeSvg(svg: string): { svg: string; vbWidth: number; vbHeight: number } {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml')
  if (doc.querySelector('parsererror')) throw new Error('AI 生成的图形不是合法 SVG')
  const root = doc.documentElement
  if (root.tagName.toLowerCase() !== 'svg') throw new Error('AI 生成的图形缺少 <svg> 根节点')

  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_ELEMENT)
  const elements: Element[] = []
  while (walker.nextNode()) elements.push(walker.currentNode as Element)
  for (const el of [...elements, root]) {
    const tag = el.tagName.toLowerCase()
    if (!SVG_TAGS.has(tag)) {
      el.remove()
      continue
    }
    for (const attr of [...el.attributes]) {
      const name = attr.name
      if (name.toLowerCase().startsWith('on')) el.removeAttribute(name)
      else if (!SVG_ATTRS.has(name)) el.removeAttribute(name)
    }
  }
  /* 兜底白底：没有背景矩形的 SVG 在深色主题下可能透明，补一个最底层白底 */
  if (!root.querySelector('rect[fill]')) {
    const bg = doc.createElementNS('http://www.w3.org/2000/svg', 'rect')
    bg.setAttribute('width', '100%')
    bg.setAttribute('height', '100%')
    bg.setAttribute('fill', '#ffffff')
    root.insertBefore(bg, root.firstChild)
  }
  /* viewBox 是默认尺寸的唯一纵横比来源，先读出再剥属性 */
  const vb = (root.getAttribute('viewBox') ?? '').split(/[\s,]+/).map(Number)
  const vbWidth = vb.length === 4 && vb[2] > 0 ? vb[2] : 0
  const vbHeight = vb.length === 4 && vb[3] > 0 ? vb[3] : 0
  root.removeAttribute('width')
  root.removeAttribute('height')
  return { svg: new XMLSerializer().serializeToString(root), vbWidth, vbHeight }
}

/** 识别配图默认显示尺寸：宽 400（试卷图的标准阅读宽度，矢量图放大不失真），
    超高图按高 360 反推宽，避免几何图占满半屏 */
function diagramSize(vbWidth: number, vbHeight: number): { width: number; height: number } {
  if (!vbWidth || !vbHeight) return { width: 400, height: 240 }
  const height = Math.round((400 * vbHeight) / vbWidth)
  if (height <= 360) return { width: 400, height }
  return { width: Math.round((360 * vbWidth) / vbHeight), height: 360 }
}

/** 净化后的 SVG → data URL <img>（带默认宽高，替换题干中的 【图】占位符） */
function diagramImg(svg: string): string {
  const clean = sanitizeSvg(svg)
  const size = diagramSize(clean.vbWidth, clean.vbHeight)
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(clean.svg)}`
  return `<img src="${url}" alt="题目配图" width="${size.width}" height="${size.height}" />`
}

/* ==================== 汇总入口 ==================== */

interface NormalizeOptions {
  /** 最多保留题数（出题=用户指定数量；拍照识别防御性封顶） */
  maxCount: number
  /** 知识点白名单（出题必填）；识别场景传 undefined，保留模型自判知识点 */
  allowedKnowledge?: string[]
  /**
   * 主观题（无选项）的 answer 是否转富文本：出题仅在题型为「解答题」时开启
   * （填空题答案保持纯文本，手动编辑页按纯文本回填）；拍照识别恒为 true，
   * 校对区用编辑器承载答案，$...$ LaTeX 还原为标准公式节点。
   */
  richAnswer?: boolean
}

/** 模型回复 → 归一化后的题目数组（出题与拍照识别共用的核心管线） */
export function normalizeQuestionList(content: string, options: NormalizeOptions): GeneratedQuestion[] {
  const parsed = extractJsonObject(content)
  const rawList = parsed.questions
  if (!Array.isArray(rawList) || rawList.length === 0) throw new Error('AI 返回中缺少 questions 数组')

  return rawList.slice(0, options.maxCount).map((value, i): GeneratedQuestion => {
    const raw = toRawQuestion(value, i)
    let stemHtml = richField(raw.stem)
    if (raw.diagram) {
      try {
        const img = diagramImg(raw.diagram)
        stemHtml = stemHtml.includes('【图】')
          ? stemHtml.split('【图】').join(img)
          : `${stemHtml}<p>${img}</p>`
      } catch {
        /* 图形非法时降级为无图题干，不拖垮整批题目 */
      }
    }
    /* 知识点兜底：有白名单时模型自造名回落到用户已选知识点，保证与筛选体系一致 */
    let knowledge = raw.knowledge
    if (options.allowedKnowledge) {
      const allowed = options.allowedKnowledge
      knowledge = knowledge.filter((k) => allowed.includes(k))
      if (!knowledge.length) knowledge = [...allowed.slice(0, Math.min(2, allowed.length))]
    }

    return {
      id: `ai_${Date.now()}_${i}`,
      stem: stemHtml,
      options: raw.options.map((opt) => richField(opt)),
      /* 客观题答案是选项字母保持纯文本；主观题答案转富文本，LaTeX 公式还原为公式节点 */
      answer: raw.options.length || !options.richAnswer ? raw.answer : richField(raw.answer),
      analysis: richField(raw.analysis),
      knowledge,
      difficulty: raw.difficulty,
      subject: raw.subject,
      grade: raw.grade,
    }
  })
}

/* ==================== 材料组合题修正版（逐题补丁） ==================== */

/**
 * 一道子题的**修正补丁**：只带模型确实给出了的字段。
 *
 * 与 `GeneratedQuestion` 的差别有两处，都是为了「修正」这个语义：
 * - 字段全部可缺省 —— 缺字段表示「这一项没问题，按原题保留」，而不是「输出不合格」；
 * - `index` 指明补的是哪一道子题，由调用方按原题下标合并（子题数量、顺序以输入为准）。
 */
export interface SubQuestionCorrection {
  /** 子题下标（0 起，与输入子题的顺序一致） */
  index: number
  type?: string
  difficulty?: string
  knowledge?: string[]
  stem?: string
  options?: string[]
  answer?: string
  analysis?: string
}

/**
 * 组合题修正版的 `subQuestions` → 逐题补丁列表。
 *
 * 与 `normalizeQuestionList` 的取向**相反**：那条是「生成」，一题不合格就该整批判失败重试
 * （宁可重来也不能少给题）；这里是「修正」，模型漏写一个字段只意味着这一项按原题保留，
 * 为它把整份报告判失败会让一次检测（含 token 消耗）白白作废，故一律宽进。
 *
 * 下标解析：模型报下标的起点有两种（提示词要求 1 起，但偶尔整批写成 0 起），逐个猜会把整批补丁
 * 整体错位一格、把 A 题的修正写到 B 题上。所以**先看整批的起点**：出现 `index: 0` 就按整批 0 起算，
 * 否则按 1 起算；没报 index 的那条退回它在数组里的位置。两种写法都能落到正确的那道子题上。
 * 返回 null 表示模型压根没给这个数组（本次没有逐题修正可回写）。
 */
export function normalizeSubCorrections(value: unknown): SubQuestionCorrection[] | null {
  if (!Array.isArray(value)) return null
  const rows = value.filter((raw): raw is Record<string, unknown> => Boolean(raw) && typeof raw === 'object')
  const declared = rows
    .map((row) => Number(row.index))
    .filter((n) => Number.isInteger(n) && n >= 0)
  /* 整批的起点：只有出现 0 才判定为 0 起（1 起时最小下标必然是 1） */
  const base = declared.length && Math.min(...declared) === 0 ? 0 : 1

  const patches: SubQuestionCorrection[] = []
  rows.forEach((raw, position) => {
    const declaredIndex = Number(raw.index)
    const index = Number.isInteger(declaredIndex) && declaredIndex >= base ? declaredIndex - base : position
    const patch: SubQuestionCorrection = { index }

    const stem = asString(raw.stem).trim()
    if (stem) patch.stem = richField(stem)
    const type = asString(raw.type).trim()
    if (type) patch.type = type
    const difficulty = asString(raw.difficulty).trim()
    if (['容易', '中等', '困难'].includes(difficulty)) patch.difficulty = difficulty
    const knowledge = asStringArray(raw.knowledge).map((s) => s.trim()).filter(Boolean).slice(0, 3)
    if (knowledge.length) patch.knowledge = knowledge
    const options = asStringArray(raw.options).map((s) => s.trim()).filter(Boolean).slice(0, 6)
    if (options.length) patch.options = options.map((opt) => richField(opt))
    const answer = asString(raw.answer).trim()
    /* 客观题答案是选项字母，保持纯文本；主观题答案转富文本（公式还原为公式节点）——
       与 normalizeQuestionList 的 richAnswer 口径一致 */
    if (answer) patch.answer = options.length ? answer : richField(answer)
    const analysis = asString(raw.analysis).trim()
    if (analysis) patch.analysis = richField(analysis)

    patches.push(patch)
  })
  return patches
}

/**
 * 模型回复 → GeneratedQuestion[]（AI 出题入口）。
 * 归一化后仍要再过一遍 sanitizeRichHtml（采纳入库时 mock 层会做），
 * 这里的产出只需保证结构合法 + 公式节点约定正确。
 */
export function parseQuestionResponse(content: string, params: UserPromptParams): GeneratedQuestion[] {
  return normalizeQuestionList(content, {
    maxCount: params.count,
    allowedKnowledge: params.knowledge,
    /* 只有解答题用富文本编辑器承载答案；填空题答案走纯文本空值回填 */
    richAnswer: params.type === '解答',
  })
}
