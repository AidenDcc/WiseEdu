/**
 * 纸张规格 + 试卷排版样式预设（预览弹窗「纸张 / 版数 / 排版样式」的可选项）。
 *
 * 每个预设是一组版式令牌：字体 / 字号 / 行距 / 题距 / 选项列数 / 卷面栏数 / 卷头样式 / 页边距。
 * 预览弹窗用同一组令牌做「隐藏测量层 → 贪心分页」的自动排版，
 * 所以这里凡是影响元素高度与换行的值，都必须能在测量层与实际卷面之间一一对应。
 *
 * 版面（版）概念：真实考卷用 8K / A3 大纸，一面（对折后的半张）印两版，
 * 阅读顺序是「先左版后右版」再翻面。所以纸张规格里带一个习惯版数，
 * 分页以「版」为单位装箱（每版可填高度 = 版心高），再按版数把若干版拼到一张纸面上。
 */

/** mm → CSS px（96dpi）；纸张尺寸换算的唯一出口 */
export const MM = 96 / 25.4

/** 版间距 px：版与版之间留白，印后对折 / 装订用 */
export const PANEL_GAP = 22
/** 版内双栏的栏间距 px */
export const COL_GAP = 18
/** 页脚（页码）占位高度 px */
const FOOT_H = 20

export type PaperSizeKey = 'A4' | '16K' | 'B4' | '8K-Z' | '8K-D' | 'A3' | '6K'

export interface PaperSize {
  key: PaperSizeKey
  name: string
  /** 纵向尺寸 mm */
  width: number
  height: number
  /** 该纸张的习惯版数：8K / A3 一面两版，6K 一面三版 */
  panels: 1 | 2 | 3
  /** 尺寸文字（纵向 mm） */
  mm: string
  /** 适用场景（纸张下拉里的一句话说明） */
  note: string
}

export const PAPER_SIZES: readonly PaperSize[] = [
  { key: 'A4', name: 'A4', width: 210, height: 297, panels: 1, mm: '210 × 297', note: '一面一版 · 随堂测 / 小卷' },
  { key: '16K', name: '16K', width: 195, height: 270, panels: 1, mm: '195 × 270', note: '一面一版 · 讲义 / 小测' },
  { key: 'B4', name: 'B4', width: 250, height: 353, panels: 1, mm: '250 × 353', note: '一面一版 · 期中期末' },
  { key: '8K-Z', name: '正度 8K', width: 270, height: 390, panels: 2, mm: '270 × 390', note: '一面两版 · 常用考卷' },
  { key: '8K-D', name: '大度 8K', width: 285, height: 420, panels: 2, mm: '285 × 420', note: '一面两版 · 标准考卷' },
  { key: 'A3', name: 'A3', width: 297, height: 420, panels: 2, mm: '297 × 420', note: '一面两版 · 仿真高考' },
  { key: '6K', name: '6K', width: 370, height: 390, panels: 3, mm: '370 × 390', note: '一面三版 · 大张卷' },
]

export type PaperOrientation = 'portrait' | 'landscape'

/** 卷头样式：简洁 / 表格式（姓名班级考号得分）/ 密封线（表格 + 装订线） */
export type PaperHeadStyle = 'simple' | 'form' | 'seal'

export interface PaperLayoutPreset {
  key: string
  name: string
  /** 一句话说明，样式卡片上展示 */
  desc: string
  /** 正文字体（题干、选项、答案） */
  bodyFont: string
  /** 标题字体（卷头、大题标题） */
  headFont: string
  /** 基准字号 px */
  fontSize: number
  lineHeight: number
  /** 块与块之间的纵向间距 px（分页累计时按此值计高） */
  gap: number
  /** 大题标题字号 px */
  sectionSize: number
  /** 卷头主标题字号 px */
  titleSize: number
  headStyle: PaperHeadStyle
  /** 分值位置：紧跟题号 / 题干末尾 */
  scoreStyle: 'inline' | 'trail'
  /** 选项排布列数 */
  optionColumns: 1 | 2
  /** 卷面双栏：客观题两栏并排，解答题通栏（仅单版纸张生效，见 paperGeometry） */
  twoColumn: boolean
  /** 解答题是否留答题空白 */
  answerSpace: boolean
  pageNumber: boolean
  /** 页边距 mm */
  margin: { top: number; right: number; bottom: number; left: number }
  /** 强调色（大题标题、分隔线） */
  accent: string
}

const SONG = '"Songti SC", SimSun, "Noto Serif SC", serif'
const HEI = '"Heiti SC", "Microsoft YaHei", "PingFang SC", sans-serif'
const KAI = '"Kaiti SC", KaiTi, STKaiti, serif'

