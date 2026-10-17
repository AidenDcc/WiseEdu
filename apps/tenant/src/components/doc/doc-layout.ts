/**
 * 「版式预览」的样式 —— 也就是**发下去 / 归档的那一份**长什么样。
 *
 * ## 为什么样式是一段字符串，而不是 .vue 里的 `<style scoped>`
 *
 * 预览要能**原样打印**。打印走的是临时 iframe 里写一份独立 HTML（见 doc-print.ts），
 * 而 scoped 样式带 `data-v-xxxx` 哈希、又只存在于当前页面的样式表里 —— 抄不进 iframe。
 * 于是同一套版式会出现两副面孔：屏幕上排得整整齐齐，一打印全散。
 *
 * 把样式收成一段纯字符串，屏幕端注入到 `<head>`、打印端拼进 iframe，两处**同一份文本**，
 * 结构不会再分叉。代价是类名必须自己维护前缀（`dl-`），并且不能再用 `:deep()`。
 *
 * ## 与「纸面预览」的分工
 *
 * - 纸面预览（DocPreviewDialog 的第一个页签）画的是**编辑器里的正文**，字体字号页边距
 *   全部来自「全局设置 → 页面设置」，与打印正文完全一致；
 * - 这里的版式画的是**另一件事**：教案那张正式教案纸（环节表格）、学案/讲义那份带题的稿子
 *   （答案只存在题库里，正文里根本没有）。所以两者不是同一份内容，只是装在同一张纸上。
 *
 * 纸张本身（210mm 宽、页边距、字体基线）由预览弹窗的 `.pv-paper` 提供 —— 版式只管
 * 「这张纸上怎么排」，不再自己画一张纸。
 */

/** 版式正文的类名前缀，统一挂在容器上（见各页的 `#preview-layout` 插槽） */
export const DL_ROOT = 'dl'

/**
 * 版式样式表。
 *
 * 尺寸都用 `em`：纸张的正文基线由页面设置决定（可能是五号也可能小四），
 * 版式内部的比例应该跟着它走，写死 px 会让「小四」的稿子标题显得很小。
 */
export const DOC_LAYOUT_CSS = `
/* ===== 抬头 ===== */
.dl { color: #1c2434; }
.dl-head { text-align: center; padding-bottom: 10px; border-bottom: 2px solid #1c2434; margin-bottom: 16px; }
.dl-title { font-size: 1.75em; font-weight: 700; line-height: 1.35; margin: 0; }
.dl-sub { font-size: 0.9em; color: #5b6475; margin: 6px 0 0; }
.dl-note { font-size: 0.92em; color: #2f3846; margin: 8px 0 0; letter-spacing: 0.4px; }

/* ===== 节 ===== */
.dl-sec { margin: 0 0 14px; }
.dl-sec-h { display: flex; align-items: baseline; gap: 7px; font-size: 1.1em; font-weight: 700; margin: 0 0 7px; }
.dl-sec-no { color: #2454c8; }
.dl-kv { margin: 0 0 7px; line-height: 1.75; }
.dl-kv > b { display: inline-block; min-width: 6.5em; font-weight: 700; }
.dl-empty { color: #8a93a5; }

/* ===== 教学过程表（教案专用：环节 / 教师活动 / 学生活动 / 设计意图 / 时长） ===== */
.dl-table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 0.94em; }
.dl-table th, .dl-table td { border: 1px solid #97a1b3; padding: 6px 8px; vertical-align: top; }
.dl-table th { background: #eef1f7; font-weight: 700; text-align: center; }
.dl-table td.is-center { text-align: center; }
.dl-table td.is-time { text-align: center; white-space: nowrap; }
.dl-step-name { font-weight: 700; }

/* ===== 题目（学案 / 讲义 / 教案的例题） ===== */
.dl-q { margin: 0 0 10px; }
.dl-q-head { font-weight: 700; }
.dl-ans-line { margin: 6px 0 0; color: #5b6475; letter-spacing: 0.5px; }
.dl-ans { margin: 6px 0 0; padding: 7px 10px; background: #f6f9fc; border-left: 3px solid #2f6fed; font-size: 0.94em; line-height: 1.7; }
.dl-ans > p { margin: 0 0 3px; }
.dl-ans > p:last-child { margin-bottom: 0; }
.dl-ans b { color: #2454c8; }

/* ===== 选项（QuestionOptions 的样式是 scoped 的，打印时抄不进 iframe，这里补一份） ===== */
.dl .qo { display: flex; flex-direction: column; gap: 3px; list-style: none; padding: 0; margin: 4px 0 0; }
.dl .qo-cols-2 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
.dl .qo-cols-4 { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); }
.dl .qo li { display: flex; align-items: baseline; gap: 8px; min-width: 0; line-height: 1.75; }
.dl .qo-key { font-weight: 700; color: #5b6475; flex-shrink: 0; }
.dl .qo-doc .qo-key::after { content: '．'; }

/* ===== 富文本（RichTextViewer 的 .rich-text 也是 scoped 的，同上） ===== */
.dl .rich-text p { margin: 0 0 6px; }
.dl .rich-text p:last-child { margin-bottom: 0; }
.dl .rich-text h1 { font-size: 1.45em; margin: 12px 0 6px; }
.dl .rich-text h2 { font-size: 1.25em; margin: 12px 0 6px; }
.dl .rich-text h3 { font-size: 1.1em; margin: 10px 0 5px; }
.dl .rich-text ul, .dl .rich-text ol { padding-left: 22px; margin: 0 0 6px; }
.dl .rich-text img { max-width: 100%; height: auto; }
.dl .rich-text table { border-collapse: collapse; width: 100%; table-layout: fixed; }
.dl .rich-text td, .dl .rich-text th { border: 1px solid #999; padding: 4px 8px; vertical-align: top; }
.dl .rich-text th { background: #f2f2f2; }

/* 空态：版式这一份没有任何内容时说清「为什么空、去哪儿补」，别只留一张白纸 */
.dl-blank { padding: 40px 0; text-align: center; color: #8a93a5; line-height: 1.9; }
`

const STYLE_ID = 'doc-layout-css'

/**
 * 把版式样式注入 `<head>`（幂等）。
 *
 * 只做一次：这是一份全站共用的样式表，多个预览弹窗反复开关不该重复插入。
 * 卸载时不摘 —— 摘掉会让同时打开着的另一个预览突然掉样式，而这段 CSS 只有几 KB。
 */
export function ensureLayoutCss(): void {
  if (document.getElementById(STYLE_ID)) return
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = DOC_LAYOUT_CSS
  document.head.appendChild(style)
}
