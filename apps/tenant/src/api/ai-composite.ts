/**
 * 材料组合题「被拆开」的还原（图片识题 / 文档识题共用的兜底管线）。
 *
 * ## 要解决什么
 *
 * 卷面上的一段材料 / 短文 / 图表 + 若干小问（「（1）（2）（3）」「①②③」）在**卷面上是一个题号**，
 * 也就是系统里的「材料组合题」——一道题、多个作答单位。但多模态模型转录时很容易把它按小问
 * 拆成多条 questions 记录（尤其现代文阅读、文言文阅读、英语阅读、材料分析题），
 * 结果一张图识别出 4 道「题」，每道都重复一遍材料，教师得手工再合回去。
 *
 * 提示词里已经写明「一个题号 = 一条记录」（见 ai-prompts 的 SCHEMA_RULES / PHOTO_SYSTEM_PROMPT），
 * 但提示词只是软约束：模型仍会偶发拆题。这里是**确定性的兜底**，在归一化之前把拆开的那几条
 * 重新粘成一条。
 *
 * ## 判定（宁可漏合，不可错合）
 *
 * 只有「后一条的题干以**小问编号**开头，且这个编号正好接上前一条已出现过的最大编号 +1」才合并
 * （「（1）→（2）→（3）」连成一条）。错合的代价比漏合大得多：把两道独立题粘成一道，
 * 教师得手工拆回来，且答案/解析已经被拼成一段；漏合只是保持原来的样子。
 * 因此这里不放宽到「以（1）开头就合并」，只有前一条**完全没有小问编号、但明显是一段材料 /
 * 引导语**（无选项、含「阅读 / 材料 / 回答下列 / 完成下列」等字样）时，才把「（1）」当作第一条小问并进去。
 *
 * 另外三条同义约束（都是零误判的）：
 * - 学科不一致不合并（同一个模型输出里两题的 subject 不同，必然不是同一条组合题）；
 * - 前一条的编号已经到 n 而后一条又从 1 开始时一律不动（跨题、跨材料）；
 * - 后一条不能带自己的选项前缀冲突 —— 合并时选项会被并进题干（见 `withOptions`），因为
 *   合并后的题只能有一个 options 数组，而组合题的每个小问可能是各自的选择题。
 *
 * ## 合并出来的形状
 *
 * ```text
 * stem：材料……  （去重后只留一份）
 *       （1）小问题干   A．选项  B．选项
 *       （2）小问题干
 * answer：（1）B  （2）……     ← 逐小问一条，与提示词要求的口径一致
 * analysis：（1）……  （2）……   ← 同上
 * options：[]                 ← 组合题不再有自己的选项
 * ```
 * 于是它在系统里落地为「一道题干较长的解答题」，教师在校对区可以继续改，也可以入库后
 * 在录题中心转成「材料组合题」结构（见 question-draft 的 category / subQuestions）。
 */

/** 解析兜底文案：单题解析为空时 ai-normalize 会填这句，合并时不该把它当成某个小问的解析堆上去 */
export const ANALYSIS_FALLBACK = '（AI 未提供解析，请人工补充）'

/** 圆圈序号（①~⑩），与 LEADING_MARK 的第二个分支保持同一顺序 */
const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩'

/** 行首小问编号：全 / 半角括号数字，或圆圈数字 */
const LEADING_MARK = /^(?:[（(]\s*(\d{1,2})\s*[）)]|([①②③④⑤⑥⑦⑧⑨⑩]))/

/** 题干内任意位置的小问编号（判断「前一条已经带到第几问」） */
const ANY_MARK = /[（(]\s*(\d{1,2})\s*[）)]|[①②③④⑤⑥⑦⑧⑨⑩]/g

/** 选项自带的字母前缀（「A．」「A.」「A、」），并进题干时要先剥掉再按位置重新编号 */
const OPTION_PREFIX = /^[A-F]\s*[.、．)）]\s*/

/** 判断「前一条是纯材料 / 引导语」的关键词（只在它没有小问编号时才用） */
const MATERIAL_HINT = /材料|阅读|短文|文段|语段|图表|下图|如图|根据|回答下列|完成下列|下面.{0,8}题|资料|情境|背景/

/** 行级去重时，重复部分至少要有这么多字才认定是「材料重复」，太少可能是巧合 */
const REPEAT_MIN_CHARS = 20
/** 单行材料重复的锚点长度（比较两题开头的这么多字符） */
const ANCHOR_LEN = 24

