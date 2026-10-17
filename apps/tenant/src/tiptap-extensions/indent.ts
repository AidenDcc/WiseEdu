/**
 * 段落盒模型：缩进（整体 + 首行）与段间距。
 *
 * 本扩展是**段落级盒子属性（margin / padding / text-indent）的唯一所有者**。一条 CSS 属性
 * 只能有一个写入方 —— 曾经「首行缩进」由本文件写 `text-indent`、段间距另起一个扩展写
 * `margin-top`，两边都会往同一段落的 `style` 上拼串，一旦哪天都想写同一个属性，
 * Tiptap 的 `mergeAttributes` 只会把两段 style 拼起来、由浏览器取最后一个，静默覆盖。
 * 所以缩进与间距合成一处，见下面的属性表。
 *
 * 属性一览（都挂在**段落 / 标题**上，列表项只吃 `indentLevel`）：
 * - `indentLevel`      增加/减少缩进按钮，一级 2em（= 两个汉字宽），走 `margin-left`
 * - `firstLineChars`   首行缩进（字符数，中文排版惯例是 2），走 `text-indent`
 * - `indentLeftChars`  左缩进（字符数），走 `padding-left`
 * - `indentRightChars` 右缩进（字符数），走 `padding-right`
 * - `spaceBefore`      段前间距（px），走 `margin-top`
 * - `spaceAfter`       段后间距（px），走 `margin-bottom`
 *
 * 为什么 `indentLeftChars` 用 `padding-left` 而不用 `margin-left`：`margin-left` 已经被
 * `indentLevel` 占了，两者语义不同（前者是「整段右移几个字」，后者是「缩进级别」），
 * 而且可能同时存在（先按了两级缩进、又在段落对话框里设了 4 字符）。`padding-left` 与
 * `margin-left` 在视觉上是叠加的，谁也不会盖住谁。段落自身没有背景与边框（本编辑器里），
 * 用 padding 不会带来副作用。
 *
 * 为什么是全局属性而不是包一层 div：如旧版注释所述，回车换段时 ProseMirror 分裂文本块会复制
 * 节点 attrs，**缩进与间距随段落自动继承**（与 Word 的「段落格式跟着回车走」一致），
 * 而且导出 Word 不会多出一层空 div。
 *
 * 为什么列表项的 `indentLevel` 单独定义：列表标记（序号 / 圆点）画在 `li` 的盒子**外侧**，
 * 跟着 `li` 走。进入列表后把缩进记在段落上（`<li><p style="margin-left: 2em">`），
 * 只有文字往右挪、序号原地不动 —— 看着就是「序号没跟着缩进」。记到 `li` 上则整个列表项
 * 连同序号一起右移（见 resolveIndentHost）。反过来 `text-indent` 不能给 `li`：
 * 它是继承属性，写在 `li` 上会传给里面的段落，与段落自身那一份叠加成「缩进两格又两格」。
 */
import { Extension, getStyleProperty, type CommandProps } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'

/** 与缩进按钮的档数一致：8 级，一级 2em */
export const INDENT_LEVELS = 8
const INDENT_STEP_EM = 2
/** 首行缩进按钮的默认值：中文正文惯例两格 */
export const FIRST_LINE_DEFAULT = 2
/** 段落对话框里「缩进字符」与「间距 px」的取值范围（超出即视为脏数据） */
export const INDENT_CHARS_MAX = 16
export const SPACING_PX_MAX = 96

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    indent: {
      indent: () => ReturnType
      outdent: () => ReturnType
      /** 首行缩进开 / 关（工具栏那一个按钮：关→2 字符，开→0） */
      toggleFirstLineIndent: () => ReturnType
      /** 首行缩进字符数（段落对话框），传 0 等于取消 */
      setFirstLineChars: (chars: number) => ReturnType
      /** 左右缩进（字符数，段落对话框） */
      setParagraphIndent: (value: { left?: number; right?: number }) => ReturnType
      /** 段前 / 段后间距（px，段落对话框） */
      setParagraphSpacing: (value: { before?: number; after?: number }) => ReturnType
    }
  }
}

export interface IndentOptions {
  /** 参与缩进的块级节点 */
  types: string[]
  /** 最大缩进级别 */
  levels: number
}

/** 数值属性的统一归一：null / 非数 / 越界 → 0；小数四舍五入到 0.1（`1.5 字符`也合法） */
function norm(value: unknown, max: number): number {
  const num = Number(value)
  if (!Number.isFinite(num) || num <= 0) return 0
  return Math.min(Math.round(num * 10) / 10, max)
}

/** 从内联样式里读一个 px 值（`margin-top: 8px` → 8）；百分比 / em 一律不猜，返回 0 */
function parsePx(element: HTMLElement, prop: string): number {
  const value = (getStyleProperty(element, prop) ?? '').trim()
  const matched = /^(\d+(?:\.\d+)?)px$/.exec(value)
  return matched ? norm(matched[1], SPACING_PX_MAX) : 0
}

