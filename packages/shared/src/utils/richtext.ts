/**
 * 富文本工具：题干 / 选项 / 答案 / 解析改为富文本后，所有「对纯字符串做操作」的地方
 * （搜索、截断、内容启发式、tooltip）都会撞上 HTML 标签，统一收敛到这里。
 *
 * 存储格式约定：正文为 HTML；未被编辑器改造过的历史数据（100 道种子题为纯文本 + Unicode 数学，
 * 如 `x²`、`∁ᵤB`）原样保留，由 isRichContent 识别后走纯文本分支，因此新旧数据可共存。
 */
import katex from './katex'

/**
 * 判断「这段字符串是不是 HTML」。
 *
 * 关键：容器类标签必须成对出现。若只认开标签，历史纯文本里一个孤立的 `<b>`（如
 * `已知 a<b>c`）就会被误判为富文本，净化后渲染成「a 加粗 c」—— 字面量 `<b>` 被静默吞掉。
 * 要求闭合标签后，这类纯文本走 isRichContent 的否分支，显示结果与改造前逐字节一致。
 */
const RICH_HINT = new RegExp(
  [
    /* 公式节点：无子节点，靠 data-type 识别 */
    'data-type="(?:inline|block)-math"',
    /* 以下三类是空元素，本身即充分证据 */
    '<img\\b[^>]*>',
    '<br\\s*/?>',
    '<hr\\s*/?>',
    /* 其余要求成对 */
    '<(p|div|ul|ol|li|h[1-6]|blockquote|pre|table|tr|td|th|strong|b|em|i|u|s|del|code|span|sub|sup|a)\\b[^>]*>[\\s\\S]*</\\1\\s*>',
  ].join('|'),
  'i',
)

/** v-html 前的白名单：编辑器自身产出的标签 + 图片 + 公式节点 */
const ALLOWED_TAGS = new Set([
  'p', 'div', 'br', 'span', 'strong', 'b', 'em', 'i', 'u', 's', 'del', 'code', 'pre',
  'blockquote', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'img', 'a', 'sub', 'sup', 'table', 'thead', 'tbody', 'tr', 'td', 'th', 'hr',
])

/** 通配允许的属性（Tiptap 公式节点靠 data-type / data-latex 承载 LaTeX 源码） */
const GLOBAL_ATTRS = new Set(['data-type', 'data-latex', 'title'])
const TAG_ATTRS: Record<string, Set<string>> = {
  img: new Set(['src', 'alt', 'width', 'height']),
  a: new Set(['href', 'target', 'rel']),
}
/** 需要校验协议的属性 */
const URL_ATTRS = new Set(['src', 'href'])

/** 整体丢弃（连子节点一起）而非解包的标签 */
const DROP_WITH_CHILDREN = new Set(['script', 'style', 'iframe', 'object', 'embed', 'form', 'link', 'meta'])

function parseHtml(html: string): Document {
  return new DOMParser().parseFromString(html, 'text/html')
}

function isDangerousUrl(value: string): boolean {
  const url = value.replace(/[\u0000-\u0020]/g, '').toLowerCase()
  if (url.startsWith('javascript:') || url.startsWith('vbscript:')) return true
  /* data: 只放行图片，挡掉 data:text/html 这类可执行载荷 */
  if (url.startsWith('data:')) return !url.startsWith('data:image/')
  return false
}

/** 内容是否已是富文本 HTML */
export function isRichContent(content: string): boolean {
  return !!content && RICH_HINT.test(content)
}

/**
 * 编辑器输出归一化：Tiptap 把空文档序列化成 `<p></p>`，而校验与存储都以空串表示「无内容」。
 * 不归一化的话，空题目会被 `'<p></p>'.trim()` 判为有值而放过。
 */
export function normalizeRichHtml(html: string): string {
  if (!html) return ''
  return toPlainText(html) || hasImage(html) ? html : ''
}

/** 内容里是否含图片（用于配图占位判断：已有真图就不必再显示占位框） */
export function hasImage(content: string): boolean {
  return /<img\b[^>]*>/i.test(content)
}

