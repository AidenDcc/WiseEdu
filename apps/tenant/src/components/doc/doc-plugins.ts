/**
 * 备课文档编辑器的**功能注册表**。
 *
 * ## 为什么要有这张表
 *
 * 教案编辑器的功能清单有一百多项（字体、段落、插入、教学专用组件……），如果每加一个功能都去
 * 某个 .vue 里再抄一段按钮 + 一段弹层，会出现两个必然结果：一是顶部功能区与右侧竖排工具栏
 * 各写一遍、手感开始分叉；二是改一个功能的可用条件（比如「表格操作」只在表格里出现）要改两处。
 *
 * 所以每个功能在这里声明成**一条数据**：它是哪种控件（按钮 / 开关 / 下拉 / 弹层 / 对外事件）、
 * 属于哪一组、图标与文案、怎么读当前值、怎么执行。渲染层（DocRibbon.vue）只按 `kind` 分派，
 * 于是「加一个功能」= 往数组里加一条，「换一种排版」= 换一个渲染层。
 *
 * ## 与编辑器的边界（与旧 DocToolbar 的注释一致）
 *
 * **只碰编辑器内容的动作写在表里**（加粗、改行距、插表格、格式刷……）；
 * **需要媒体库 / 弹窗的动作**（图片、公式、理科配图、段落对话框）声明为 `kind: 'emit'` ——
 * 那些状态的宿主是画布（DocCanvas），工具栏只负责把意图喊出去。
 */
import type { Editor } from '@tiptap/vue-3'

import {
  DOC_COLORS,
  DOC_FONT_FAMILIES,
  DOC_FONT_SIZES,
  DOC_HIGHLIGHTS,
  DOC_PARAGRAPH_STYLES,
  type DocValueOption,
} from './doc-options'
import { RTE_LIST_MARKERS } from '@/components/ui/rte/rte-options'
import { DOC_ALIGN_TEXT, type DocAlign } from '@/tiptap-extensions/docFormat'

/** 功能分组：顶部功能区按这个顺序从左到右排，右侧竖排按这个顺序从上到下排 */
export type DocPluginGroup = 'clipboard' | 'font' | 'paragraph' | 'insert'

export interface DocPluginGroupDef {
  key: DocPluginGroup
  label: string
}

export const DOC_PLUGIN_GROUPS: DocPluginGroupDef[] = [
  { key: 'clipboard', label: '编辑' },
  { key: 'font', label: '字体' },
  { key: 'paragraph', label: '段落' },
  { key: 'insert', label: '插入' },
]

/** 弹层型功能：渲染层按这个标识挂上对应的弹层内容 */
export type DocPopoverKind = 'painter' | 'color' | 'highlight' | 'listMarker' | 'table' | 'link'

/** 对外事件的标识（画布监听后开对应的弹窗 / 媒体库） */
export type DocEmitEvent = 'image' | 'formula' | 'draw' | 'paragraph'

interface DocPluginBase {
  id: string
  group: DocPluginGroup
  /** 按钮上的文字（可省，省了就是纯图标按钮） */
  text?: string
  /** 图标名（见 @aiteach/shared 的 AppIcon） */
  icon?: string
  /** 悬浮提示 */
  title?: string
  /** 在窄栏里是否占据整行（带下拉箭头的按钮一般占整行，免得挤成一坨） */
  wide?: boolean
  /**
   * 折叠组名。同一个组里的功能在**顶栏一行放不下**时会收成一个下拉按钮
   * （对齐四档、缩进两档 —— 这两组的图标本身就能自解释，收起来损失最小）。
   * 见 DocRibbon 的 collapsed 与 `DOC_COLLAPSE_META`。
   */
  collapse?: string
}

export interface DocPluginButton extends DocPluginBase {
  kind: 'button'
  run: (editor: Editor) => void
  /** 有值时按钮显示按下态 */
  isActive?: (editor: Editor) => boolean
  disabled?: (editor: Editor) => boolean
}

export interface DocPluginToggle extends DocPluginBase {
  kind: 'toggle'
  toggle: (editor: Editor) => void
  isActive: (editor: Editor) => boolean
}

export interface DocPluginSelect extends DocPluginBase {
  kind: 'select'
  /** 弹层宽度（px） */
  width: number
  options: Array<{ key: string; label: string; value: string | null; preview?: string }>
  /** 当前值（null 表示「默认」） */
  current: (editor: Editor) => string | null
  /** 选中某一项：`null` 表示「默认档」，即清掉该属性回到继承样式 */
  apply: (editor: Editor, value: string | null) => void
  /** 按钮上的显示文字：多数直接用 label，字号 / 行距这种要截短 */
  display?: (editor: Editor) => string
}