/** 从内联样式里读一个 em / ch 值（`text-indent: 2em` → 2）；单位不符返回 0 */
function parseUnit(element: HTMLElement, prop: string, unit: 'em' | 'ch'): number {
  const value = (getStyleProperty(element, prop) ?? '').trim()
  const matched = new RegExp(`^(\\d+(?:\\.\\d+)?)${unit}$`).exec(value)
  return matched ? norm(matched[1], INDENT_CHARS_MAX) : 0
}

/**
 * `indentLevel` 的属性定义。段落/标题与列表项**必须共用同一份**：两边都靠 `margin-left` 存值，
 * 编写与解析口径一旦分叉，就会出现「在列表里缩进两级、退出列表变成一级」这种漂移。
 */
function indentLevelAttribute() {
  return {
    default: 0,
    parseHTML: (element: HTMLElement) => parseIndentLevel(element),
    renderHTML: (attributes: Record<string, unknown>) =>
      Number(attributes.indentLevel) > 0
        ? { style: `margin-left: ${Number(attributes.indentLevel) * INDENT_STEP_EM}em` }
        : {},
  }
}

/** `margin-left: 6em` → 3 级；不是 em 或对不上步长的一律当 0（历史数据里的 px 缩进不猜） */
function parseIndentLevel(element: HTMLElement): number {
  const value = getStyleProperty(element, 'margin-left')
  const matched = value ? /^(\d+(?:\.\d+)?)em$/.exec(value.trim()) : null
  if (!matched) return 0
  const level = Math.round(Number(matched[1]) / INDENT_STEP_EM)
  return level > 0 ? Math.min(level, INDENT_LEVELS) : 0
}

/** 段落盒模型的属性表（段落与标题共用） */
function paragraphBoxAttributes() {
  return {
    firstLineChars: {
      default: 0,
      parseHTML: (element: HTMLElement) => parseUnit(element, 'text-indent', 'em'),
      renderHTML: (attributes: Record<string, unknown>) =>
        Number(attributes.firstLineChars) > 0 ? { style: `text-indent: ${Number(attributes.firstLineChars)}em` } : {},
    },
    indentLeftChars: {
      default: 0,
      parseHTML: (element: HTMLElement) => parseUnit(element, 'padding-left', 'ch'),
      renderHTML: (attributes: Record<string, unknown>) =>
        Number(attributes.indentLeftChars) > 0 ? { style: `padding-left: ${Number(attributes.indentLeftChars)}ch` } : {},
    },
    indentRightChars: {
      default: 0,
      parseHTML: (element: HTMLElement) => parseUnit(element, 'padding-right', 'ch'),
      renderHTML: (attributes: Record<string, unknown>) =>
        Number(attributes.indentRightChars) > 0 ? { style: `padding-right: ${Number(attributes.indentRightChars)}ch` } : {},
    },
    spaceBefore: {
      default: 0,
      parseHTML: (element: HTMLElement) => parsePx(element, 'margin-top'),
      renderHTML: (attributes: Record<string, unknown>) =>
        Number(attributes.spaceBefore) > 0 ? { style: `margin-top: ${Number(attributes.spaceBefore)}px` } : {},
    },
    spaceAfter: {
      default: 0,
      parseHTML: (element: HTMLElement) => parsePx(element, 'margin-bottom'),
      renderHTML: (attributes: Record<string, unknown>) =>
        Number(attributes.spaceAfter) > 0 ? { style: `margin-bottom: ${Number(attributes.spaceAfter)}px` } : {},
    },
  }
}

/**
 * 缩进该记在哪个节点上：块本身若在列表项里，就往**最近的那一层 `li`** 上记（这样序号会一起右移）；
 * 否则记在块自己身上。
 */
function resolveIndentHost(
  doc: ProseMirrorNode,
  pos: number,
): { pos: number; node: ProseMirrorNode } {
  /* nodesBetween 给的 pos 是节点**起始**位置，resolve 出来的位置就落在它前面：
     `$pos.parent` 是父节点，向上找最近的 listItem 就是承载者 */
  const $pos = doc.resolve(pos)
  for (let depth = $pos.depth; depth > 0; depth -= 1) {
    const node = $pos.node(depth)
    if (node.type.name === 'listItem') return { pos: $pos.before(depth), node }
  }
  return { pos, node: $pos.nodeAfter ?? $pos.parent }
}

/**
 * 逐段改缩进。不用 `updateAttributes`：它是「把选中的同类节点全部设成同一个值」，而多段一起缩进时
 * 每段的**当前级别未必相同**（三段里有一段已经缩过一级），必须逐节点按自身当前值增减。
 */