/** 富文本 → 纯文本：公式取 LaTeX 源码，块级元素补换行，最后压缩空白 */
export function toPlainText(content: string): string {
  if (!content) return ''
  /* 历史纯文本数据原样返回：保证 100 道种子题的行为与改造前完全一致 */
  if (!isRichContent(content)) return content

  const doc = parseHtml(content)
  /* 公式节点是叶子（无文本子节点），直接取 data-latex，否则搜索/截断会得到空串 */
  doc.querySelectorAll('[data-type="inline-math"],[data-type="block-math"]').forEach((el) => {
    el.textContent = el.getAttribute('data-latex') ?? ''
  })
  doc.querySelectorAll('br').forEach((el) => el.replaceWith('\n'))
  doc.querySelectorAll('p,div,li,h1,h2,h3,h4,h5,h6,blockquote,pre,tr').forEach((el) => el.append('\n'))
  return (doc.body.textContent ?? '').replace(/\s+/g, ' ').trim()
}

/** 先转纯文本再截断，替代直接对 HTML 调 .slice()（会把标签拦腰截断） */
export function truncateRich(content: string, max: number): string {
  const text = toPlainText(content)
  return text.length > max ? text.slice(0, max) : text
}

/**
 * HTML 白名单净化。内容也来自 AI 生成与 OCR，而 mock 层 saveQuestion 是裸 Object.assign，
 * 没有任何服务端净化可依赖，故 v-html 前必须过这里。
 *
 * 允许集合是封闭且已知的（Tiptap 自身产出的标签 + img + 公式节点的 data-*），因此用手写白名单
 * 而非引入 DOMPurify —— 与本仓库「手绘、零依赖」的取向一致。
 */
export function sanitizeRichHtml(html: string): string {
  if (!html) return ''
  const doc = parseHtml(html)
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_ELEMENT)

  const elements: Element[] = []
  while (walker.nextNode()) elements.push(walker.currentNode as Element)

  /* 逆序处理：先处理深层节点，父节点解包时其子树已是干净的 */
  for (const el of elements.reverse()) {
    const tag = el.tagName.toLowerCase()

    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase()
      const allowed = TAG_ATTRS[tag] ?? GLOBAL_ATTRS
      if (!GLOBAL_ATTRS.has(name) && !allowed.has(name)) {
        el.removeAttribute(attr.name)
        continue
      }
      if (URL_ATTRS.has(name) && isDangerousUrl(attr.value)) el.removeAttribute(attr.name)
    }

    if (ALLOWED_TAGS.has(tag)) continue
    if (DROP_WITH_CHILDREN.has(tag)) el.remove()
    else el.replaceWith(...el.childNodes) // 未知标签解包，保留其文字内容
  }

  return doc.body.innerHTML
}

/**
 * 把 [data-type=inline-math|block-math] 节点渲染为 KaTeX。
 *
 * Tiptap 的 getHTML() 走 schema 序列化、不读实时 DOM，公式节点只留下 data-latex（见
 * @tiptap/extension-mathematics 的 InlineMath.renderHTML），KaTeX 渲染只存在于编辑器的 NodeView，
 * 所以只读渲染必须在这里补一次。
 */
export function renderMathIn(root: HTMLElement): void {
  const nodes = root.querySelectorAll<HTMLElement>('[data-type="inline-math"],[data-type="block-math"]')
  nodes.forEach((el) => {
    const latex = el.getAttribute('data-latex') ?? ''
    if (!latex) return
    /* 幂等：内容未变则不重复渲染，避免 watch 触发时做无谓的 DOM 重建 */
    if (el.dataset.mathRendered === latex) return
    try {
      katex.render(latex, el, {
        throwOnError: false,
        displayMode: el.dataset.type === 'block-math',
      })
      el.dataset.mathRendered = latex
      el.classList.remove('rich-math-error')
    } catch {
      /* 语法非法时不抛错，回退为展示 LaTeX 源码 */
      el.textContent = latex
      el.dataset.mathRendered = latex
      el.classList.add('rich-math-error')
    }
  })
}
