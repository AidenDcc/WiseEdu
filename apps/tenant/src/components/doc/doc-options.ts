/**
 * 文档编辑器（教案 / 学案 / 讲义）右侧工具栏的取值表。
 *
 * 与录题工具栏的 rte-options.ts 刻意分开两份，不共用：两者的**使用场景不同** ——
 * 录题是在一行题干里抠排版，字体往往只用宋体一档；备课文档是一份要打印、要发给学生的稿子，
 * 字体要按「标题黑体 + 正文宋体 / 仿宋」这种中文排版惯例来选，字号也要覆盖到标题级别。
 * 合成一份只会让两边都拿到一半没用的候选项。色板这类完全同义的（字色）则直接复用。
 */
import { RTE_COLORS } from '@/components/ui/rte/rte-options'

export interface DocValueOption {
  key: string
  label: string
  /** null 表示「默认」：清掉该属性，回到继承样式 */
  value: string | null
}

/**
 * 中文字体栈的写法同 rte-options.ts：先 PostScript 名（macOS 上是 Songti SC 这一套），
 * 再 Windows 的中易字体名，再中文名兜底，最后给一个通用字族。末尾三档是英文正文常用的。
 */
export const DOC_FONT_FAMILIES: DocValueOption[] = [
  { key: 'song', label: '宋体', value: 'SimSun, "Songti SC", 宋体, serif' },
  { key: 'hei', label: '黑体', value: 'SimHei, "Heiti SC", 黑体, sans-serif' },
  { key: 'fangsong', label: '仿宋', value: 'FangSong, "FangSong SC", STFangsong, 仿宋, serif' },
  { key: 'kai', label: '楷体', value: 'KaiTi, "Kaiti SC", STKaiti, 楷体, serif' },
  { key: 'yahei', label: '微软雅黑', value: '"Microsoft YaHei", "PingFang SC", 微软雅黑, sans-serif' },
  { key: 'dengxian', label: '等线', value: 'DengXian, "PingFang SC", 等线, sans-serif' },
  { key: 'times', label: 'Times New Roman', value: '"Times New Roman", Times, serif' },
  { key: 'arial', label: 'Arial', value: 'Arial, Helvetica, sans-serif' },
  { key: 'default', label: '默认字体', value: null },
]

/** 中文字号名与 pt 的对应沿用例题编辑器那一套（老师说「小四」比说「12pt」顺口） */
export const DOC_FONT_SIZES: DocValueOption[] = [
  { key: 'xiaowu', label: '小五 9pt', value: '9pt' },
  { key: 'wuhao', label: '五号 10.5pt', value: '10.5pt' },
  { key: 'xiaosi', label: '小四 12pt', value: '12pt' },
  { key: 'sihao', label: '四号 14pt', value: '14pt' },
  { key: 'xiaosan', label: '小三 15pt', value: '15pt' },
  { key: 'sanhao', label: '三号 16pt', value: '16pt' },
  { key: 'xiaoer', label: '小二 18pt', value: '18pt' },
  { key: 'erhao', label: '二号 22pt', value: '22pt' },
  { key: 'xiaoyi', label: '小一 24pt', value: '24pt' },
  { key: 'yihao', label: '一号 26pt', value: '26pt' },
  { key: 'xiaochu', label: '小初 36pt', value: '36pt' },
  { key: 'chuhao', label: '初号 42pt', value: '42pt' },
  { key: 'default', label: '默认字号', value: null },
]

/**
 * 行距档位。值直接是 CSS 的 `line-height`，无单位倍数（1.5 = 1.5 倍）与百分比两种写法
 * 在 Word 与浏览器里都认；这里统一给倍数，中文排版最常见的是 1.5 与固定值 1.15。
 */
export const DOC_LINE_HEIGHTS: DocValueOption[] = [
  { key: '1', label: '单倍行距 1.0', value: '1' },
  { key: '1.15', label: '1.15 倍行距', value: '1.15' },
  { key: '1.5', label: '1.5 倍行距', value: '1.5' },
  { key: '1.75', label: '1.75 倍行距', value: '1.75' },
  { key: '2', label: '2 倍行距', value: '2' },
  { key: '2.5', label: '2.5 倍行距', value: '2.5' },
  { key: '3', label: '3 倍行距', value: '3' },
  { key: 'default', label: '默认行距', value: null },
]

/**
 * 段落样式档位。`level` 为 0 表示正文（普通段落），1~5 对应 h1~h5。
 *
 * 开到「标题 5」而不是 4：教案 / 学案里「一、→（一）→ 1. →（1）→ ①」的嵌套很常见，
 * 4 级在写「教学过程」时会不够用。文档标题本身不在这里（它是页面级的 name，
 * 不参与正文的标题树与左侧目录）。
 */
export const DOC_PARAGRAPH_STYLES: Array<{ key: string; label: string; level: number; hint: string }> = [
  { key: 'body', label: '正文', level: 0, hint: '文档正文段落' },
  { key: 'h1', label: '标题 1', level: 1, hint: '一级标题（左侧目录的第一层）' },
  { key: 'h2', label: '标题 2', level: 2, hint: '二级标题' },
  { key: 'h3', label: '标题 3', level: 3, hint: '三级标题' },
  { key: 'h4', label: '标题 4', level: 4, hint: '四级标题' },
  { key: 'h5', label: '标题 5', level: 5, hint: '五级标题' },
]

