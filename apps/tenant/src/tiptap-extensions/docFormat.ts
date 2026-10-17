/**
 * 教案 / 学案 / 讲义「文档编辑器」的 Word 式排版扩展集。
 *
 * 与录题富文本（RichTextEditor）的差别在于**版面的重心不同**：录题编辑器排的是题干与选项，
 * 段落只需要对齐与缩进；备课文档是一份完整排版稿，段落还要有行距、段落样式、上下标、底纹高亮
 * 与分页符 —— 这五件事 Tiptap 官方包不全（LineHeight 在 text-style 里有、但对齐 / 上下标 /
 * 分页符都没有），所以在这里一次性补齐，页面只注册这一个扩展，避免在编辑器里散落一串小扩展。
 *
 * **一律落到内联样式、且只用净化白名单里放行的那几个属性**：段落对齐走 `text-align`、
 * 行距走 `line-height`。它们都挂在**段落 / 标题自身**而不是包一层容器 —— 与 indent.ts 的理由相同
 * （回车换段时 attrs 会被 ProseMirror 自动复制，行距与对齐因此天然继承），导出 Word 也不会多出空段。
 *
 * 上下标用 `<sup>` / `<sub>` 标签而不是 `vertical-align` 内联样式：后者不在白名单里，
 * 保存一次就会被净化掉；而 sup / sub 在白名单的标签集里，Word 也认。
 */
import { Extension, Mark, Node, getStyleProperty, type CommandProps } from '@tiptap/core'
import { BackgroundColor } from '@tiptap/extension-text-style'
import { toHexColor } from '@aiteach/shared'

/** 承载段落级排版（对齐 / 行距）的块类型：正文与各级标题 */
export const DOC_BLOCK_TYPES = ['paragraph', 'heading']

export type DocAlign = 'left' | 'center' | 'right' | 'justify'

export const DOC_ALIGN_TEXT: Record<DocAlign, string> = {
  left: '左对齐',
  center: '居中对齐',
  right: '右对齐',
  justify: '两端对齐',
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    docFormat: {
      /** 设置选中段落的对齐方式；传 'left' 等于清除（左对齐是默认值，不留内联样式） */
      setBlockAlign: (align: DocAlign) => ReturnType
      /** 设置选中段落的行距（'1.5' / '24px' / '150%'）；传 null 回到默认 */
      setBlockLineHeight: (value: string | null) => ReturnType
      toggleSuperscript: () => ReturnType
      toggleSubscript: () => ReturnType
      insertPageBreak: () => ReturnType
    }
  }
}

/**
 * 逐块改属性。
 *
 * 不用 `updateAttributes`：它是「把选区内的同类节点一律设成同一个值」，而多段一起排版时
 * 每段的当前值未必相同（三段里有一段已经是居中），必须逐节点按自身情况决定写什么。
 * 与 indent.ts 的 shiftIndent 同一套做法（先收集、再统一 dispatch，避免遍历途中改文档导致 pos 错位）。
 */
function mapBlocks(
  types: string[],
  build: (attrs: Record<string, unknown>) => Record<string, unknown> | null,
) {
  return ({ tr, state, dispatch }: CommandProps) => {
    const { from, to } = state.selection
    const targets: Array<{ pos: number; attrs: Record<string, unknown> }> = []
    state.doc.nodesBetween(from, to, (node, pos) => {
      if (!types.includes(node.type.name)) return
      const next = build({ ...node.attrs })
      if (next) targets.push({ pos, attrs: next })
    })
    if (!targets.length) return false
    if (dispatch) targets.forEach(({ pos, attrs }) => tr.setNodeMarkup(pos, undefined, attrs))
    return true
  }
}

/**
 * 段落对齐。
 *
 * `left` 不写内联样式（清掉属性即可）：左对齐是浏览器默认值，落一个
 * `style="text-align: left"` 只会让导出稿到处是冗余声明，也会让「有没有设过」的判断失真。
 */
export const DocTextAlign = Extension.create({
  name: 'docTextAlign',

  addGlobalAttributes() {
    return [
      {
        types: DOC_BLOCK_TYPES,
        attributes: {
          textAlign: {
            default: null,
            parseHTML: (element: HTMLElement) => {
              const value = (getStyleProperty(element, 'text-align') ?? '').trim().toLowerCase()
              return ['left', 'center', 'right', 'justify'].includes(value) ? value : null
            },
            renderHTML: (attributes: { textAlign?: string | null }) =>
              attributes.textAlign && attributes.textAlign !== 'left'
                ? { style: `text-align: ${attributes.textAlign}` }
                : {},
          },
        },
      },
    ]
  },

  addCommands() {
    return {
      setBlockAlign: (align: DocAlign) =>
        mapBlocks(DOC_BLOCK_TYPES, (attrs) => (attrs.textAlign === align ? null : { ...attrs, textAlign: align === 'left' ? null : align })),
    }
  },
})

