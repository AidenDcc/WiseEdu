/**
 * 字色。与官方 `@tiptap/extension-text-style` 的 Color 只差 `parseHTML` 多折了一步。
 *
 * 官方读的是 `getStyleProperty(element, 'color')` —— 那是**浏览器归一化后**的值，
 * `color: #c0272d` 读回来是 `rgb(192, 39, 45)`。内存里的 attrs 因此是 rgb 形态，会带来两个问题：
 * 1. 工具栏的色板比对（拿 `RTE_COLORS` 里的 `#c0272d` 去比当前色）永远不相等 ——
 *    用户选完红保存再打开，色板上不再高亮任何一格；
 * 2. 导出的 Word HTML 只认 #hex。
 *
 * 所以在解析这一步就折回 hex，让文档 attrs 与「库里存的那一份」同形。
 * 序列化侧改不了（CSSOM 输出 rgb 是浏览器行为，见 shared/utils/richtext.ts 的 toHexColor），
 * 那一头由富文本净化在写库前兜住。
 *
 * 用法：注册本扩展**替代** Color（它是 Color.extend，命令 setColor / unsetColor 都继承下来）。
 */
import { getStyleProperty } from '@tiptap/core'
import { Color } from '@tiptap/extension-text-style'
import { toHexColor } from '@aiteach/shared'

export const HexColor = Color.extend({
  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          color: {
            default: null,
            parseHTML: (element: HTMLElement) => {
              /* 折不动就原样留着：交给净化那一关去判（它同样只放行 #hex） */
              const value = getStyleProperty(element, 'color') ?? element.style.color
              if (!value) return null
              return toHexColor(value) ?? value.replace(/['"]+/g, '')
            },
            renderHTML: (attributes: { color?: string | null }) =>
              attributes.color ? { style: `color: ${attributes.color}` } : {},
          },
        },
      },
    ]
  },
})
