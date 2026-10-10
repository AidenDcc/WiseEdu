/**
 * 单下划线。与官方 `@tiptap/extension-underline` 只差 `parseHTML` 里的一个条件。
 *
 * 原版把「`text-decoration` 里含 underline 就算命中」写死了：
 * ```
 * { style: 'text-decoration', consuming: false, getAttrs: (s) => s.includes('underline') ? {} : false }
 * ```
 * 于是 `text-decoration: underline wavy` 会被**同时**解析成「单下划线 mark」＋「textDecoration=wavy」，
 * 卷面上就出现两条线；而且打开一次再保存，`<u>` 就被固化进库里，越存越脏。
 *
 * 这里把 style 分支收紧成只认朴素的 `underline`：带 wavy / double 的一律交给
 * `textDecoration.ts`（波浪线与双下划线在那里承载）。`<u>` 标签那条照旧 —— 单下划线本来就用 `<u>` 存。
 *
 * 用法：`StarterKit.configure({ underline: false })` 关掉原版，注册这一版（同名扩展不能注册两次）。
 */
import { Underline } from '@tiptap/extension-underline'

export const PlainUnderline = Underline.extend({
  parseHTML() {
    return [
      { tag: 'u' },
      {
        style: 'text-decoration',
        consuming: false,
        getAttrs: (style: string) =>
          (/underline/i.test(style) && !/wavy|double/i.test(style) ? {} : false),
      },
    ]
  },
})
