/**
 * 有序列表序号样式：在官方 OrderedList 上补一个 `listStyle` 属性，承接三种没有原生 HTML 对应的序号
 * （① / (1) / 一、），其余五种（1. I. i. A. a.）继续走内置的 `type` 属性。
 *
 * 分工的由来：`<ol type>` 只认 1 / a / A / i / I 五个值，浏览器的 `list-style-type` 对中文与带圈序号
 * 也没有对应关键字（`cjk-ideographic` 只给「一、二、」，没有 ①）。所以自定义的三种只能落
 * `list-style-type: <自定义 counter-style 名>`，而 counter-style 必须定义在**文档级 CSS** 里
 * （apps/tenant/src/styles/main.css 与 paper-export 的 baseCss），scoped 样式里写不生效。
 *
 * 序列化：`<ol type="A">` 或 `<ol style="list-style-type: circled-number">`，二者互斥 —— 选一种就清掉另一种，
 * 免得 `type` 与内联样式同时存在时靠 CSS 优先级打架（内联样式会赢，但存下来的 HTML 会自相矛盾）。
 * 白名单里 `ol` 已放行 `type` / `start` / `style`，见 packages/shared/src/utils/richtext.ts。
 */
import { OrderedList } from '@tiptap/extension-list'
import { RICH_LIST_MARKERS, RICH_COUNTER_STYLES } from '@aiteach/shared'

/** 需要存进 `listStyle` 的值（自定义 counter-style 名） */
type CounterStyle = (typeof RICH_COUNTER_STYLES)[number]

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    listMarker: {
      /** 按 RICH_LIST_MARKERS 的 key 切换当前有序列表的序号样式；不在列表里先建一个 */
      setListMarker: (key: string) => ReturnType
    }
  }
}

const isCounterStyle = (value: string | null): value is CounterStyle =>
  !!value && (RICH_COUNTER_STYLES as readonly string[]).includes(value)

export const ListMarker = OrderedList.extend({
  addAttributes() {
    return {
      /* 必须显式摊开父级：extend 时子级一旦定义了 addAttributes，父级的不会被自动调用，
         start / type 两个原生属性会一起消失（列表起始序号与 1/a/A/i/I 全靠它们） */
      ...this.parent?.(),

      listStyle: {
        default: null,
        /* 只认自家三种：粘贴进来的 external HTML 里可能有 `list-style-type: square` 之类，
           不认的值当没设过，让内置 type 属性的解析器去处理 */
        parseHTML: (element) => {
          const value = (element as HTMLElement).style.getPropertyValue('list-style-type').trim()
          return isCounterStyle(value) ? value : null
        },
        renderHTML: (attributes) =>
          isCounterStyle(attributes.listStyle) ? { style: `list-style-type: ${attributes.listStyle}` } : {},
      },
    }
  },

  addCommands() {
    return {
      /* 不覆盖父级命令（toggleOrderedList 等），只补这一个 */
      ...this.parent?.(),

      setListMarker: (key) => ({ chain, editor }) => {
        const marker = RICH_LIST_MARKERS.find((item) => item.key === key)
        if (!marker) return false
        /* 两种通路互斥：选了原生 type 就把 listStyle 清空，反之把 type 归位到默认（渲染时省略） */
        const attrs = { type: marker.type ?? null, listStyle: marker.style ?? null }
        if (!editor.isActive('orderedList')) {
          return chain().toggleOrderedList().updateAttributes('orderedList', attrs).run()
        }
        return chain().updateAttributes('orderedList', attrs).run()
      },
    }
  },
})