function shiftIndent(blockTypes: string[], levels: number, delta: number) {
  return ({ tr, state, dispatch }: CommandProps) => {
    const { from, to } = state.selection
    /* 按承载者去重：一个列表项里有两个段落时，两个候选会落到同一个 li 上 */
    const targets = new Map<number, Record<string, unknown>>()
    state.doc.nodesBetween(from, to, (node, pos) => {
      if (!blockTypes.includes(node.type.name)) return
      const host = resolveIndentHost(state.doc, pos)
      const current = Number(host.node.attrs.indentLevel ?? 0)
      const next = Math.min(Math.max(current + delta, 0), levels)
      if (next === current) return
      targets.set(host.pos, { ...host.node.attrs, indentLevel: next })
    })
    /* 先收集再改：遍历途中改文档会让后续 pos 全部错位 */
    if (!targets.size) return false
    if (dispatch) targets.forEach((attrs, pos) => tr.setNodeMarkup(pos, undefined, attrs))
    return true
  }
}

/**
 * 逐段合并属性。
 *
 * 与 shiftIndent 同一套写法：先遍历收集（按 pos 去重）、再统一 dispatch。
 * `patch` 返回要并入的属性；返回 null 表示这一段本来就是目标值、不必进事务。
 */
function patchBlocks(blockTypes: string[], patch: (attrs: Record<string, unknown>) => Record<string, unknown> | null) {
  return ({ tr, state, dispatch }: CommandProps) => {
    const { from, to } = state.selection
    const targets: Array<{ pos: number; attrs: Record<string, unknown> }> = []
    state.doc.nodesBetween(from, to, (node, pos) => {
      if (!blockTypes.includes(node.type.name)) return
      const next = patch({ ...node.attrs })
      if (next) targets.push({ pos, attrs: next })
    })
    if (!targets.length) return false
    if (dispatch) targets.forEach(({ pos, attrs }) => tr.setNodeMarkup(pos, undefined, attrs))
    return true
  }
}

export const Indent = Extension.create<IndentOptions>({
  name: 'indent',

  addOptions() {
    /* heading 一并登记：标题与正文共享同一套段落盒模型（缩进 + 间距） */
    return { types: ['paragraph', 'heading'], levels: INDENT_LEVELS }
  },

  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          /* 与列表项那一份是同一份定义（分离出去只为两边口径一致） */
          indentLevel: indentLevelAttribute(),
          ...paragraphBoxAttributes(),
        },
      },
      {
        /* 列表项只吃 indentLevel —— 见文件头：序号跟着 li 走，而 text-indent / 段间距在 li 上
           会继承给段落，与段落自身那一份叠加 */
        types: ['listItem'],
        attributes: { indentLevel: indentLevelAttribute() },
      },
    ]
  },

  addCommands() {
    return {
      indent: () => shiftIndent(this.options.types, this.options.levels, 1),
      outdent: () => shiftIndent(this.options.types, this.options.levels, -1),

      toggleFirstLineIndent: () =>
        patchBlocks(this.options.types, (attrs) => {
          const next = Number(attrs.firstLineChars) > 0 ? 0 : FIRST_LINE_DEFAULT
          return { ...attrs, firstLineChars: next }
        }),

      setFirstLineChars: (chars: number) =>
        patchBlocks(this.options.types, (attrs) => {
          const next = norm(chars, INDENT_CHARS_MAX)
          return Number(attrs.firstLineChars) === next ? null : { ...attrs, firstLineChars: next }
        }),

      setParagraphIndent: (value) =>
        patchBlocks(this.options.types, (attrs) => {
          const left = value.left === undefined ? Number(attrs.indentLeftChars) : norm(value.left, INDENT_CHARS_MAX)
          const right = value.right === undefined ? Number(attrs.indentRightChars) : norm(value.right, INDENT_CHARS_MAX)
          if (Number(attrs.indentLeftChars) === left && Number(attrs.indentRightChars) === right) return null
          return { ...attrs, indentLeftChars: left, indentRightChars: right }
        }),

      setParagraphSpacing: (value) =>
        patchBlocks(this.options.types, (attrs) => {
          const before = value.before === undefined ? Number(attrs.spaceBefore) : norm(value.before, SPACING_PX_MAX)
          const after = value.after === undefined ? Number(attrs.spaceAfter) : norm(value.after, SPACING_PX_MAX)
          if (Number(attrs.spaceBefore) === before && Number(attrs.spaceAfter) === after) return null
          return { ...attrs, spaceBefore: before, spaceAfter: after }
        }),
    }
  },

  addKeyboardShortcuts() {
    return {
      /* 列表里的 Tab / Shift-Tab 是「升降级」（ListItem 自己绑的），表格里是「下一格」（Table 绑的）。
         同优先级的键位按注册顺序倒序生效，本扩展注册在 StarterKit 之后，按键会先落到这里 ——
         这两处必须返回 false 让路，否则列表按 Tab 不再进级、表格按 Tab 不再跳格。 */
      Tab: ({ editor }) => {
        if (editor.isActive('listItem') || editor.isActive('table')) return false
        return editor.commands.indent()
      },
      'Shift-Tab': ({ editor }) => {
        if (editor.isActive('listItem') || editor.isActive('table')) return false
        return editor.commands.outdent()
      },
    }
  },
})