/**
 * 行距。
 *
 * 值统一存字符串：无单位倍数（`1.5`）与带单位长度（`24px` / `150%`）都合法，多一层换算
 * 反而会在「工具栏显示什么」上引入两份口径。写进文档的是 `line-height: 1.5` 这种原样值。
 */
export const DocLineHeight = Extension.create({
  name: 'docLineHeight',

  addGlobalAttributes() {
    return [
      {
        types: DOC_BLOCK_TYPES,
        attributes: {
          lineHeight: {
            default: null,
            parseHTML: (element: HTMLElement) => {
              const value = (getStyleProperty(element, 'line-height') ?? '').trim()
              return value || null
            },
            renderHTML: (attributes: { lineHeight?: string | null }) =>
              attributes.lineHeight ? { style: `line-height: ${attributes.lineHeight}` } : {},
          },
        },
      },
    ]
  },

  addCommands() {
    return {
      setBlockLineHeight: (value: string | null) =>
        mapBlocks(DOC_BLOCK_TYPES, (attrs) => (value === null ? (attrs.lineHeight ? { ...attrs, lineHeight: null } : null) : { ...attrs, lineHeight: value })),
    }
  },
})

/**
 * 上标。`excludes: 'subscript'` 让两者互斥 —— 同时挂两个只会得到「又高又低」的鬼影。
 * 快捷键对齐 Word 的习惯：Ctrl/Cmd + Shift + .（上标）/ ,（下标）。
 */
export const SuperScript = Mark.create({
  name: 'superscript',
  excludes: 'subscript',
  parseHTML() {
    return [{ tag: 'sup' }]
  },
  renderHTML() {
    return ['sup', 0]
  },
  addCommands() {
    return {
      toggleSuperscript: () => ({ commands }) => commands.toggleMark(this.name),
    }
  },
  addKeyboardShortcuts() {
    return { 'Mod-Shift-.': () => this.editor.commands.toggleSuperscript() }
  },
})

export const SubScript = Mark.create({
  name: 'subscript',
  excludes: 'superscript',
  parseHTML() {
    return [{ tag: 'sub' }]
  },
  renderHTML() {
    return ['sub', 0]
  },
  addCommands() {
    return {
      toggleSubscript: () => ({ commands }) => commands.toggleMark(this.name),
    }
  },
  addKeyboardShortcuts() {
    return { 'Mod-Shift-,': () => this.editor.commands.toggleSubscript() }
  },
})

/**
 * 底纹高亮（Word 的「突出显示」）。
 *
 * 与官方 BackgroundColor 只差 `parseHTML` 多折了一步：官方读回的是浏览器归一化的 `rgb(...)`，
 * 与工具栏色板里的 `#hex` 对不上，色板会永远不高亮。理由与 tiptap-extensions/color.ts 完全一致。
 * 高亮落在**字形**上（textStyle span），而不是段落底纹 —— 与 Word 的「突出显示」同义。
 */
export const HexBackgroundColor = BackgroundColor.extend({
  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          backgroundColor: {
            default: null,
            parseHTML: (element: HTMLElement) => {
              const value = getStyleProperty(element, 'background-color') ?? element.style.backgroundColor
              if (!value) return null
              return toHexColor(value) ?? null
            },
            renderHTML: (attributes: { backgroundColor?: string | null }) =>
              attributes.backgroundColor ? { style: `background-color: ${attributes.backgroundColor}` } : {},
          },
        },
      },
    ]
  },
})

/**
 * 分页符。
 *
 * 用 `div[data-type=page-break]` 而不是 `hr`：StarterKit 的 horizontalRule 也匹配 `hr`，
 * 两个节点类型抢同一个标签，解析时谁赢取决于注册顺序 —— 一份文档里两种东西会长得一样。
 * `data-type` 是净化白名单里的**全局属性**，任何标签都留得住，所以这个标记不会被保存一次就丢掉。
 *
 * `atom: true` + `selectable: false`：分页符是一个「整体记号」，光标进不去、也不该被框选中的
 * 文本操作改写；要删就整块删。打印稿靠 CSS 的 `break-after: page` 真正分页（见 DocEditor.vue）。
 */
export const DocPageBreak = Node.create({
  name: 'pageBreak',
  group: 'block',
  atom: true,
  selectable: false,

  parseHTML() {
    return [{ tag: 'div[data-type="page-break"]' }]
  },

  renderHTML() {
    return ['div', { 'data-type': 'page-break' }]
  },

  addCommands() {
    return {
      insertPageBreak: () => ({ commands }) => commands.insertContent({ type: this.name }),
    }
  },
})
