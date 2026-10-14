/**
 * 内联公式输入框的命令候选（敲 `\` 或 `/` 后在输入框下方弹出的「LaTeX 源码 + 预览」列表）。
 *
 * 数据源就是公式助手符号面板的 `FORMULA_CATEGORIES` —— 面板点选与命令检索共用同一份符号定义，
 * 以后加符号只改一处；本文件只做「展平 + 检索字段」的加工，不另立一份符号表。
 *
 * 检索口径（三条都命中即算匹配，按优先级打分排序）：
 * - `label`（中文名）：敲 `分数`、`积分` 能找到；
 * - `latex` 的命令名（去掉开头的 `\`）：敲 `\fra`、`/fra` 都能找到 —— 触发那个字符由调用方
 *   （FormulaInlineInput 的 commandEntry）吃掉，传进来的 query 已经是纯命令名；
 * - `category`（分类名）：敲 `化学` 能把整个化学分类的常用项列出来。
 *
 * 去重按 `latex`：同一个命令会在多个分类里重复出现（如 `\mid` 既在「基础数学符号」又在「关系与比较」），
 * 不去重的话候选里会出现两条一模一样的结果，上下键翻半天还是同一个符号。
 *
 * 只收「符号 + 可填模板」：内置的成篇公式（含等式的定理、化学反应式、多行环境）不进联想，
 * 判据见 isBuiltinFormula —— 那些一律长到一行放不下，会把候选列表撑成几屏，
 * 真要找它们应该去公式编辑器的公式库（那边有名字、能搜、空间也够）。
 */
import { FORMULA_CATEGORIES, PLACEHOLDER } from '../formula-symbols'

export interface LatexSuggestion {
  /** 插入到输入框的源码（模板类条目含 `\square` 占位符） */
  latex: string
  /** 候选右侧的预览源码：模板类条目用「填好样子的示例」，否则与 latex 相同 */
  preview: string
  /** 中文名，同时作为候选的说明文字 */
  label: string
  /** 所属分类名，用于 `/化学` 这类按分类检索 */
  category: string
}

/** 全部候选：按分类顺序展平，latex 去重（保留首个出现的） */
const ALL_SUGGESTIONS: LatexSuggestion[] = (() => {
  const seen = new Set<string>()
  const rows: LatexSuggestion[] = []
  for (const category of FORMULA_CATEGORIES) {
    for (const item of category.items) {
      if (seen.has(item.latex)) continue
      seen.add(item.latex)
      rows.push({
        latex: item.latex,
        preview: item.preview ?? item.latex,
        label: item.label,
        category: category.title,
      })
    }
  }
  return rows
})()

/**
 * 判一条候选该不该进联想 —— 联想只收「符号 + 短模板」。
 *
 * 三条判据，从硬到软：
 * 1. **源码长度**：超过 `MAX_SUGGEST_LENGTH` 一律不收。候选行的源码列宽 250px、
 *    等宽 12px 每字符约 7.2px，26 字符刚好一行放得下 —— 上限就卡在这，
 *    保证任何一条候选都不会折成两行把列表撑长（需求：「不然显示不下」）。
 * 2. **带 `\square` 的**：是可填模板，留（`\frac{\square}{\square}`、`\int_{\square}^{\square}` 这些
 *    正是边敲边补最想要的，长度也已由第 1 条兜住）。
 * 3. **不带占位符的**：短的（`\alpha`、`\times`、`\frac{1}{2}`）都是符号，留；
 *    中等的再看到底是符号还是公式 —— 带等号、反应箭头、多行环境的就是**内置成篇公式**
 *    （`a^{2}+b^{2}=c^{2}`、`\ce{Fe + CuSO4 -> FeSO4 + Cu}`），那些在公式编辑器的公式库里翻。
 *
 * 只用于**联想**：公式编辑器的符号面板不过滤（那边是翻着找、有名字有搜索，不差空间）。
 */
const MAX_SUGGEST_LENGTH = 26
const FORMULA_MARKERS = ['=', '->', '<=>', '\\\\', '\\begin{']
/** 不带占位符时，短到这个长度以内的都当符号看，不再追究结构 */
const SYMBOL_MAX_LENGTH = 14

function isSuggestable(latex: string): boolean {
  if (latex.length > MAX_SUGGEST_LENGTH) return false
  if (latex.includes(PLACEHOLDER)) return true
  if (latex.length <= SYMBOL_MAX_LENGTH) return true
  return !FORMULA_MARKERS.some((mark) => latex.includes(mark))
}