/** 目录 / 段落样式菜单共用的标题层级上限（DocOutline 的缩进档、DocCanvas 的字号规则都读它） */
export const DOC_MAX_HEADING_LEVEL = 5

/**
 * 段落对话框「缩进」一栏的字符候选。取 Word 里最常见的几档 ——
 * 中文正文的首行缩进基本只用「2 字符」，左缩进常见 2 / 4 字符（引文、例题框内缩进）。
 */
export const DOC_INDENT_CHARS: number[] = [0, 2, 4, 6, 8]

/**
 * 段落对话框「间距」一栏的 px 候选。
 *
 * 用 px 而不是「行」：屏幕上段落间距就是像素，老师调的时候看到的也是像素，
 * 换算成行只会让「段前 6px」变成「段前 0.4 行」这种谁都读不懂的数。
 */
export const DOC_SPACING_PX: number[] = [0, 3, 6, 9, 12, 18, 24, 36]

/** 字色色板与录题编辑器同源：同一种颜色不该在两个编辑器里长得不一样 */
export const DOC_COLORS = RTE_COLORS

/**
 * 高亮（突出显示）色板。取 Word「突出显示」那几档的浅色版本 —— 高亮是**压在文字下面的色带**，
 * 深色会把黑字吃掉；末档「无高亮」清掉属性。
 */
export const DOC_HIGHLIGHTS: DocValueOption[] = [
  { key: 'yellow', label: '黄色', value: '#fff3b0' },
  { key: 'green', label: '绿色', value: '#ccf5d3' },
  { key: 'cyan', label: '青色', value: '#c9f1f5' },
  { key: 'pink', label: '粉色', value: '#ffd9e6' },
  { key: 'blue', label: '蓝色', value: '#d6e4ff' },
  { key: 'gray', label: '灰色', value: '#e6e8ec' },
  { key: 'none', label: '无高亮', value: null },
]

/**
 * 页面设置（「全局设置」里的纸张与页边距）。
 *
 * 只给 A4 与 B5 两种纸：K12 的教案 / 学案 / 讲义打印出来基本都是 A4，
 * B5 是部分学校的作业本规格。页边距给四档常用值（单位 mm，写进纸张的内边距）。
 */
export const DOC_PAPERS: Array<{ key: string; label: string; width: number; height: number }> = [
  { key: 'a4', label: 'A4（210 × 297 mm）', width: 210, height: 297 },
  { key: 'b5', label: 'B5（176 × 250 mm）', width: 176, height: 250 },
]

export const DOC_MARGINS: Array<{ key: string; label: string; value: number }> = [
  { key: 'narrow', label: '窄（12.7 mm）', value: 12.7 },
  { key: 'normal', label: '常规（25.4 mm）', value: 25.4 },
  { key: 'wide', label: '宽（31.8 mm）', value: 31.8 },
  { key: 'none', label: '无页边距', value: 0 },
]

/** 正文默认段落样式（页面设置里的「正文样式」一栏，作用于整个文档的基线） */
export const DOC_BODY_FONTS = DOC_FONT_FAMILIES.filter((row) => row.value)
export const DOC_BODY_SIZES = DOC_FONT_SIZES.filter((row) => row.value)
export const DOC_BODY_LINE_HEIGHTS = DOC_LINE_HEIGHTS.filter((row) => row.value)

/**
 * 页码格式档位。
 *
 * 只收打印稿上真正会用的几种：中文学术文档习惯「第 n 页 / 共 m 页」或「第 n 页」，
 * 公文习惯「- n -」，英文材料习惯「n」或「n / m」。格式的展开在 useDocPage 的 `pageNoText`，
 * 存的是 key —— 与页面设置里其余字段同一口径，将来加一档不影响已存文档。
 */
export const DOC_PAGE_NO_FORMATS: Array<{ key: string; label: string }> = [
  { key: 'zh', label: '第 1 页 / 共 2 页' },
  { key: 'zh-simple', label: '第 1 页' },
  { key: 'num-total', label: '1 / 2' },
  { key: 'dash', label: '- 1 -' },
  { key: 'num', label: '1' },
]

/** 页码位置：页脚三个横位。默认在右侧（与 Word 的「页脚 → 页码 → 当前位置」常见做法一致） */
export const DOC_PAGE_NO_POS: Array<{ key: string; label: string }> = [
  { key: 'left', label: '页脚左' },
  { key: 'center', label: '页脚中' },
  { key: 'right', label: '页脚右' },
]

/**
 * 页眉位置：页眉行同样分三个横位。
 *
 * 默认**居中**：中文公文的页眉（单位名 / 文档名）几乎都居中，而页脚文字习惯靠左；
 * 两者各占一行，位置互不影响。
 */
export const DOC_HEADER_POS: Array<{ key: string; label: string }> = [
  { key: 'left', label: '页眉左' },
  { key: 'center', label: '页眉中' },
  { key: 'right', label: '页眉右' },
]
