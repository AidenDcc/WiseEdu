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

/** v-html 前的白名单：编辑器自身产出的标签 + 图片 + 公式节点 + 表格 */
const ALLOWED_TAGS = new Set([
  'p', 'div', 'br', 'span', 'strong', 'b', 'em', 'i', 'u', 's', 'del', 'code', 'pre',
  'blockquote', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'img', 'a', 'sub', 'sup', 'hr',
  'table', 'thead', 'tbody', 'tr', 'td', 'th',
  /* colgroup / col 必须留在白名单里：编辑器按列宽存下的是
     `<colgroup><col style="width: 120px"></colgroup>`，而不在白名单里的标签会被**解包**
     （replaceWith 子节点），col 一旦被提到 table 外面，表格结构连同列宽一起散架。 */
  'colgroup', 'col',
])

/** 通配允许的属性（Tiptap 公式节点靠 data-type / data-latex 承载 LaTeX 源码） */
const GLOBAL_ATTRS = new Set(['data-type', 'data-latex', 'title'])
const TAG_ATTRS: Record<string, Set<string>> = {
  img: new Set(['src', 'alt', 'width', 'height']),
  a: new Set(['href', 'target', 'rel']),
  /* 有序列表的序号写法：原生 1 / a / A / i / I 走 type 属性，起始号走 start */
  ol: new Set(['type', 'start']),
  /* 表格单元格：合并、列宽（Tiptap 的 colwidth 是逗号分隔的 px 数组）、单元格对齐 */
  td: new Set(['colspan', 'rowspan', 'colwidth', 'align']),
  th: new Set(['colspan', 'rowspan', 'colwidth', 'align']),
}
/** 需要校验协议的属性 */
const URL_ATTRS = new Set(['src', 'href'])

/** 允许携带内联样式的标签：就是我们编辑器自己会产出的那些 */
const STYLE_TAGS = new Set([
  'span', 'p', 'div', 'li', 'ul', 'ol', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'table', 'colgroup', 'col', 'tr', 'td', 'th', 'blockquote',
])

/** 自定义序号样式名（① / (1) / 一、），定义见 apps/tenant/src/styles/main.css 的 @counter-style */
export const RICH_COUNTER_STYLES = ['circled-number', 'paren-number', 'cjk-number'] as const

/**
 * 有序列表可选序号样式。
 *
 * - `type` 落原生 HTML 属性（1 / a / A / i / I），Word 认；
 * - `style` 落内联 `list-style-type`（自定义 counter-style 名，Word 不认，会退化成 1.）；
 * - `css` 是这份序号在 CSS 里的写法，**给工具栏的候选项画 1-2-3 预览用**：
 *   预览是一段真的 `<ol style="list-style-type: …">`，与正文里的渲染同源，
 *   看到什么样就是插进去什么样（这里的值必须是 CSS 关键字，不能是 counter-style 之外的臆造名）。
 *
 * 两个字段互斥：选了 type 就清掉 style，反之亦然（见 apps/tenant/src/tiptap-extensions/listMarker.ts）。
 */
export const RICH_LIST_MARKERS: { key: string; label: string; css: string; type?: string; style?: string }[] = [
  { key: 'decimal', label: '1.', css: 'decimal', type: '1' },
  { key: 'circled', label: '①', css: 'circled-number', style: 'circled-number' },
  { key: 'paren', label: '(1)', css: 'paren-number', style: 'paren-number' },
  { key: 'upper-roman', label: 'I.', css: 'upper-roman', type: 'I' },
  { key: 'lower-roman', label: 'i.', css: 'lower-roman', type: 'i' },
  { key: 'upper-alpha', label: 'A.', css: 'upper-alpha', type: 'A' },
  { key: 'lower-alpha', label: 'a.', css: 'lower-alpha', type: 'a' },
  { key: 'cjk', label: '一、', css: 'cjk-number', style: 'cjk-number' },
]

/** 长度 / 尺寸类的值：必须是「数字 + 允许的单位」，且不超过上限（挡住 9999px 这类糊弄） */
function isCssLength(value: string, units: string[], max: number): boolean {
  const match = /^(\d{1,4}(?:\.\d+)?)([a-z%]+)$/.exec(value)
  if (!match) return false
  return units.includes(match[2]) && Number(match[1]) <= max
}

/**
 * 把颜色值折成 `#rrggbb`，认不出来返回 null。
 *
 * 为什么非折不可：浏览器的 CSSOM 会把 `style="color: #c0272d"` 归一化读成
 * `color: rgb(192, 39, 45)`，而 DOM 序列化回去时用的就是这个 rgb 形态 —— 也就是说
 * Tiptap 的 `getHTML()` 里颜色**天生就是 rgb(...)**。于是两头都不对付：白名单只放行 #hex 的话，
 * 用户从调色板选的颜色一保存就被剥掉；全放行 rgb 的话，Word 又不认（它只认 #hex）。
 * 折回 hex 一次同时解决两边：**存储与导出一律 hex，编辑器内存里是什么形态无所谓**。
 */
