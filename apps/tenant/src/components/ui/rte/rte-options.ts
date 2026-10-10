/**
 * 富文本工具栏的取值表：字体 / 字号 / 颜色 / 下划线档位 / 表格网格上限。
 *
 * 抽成纯数据表的原因：三处要用同一份口径 —— 工具栏弹层里的候选项、编辑器内「当前值」的比对、
 * 以及面板里的输入校验上下限。写在组件里就会三份各写一遍。
 *
 * 字体栈的写法：先 PostScript 名（macOS 上是 Songti SC / Heiti SC 这一套），再 Windows 的中易字体名，
 * 再中文名兜底，最后给一个通用字族。试卷最常用的宋体 / 黑体 / 仿宋 / 楷体都是随系统发行、
 * 可免费使用的中文字体，能覆盖 Win 与 Mac 两端的演示环境。
 */
import { RICH_LIST_MARKERS } from '@aiteach/shared'

export interface RteValueOption {
  key: string
  label: string
  /** null 表示「默认」：清除该属性，回到继承样式 */
  value: string | null
}

export const RTE_FONT_FAMILIES: RteValueOption[] = [
  { key: 'song', label: '宋体', value: 'SimSun, "Songti SC", 宋体, serif' },
  { key: 'hei', label: '黑体', value: 'SimHei, "Heiti SC", 黑体, sans-serif' },
  { key: 'fangsong', label: '仿宋', value: 'FangSong, "FangSong SC", STFangsong, 仿宋, serif' },
  { key: 'kai', label: '楷体', value: 'KaiTi, "Kaiti SC", STKaiti, 楷体, serif' },
  { key: 'default', label: '默认字体', value: null },
]

/** 字号用中文字号名标注（录题时按「小四」说话），值仍是 pt，Word 与浏览器都认 */
export const RTE_FONT_SIZES: RteValueOption[] = [
  { key: 'wuhao', label: '五号 10.5pt', value: '10.5pt' },
  { key: 'xiaosi', label: '小四 12pt', value: '12pt' },
  { key: 'sihao', label: '四号 14pt', value: '14pt' },
  { key: 'xiaosan', label: '小三 15pt', value: '15pt' },
  { key: 'sanhao', label: '三号 16pt', value: '16pt' },
  { key: 'erhao', label: '二号 22pt', value: '22pt' },
  { key: 'default', label: '默认字号', value: null },
]

/** 固定色板（不做任意取色器）：试卷里用到的基本只有这几个。
    末档是「默认颜色」（value: null，清掉 color），与字体 / 字号两份表的写法一致 ——
    不然选过红的字只能靠「清除格式」回黑，而那一并把字体字号下划线都清了。 */
export const RTE_COLORS: RteValueOption[] = [
  { key: 'black', label: '黑色', value: '#000000' },
  /* 白色是给「深底浅字」用的：表格格子上压了浅灰/浅蓝底纹后，若整格底纹调深（未来加），
     字色得能翻白；现阶段最常用的场景反而是「压在深色图片/底色上做标题」。色板里给白，
     不等于默认白 —— 白色字在白纸上等于看不见，所以它排在黑色旁边，不与「默认颜色」混为一谈。 */
  { key: 'white', label: '白色', value: '#ffffff' },
  { key: 'red', label: '红色', value: '#c0272d' },
  { key: 'orange', label: '橙色', value: '#d97706' },
  { key: 'green', label: '绿色', value: '#15803d' },
  { key: 'blue', label: '蓝色', value: '#1d4ed8' },
  { key: 'purple', label: '紫色', value: '#7c3aed' },
  { key: 'gray', label: '灰色', value: '#6b7280' },
  { key: 'default', label: '默认颜色', value: null },
]

/**
 * 下划线的**花式**档位（单下划线不在表里）。
 *
 * 工具栏上那个 U 按钮就是单下划线，点它等于本表的 'none' 与单下划线之间来回切
 * （见 RteToolbar.vue 的 toggleUnderline）。这里再放一条「单下划线」只会造成两个入口、
 * 两种语义：选它到底该清掉波浪线还是叠加一条实线？答案是清掉（两条线叠在一起不是任何人想要的），
 * 那它就与 U 按钮完全等效，留着只是让人多猜一次。
 */
export const RTE_UNDERLINE_STYLES: { key: 'wavy' | 'double' | 'none'; label: string }[] = [
  { key: 'wavy', label: '波浪线' },
  { key: 'double', label: '双重下划线' },
  { key: 'none', label: '取消下划线' },
]

/**
 * 单元格底纹色板：试卷里的底纹是「表头压一层灰、重点格压一层黄」这种极克制的用法，
 * 所以只给固定几档 + 白色 + 无底纹，不做任意取色器（与字色色板同一条原则）。
 *
 * 末档 value: null = 清掉底纹。色值都取低饱和的浅色：底纹是要**托住文字**的，
 * 太深会把黑字吃掉 —— 这几档的对比度在打印与 Word 导出里都还看得清。
 *
 * 白色与无底纹**不是一回事**，两档都要留：无底纹是「我没有底纹」，表头格会掉回 CSS 里的
 * `th { background: #f4f6fa }` 浅灰；白色是「我明确要白底」，表头格也能压成纯白。
 */
export const RTE_CELL_BACKGROUNDS: RteValueOption[] = [
  { key: 'gray', label: '浅灰（表头常用）', value: '#f4f6fa' },
  { key: 'yellow', label: '浅黄（重点格）', value: '#fef3c7' },
  { key: 'green', label: '浅绿', value: '#e7f6ec' },
  { key: 'blue', label: '浅蓝', value: '#e8f0fe' },
  { key: 'red', label: '浅红', value: '#fdeaea' },
  { key: 'white', label: '白色', value: '#ffffff' },
  { key: 'none', label: '无底纹', value: null },
]

/** 有序列表序号：口径在共享层（导出端与净化白名单与它同源） */
export const RTE_LIST_MARKERS = RICH_LIST_MARKERS

/**
 * 表格边框色板：整表一起换（命令逐格写，见 tableCellStyle.ts 的 setTableBorderColor）。
 *
 * 只给试卷上真会用到的几档：默认（三端 CSS 里那条灰）、黑（正式卷面）、深灰 / 浅灰（淡一些的
 * 答题格）、红与蓝（强调）。末档 value: null = 清掉，回到 CSS 的默认边框色 ——
 * 与底纹色板的「无底纹」同一种写法，色板上用一个带斜线的格子表示「回到默认」。
 */
export const RTE_BORDER_COLORS: RteValueOption[] = [
  { key: 'black', label: '黑色', value: '#000000' },
  { key: 'gray', label: '深灰', value: '#6b7280' },
  { key: 'light', label: '浅灰', value: '#cbd5e1' },
  { key: 'red', label: '红色', value: '#c0272d' },
  { key: 'blue', label: '蓝色', value: '#1d4ed8' },
  { key: 'default', label: '默认边框', value: null },
]

/** 插入表格的网格选择器上限 */
export const RTE_TABLE_GRID_ROWS = 6
export const RTE_TABLE_GRID_COLS = 8