/** 可进联想的候选：符号 + 短模板（滤掉内置成篇公式和过长的模板） */
const SUGGESTABLE: LatexSuggestion[] = ALL_SUGGESTIONS.filter((row) => isSuggestable(row.latex))

/** 按 latex 取候选（常用项白名单用它把 latex 映射回完整条目，避免手写第二份文案） */
const BY_LATEX = new Map(ALL_SUGGESTIONS.map((row) => [row.latex, row]))

/**
 * 空查询（刚敲下 `\` 或 `/`、还没输入过滤词）时的默认候选：K12 录题最高频的十来项。
 * 顺序即展示顺序 —— 第一个是默认选中项，回车直接落到的就是它，所以把分数模板放最前。
 */
const COMMON_LATEX: string[] = [
  `\\frac{${PLACEHOLDER}}{${PLACEHOLDER}}`,
  `x^{${PLACEHOLDER}}`,
  `\\sqrt{${PLACEHOLDER}}`,
  `\\left( ${PLACEHOLDER} \\right)`,
  '\\pm',
  '\\times',
  '\\leq',
  '\\geq',
  '\\neq',
  '\\pi',
  '\\theta',
  '\\alpha',
  `\\vec{${PLACEHOLDER}}`,
  '\\ce{H2O}',
  '\\ce{->}',
  `\\int_{${PLACEHOLDER}}^{${PLACEHOLDER}}`,
  `\\sum_{${PLACEHOLDER}=${PLACEHOLDER}}^{${PLACEHOLDER}}`,
  `\\lim_{x \\to ${PLACEHOLDER}}`,
]

/* 也过一遍 isSuggestable：白名单是自己维护的，将来往里面塞了长公式也不至于漏到联想里 */
const COMMON_SUGGESTIONS: LatexSuggestion[] = COMMON_LATEX.map((latex) => BY_LATEX.get(latex)).filter(
  (row): row is LatexSuggestion => row !== undefined && isSuggestable(row.latex),
)

/**
 * 取 LaTeX 的命令名：开头的 `\word`（`\frac{1}{2}` → frac）。
 * 没有反斜杠的写法（`x^{n}`）取首个字母串，敲 `\x`、`/x` 也能命中。
 * 比较时一律小写、不带反斜杠 —— 触发字符（`\` 或 `/`）已经在调用方被剥掉了。
 */
function commandOf(latex: string): string {
  const match = /^\\?([a-zA-Z]+)/.exec(latex)
  return match ? match[1].toLowerCase() : ''
}

/**
 * 命令候选检索。
 *
 * @param query 触发字符（`\` 或 `/`）之后、光标之前的文本（可能为空串）
 * @param limit 最多返回多少条（默认 8 —— 再多个体会盖住编辑器正文）
 */
export function matchLatexSuggestions(query: string, limit = 8): LatexSuggestion[] {
  const raw = query.trim()
  if (!raw) return COMMON_SUGGESTIONS.slice(0, limit)

  const lower = raw.toLowerCase()
  const scored: Array<{ row: LatexSuggestion; score: number; template: number; blanks: number }> = []
  for (const row of SUGGESTABLE) {
    const command = commandOf(row.latex)
    let score = 0
    if (row.label.startsWith(raw)) score = 100
    else if (row.label.includes(raw)) score = 80
    /* 命令名整词命中 > 前缀命中 > 包含命中：输入 frac 时 \frac 要排在 \cfrac 前面 */
    else if (command === lower) score = 90
    else if (command.startsWith(lower)) score = 70
    else if (command.includes(lower)) score = 50
    else if (row.category.includes(raw)) score = 30
    if (score > 0) {
      scored.push({
        row,
        score,
        template: row.latex.includes(PLACEHOLDER) ? 1 : 0,
        blanks: row.latex.split(PLACEHOLDER).length - 1,
      })
    }
  }

  /* 排序：命中优先级 → 带占位符的模板优先 → 占位符多的在前 → 源码短的在前。
     中间两条是「输入 frac 想插的显然是能填的 \frac{□}{□}，而不是 \frac{□}{100} 或 \frac{1}{2}」：
     先排除写死的常量项，再让可填位置最多的通用模板胜出；
     最后一条让输入 x 时先看到 x^{□} 而不是更长的变体。 */
  scored.sort(
    (a, b) =>
      b.score - a.score ||
      b.template - a.template ||
      b.blanks - a.blanks ||
      a.row.latex.length - b.row.latex.length,
  )
  return scored.slice(0, limit).map((item) => item.row)
}