/**
 * 可合并的题目行。
 *
 * 与 ai-normalize 的 `RawQuestion` 结构一致（那边直接把它传进来），刻意不 import 那个类型：
 * 归一化层与本模块相互引用类型会绕成环，而结构一致已经够用（TS 结构化类型）。
 */
export interface MergeableRow {
  stem: string
  options: string[]
  answer: string
  analysis: string
  knowledge: string[]
  difficulty: string
  subject?: string
  grade?: string
  diagram: string | null
}

/* ==================== 小问编号解析 ==================== */

/** 题干行首的小问编号（「（2）」「②」）；不是以编号开头返回 null */
function leadingMarker(stem: string): number | null {
  const match = stem.replace(/^[\s\u3000]+/, '').match(LEADING_MARK)
  if (!match) return null
  if (match[1]) return Number(match[1])
  const index = CIRCLED.indexOf(match[2])
  return index >= 0 ? index + 1 : null
}

/** 题干里出现过的全部小问编号（按出现顺序） */
function markersIn(stem: string): number[] {
  const numbers: number[] = []
  for (const match of stem.matchAll(ANY_MARK)) {
    const value = match[1] ? Number(match[1]) : CIRCLED.indexOf(match[0]) + 1
    /* 只收 1~30：卷面来源标注里的「（2020）」这类四位年份不会被误判成编号 */
    if (value >= 1 && value <= 30) numbers.push(value)
  }
  return numbers
}

/** 前一条是否是一段「没有小问编号的纯材料 / 引导语」（只有这种才允许把「（1）」并进去） */
function isMaterialLead(row: MergeableRow): boolean {
  if (row.options.length) return false
  const text = row.stem.replace(/\s+/g, '')
  if (text.length < 12) return false
  return MATERIAL_HINT.test(text)
}

/** 学科不一致必然不是同一条组合题（模型在同一张图里可能跨学科，那更不该合并） */
function sameSubject(prev: MergeableRow, row: MergeableRow): boolean {
  return !prev.subject || !row.subject || prev.subject === row.subject
}

/** 命中的下一个小问：编号（用于给答案 / 解析打标签）与切掉重复材料后的正文 */
interface SubQuestionMatch {
  marker: number
  body: string
}

/**
 * 后一条是不是前一条的下一个小问；是的话返回「去掉重复材料后的正文 + 小问编号」。
 *
 * 编号必须**严格接上**（前一条的最大编号 +1）：这是「（1）（2）（3）连成一条」的唯一依据，
 * 也是不做误合并的底线。
 *
 * 注意取编号的位置：拆题时模型常给每条都补一遍材料，此时后一条的题干**以材料开头**，
 * 行首并不是编号 —— 所以先按前一条切掉重复材料，再看剩下的开头。
 * 若切完之后开头仍不是编号，说明这一刀切错了位置（可能把材料正文切掉了一截），
 * 此时一律不合并，宁可留着让人工处理。
 */
function asNextSubQuestion(prev: MergeableRow, row: MergeableRow): SubQuestionMatch | null {
  if (!sameSubject(prev, row)) return null
  const body = stripRepeatedMaterial(prev.stem, row.stem)
  const marker = leadingMarker(body)
  if (marker === null) return null

  const prevMarkers = markersIn(prev.stem)
  const prevMax = prevMarkers.length ? Math.max(...prevMarkers) : 0
  if (marker !== prevMax + 1) return null
  /* 前一条还没有任何编号：只有「明显是材料 / 引导语」才认这是它的第一问 */
  if (!prevMarkers.length && !isMaterialLead(prev)) return null
  return { marker, body }
}

/* ==================== 文本拼装 ==================== */

/** 按行切分（去空行、去行首尾空白）：材料与选项在模型输出里都是一行一段 */
function splitLines(text: string): string[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
}

/** 题干 + 选项并成一段（选项按位置重新编号为 A．B．C．…；已有字母前缀先剥掉，避免「A．A. xxx」） */
function withOptions(stem: string, options: readonly string[]): string {
  const text = stem.trim()
  if (!options.length) return text
  const lines = options.map((opt, i) => `${'ABCDEF'[i] ?? ''}．${opt.replace(OPTION_PREFIX, '').trim()}`)
  return `${text}\n${lines.join('\n')}`
}

