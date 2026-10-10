/**
 * 段落缩进：`indentLevel`（整体左缩进）+ `firstLineIndent`（首行缩进两格）两个属性。
 * `indentLevel` 挂在段落、标题**与列表项**上，`firstLineIndent` 只挂段落与标题。
 *
 * 为什么是全局属性而不是包一层 div：卷面里「缩进」是对**段落**的排版（语文卷的答题空、数学卷的条件
 * 分行），套容器会多一层结构，导出 Word 时多一层 div 会带出多余的空行段。挂到段落上还能白拿一件事 ——
 * 回车换段时 ProseMirror 分裂文本块会复制节点 attrs，**缩进自动继承**，不需要为「换行自动缩进」写代码。
 * 有序列表的续号同理，由列表本身负责。
 *
 * 为什么列表项也要吃 `indentLevel`：列表标记（序号 / 圆点）画在 `li` 的盒子**外侧**，跟着 `li` 走。
 * 进入列表后把缩进记在段落上（`<li><p style="margin-left: 2em">`），只有文字往右挪，序号原地不动 ——
 * 看着就是「序号没跟着缩进」。记到 `li` 上则整个列表项连同序号一起右移（见 resolveIndentHost）。
 * 反过来 `firstLineIndent` 不能给 `li`：`text-indent` 是继承属性，写在 `li` 上会传给里面的段落，
 * 与段落自身那一份叠加成「缩进两格又两格」。
 *
 * 值只存数字与布尔，渲染成本仓库约定的内联样式（`margin-left: 2em` / `text-indent: 2em`），
 * 两端渲染与 Word 导出都认；净化白名单里放行的正是这两个属性。
 */
import { Extension, getStyleProperty, type CommandProps } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'

/** 与缩进按钮的档数一致：8 级，一级 2em */
export const INDENT_LEVELS = 8
const INDENT_STEP_EM = 2
/** 首行缩进固定两格（中文排版惯例），不做可调 */
const FIRST_LINE_INDENT = '2em'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    indent: {
      indent: () => ReturnType
      outdent: () => ReturnType
      toggleFirstLineIndent: () => ReturnType
    }
  }
}

export interface IndentOptions {
  /** 参与缩进的块级节点 */
  types: string[]
  /** 最大缩进级别 */
  levels: number
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

export const Indent = Extension.create<IndentOptions>({
  name: 'indent',

  addOptions() {
    /* heading 一并登记：本编辑器当前关掉了标题，但 attributes 是按类型名登记的，
       名字不存在只是不生效，不会报错；哪天打开标题也不用回来改 */
    return { types: ['paragraph', 'heading'], levels: INDENT_LEVELS }
  },

  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          /* 与列表项那一份是同一份定义（分离出去只为两边口径一致） */
          indentLevel: indentLevelAttribute(),
          firstLineIndent: {
            default: false,
            parseHTML: (element) => (getStyleProperty(element, 'text-indent') ?? '').trim() === FIRST_LINE_INDENT,
            renderHTML: (attributes) => (attributes.firstLineIndent ? { style: `text-indent: ${FIRST_LINE_INDENT}` } : {}),
          },
        },
      },
      {
        /* 列表项只吃 indentLevel —— 见文件头：序号跟着 li 走，而 text-indent 在 li 上会继承给段落 */
        types: ['listItem'],
        attributes: { indentLevel: indentLevelAttribute() },
      },
    ]
  },

  addCommands() {
    return {
      indent: () => shiftIndent(this.options.types, this.options.levels, 1),
      outdent: () => shiftIndent(this.options.types, this.options.levels, -1),

      toggleFirstLineIndent: () => ({ tr, state, dispatch }) => {
        const { from, to } = state.selection
        const targets: { pos: number; attrs: Record<string, unknown> }[] = []
        state.doc.nodesBetween(from, to, (node, pos) => {
          if (!this.options.types.includes(node.type.name)) return
          targets.push({ pos, attrs: { ...node.attrs, firstLineIndent: !node.attrs.firstLineIndent } })
        })
        if (!targets.length) return false
        if (dispatch) targets.forEach(({ pos, attrs }) => tr.setNodeMarkup(pos, undefined, attrs))
        return true
      },
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
