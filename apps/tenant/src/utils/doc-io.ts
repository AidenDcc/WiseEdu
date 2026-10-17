/**
 * 教案 / 学案 / 讲义与 Word 之间的**格式转换**（导入 .docx、导出 .docx / .doc）。
 *
 * ## 为什么分两条导出通路
 *
 * - **`exportDocx`**：真正的 `.docx`（OOXML，走 `docx` 库）。规范、可被 Word / WPS
 *   无损打开、后续能被 mammoth 读回来。代价是它只能表达「我们认识的这些结构」——
 *   公式（KaTeX 节点）、理科配图（自绘 SVG）落不到 OOXML 里，会被记成一行说明。
 * - **`exportWordHtml`**：把正文包成一份**Word 能打开的 HTML**（`.doc`，MIME 是 msword）。
 *   零依赖、永远可用，中文排版与表格保留得最完整，缺点是扩展名是 `.doc` 而非 `.docx`
 *   （Word 打开时会提示「格式与扩展名不符」，确认即可，另存为即得 .docx）。
 *   项目里的试卷导出（business-common/utils/paper-export.ts）走的就是这条。
 *
 * 界面上的策略：默认给 `.docx`；`docx` 依赖没装或转换抛错时**自动退回** `.doc`，
 * 并如实告诉用户「导出的是 .doc，用 Word 另存为 .docx 即可」—— 不能让导出按钮点了没反应。
 *
 * ## 导入为什么只能「重建」
 *
 * `.docx` 是 OOXML（zip + XML），能读出**语义**（段落、标题、表格、加粗），但读不出
 * Word 的版面（分栏、页边距、浮动图片位置、页眉页脚）—— 那些在 OOXML 里是排版指令，
 * 与本编辑器「一段段重排」的模型不是一回事。所以导入是**重建一份结构相近的文档**，
 * 而不是「原样打开」；老师导入后看到的是可以在线编辑的稿子，不是 Word 的截图。
 *
 * `.pdf` 不在本文件的处理范围内：它是页面绘制指令，段落这个概念已经不存在，
 * 只能靠 OCR / 版面分析**重新生成**（见 DocEditor 的说明）。
 */
import { AlignmentType, Document, HeadingLevel, Packer, Paragraph, Table, TableCell, TableRow, TextRun } from 'docx'
import mammoth from 'mammoth'

/* ================= 通用小工具 ================= */

/** 导出文件名：去掉文件系统不认的字符，并补上扩展名 */
export function safeFileName(name: string, ext: string): string {
  const base = (name || '文档').replace(/[\\/:*?"<>|\n\r\t]/g, '').trim().slice(0, 60) || '文档'
  return `${base}.${ext}`
}

/** 触发浏览器下载 */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  /* 立刻 revoke 会让部分浏览器来不及取数据，留一拍 */
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

/* ================= 导入：.docx → 文档流 HTML ================= */

/** 本编辑器 schema 里存在、且 mammoth 有可能产出的标签白名单 */
const KEEP_TAGS = new Set([
  'P', 'H1', 'H2', 'H3', 'H4', 'H5',
  'STRONG', 'B', 'EM', 'I', 'U', 'S', 'DEL', 'SUP', 'SUB',
  'UL', 'OL', 'LI', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TD', 'TH',
  'IMG', 'A', 'SPAN', 'BR', 'BLOCKQUOTE',
])

export interface ImportDocxOptions {
  /**
   * 上传一张图片，返回可引用的 URL。
   *
   * `.docx` 里的图片是**打包在 zip 里**的，mammoth 会把它们转成内联 base64；
   * 而本仓库的正文明确 `allowBase64: false`（只存 URL，见 doc-extensions.ts），
   * 所以每张图都要先落到媒体库再换地址 —— 这层不做的话，图片会在保存时被净化掉。
   * 不传则该图被丢弃并计入 `droppedImages`。
   */
  uploadImage?: (blob: Blob, name: string) => Promise<string>
}

export interface ImportDocxResult {
  html: string
  /** mammoth 的提示（有样式被忽略等），给用户一句人话解释 */
  warnings: string[]
  /** 没能入库、因而被丢掉的图片数 */
  droppedImages: number
}

/**
 * 把 `.docx` 转成本编辑器的文档流 HTML。
 *
 * 三步：mammoth 出**语义化 HTML** → **压进本编辑器的 schema**（这一步不做的话，
 * mammoth 产出的 `<h6>` / `<pre>` / `<div>` 会在 `setContent` 时被静默丢弃，
 * 表现成「导入成功但内容少了半页」）→ 图片抽出来入库换 URL。
 */
export async function importDocx(file: File, options: ImportDocxOptions = {}): Promise<ImportDocxResult> {
  const arrayBuffer = await file.arrayBuffer()
  const result = await mammoth.convertToHtml({ arrayBuffer })
  const raw = result.value ?? ''

  const doc = new DOMParser().parseFromString(`<body>${raw}</body>`, 'text/html')
  const dropped = { images: 0 }

  /* ---- 1. 图片：先抽出来（改 DOM 前收集，避免边遍历边改导致漏掉） ---- */
  const images = Array.from(doc.querySelectorAll('img'))
  for (const [index, img] of images.entries()) {
    const src = img.getAttribute('src') ?? ''
    if (!src.startsWith('data:')) continue
    if (!options.uploadImage) {
      dropped.images += 1
      img.remove()
      continue
    }
    try {
      const blob = dataUrlToBlob(src)
      const url = await options.uploadImage(blob, `${file.name.replace(/\.docx$/i, '')}-图${index + 1}.png`)
      img.setAttribute('src', url)
      img.removeAttribute('style')
    } catch {
      dropped.images += 1
      img.remove()
    }
  }

  /* ---- 2. 压进 schema ---- */
  squashToSchema(doc.body)

  const warnings = ((result.messages ?? []) as Array<{ message?: unknown }>)
    .slice(0, 4)
    .map((row) => String(row.message ?? '').trim())
    .filter(Boolean)

  return { html: doc.body.innerHTML, warnings, droppedImages: dropped.images }
}

/** base64 data URL → Blob（媒体库接口收 dataUrl 也可，但 Blob 更通用） */
function dataUrlToBlob(dataUrl: string): Blob {
  const [head, body] = dataUrl.split(',')
  const mime = /data:([^;]+)/.exec(head)?.[1] ?? 'image/png'
  const binary = atob(body ?? '')
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type: mime })
}