/**
 * 去掉后一条里重复抄了一遍的材料。
 *
 * 拆题时模型常常给每条都补一遍材料，直接拼会出现「材料 / 材料 /（1）…（2）…」。
 * 先按行比对公共开头；材料写成一整行时行级比对对不上，退回到「开头 24 字相同 → 从第一个
 * 小问编号处切开」。都对不上就原样返回 —— 宁可材料重复一次（教师能删），也不能吞掉正文。
 */
function stripRepeatedMaterial(prevStem: string, childStem: string): string {
  const prevLines = splitLines(prevStem)
  const childLines = splitLines(childStem)
  if (!childLines.length) return childStem

  let matched = 0
  let index = 0
  while (index < prevLines.length && index < childLines.length && prevLines[index] === childLines[index]) {
    matched += childLines[index].length
    index += 1
  }
  if (index > 0 && matched >= REPEAT_MIN_CHARS) return childLines.slice(index).join('\n')

  const prevHead = prevLines[0] ?? ''
  const childHead = childLines[0] ?? ''
  if (prevHead.length >= ANCHOR_LEN && childHead.slice(0, ANCHOR_LEN) === prevHead.slice(0, ANCHOR_LEN)) {
    const at = childHead.search(/[（(]\s*\d{1,2}\s*[）)]|[①②③④⑤⑥⑦⑧⑨⑩]/)
    if (at > 0) return [childHead.slice(at), ...childLines.slice(1)].join('\n')
  }
  return childStem
}

/** 给小问的答案 / 解析打上「（n）」标签（已经自带标签的不重复加） */
function labeled(label: number, text: string): string {
  const clean = text.trim()
  if (!clean) return ''
  if (/^[（(]\s*\d{1,2}\s*[）)]/.test(clean)) return clean
  return `（${label}）${clean}`
}

/* ==================== 合并 ==================== */

/** 把后一条小问并进前一条：题干接续（材料去重、选项并入），答案与解析按小问打标签 */
function absorb(target: MergeableRow, child: MergeableRow, body: string, childLabel: number): void {
  /* 标签必须在改题干之前取：并进来的选项文本里也可能出现「（1）」 */
  const targetLabel = markersIn(target.stem)[0] ?? 1

  /* 目标题自己的选项也要并进题干：合并后的题只能有一个 options 数组 */
  if (target.options.length) {
    target.stem = withOptions(target.stem, target.options)
    target.options = []
  }
  target.stem = `${target.stem.trim()}\n${withOptions(body, child.options)}`.trim()

  target.answer = [labeled(targetLabel, target.answer), labeled(childLabel, child.answer)]
    .filter(Boolean)
    .join('\n')
  /* 兜底解析是「没有解析」，不是某个小问的解析 —— 堆上去只会让真解析更难读 */
  const childAnalysis = child.analysis.trim() === ANALYSIS_FALLBACK ? '' : child.analysis
  target.analysis = [labeled(targetLabel, target.analysis), labeled(childLabel, childAnalysis)]
    .filter(Boolean)
    .join('\n')

  target.knowledge = [...new Set([...target.knowledge, ...child.knowledge])].slice(0, 3)
  /* 配图一个字段只能放一张：前一条没有配图时接过后一条的，多出来的交给教师按需补 */
  if (!target.diagram && child.diagram) target.diagram = child.diagram
}

/** 复制一行（数组字段换新引用）：合并会就地改行，不能把调用方的对象改脏 */
function cloneRow<T extends MergeableRow>(row: T): T {
  return { ...row, options: [...row.options], knowledge: [...row.knowledge] }
}

/**
 * 把被拆开的小问粘回一道题（入口）。
 *
 * 逐行扫描：能接上前一条就接（编号严格 +1），否则作为新题留下。
 * 不改入参、不抛错 —— 它只是归一化管线里的一步，判错一行也不该拖垮整张图。
 */
export function mergeSplitCompositeRows<T extends MergeableRow>(rows: readonly T[]): T[] {
  const merged: T[] = []
  for (const row of rows) {
    const prev = merged[merged.length - 1]
    const match = prev ? asNextSubQuestion(prev, row) : null
    if (prev && match) {
      absorb(prev, row, match.body, match.marker)
      continue
    }
    merged.push(cloneRow(row))
  }
  return merged
}
