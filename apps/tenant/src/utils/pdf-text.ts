/**
 * PDF 纯文本抽取（零依赖，不引 pdfjs）。
 *
 * ## 为什么自己抽
 *
 * 试卷导入要支持 PDF，而「AI 识别」需要的是**文字内容**（扫描件除外）。仓库里没有 pdfjs，
 * 为一个演示阶段的原型引入 2MB+ 的渲染库并不划算：PDF 的正文就写在内容流的
 * `Tj` / `TJ` 文本算子中，只要把 `FlateDecode` 的流解压出来，按算子顺序拼接即可。
 *
 * 抽到的是「行列顺序的裸文本」，不是版面 —— 版面由后续的「卷面识别」交给模型重建
 * （题号、大题标题、分值都在文本里，模型能读出来）。
 *
 * ## 边界（刻意的取舍）
 *
 * - **扫描件**（整页是图片）抽不到文字：返回可读性校验失败，由调用方提示「改为上传图片」；
 * - **CID 字体没有 ToUnicode 映射**时，文本算子里是字形编号，解出来是乱码 ——
 *   同样由可读性校验兜住，不会把乱码喂给模型产出更离谱的结果；
 * - 加密 PDF（`/Encrypt`）不处理，直接判失败；
 * - 不还原表格与多栏顺序，多栏 PDF 的阅读顺序可能串行 —— 这是「卷面识别」要纠的事。
 */

/** 抽取结果：正文 + 页数（页数用于界面展示「共 N 页」） */
export interface PdfTextResult {
  text: string
  pages: number
  /** 是否加密（加密时 text 为空，调用方据此给出不同提示） */
  encrypted: boolean
}

/* ==================== 字节 → 字符串 ==================== */

/** latin1 解码（PDF 的语法层是单字节的，字典 / 算子名都能这样读） */
function latin1(bytes: Uint8Array): string {
  let out = ''
  /* 分块拼接：一次性 apply 上百万个参数会爆栈 */
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    out += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return out
}

/**
 * zlib / raw deflate 解压。
 *
 * 浏览器原生 `DecompressionStream` 支持 `deflate`（带 zlib 头）与 `deflate-raw`；
 * PDF 的 `/FlateDecode` 通常是前者，个别生成器写的是裸 deflate，故两种都试一次。
 */
async function inflate(bytes: Uint8Array, format: 'deflate' | 'deflate-raw'): Promise<string> {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream(format))
  const buffer = await new Response(stream).arrayBuffer()
  return latin1(new Uint8Array(buffer))
}

/* ==================== 内容流 → 文本 ==================== */

/** 字面量字符串里的转义还原（`\(` `\)` `\\` `\n` 与八进制 `\ddd`） */
function unescapePdfLiteral(raw: string): string {
  return raw.replace(/\\([nrtbf()\\]|[0-7]{1,3})/g, (_match, code: string) => {
    switch (code) {
      case 'n':
        return '\n'
      case 'r':
        return '\r'
      case 't':
        return '\t'
      case 'b':
        return '\b'
      case 'f':
        return '\f'
      case '(':
        return '('
      case ')':
        return ')'
      case '\\':
        return '\\'
      default:
        return String.fromCharCode(parseInt(code, 8))
    }
  })
}

/** 十六进制字符串 `<48656C6C6F>`：偶数长度按 UTF-16BE（中文常见），否则按单字节 */
function decodePdfHex(hex: string): string {
  const clean = hex.replace(/[^0-9a-fA-F]/g, '')
  if (!clean.length) return ''
  if (clean.length % 4 === 0) {
    let out = ''
    for (let i = 0; i < clean.length; i += 4) {
      const code = parseInt(clean.slice(i, i + 4), 16)
      /* 控制字符（除换行）基本说明不是 UTF-16 文本，退回单字节 */
      if (code === 0 || (code < 0x20 && code !== 0x0a && code !== 0x0d)) return latin1FromHex(clean)
      out += String.fromCharCode(code)
    }
    return out
  }
  return latin1FromHex(clean)
}

function latin1FromHex(hex: string): string {
  let out = ''
  const even = hex.length % 2 === 0 ? hex : hex.slice(0, -1)
  for (let i = 0; i < even.length; i += 2) out += String.fromCharCode(parseInt(even.slice(i, i + 2), 16))
  return out
}

/**
 * 从一个内容流里按绘制顺序取出文本。
 *
 * 只认这几类算子：`(...)Tj`、`[...]TJ`、`<...>Tj` 出文字；
 * `Td` / `TD` / `T*` / `ET` 视为换行（PDF 里换行就是重新定位文本矩阵）。
 * 字距微调用 TJ 数组里的数字表示，小于 -100 时按一个空格处理（中文无空格，正文多为负值较小）。
 */