export const PAPER_LAYOUTS: readonly PaperLayoutPreset[] = [
  {
    key: 'standard',
    name: '标准卷面',
    desc: '宋体正文 + 表格式卷头，通用考试卷',
    bodyFont: SONG,
    headFont: HEI,
    fontSize: 14,
    lineHeight: 1.75,
    gap: 12,
    sectionSize: 15,
    titleSize: 22,
    headStyle: 'form',
    scoreStyle: 'inline',
    optionColumns: 1,
    twoColumn: false,
    answerSpace: true,
    pageNumber: true,
    margin: { top: 20, right: 18, bottom: 18, left: 18 },
    accent: '#1c2434',
  },
  {
    key: 'compact',
    name: '紧凑省纸',
    desc: '小字号 + 选项双列，尽量少用纸',
    bodyFont: HEI,
    headFont: HEI,
    fontSize: 12.5,
    lineHeight: 1.5,
    gap: 7,
    sectionSize: 13,
    titleSize: 18,
    headStyle: 'simple',
    scoreStyle: 'inline',
    optionColumns: 2,
    twoColumn: false,
    answerSpace: true,
    pageNumber: true,
    margin: { top: 14, right: 14, bottom: 12, left: 14 },
    accent: '#1c2434',
  },
  {
    key: 'twocol',
    name: '双栏版面',
    desc: '客观题双栏并排，解答题通栏',
    bodyFont: SONG,
    headFont: HEI,
    fontSize: 12.5,
    lineHeight: 1.55,
    gap: 8,
    sectionSize: 13,
    titleSize: 19,
    headStyle: 'simple',
    scoreStyle: 'inline',
    optionColumns: 1,
    twoColumn: true,
    answerSpace: true,
    pageNumber: true,
    margin: { top: 16, right: 15, bottom: 14, left: 15 },
    accent: '#1c2434',
  },
  {
    key: 'gaokao',
    name: '高考仿真',
    desc: '密封线 + 装订线卷头，仿真考场卷',
    bodyFont: SONG,
    headFont: HEI,
    fontSize: 13.5,
    lineHeight: 1.6,
    gap: 10,
    sectionSize: 14,
    titleSize: 20,
    headStyle: 'seal',
    scoreStyle: 'inline',
    optionColumns: 2,
    twoColumn: false,
    answerSpace: true,
    pageNumber: true,
    margin: { top: 18, right: 16, bottom: 16, left: 24 },
    accent: '#111827',
  },
  {
    key: 'primary',
    name: '小学大字号',
    desc: '楷体大字号宽行距，低年级适用',
    bodyFont: KAI,
    headFont: HEI,
    fontSize: 16,
    lineHeight: 2,
    gap: 16,
    sectionSize: 17,
    titleSize: 24,
    headStyle: 'form',
    scoreStyle: 'inline',
    optionColumns: 1,
    twoColumn: false,
    answerSpace: true,
    pageNumber: false,
    margin: { top: 20, right: 18, bottom: 18, left: 18 },
    accent: '#1c2434',
  },
]

export function presetOf(key: string): PaperLayoutPreset {
  return PAPER_LAYOUTS.find((row) => row.key === key) ?? PAPER_LAYOUTS[0]
}

/** 版式令牌 → 作用在卷面与测量层上的 CSS 变量（两层必须拿到同一份，否则测量失真） */
export function presetVars(preset: PaperLayoutPreset): Record<string, string> {
  return {
    '--pp-font': preset.bodyFont,
    '--pp-head-font': preset.headFont,
    '--pp-size': `${preset.fontSize}px`,
    '--pp-line': String(preset.lineHeight),
    '--pp-gap': `${preset.gap}px`,
    '--pp-section-size': `${preset.sectionSize}px`,
    '--pp-title-size': `${preset.titleSize}px`,
    '--pp-accent': preset.accent,
  }
}

/* ================ 排版块 ================ */

/** 答题卡填涂区里的一个题号（选项字母由题目数据带出，块里只存引用） */
export interface CardFillItem {
  key: string
  no: number
  questionId: number
}

/**
 * 卷面上的最小排版单元（分页以块为原子，块内部不再拆分）。
 * span 指版内占几栏：客观题 1 栏（仅版内双栏时）、其余 2 栏（通栏 = 整版宽）。
 */