export interface DocPluginPopover extends DocPluginBase {
  kind: 'popover'
  popover: DocPopoverKind
  width: number
  /** 触发按钮是否显示按下态 */
  isActive?: (editor: Editor) => boolean
}

export interface DocPluginEmit extends DocPluginBase {
  kind: 'emit'
  event: DocEmitEvent
}

export type DocPlugin = DocPluginButton | DocPluginToggle | DocPluginSelect | DocPluginPopover | DocPluginEmit

/* ================= 取值小工具 ================= */

/** 段落 / 标题共享的盒模型属性：两者都要问一次（光标落在哪一类节点上由文档决定） */
function blockAttr(editor: Editor, name: string): string | null {
  const fromParagraph = (editor.getAttributes('paragraph') as Record<string, unknown>)[name]
  const fromHeading = (editor.getAttributes('heading') as Record<string, unknown>)[name]
  return ((fromParagraph ?? fromHeading ?? null) as string | null) ?? null
}

/** 档位表 → 下拉项（`preview` 用于字体名那种「用字体本身预览」的菜单） */
function toOptions(list: DocValueOption[], previewAsFont = false) {
  return list.map((row) => ({ key: row.key, label: row.label, value: row.value, preview: previewAsFont ? (row.value ?? undefined) : undefined }))
}

/* ================= 注册表 ================= */

