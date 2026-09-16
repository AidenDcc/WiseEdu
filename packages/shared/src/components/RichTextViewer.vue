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
}
/* 行内根元素（span）下，内部段落不能再是块级，否则同样会撑破父级行内布局。
   块级公式本身就该独占一行，排除在外。 */
.rich-text.is-inline :deep(p),
.rich-text.is-inline :deep(div:not([data-type='block-math'])) { display: inline; }
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
.rich-text :deep(ol) { list-style: decimal; }
.rich-text :deep(li) { margin-bottom: 4px; }

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
