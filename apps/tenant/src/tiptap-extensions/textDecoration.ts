/**
 * 文字装饰扩展：波浪下划线与双重下划线（单下划线仍用 StarterKit 的 underline，落 `<u>`）。
 *
 * 为什么不另开一个 mark，而是挂在 textStyle 上：这三档下划线互斥，而字体 / 字号 / 颜色
 * 也都落在 textStyle 上。属性挂同一个 mark 时，Tiptap 的 `setMark` 会与已有 attrs 合并
 * （官方 Color / FontFamily 就靠这个协作），「黑体 + 小四 + 红色 + 波浪线」最终只产生
 * **一个** span 的四条声明，而不是四层嵌套 span。写法照 @tiptap/extension-text-style 的 FontSize。
 *
 * 序列化成本 `<span style="text-decoration: underline wavy">`：不用 class 承接 ——
 * sanitizeRichHtml 会剥掉 class，导出的 Word HTML 也只认内联样式，落 class 等于只在编辑器里好看。
 */
import { Extension, getStyleProperty } from '@tiptap/core'
/* 只为让本文件解析到这个包：下面的 declare module 是「扩写」而不是「新建」，TS 要求同文件里
   真的存在一次导入（TS2664），光在别的文件里 import 不算数 */
import type {} from '@tiptap/extension-text-style'

/** 工具栏下划线菜单的四档：单下划线 / 波浪线 / 双重下划线 / 取消 */
export type UnderlineStyle = 'single' | 'wavy' | 'double' | 'none'
/** 需要走 textStyle 的两档（单下划线不走这里） */
export type TextDecorationStyle = 'wavy' | 'double'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    textDecoration: {
      setTextDecoration: (value: TextDecorationStyle) => ReturnType
      unsetTextDecoration: () => ReturnType
      /** 四档互斥切换：单下划线落到 `<u>`，另外两档落到 text-decoration 内联样式 */
      setUnderlineStyle: (style: UnderlineStyle) => ReturnType
    }
  }
}

declare module '@tiptap/extension-text-style' {
  interface TextStyleAttributes {
    textDecoration?: TextDecorationStyle | null
  }
}

export const TextDecoration = Extension.create({
  name: 'textDecoration',

  addGlobalAttributes() {
    return [
      {
        types: ['textStyle'],
        attributes: {
          textDecoration: {
            default: null,
            /* 只认 wavy / double：同一段文字上还可能挂着别处来的 text-decoration（如 line-through），
               不把它当成本扩展的值，免得来回一趟把别人的样式改写成下划线 */
            parseHTML: (element) => {
              const value = getStyleProperty(element, 'text-decoration')
              const matched = value ? /\b(wavy|double)\b/i.exec(value) : null
              return matched ? (matched[1].toLowerCase() as TextDecorationStyle) : null
            },
            renderHTML: (attributes) =>
              attributes.textDecoration
                ? { style: `text-decoration: underline ${attributes.textDecoration}` }
                : {},
          },
        },
      },
    ]
  },

  addCommands() {
    return {
      setTextDecoration: (value) => ({ chain }) =>
        chain().setMark('textStyle', { textDecoration: value }).run(),

      /* 只摘掉 textDecoration，同 span 上的字体 / 字号 / 颜色必须留着 —— 所以是「把这条属性置空 +
         清掉已经没有声明的 span」，而不是 unsetMark('textStyle')。与官方 unsetColor 同一写法。 */
      unsetTextDecoration: () => ({ chain }) =>
        chain().setMark('textStyle', { textDecoration: null }).removeEmptyTextStyle().run(),

      setUnderlineStyle: (style) => ({ chain }) => {
        /* 两条下划线通路互斥：不先撤另一侧，`<u>` 与 text-decoration 会叠出两条线 */
        if (style === 'single') return chain().unsetTextDecoration().toggleMark('underline').run()
        if (style === 'none') return chain().unsetTextDecoration().unsetMark('underline').run()
        return chain().unsetMark('underline').setTextDecoration(style).run()
      },
    }
  },
})