/**
 * 把 DOM 压进本编辑器的 schema（`doc-extensions.ts` 里注册的那批节点）。
 *
 * 规则很短：**认识的结构降级到最近的认识的形态**，不认识的整体丢掉但保留文字 ——
 * 丢内容是最坏的结果，宁可让格式少一点。
 */
function squashToSchema(root: HTMLElement) {
  const REPLACE: Record<string, string> = {
    H6: 'H5',
    PRE: 'P',
    CODE: 'SPAN',
    SMALL: 'SPAN',
    MARK: 'SPAN',
    FONT: 'SPAN',
    SECTION: 'DIV',
    ARTICLE: 'DIV',
    HEADER: 'DIV',
    FOOTER: 'DIV',
    FIGURE: 'DIV',
    FIGCAPTION: 'P',
  }
  const DROP_TAGS = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'HR', 'VIDEO', 'AUDIO', 'SVG', 'CANVAS'])

  /* 自底向上遍历：先把深层处理好，再决定这一层怎么收拾 */
  const walk = (node: Element) => {
    Array.from(node.children).forEach(walk)
    const tag = node.tagName
    if (DROP_TAGS.has(tag)) {
      node.remove()
      return
    }
    const replaceWith = REPLACE[tag]
    if (replaceWith) {
      const next = node.ownerDocument.createElement(replaceWith)
      while (node.firstChild) next.appendChild(node.firstChild)
      node.replaceWith(next)
      /* 换出来的可能是 DIV，还要再拆一次 */
      if (replaceWith === 'DIV') unwrap(next)
      return
    }
    if (!KEEP_TAGS.has(tag)) {
      unwrap(node)
      return
    }
    /* 只留白名单属性：mammoth 会带 class / id / 各种 data-*，净化时会一并被清掉，
       这里先清干净，免得「保存一次格式变了」 */
    Array.from(node.attributes).forEach((attr) => {
      const name = attr.name.toLowerCase()
      const keep =
        (tag === 'IMG' && (name === 'src' || name === 'alt')) ||
        (tag === 'A' && name === 'href') ||
        (name === 'colspan' || name === 'rowspan')
      if (!keep) node.removeAttribute(attr.name)
    })
  }

  Array.from(root.children).forEach(walk)
}

/** 把一个元素拆掉，让它的子节点顶上来（保留文字与行内格式） */
function unwrap(element: Element) {
  const parent = element.parentNode
  if (!parent) return
  while (element.firstChild) parent.insertBefore(element.firstChild, element)
  parent.removeChild(element)
}