export type PaperBlock =
  | { key: string; kind: 'head'; span: 2 }
  | {
      key: string
      kind: 'section'
      span: 2
      title: string
      count: number
      score: number
      /** 各小题分值一致时的单题分值，不一致为 null（大题说明里就不写「每小题 X 分」） */
      perScore: number | null
    }
  /** 大题材料（阅读文本 / 文言文 / 诗歌 / 英语短文）：整版通栏，本大题各小题共用 */
  | { key: string; kind: 'material'; span: 2; hint: string; text: string }
  | {
      key: string
      kind: 'question'
      span: 1 | 2
      /** 题号（全卷连续编号） */
      no: number
      questionId: number
      score: number
    }
  /* ↓ 答题卡 */
  | { key: string; kind: 'card-head'; span: 2 }
  | { key: string; kind: 'card-title'; span: 2; title: string; hint: string }
  | { key: string; kind: 'card-fill'; span: 2; columns: number; items: CardFillItem[] }
  | {
      key: string
      kind: 'card-answer'
      span: 2
      no: number
      questionId: number
      score: number
      /** >0：填空题式作答横线行数；0：解答题式作答框（高度见 boxH） */
      lines: number
      boxH: number
    }

/** 客观题：有选项即视为客观题（判断题选项为 √/×） */
export function isObjective(item: { options: string[] } | undefined): boolean {
  return !!item && item.options.length > 0
}

/* ================ 答题卡尺寸规则 ================ */

/** 填涂区每格（题号 + A B C D 涂点）最小宽度：约 9.2 个字宽（随字号缩放，见 .pc-bub 的 em 尺寸） */
const FILL_CELL_EM = 9.2
/** 一块填涂区最多排几行（块高可控，避免整块高过版面） */
const FILL_ROWS = 6
/** 填空题在答题卡上的作答横线行数 */
export const ANSWER_LINES = 2

/** 填涂区列数：按版面宽度自适应，3~6 列 */
export function fillColumns(panelW: number, fontSize: number): number {
  return Math.min(6, Math.max(3, Math.floor(panelW / (FILL_CELL_EM * fontSize))))
}

/** 一块填涂区放多少题（列数 × 行数），其余自动续块 */
export function fillChunk(panelW: number, fontSize: number): number {
  return fillColumns(panelW, fontSize) * FILL_ROWS
}

/** 解答题作答框高度：按分值给（10 分题约 300px ≈ 80mm），夹在 150~520 px */
export function answerBoxHeight(score: number): number {
  return Math.min(520, Math.max(150, Math.round(score * 26 + 44)))
}

/* ================ 纸张几何 ================ */

export interface PaperGeometry {
  /** 纸面像素尺寸（未缩放） */
  sheetW: number
  sheetH: number
  /** 版心尺寸（纸面去掉页边距） */
  contentW: number
  contentH: number
  /** 页边距像素 */
  padTop: number
  padRight: number
  padBottom: number
  padLeft: number
  /** 每面版数（一面两版 = 对折后半张一版） */
  panels: number
  /** 版间距像素（单版时为 0） */
  panelGap: number
  /** 单版宽度：分页装箱时的填充宽度 */
  panelW: number
  /** 版内再分栏数（仅单版纸张 + 双栏样式时为 2） */
  subCols: 1 | 2
  /** 版内单栏宽度 */
  colW: number
}

/**
 * 由纸张 / 方向 / 版式（+ 版数覆盖）计算几何参数。
 * 版心高 = 纸面高 − 上下页边距 − 页脚占位，分页算法以它为每版的填充上限。
 */
export function paperGeometry(
  size: PaperSize,
  orientation: PaperOrientation,
  preset: PaperLayoutPreset,
  /** 版数覆盖：0 = 按纸张习惯版数 */
  panelOverride = 0,
): PaperGeometry {
  const landscape = orientation === 'landscape'
  const sheetW = (landscape ? size.height : size.width) * MM
  const sheetH = (landscape ? size.width : size.height) * MM
  const padTop = preset.margin.top * MM
  const padRight = preset.margin.right * MM
  const padBottom = preset.margin.bottom * MM
  const padLeft = preset.margin.left * MM
  const contentW = sheetW - padLeft - padRight
  const contentH = sheetH - padTop - padBottom - (preset.pageNumber ? FOOT_H : 0)

  const panels = Math.min(3, Math.max(1, panelOverride || size.panels))
  const panelGap = panels > 1 ? PANEL_GAP : 0
  const panelW = (contentW - panelGap * (panels - 1)) / panels
  /* 版内再分栏只在单版纸张上做：8K / A3 一面两版时每版本就只有半张宽，再分栏就太窄了 */
  const subCols: 1 | 2 = preset.twoColumn && panels === 1 ? 2 : 1
  const colW = subCols === 2 ? (panelW - COL_GAP) / 2 : panelW

  return {
    sheetW,
    sheetH,
    contentW,
    contentH,
    padTop,
    padRight,
    padBottom,
    padLeft,
    panels,
    panelGap,
    panelW,
    subCols,
    colW,
  }
}