export const DOC_PLUGINS: DocPlugin[] = [
  /* ---------- 编辑 ----------
     这一组一律**只显示图标**：撤销 / 重做 / 格式刷 / 清格式都是高频、已被图标普适化的动作，
     写上文字只会把整条功能带撑宽（一行放不下的代价是其余功能被挤进下拉里）。 */
  {
    id: 'undo',
    kind: 'button',
    group: 'clipboard',
    icon: 'undo',
    title: '撤销（Ctrl / ⌘ + Z）',
    disabled: (editor) => !editor.can().undo(),
    run: (editor) => editor.chain().focus().undo().run(),
  },
  {
    id: 'redo',
    kind: 'button',
    group: 'clipboard',
    icon: 'redo',
    title: '重做（Ctrl / ⌘ + Shift + Z）',
    disabled: (editor) => !editor.can().redo(),
    run: (editor) => editor.chain().focus().redo().run(),
  },
  {
    id: 'painter',
    kind: 'popover',
    group: 'clipboard',
    popover: 'painter',
    /* 刷子：与 Word / WPS 的「格式刷」同一个形状 */
    icon: 'brush',
    width: 250,
    title: '格式刷：先在源文字上点一下，再选中目标文字即套用（复制字体、字号、颜色、对齐与行距）',
  },
  {
    id: 'clearFormat',
    kind: 'button',
    group: 'clipboard',
    icon: 'eraser',
    title: '清除格式（连同行内样式一起清掉）',
    run: (editor) => editor.chain().focus().unsetAllMarks().run(),
  },

  /* ---------- 字体 ---------- */
  {
    id: 'paragraphStyle',
    kind: 'select',
    group: 'font',
    icon: 'paragraph',
    title: '段落样式（正文 / 标题，决定左侧目录的层级）',
    wide: true,
    width: 214,
    options: DOC_PARAGRAPH_STYLES.map((row) => ({ key: row.key, label: row.label, value: row.key })),
    current: (editor) => {
      const level = [1, 2, 3, 4, 5].find((n) => editor.isActive('heading', { level: n }))
      return level ? `h${level}` : 'body'
    },
    apply: (editor, value) => {
      const row = DOC_PARAGRAPH_STYLES.find((item) => item.key === value)
      if (!row) return
      const chain = editor.chain().focus()
      if (row.level === 0) chain.setParagraph().run()
      else chain.setHeading({ level: row.level as 1 | 2 | 3 | 4 | 5 }).run()
    },
  },
  {
    id: 'fontFamily',
    kind: 'select',
    group: 'font',
    icon: 'font',
    title: '字体',
    wide: true,
    width: 190,
    options: toOptions(DOC_FONT_FAMILIES, true),
    current: (editor) => (editor.getAttributes('textStyle') as { fontFamily?: string | null }).fontFamily ?? null,
    apply: (editor, value) => {
      const chain = editor.chain().focus()
      if (value) chain.setFontFamily(value).run()
      else chain.unsetFontFamily().run()
    },
  },
  {
    id: 'fontSize',
    kind: 'select',
    group: 'font',
    icon: 'font-size',
    title: '字号',
    wide: true,
    width: 178,
    options: toOptions(DOC_FONT_SIZES),
    current: (editor) => (editor.getAttributes('textStyle') as { fontSize?: string | null }).fontSize ?? null,
    apply: (editor, value) => {
      const chain = editor.chain().focus()
      if (value) chain.setFontSize(value).run()
      else chain.unsetFontSize().run()
    },
    /* 按钮上只留「小四 / 12pt」里的后一半，窄栏里才放得下 */
    display: (editor) => {
      const value = (editor.getAttributes('textStyle') as { fontSize?: string | null }).fontSize ?? null
      const hit = DOC_FONT_SIZES.find((row) => row.value === value)
      return hit ? hit.label.split(' ')[1] : ''
    },
  },

  { id: 'bold', kind: 'toggle', group: 'font', text: 'B', title: '加粗（Ctrl / ⌘ + B）', toggle: (e) => e.chain().focus().toggleBold().run(), isActive: (e) => e.isActive('bold') },
  { id: 'italic', kind: 'toggle', group: 'font', text: 'I', title: '斜体（Ctrl / ⌘ + I）', toggle: (e) => e.chain().focus().toggleItalic().run(), isActive: (e) => e.isActive('italic') },
  { id: 'underline', kind: 'toggle', group: 'font', text: 'U', title: '下划线（Ctrl / ⌘ + U）', toggle: (e) => e.chain().focus().toggleUnderline().run(), isActive: (e) => e.isActive('underline') },
  { id: 'strike', kind: 'toggle', group: 'font', text: 'S', title: '删除线', toggle: (e) => e.chain().focus().toggleStrike().run(), isActive: (e) => e.isActive('strike') },
  { id: 'superscript', kind: 'toggle', group: 'font', text: 'x²', title: '上标（Ctrl / ⌘ + Shift + .）', toggle: (e) => e.chain().focus().toggleSuperscript().run(), isActive: (e) => e.isActive('superscript') },
  { id: 'subscript', kind: 'toggle', group: 'font', text: 'x₂', title: '下标（Ctrl / ⌘ + Shift + ,）', toggle: (e) => e.chain().focus().toggleSubscript().run(), isActive: (e) => e.isActive('subscript') },
  {
    id: 'color',
    kind: 'popover',
    group: 'font',
    popover: 'color',
    icon: 'font',
    title: '文字颜色',
    width: 152,
  },
  {
    id: 'highlight',
    kind: 'popover',
    group: 'font',
    popover: 'highlight',
    icon: 'highlight',
    title: '突出显示（高亮）',
    width: 152,
  },

  /* ---------- 段落 ----------
     对齐四档与缩进两档带 `collapse`：顶栏一行放不下时它们各自收成一个下拉按钮。
     这两组最该被收起来 —— 图标语义清楚（左/中/右/两端、增/减缩进），收起来损失最小；
     而字体、字号、段落样式这些「带当前值」的控件收起来就看不到当前状态了。 */
  ...(['left', 'center', 'right', 'justify'] as DocAlign[]).map<DocPlugin>((align) => ({
    id: `align-${align}`,
    kind: 'toggle',
    group: 'paragraph',
    collapse: 'align',
    icon: `align-${align}`,
    title: DOC_ALIGN_TEXT[align],
    toggle: (editor) => editor.chain().focus().setBlockAlign(align).run(),
    isActive: (editor) => ((blockAttr(editor, 'textAlign') as DocAlign | null) ?? 'left') === align,
  })),
  { id: 'bulletList', kind: 'toggle', group: 'paragraph', icon: 'list-ul', title: '项目符号', toggle: (e) => e.chain().focus().toggleBulletList().run(), isActive: (e) => e.isActive('bulletList') },
  { id: 'orderedList', kind: 'toggle', group: 'paragraph', icon: 'list-ol', title: '编号', toggle: (e) => e.chain().focus().toggleOrderedList().run(), isActive: (e) => e.isActive('orderedList') },
  {
    id: 'listMarker',
    kind: 'popover',
    group: 'paragraph',
    popover: 'listMarker',
    icon: 'chevron-down',
    width: 198,
    title: '有序列表序号样式',
  },
  {
    id: 'indent',
    kind: 'button',
    group: 'paragraph',
    collapse: 'indent',
    icon: 'indent',
    title: '增加缩进（Tab）',
    run: (e) => e.chain().focus().indent().run(),
  },
  {
    id: 'outdent',
    kind: 'button',
    group: 'paragraph',
    collapse: 'indent',
    icon: 'outdent',
    title: '减少缩进（Shift + Tab）',
    disabled: (editor) => Number((editor.getAttributes('paragraph') as { indentLevel?: number }).indentLevel ?? 0) === 0,
    run: (e) => e.chain().focus().outdent().run(),
  },
  {
    id: 'firstLine',
    kind: 'toggle',
    group: 'paragraph',
    icon: 'first-line',
    title: '首行缩进两格（中文正文的排版惯例）',
    toggle: (e) => e.chain().focus().toggleFirstLineIndent().run(),
    isActive: (e) => Number((e.getAttributes('paragraph') as { firstLineChars?: number }).firstLineChars ?? 0) > 0,
  },
  /* 行距不在这里：它是「一次设一组值」的排版决定，收在「段落设置」对话框里与缩进、间距一起调
     （工具栏上留一个只显示当前档位的窄下拉，反而比打开对话框慢） */
  {
    id: 'paragraphDialog',
    kind: 'emit',
    group: 'paragraph',
    event: 'paragraph',
    icon: 'paragraph',
    text: '段落设置',
    title: '缩进与间距：左 / 右缩进（字符）、首行缩进、段前 / 段后间距（px）、行距',
  },

  /* ---------- 插入 ----------
     与「编辑」组同理：这一组也一律只显示图标（图片 / 公式 / 配图 / 链接 / 分页符），
     图标本身就能认出来，写上文字会把功能带撑成两行。 */
  {
    id: 'table',
    kind: 'popover',
    group: 'insert',
    popover: 'table',
    icon: 'table',
    title: '插入表格 / 表格操作',
    width: 236,
  },
  { id: 'image', kind: 'emit', group: 'insert', event: 'image', icon: 'image', title: '插入图片（可上传本地或从图片库选择；也支持粘贴 / 拖入）' },
  { id: 'formula', kind: 'emit', group: 'insert', event: 'formula', icon: 'formula', title: '插入公式（在光标处输入 LaTeX）' },
  { id: 'draw', kind: 'emit', group: 'insert', event: 'draw', icon: 'shapes', title: '插入理科配图（几何图 / 化学装置图 / 分子结构式 / 示意图）' },
  { id: 'link', kind: 'popover', group: 'insert', popover: 'link', icon: 'link', title: '插入 / 修改链接', width: 248 },
  { id: 'pageBreak', kind: 'button', group: 'insert', icon: 'page-break', title: '分页符（打印时从此处换页）', run: (e) => e.chain().focus().insertPageBreak().run() },
]