/* ================= 导出：文档流 HTML → .docx ================= */

const HEADING_BY_LEVEL = {
  1: HeadingLevel.HEADING_1,
  2: HeadingLevel.HEADING_2,
  3: HeadingLevel.HEADING_3,
  4: HeadingLevel.HEADING_4,
  5: HeadingLevel.HEADING_5,
} as const

/**
 * 本模块里 docx 的构造器（Paragraph / TextRun / Table …）统一按 `any` 用。
 *
 * 理由：`docx` 是**按需依赖**（见 src/shims/vendor.d.ts），仓库里可能还没装 ——
 * 那时它们没有类型。把它们的类型写死成 `any` 就不必为了「装没装」写两套签名，
 * 真实类型存在时照样能跑（只是退回动态类型）。
 */
type DocxNode = any

/** 行内样式（我们自己的那套内联写法）→ TextRun 的选项 */
function runOptions(el: Element | null, marks: Record<string, unknown> = {}): Record<string, unknown> {
  const options: Record<string, unknown> = { ...marks }
  if (!el || el.tagName !== 'SPAN') return options
  const style = (el as HTMLElement).style
  const fontFamily = style.fontFamily
  if (fontFamily) options.font = fontFamily.split(',')[0].trim().replace(/^["']|["']$/g, '')
  const size = style.fontSize
  if (size) {
    const pt = /([\d.]+)pt/.exec(size)?.[1]
    if (pt) /* docx 的 size 单位是**半磅**，12pt 要写 24 */ options.size = Math.round(Number(pt) * 2)
  }
  const color = style.color
  if (color) options.color = toHex(color)
  const bg = style.backgroundColor
  if (bg) options.shading = { fill: toHex(bg).replace('#', '') }
  return options
}

/** `rgb(17, 17, 17)` / `#111` → `#111111`（docx 只认 6 位 hex） */
function toHex(value: string): string {
  const rgb = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(value)
  if (rgb) {
    return `#${[rgb[1], rgb[2], rgb[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('')}`
  }
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim())
  if (!hex) return '#000000'
  const body = hex[1]
  return `#${body.length === 3 ? body.split('').map((c) => c + c).join('') : body}`
}

/** 段落的对齐 / 行距 / 缩进（我们的内联写法挂在段落自身） */
function paragraphOptions(el: HTMLElement): Record<string, unknown> {
  const style = el.style
  const options: Record<string, unknown> = {}
  const align = style.textAlign
  if (align === 'center') options.alignment = AlignmentType.CENTER
  else if (align === 'right') options.alignment = AlignmentType.RIGHT
  else if (align === 'justify') options.alignment = AlignmentType.JUSTIFIED
  /* docx 的间距单位是 twip（1pt = 20twip，1px ≈ 15twip） */
  const px = (value: string) => (/^([\d.]+)px$/.exec(value)?.[1] ?? '')
  const before = px(style.marginTop)
  const after = px(style.marginBottom)
  if (before || after) {
    options.spacing = {
      before: before ? Math.round(Number(before) * 15) : undefined,
      after: after ? Math.round(Number(after) * 15) : undefined,
    }
  } else if (style.marginBottom) {
    options.spacing = { after: Math.round(Number(px(style.marginBottom) || 0) * 15) }
  }
  const indentLeft = /^([\d.]+)ch$/.exec(style.paddingLeft)?.[1]
  const indentFirst = /^([\d.]+)em$/.exec(style.textIndent)?.[1]
  const indentLevel = /^([\d.]+)em$/.exec(style.marginLeft)?.[1]
  const left = (Number(indentLeft ?? 0) + Number(indentLevel ?? 0)) * 240
  if (left || indentFirst) {
    options.indent = {
      left: left || undefined,
      /* 首行缩进的单位是「字符」，docx 用 firstLine（twip）；一个汉字约 240twip */
      firstLine: indentFirst ? Math.round(Number(indentFirst) * 240) : undefined,
    }
  }
  return options
}

/** 把一个块级元素拆成若干段（表格、列表单独处理） */
function blockToParagraphs(el: Element, listLevel = 0, ordered = false): DocxNode[] {
  const tag = el.tagName

  if (tag === 'TABLE') return [tableToParagraph(el)]
  if (tag === 'UL' || tag === 'OL') {
    return Array.from(el.children)
      .filter((li) => li.tagName === 'LI')
      .flatMap((li) => blockToParagraphs(li, listLevel, tag === 'OL'))
  }
  if (tag === 'LI') {
    return [new Paragraph({ children: inlineRuns(el), ...(ordered ? { numbering: undefined } : {}), bullet: ordered ? undefined : { level: Math.min(listLevel, 4) } })]
  }

  const level = /^H([1-5])$/.exec(tag)?.[1]
  if (level) {
    return [
      new Paragraph({
        children: inlineRuns(el),
        heading: HEADING_BY_LEVEL[Number(level) as 1 | 2 | 3 | 4 | 5],
        ...paragraphOptions(el as HTMLElement),
      }),
    ]
  }

  if (tag === 'BLOCKQUOTE') {
    return [new Paragraph({ children: inlineRuns(el), indent: { left: 480 }, ...paragraphOptions(el as HTMLElement) })]
  }

  /* div[data-type=page-break] → Word 的分页符 */
  if (el.getAttribute('data-type') === 'page-break') {
    return [new Paragraph({ children: [new TextRun({ text: '', break: 1 })], pageBreakBefore: true })]
  }

  /* 只剩一段：把它的块级子元素拆开（编辑器里一般不会有，导入的稿子可能有） */
  const blockChildren = Array.from(el.children).filter((child) => /^(P|DIV|SECTION|ARTICLE)$/.test(child.tagName))
  if (blockChildren.length > 1) return blockChildren.flatMap((child) => blockToParagraphs(child))
  return [new Paragraph({ children: inlineRuns(el), ...paragraphOptions(el as HTMLElement) })]
}

/** 行内节点 → TextRun[]（加粗、斜体、下划线、删除线、上下标、字体字号颜色高亮都在这里） */
function inlineRuns(root: Element, marks: Record<string, unknown> = {}): DocxNode[] {
  const runs: DocxNode[] = []
  root.childNodes.forEach((node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? ''
      if (!text) return
      runs.push(new TextRun({ text, ...marks }))
      return
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return
    const el = node as Element
    const tag = el.tagName
    /* 图片 / 公式 / 理科配图落不进 OOXML，留一行说明而不是无声丢掉 */
    if (tag === 'IMG') {
      runs.push(new TextRun({ text: '［图片］', italics: true }))
      return
    }
    if (tag === 'BR') {
      runs.push(new TextRun({ text: '', break: 1 }))
      return
    }
    if (el.hasAttribute('data-type')) {
      const kind = el.getAttribute('data-type') ?? ''
      if (kind.includes('math')) {
        runs.push(new TextRun({ text: `［公式：${el.getAttribute('data-latex') ?? ''}］`, italics: true }))
        return
      }
      if (kind.includes('draw') || kind.includes('svg')) {
        runs.push(new TextRun({ text: '［配图］', italics: true }))
        return
      }
    }
    const nextMarks = { ...marks }
    if (tag === 'STRONG' || tag === 'B') nextMarks.bold = true
    if (tag === 'EM' || tag === 'I') nextMarks.italics = true
    if (tag === 'U') nextMarks.underline = { type: 'single' as never } as never
    if (tag === 'S' || tag === 'DEL' || tag === 'STRIKE') nextMarks.strike = true
    if (tag === 'SUP') nextMarks.superScript = true
    if (tag === 'SUB') nextMarks.subScript = true
    const styled = { ...nextMarks, ...runOptions(el, nextMarks) }
    runs.push(...inlineRuns(el, styled))
  })
  return runs
}

/** 表格：只映射结构（行列、合并），底色与边框留给「导出 .doc」那条通路 */
function tableToParagraph(el: Element): DocxNode {
  const rows = Array.from(el.querySelectorAll('tr')).map(
    (tr) =>
      new TableRow({
        children: Array.from(tr.children).map(
          (cell) =>
            new TableCell({
              children: [new Paragraph({ children: inlineRuns(cell) })],
              ...(Number(cell.getAttribute('colspan') ?? 1) > 1 ? { columnSpan: Number(cell.getAttribute('colspan')) } : {}),
              ...(Number(cell.getAttribute('rowspan') ?? 1) > 1 ? { rowSpan: Number(cell.getAttribute('rowspan')) } : {}),
            }),
        ),
      }),
  )
  /* docx 的 Table 不是 Paragraph，这里用一个只承载表格的 Paragraph 包一下，
     由下面 exportDocx 单独把它取出来（见 tableParagraphs） */
  return new Paragraph({ children: [], __table: new Table({ rows, width: { size: 100, type: 'pct' } }) })
}

export interface ExportDocxMeta {
  title: string
  /** 纸张高度 mm（用于页面尺寸） */
  paper: { width: number; height: number }
  /** 页边距 mm */
  margin: number
  /** 页眉 / 页脚文字（可空） */
  header?: string
  footer?: string
}

/** mm → twip（docx 的长度单位：1mm ≈ 56.7twip） */
const mmToTwip = (mm: number) => Math.round(mm * 56.6929)

/**
 * 导出真正的 `.docx`。
 *
 * 公式与理科配图会在正文里留下「［公式：…］」「［配图］」这样的记号 —— OOXML 里没有
 * 对应的原生结构，硬塞一个图片反而会让老师以为还能在 Word 里改。留记号是更诚实的选择，
 * 需要带公式的稿子请用打印 / PDF。
 */
export async function exportDocx(html: string, meta: ExportDocxMeta): Promise<Blob> {
  const parsed = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  const blocks = Array.from(parsed.body.children)

  const children: DocxNode[] = []
  blocks.forEach((el) => {
    const paragraphs = blockToParagraphs(el)
    paragraphs.forEach((row) => {
      const table = (row as { __table?: DocxNode }).__table
      if (table) children.push(table)
      else children.push(row)
    })
  })
  if (!children.length) {
    children.push(new Paragraph({ children: [new TextRun({ text: '（空文档）', italics: true })] }))
  }

  const document = new Document({
    creator: 'AI 教学云',
    title: meta.title,
    description: meta.title,
    styles: {
      default: {
        document: { run: { font: 'SimSun', size: 24 } },
      },
    },
    sections: [
      {
        properties: {
          page: {
            size: { width: mmToTwip(meta.paper.width), height: mmToTwip(meta.paper.height) },
            margin: {
              top: mmToTwip(meta.margin),
              bottom: mmToTwip(meta.margin),
              left: mmToTwip(meta.margin),
              right: mmToTwip(meta.margin),
            },
          },
        },
        headers: meta.header
          ? { default: { options: {}, children: [new Paragraph({ children: [new TextRun({ text: meta.header, size: 18 })], alignment: AlignmentType.CENTER })] } }
          : undefined,
        footers: meta.footer
          ? { default: { options: {}, children: [new Paragraph({ children: [new TextRun({ text: meta.footer, size: 18 })], alignment: AlignmentType.CENTER })] } }
          : undefined,
        children,
      },
    ],
  })

  return Packer.toBlob(document)
}

/* ================= 导出：文档流 HTML → Word 能打开的 .doc ================= */

/**
 * 把正文包成一份 Word 能打开的 HTML（`.doc`）。
 *
 * 零依赖、中文排版与表格保留得最完整，是本项目的**兜底通路**（试卷导出用的是同一套做法）。
 * 页边距与纸张写进 `@page WordSection1`，Word 打开后版心与屏幕上一段段排的结果一致。
 */
export function exportWordHtml(html: string, meta: ExportDocxMeta): Blob {
  const pageSize = meta.paper.width === 176 ? 'B5' : 'A4'
  const head = `<!doctype html><html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40" lang="zh-CN"><head><meta charset="utf-8"><title>${escapeHtml(meta.title)}</title>
<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom></w:WordDocument></xml><![endif]-->
<style>
@page WordSection1 { size: ${pageSize}; margin: ${meta.margin}mm; }
div.WordSection1 { page: WordSection1; }
body { font-family: SimSun, "Songti SC", serif; font-size: 12pt; line-height: 1.5; }
h1 { font-size: 1.7em; text-align: center; margin: 0 0 14px; }
h2 { font-size: 1.35em; margin: 16px 0 8px; }
h3 { font-size: 1.15em; margin: 12px 0 6px; }
h4 { font-size: 1.05em; margin: 10px 0 6px; }
h5 { font-size: 1em; font-weight: 700; margin: 8px 0 5px; }
table { border-collapse: collapse; width: 100%; }
td, th { border: 1px solid #999; padding: 4px 8px; vertical-align: top; }
th { background: #f2f2f2; }
/* 屏幕上的分页垫片是视图层的记号，导出时必须整段消失 */
.doc-page-gap { display: none; }
[data-type='page-break'] { break-after: page; page-break-after: always; border: 0; height: 0; margin: 0; }
[data-type='page-break']::after { content: none; }
</style></head><body><div class="WordSection1">`
  const tail = '</div></body></html>'
  return new Blob([head, html, tail], { type: 'application/msword;charset=utf-8' })
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
