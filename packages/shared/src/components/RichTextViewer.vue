<script setup lang="ts">
/**
 * 题目富文本只读渲染（题干 / 选项 / 答案 / 解析通用）。
 *
 * 两点必须由本组件承担、调用方无法绕开：
 * 1. Tiptap 的 getHTML() 走 schema 序列化，公式节点只留 data-latex，KaTeX 渲染只存在于编辑器
 *    的 NodeView 里 —— 所以这里要补一次 renderMathIn。
 * 2. 历史数据是纯文本（100 道种子题为 Unicode 数学），必须继续原样显示，故按内容自动分流。
 */
import { computed, onMounted, ref, watch } from 'vue'
import { isRichContent, renderMathIn, sanitizeRichHtml } from '../utils/richtext'
import { resolveMediaIn } from '../utils/media-ref'
import 'katex/dist/katex.min.css'

const props = withDefaults(
  defineProps<{
    content: string
    /**
     * 根元素标签。嵌在既有 <p> 里时必须传 'span' —— 块级元素放进 <p> 会被浏览器提前闭合，
     * 导致渲染结果错位。
     */
    tag?: string
    /** 内容为空时的占位文案 */
    empty?: string
  }>(),
  { tag: 'div', empty: '' },
)

const el = ref<HTMLElement | null>(null)

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] as string
  ))
}

const safeHtml = computed(() => {
  const raw = props.content ?? ''
  if (!raw) return ''
  /* 历史纯文本：转义后交给 CSS 的 pre-wrap 保留换行，绝不当作 HTML 解析 */
  if (!isRichContent(raw)) return `<p class="rt-plain">${escapeHtml(raw)}</p>`
  /* 先净化再还原图片地址：两步都在写入 DOM 之前完成 */
  return resolveMediaIn(sanitizeRichHtml(raw))
})

/** 公式必须在 DOM 就位后渲染（KaTeX 直接把节点内容替换掉） */
function hydrate(): void {
  const root = el.value
  if (!root) return
  renderMathIn(root)
}

/* flush: 'post' 保证在 DOM 更新之后再处理 */
watch(() => props.content, () => hydrate(), { flush: 'post' })
onMounted(hydrate)
</script>

<template>
  <component
    :is="tag"
    v-if="safeHtml || empty"
    ref="el"
    class="rich-text"
    :class="{ 'is-inline': tag !== 'div' }"
    v-html="safeHtml || escapeHtml(empty)"
  />
</template>

<style scoped>
.rich-text {
  font-size: inherit;
  line-height: 1.8;
  color: inherit;
  word-break: break-word;
  /* 下划线离文字太近，抬开一点。text-underline-offset 是继承属性，写在这里即覆盖全文
     （`<u>` 与带 text-decoration 的 span 都吃这一条）。编辑器端与导出端各有一份同样的声明 ——
     三端一致是本仓库对富文本的硬要求。 */
  text-underline-offset: 0.2em;
}
/* 行内根元素（span）下，内部段落不能再是块级，否则同样会撑破父级行内布局。
   块级公式本身就该独占一行，排除在外。 */
.rich-text.is-inline :deep(p),
.rich-text.is-inline :deep(div:not([data-type='block-math'])) { display: inline; }
/* 表格是另一回事：被 display:inline 压平会散成一串文字，行列结构必须原样保留；
   宽度也收回来 —— 行内预览多在列表行 / 卡片预览里，撑满一行的表格会把版式顶起来。
   max-width 兜的是「用户给整表设过宽度」的那种（内联 width 会盖掉这里的 width: auto，
   900px 的表能直接把列表行撑破）—— 预览这端没有编辑器那样的横向滚动容器，
   压窄总好过撑破版式。只影响行内预览，试卷与导出的宽度不受影响。 */
.rich-text.is-inline :deep(table) { display: table; width: auto; max-width: 100%; margin: 4px 0; }
.rich-text.is-inline :deep(tr) { display: table-row; }
.rich-text.is-inline :deep(td),
.rich-text.is-inline :deep(th) { display: table-cell; }
/* 段落之间补一个空格，避免「题干解析」贴在一起 */
.rich-text.is-inline :deep(p:not(:last-child))::after { content: ' '; }
.rich-text.is-inline :deep(p) { margin: 0; }

/* 历史纯文本：保留原有换行与空白 */
.rich-text :deep(.rt-plain) { white-space: pre-wrap; margin: 0; }

.rich-text :deep(p) { margin: 0 0 8px; }
.rich-text :deep(p:last-child) { margin-bottom: 0; }

.rich-text :deep(img) {
  max-width: 100%;
  border-radius: 8px;
  vertical-align: middle;
}
/* height:auto 只留给没写高度的图：宽高属性都在的（编辑器里四边单向拉伸过的）要按属性渲染，
   否则 height:auto 会把垂直拉伸回弹成原比例 */
.rich-text :deep(img:not([height])) { height: auto; }