/** 按分组取功能（渲染层用） */
export function pluginsOf(group: DocPluginGroup): DocPlugin[] {
  return DOC_PLUGINS.filter((row) => row.group === group)
}

/**
 * 折叠组的外观定义。
 *
 * 顶栏一行放不下时，`collapse` 相同的那些功能会收成一个带下拉箭头的按钮，
 * 菜单里逐项列出（见 DocRibbon）。触发按钮上显示什么，取决于这一组的性质：
 * - 对齐：显示**当前**的对齐图标 —— 收起来之后「现在是左还是居中」仍然一眼可见；
 * - 缩进：没有「当前值」可言（增加 / 减少是两个动作），显示一个通用的缩进图标。
 */
export const DOC_COLLAPSE_META: Record<string, { title: string; width: number; icon: string; iconOf?: (editor: Editor) => string }> = {
  align: {
    title: '对齐方式（左 / 居中对齐 / 右 / 两端对齐）',
    width: 176,
    icon: 'align-left',
    iconOf: (editor) => `align-${((blockAttr(editor, 'textAlign') as DocAlign | null) ?? 'left')}`,
  },
  indent: { title: '缩进', width: 178, icon: 'indent' },
}

/** 高亮色板与字色板：注册表里只声明「有这两个弹层」，色值仍在 doc-options（与录题编辑器同源） */
export const DOC_PLUGIN_PALETTES = { colors: DOC_COLORS, highlights: DOC_HIGHLIGHTS, listMarkers: RTE_LIST_MARKERS }