export function toHexColor(value: string): string | null {
  const raw = value.trim()
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(raw)
  if (hex) {
    const body = hex[1].toLowerCase()
    /* 三位简写补成六位，免得同一个颜色在库里出现两种写法（工具栏色板的比对也靠这个） */
    return `#${body.length === 3 ? body.replace(/./g, (ch) => ch + ch) : body}`
  }
  const rgb = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*(0|1|0?\.\d+)\s*)?\)$/i.exec(raw)
  if (!rgb) return null
  const channels = [rgb[1], rgb[2], rgb[3]].map(Number)
  if (channels.some((n) => n > 255)) return null
  /* 半透明的字色试卷上没有，不值得为它把白名单撑开 */
  if (rgb[4] !== undefined && Number(rgb[4]) < 1) return null
  return `#${channels.map((n) => n.toString(16).padStart(2, '0')).join('')}`
}

/**
 * 允许保留的 CSS 声明：属性名 → 值校验。未登记的一律丢弃。
 *
 * 这里是「放行 style」而不是「放行某个固定字符串」的原因：字体、字号、颜色、序号样式、
 * 缩进都是自由组合的。白名单的写法顺序是**先属性名、再逐类校验值**，因此
 * `url(...)`、`expression(...)`、`position: fixed`、`background-image` 这些进不来。
 *
 * 校验函数统一是「返回要保留的值（可以与入参不同，颜色就靠这一步折成 hex），或 false 丢弃」。
 */
type StyleChecker = (value: string) => string | false

const STYLE_PROPS: Record<string, StyleChecker> = {
  /* 字体名里可以有引号、空格和中文（"Songti SC", SimSun, 宋体, serif），
     但不能有括号 / 反斜杠 / 分号 / 叹号 —— 它们是把 url() 与 !important 放进来的通道 */
  'font-family': (v) => v.length <= 120 && !/[[\](){}<>;\\!]/.test(v) && v,
  'font-size': (v) => isCssLength(v, ['pt', 'px', 'em', 'rem', '%'], 200) && v,
  color: (v) => toHexColor(v) ?? false,
  /* 单元格底纹（表格面板里的「背景」）。只认 #hex：与字色同口径 —— Word 认 #hex，
     而 `rgb(...)` / 命名色 / `url()`（渐变或图片底）都进不来 */
  'background-color': (v) => toHexColor(v) ?? false,
  /* 单元格边框颜色（表格面板里的「边框颜色」，逐格写在 td / th 上）。同口径只认 #hex：
     这里也把 `border-color: inherit` 这类值挡住 —— Word 不认 inherit，会当场回落到默认黑边 */
  'border-color': (v) => toHexColor(v) ?? false,
  'text-decoration': (v) => /^underline(?: (?:wavy|double|dotted|dashed|solid))?$/i.test(v) && v,
  'text-underline-offset': (v) => isCssLength(v, ['px', 'em'], 20) && v,
  'text-indent': (v) => isCssLength(v, ['px', 'em'], 20) && v,
  'margin-left': (v) => isCssLength(v, ['px', 'em'], 200) && v,
  'margin-right': (v) => isCssLength(v, ['px', 'em'], 200) && v,
  width: (v) => isCssLength(v, ['px', '%'], 2000) && v,
  'min-width': (v) => isCssLength(v, ['px', '%'], 2000) && v,
  height: (v) => isCssLength(v, ['px', '%'], 2000) && v,
  'list-style-type': (v) => (v === 'decimal' || v === 'lower-alpha' || v === 'upper-alpha'
    || v === 'lower-roman' || v === 'upper-roman' || v === 'cjk-ideographic'
    || (RICH_COUNTER_STYLES as readonly string[]).includes(v)) && v,
  'text-align': (v) => /^(?:left|center|right)$/.test(v) && v,
}

/** 逐条声明过滤内联样式：保留的按 `key: value` 重新拼回，丢掉的整条消失 */
export function sanitizeStyle(styleText: string): string {
  const kept: string[] = []
  for (const chunk of styleText.split(';')) {
    const split = chunk.indexOf(':')
    if (split < 0) continue
    const prop = chunk.slice(0, split).trim().toLowerCase()
    const value = chunk.slice(split + 1).trim()
    if (!value) continue
    const safe = STYLE_PROPS[prop]?.(value)
    if (!safe) continue
    kept.push(`${prop}: ${safe}`)
  }
  return kept.join('; ')
}

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

/**
 * 录题时最常用的两个符号：填空下横线、作答括号。
 *
 * 放共享层是为了**只有一个口径**：编辑器的工具栏按钮插入它们，录题页判断「题干是否已以作答括号开头」
 * 也读它 —— 两处各写一份字面量时，改了其中一处，另一处就会把已有括号的题干再加一次。
 * 取值与种子数据一致（填空 6 个 ASCII 下划线，括号为全角、中间两个全角空格）。
 */
export const FILL_BLANK = '______'
export const ANSWER_PAREN = '（　　）'

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
  /* td / th 也补一个断点：表格是逐格写的，不加分隔取纯文本时「甲」和「乙」会粘成一个词，
     搜索与截断都会跟着串味（最后统一压空白，所以这里补的换行在结果里是一个空格） */
  doc.querySelectorAll('p,div,li,h1,h2,h3,h4,h5,h6,blockquote,pre,tr,td,th').forEach((el) => el.append('\n'))
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
      /* style 单开一路：命中放行标签还不够，里面的每条声明都要过 STYLE_PROPS */
      if (name === 'style') {
        const safe = STYLE_TAGS.has(tag) ? sanitizeStyle(attr.value) : ''
        if (safe) el.setAttribute('style', safe)
        else el.removeAttribute('style')
        continue
      }
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