.rich-text :deep(ul),
.rich-text :deep(ol) { margin: 0 0 8px; padding-left: 22px; }
.rich-text :deep(ul) { list-style: disc; }
/* 有序列表的序号全权交给浏览器按 `type` 属性（1 / a / A / i / I）画，这一条只兜住「没设过序号」的列表。
   **不要在这里补 `ol[type='a'] { list-style: lower-alpha }` 那类规则** —— 看着更直白，实则是错的：
   HTML 文档里属性选择器对 `type` 这种值是大小写不敏感地匹配的，`[type='a']` 会连 `type="A"` 一起命中，
   于是后写的那条（upper-*）通吃，**i / a 永远显示成 I / A**（这个 bug 真出现过）。
   浏览器 UA 样式表里的同一套映射带 `s` 大小写标志，是唯一能区分大小写的地方，所以这里只让路、不接管。
   （①、(1)、一、走的是内联 list-style-type，天然压过作者样式，也不需要在这里列。） */
.rich-text :deep(ol:not([type])) { list-style: decimal; }
.rich-text :deep(li) { margin-bottom: 4px; }

/* 表格：与编辑器（RichTextEditor.vue）和导出（apps/tenant/src/utils/paper-export.ts 的 baseCss）
   三处保持一致 —— 列宽靠 <colgroup><col style="width">，行高靠 <tr style="height">，都在行内 */
.rich-text :deep(table) {
  border-collapse: collapse;
  /* fixed 才能让 colgroup 上的 px 宽度说了算（auto 布局会按内容重新分配） */
  table-layout: fixed;
  width: 100%;
  margin: 0 0 8px;
}
.rich-text :deep(td),
.rich-text :deep(th) {
  position: relative;
  vertical-align: top;
  min-width: 25px;
  padding: 4px 8px;
  border: 1px solid var(--border);
}
.rich-text :deep(th) { background: #f4f6fa; font-weight: 600; }
/* 单元格里 Tiptap 一定包一层 <p>，那层默认的 8px 下边距会把行撑虚 */
.rich-text :deep(td > p),
.rich-text :deep(th > p) { margin: 0; }

.rich-text :deep(blockquote) {
  border-left: 3px solid var(--border);
  padding-left: 10px;
  color: var(--sub);
  margin: 0 0 8px;
}

.rich-text :deep(code) {
  background: #f1f3f9;
  border-radius: 5px;
  padding: 1px 5px;
  font-size: 0.92em;
}
.rich-text :deep(pre) {
  background: #f1f3f9;
  border-radius: 8px;
  padding: 10px 12px;
  overflow-x: auto;
}
.rich-text :deep(pre code) { background: none; padding: 0; }

.rich-text :deep(h1),
.rich-text :deep(h2),
.rich-text :deep(h3),
.rich-text :deep(h4) { margin: 0 0 8px; font-size: 1.05em; font-weight: 700; }

/* 公式：行内与正文基线对齐，块级居中独立成行 */
.rich-text :deep([data-type='inline-math']) { display: inline-block; vertical-align: baseline; }
.rich-text :deep([data-type='block-math']) {
  display: block;
  text-align: center;
  margin: 10px 0;
  overflow-x: auto;
}
/* LaTeX 非法时的回退态：展示源码而非空白 */
.rich-text :deep(.rich-math-error) {
  color: var(--danger);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.9em;
}
</style>

<!--
  按序号样式渲染有序列表用的三条 @counter-style。故意**不写 scoped**：@counter-style 是文档级
  at-rule，scoped 只会给选择器加属性选择器，对它没有任何作用 —— 放在这里等于全局，正合适。

  为什么共享层也要有一份：机构端编辑器的那份在 apps/tenant/src/styles/main.css 里，而本组件同时被
  **管理端**使用（apps/admin/src/views/audit/ResourcesView.vue 审核机构端提交的题目），管理端并没有
  加载机构端的 main.css，只靠那一份的话 ①、(1)、一、 在审核页会退化成 1.。放在组件里则两端都覆盖到。
  换取的代价是机构端会同时命中 main.css 与本处的同名定义 —— 两份内容逐字相同，后加载者胜出，无差异。

  导出端（Word / 打印）是另一份文档，必须在 apps/tenant/src/utils/paper-export.ts 的 baseCss 里再写一份，
  三处互为指认。Word 不认 @counter-style，.doc 里这三种序号会退化成 1. —— 已知取舍。
-->
<style>
@counter-style circled-number {
  /* fixed 表：①–⑳ 只到 20，再多按 fallback 退成 21. —— 试卷小题号到不了这个量 */
  system: fixed;
  symbols: ① ② ③ ④ ⑤ ⑥ ⑦ ⑧ ⑨ ⑩ ⑪ ⑫ ⑬ ⑭ ⑮ ⑯ ⑰ ⑱ ⑲ ⑳;
  fallback: decimal;
  suffix: ' ';
}
@counter-style paren-number {
  system: extends decimal;
  prefix: '(';
  suffix: ') ';
}
@counter-style cjk-number {
  system: extends cjk-ideographic;
  suffix: '、';
}
</style>