function textOfContentStream(content: string): string {
  const token =
    /\((?:\\.|[^\\()])*\)\s*Tj|\[(?:[^[\]\\]|\\.)*\]\s*TJ|<[0-9A-Fa-f\s]+>\s*Tj|\bT[dD]\b|\bT\*\b|\bET\b|\bBT\b/g
  let out = ''
  let match: RegExpExecArray | null
  while ((match = token.exec(content)) !== null) {
    const piece = match[0]
    if (piece.endsWith('Tj') && piece.startsWith('(')) {
      out += unescapePdfLiteral(piece.slice(1, piece.lastIndexOf(')')))
    } else if (piece.endsWith('Tj')) {
      const start = piece.indexOf('<')
      out += decodePdfHex(piece.slice(start + 1, piece.lastIndexOf('>')))
    } else if (piece.endsWith('TJ')) {
      const body = piece.slice(piece.indexOf('[') + 1, piece.lastIndexOf(']'))
      const inner = /\((?:\\.|[^\\()])*\)|<[0-9A-Fa-f\s]+>|-?\d+(?:\.\d+)?/g
      let part: RegExpExecArray | null
      while ((part = inner.exec(body)) !== null) {
        const value = part[0]
        if (value.startsWith('(')) out += unescapePdfLiteral(value.slice(1, -1))
        else if (value.startsWith('<')) out += decodePdfHex(value.slice(1, -1))
        else if (Number(value) <= -120) out += ' '
      }
    } else if (piece === 'T*' || piece === 'ET' || piece === 'Td' || piece === 'TD') {
      out += '\n'
    }
  }
  return out
}

/* ==================== 主流程 ==================== */

/** 文本净化的下限：低于这个长度基本等于没抽到 */
const MIN_TEXT_LENGTH = 120

/**
 * 判断抽出的文本是否「像人话」：可读字符（中日韩 / 拉丁字母 / 数字 / 常用标点）占比够高。
 * 乱码（CID 字形编号）里控制字符与替换符占比很高，会被这一关拦下。
 */
export function isReadableText(text: string): boolean {
  const chars = [...text.replace(/\s+/g, '')]
  if (chars.length < MIN_TEXT_LENGTH) return false
  const readable = chars.filter((ch) => /[\u4e00-\u9fa5a-zA-Z0-9，。、；：？！（）《》“”‘’%+\-=×÷/.,:;()]/.test(ch)).length
  return readable / chars.length >= 0.55
}

/** 抽取 PDF 文本；失败不抛异常，交给调用方按 `text` 空 / `encrypted` 给提示 */
export async function extractPdfText(file: File): Promise<PdfTextResult> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const raw = latin1(bytes)
  if (/\/Encrypt\s/.test(raw)) return { text: '', pages: 1, encrypted: true }

  /* 页数：`/Type /Page`（不含 `/Pages` 目录节点）出现的次数；退化为 /Count N，再退化为 1 */
  const pageObjects = (raw.match(/\/Type\s*\/Page(?![s\w])/g) ?? []).length
  const countHint = Number(raw.match(/\/Count\s+(\d+)/)?.[1] ?? 0)
  const pages = Math.max(pageObjects, countHint, 1)

  const chunks: string[] = []
  let cursor = 0
  while (cursor < raw.length) {
    const at = raw.indexOf('stream', cursor)
    if (at < 0) break
    /* `endstream` 里也含 `stream`，跳过它，否则会在同一个流的尾部反复命中 */
    if (raw.slice(Math.max(0, at - 3), at) === 'end') {
      cursor = at + 6
      continue
    }
    /* 字典头部：过滤器、长度都在 `stream` 之前，回看 500 字符足够 */
    const dict = raw.slice(Math.max(0, at - 500), at)
    let start = at + 6
    if (raw[start] === '\r') start += 1
    if (raw[start] === '\n') start += 1
    const end = raw.indexOf('endstream', start)
    if (end < 0) break
    const data = bytes.subarray(start, end)
    cursor = end + 9

    let content = ''
    if (/FlateDecode/.test(dict)) {
      /* 同一个流两种 deflate 都试：先带 zlib 头，再裸流 */
      try {
        content = await inflate(data, 'deflate')
      } catch {
        try {
          content = await inflate(data, 'deflate-raw')
        } catch {
          content = ''
        }
      }
    } else if (!/\/Filter/.test(dict)) {
      /* 未压缩的内容流（少见但合规）直接读 */
      content = latin1(data)
    }
    if (content && /\b(Tj|TJ)\b/.test(content)) chunks.push(textOfContentStream(content))
  }

  const text = chunks
    .join('\n')
    /* 去掉多余空白：PDF 每行末尾常留定位空格，连续空行在提示词里只是噪音 */
    .replace(/\r/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .trim()

  return { text, pages, encrypted: false }
}
