/**
 * 零依赖的 Excel（.xlsx）读写 —— 学生档案批量导入 / 模板下载用。
 *
 * ## 为什么自己写
 *
 * 仓库里没有 SheetJS（xlsx 包 ~1MB，为「导入一份学生名单」这种低频动作引进来不划算），
 * 而 .xlsx 本身只是「一个 zip 里放几份 XML」：
 * - 读：解开 zip → `xl/sharedStrings.xml`（共享字符串表）+ `xl/worksheets/sheet1.xml`（单元格）；
 * - 写：拼出同样结构的 XML → 以 **store（不压缩）** 方式打 zip。
 *
 * 浏览器原生 `DecompressionStream('deflate-raw')` 负责解压（`utils/pdf-text.ts` 已用它解 PDF
 * 的 FlateDecode 流，环境支持是既有前提）；写方向干脆不压缩 —— zip 规范允许 store，
 * Excel / WPS / Numbers 都能正常打开，省掉一个压缩实现与它的兼容性坑。
 *
 * ## 边界（刻意的取舍，调用方要按这些兜底）
 *
 * - **只读第一个工作表**：学生名单模板只有一张表；多表文件请让用户删掉多余的表；
 * - **只读单元格的「值」**：公式取缓存值，格式（日期 / 百分比）按存储值原样给出 ——
 *   导入模板里都是文本，日期列不在设计内；
 * - **.xls（97-2003 二进制格式）不支持**：抛明确错误让用户另存为 .xlsx，而不是解出乱码；
 * - 合并单元格只取左上角的值（模板刻意不用合并单元格，正文说明写在第二行之外）。
 */

export interface SheetTable {
  /** 表头（第一行非空行） */
  headers: string[]
  /** 数据行：每行长度与 headers 对齐，缺列补空串 */
  rows: string[][]
}

/* ==================== 公共小工具 ==================== */

const decoder = new TextDecoder('utf-8')

/** 列号（0 起）→ 列字母：0 → A，26 → AA */
function columnLetter(index: number): string {
  let n = index
  let out = ''
  do {
    out = String.fromCharCode(65 + (n % 26)) + out
    n = Math.floor(n / 26) - 1
  } while (n >= 0)
  return out
}

/** 列字母 → 列号（0 起）：「A1」的 A → 0，「AA9」的 AA → 26 */
function columnIndex(ref: string): number {
  const letters = ref.replace(/[^A-Z]/gi, '').toUpperCase()
  let n = 0
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64)
  return Math.max(0, n - 1)
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/* ==================== ZIP：读 ==================== */

interface ZipEntry {
  name: string
  method: number
  compressedSize: number
  localOffset: number
}

/** 读中央目录（EOCD → 逐条 0x02014b50），只收调用方关心的文件 */
function readCentralDirectory(view: DataView): ZipEntry[] {
  /* EOCD 在文件尾部 22 字节起，注释最长 64KB，所以往前最多找 65557 字节 */
  let eocd = -1
  const minPos = Math.max(0, view.byteLength - 65557)
  for (let i = view.byteLength - 22; i >= minPos; i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error('不是有效的 .xlsx 文件（找不到压缩包目录）')

  const count = view.getUint16(eocd + 10, true)
  let offset = view.getUint32(eocd + 16, true)
  const entries: ZipEntry[] = []
  for (let i = 0; i < count; i += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) break
    const method = view.getUint16(offset + 10, true)
    const compressedSize = view.getUint32(offset + 20, true)
    const nameLen = view.getUint16(offset + 28, true)
    const extraLen = view.getUint16(offset + 30, true)
    const commentLen = view.getUint16(offset + 32, true)
    const localOffset = view.getUint32(offset + 42, true)
    const name = decoder.decode(new Uint8Array(view.buffer, view.byteOffset + offset + 46, nameLen))
    entries.push({ name, method, compressedSize, localOffset })
    offset += 46 + nameLen + extraLen + commentLen
  }
  return entries
}

async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('当前浏览器不支持解压 .xlsx，请改用 Chrome / Edge 或上传 .csv')
  }
  const stream = new Blob([bytes.slice()]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/** 按名字取出 zip 内的若干文件（未命中的直接跳过） */
async function unzip(buffer: ArrayBuffer, wanted: (name: string) => boolean): Promise<Map<string, Uint8Array>> {
  const view = new DataView(buffer)
  const out = new Map<string, Uint8Array>()
  for (const entry of readCentralDirectory(view)) {
    if (!wanted(entry.name)) continue
    /* 本地文件头长度可变（文件名 / 扩展字段各一份），数据起点要从本地头里现算 */
    const base = entry.localOffset
    if (view.getUint32(base, true) !== 0x04034b50) continue
    const nameLen = view.getUint16(base + 26, true)
    const extraLen = view.getUint16(base + 28, true)
    const start = base + 30 + nameLen + extraLen
    const raw = new Uint8Array(buffer, start, entry.compressedSize)
    out.set(entry.name, entry.method === 0 ? raw.slice() : await inflateRaw(raw))
  }
  return out
}

/* ==================== XLSX：读 ==================== */

function parseXml(text: string): Document {
  const doc = new DOMParser().parseFromString(text, 'application/xml')
  if (doc.querySelector('parsererror')) throw new Error('Excel 内容解析失败（文件可能已损坏）')
  return doc
}

/** 共享字符串表：`<si>` 里可能是一个 `<t>`，也可能是多段 `<r><t>`（富文本），全部拼起来 */
function readSharedStrings(xml: string | undefined): string[] {
  if (!xml) return []
  const doc = parseXml(xml)
  return Array.from(doc.getElementsByTagName('si')).map((si) =>
    Array.from(si.getElementsByTagName('t'))
      .map((t) => t.textContent ?? '')
      .join(''),
  )
}

/** 第一张工作表的数据表名（`sheet1.xml` 未必是第一张，按 workbook 的顺序取更稳） */
function firstSheetPath(files: Map<string, Uint8Array>): string | undefined {
  const workbook = files.get('xl/workbook.xml')
  const rels = files.get('xl/_rels/workbook.xml.rels')
  if (workbook && rels) {
    const sheet = parseXml(decoder.decode(workbook)).getElementsByTagName('sheet')[0]
    const relId = sheet?.getAttribute('r:id')
    if (relId) {
      const target = Array.from(parseXml(decoder.decode(rels)).getElementsByTagName('Relationship')).find(
        (rel) => rel.getAttribute('Id') === relId,
      )?.getAttribute('Target')
      if (target) {
        const normalized = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`
        if (files.has(normalized)) return normalized
      }
    }
  }
  return [...files.keys()].filter((name) => /^xl\/worksheets\/.+\.xml$/.test(name)).sort()[0]
}

/** 工作表 XML → 稀疏二维表（按单元格 ref 的列号落位，跳过整行为空的） */
function readSheetRows(xml: string, shared: string[]): string[][] {
  const doc = parseXml(xml)
  const table: string[][] = []
  const rows = Array.from(doc.getElementsByTagName('row'))
  rows.forEach((rowEl, rowIndex) => {
    /* row 的 r 属性是 Excel 里的真实行号；缺省时按顺序排 */
    const rowNo = Number(rowEl.getAttribute('r')) || rowIndex + 1
    const cells: string[] = []
    Array.from(rowEl.getElementsByTagName('c')).forEach((cell, cellIndex) => {
      const ref = cell.getAttribute('r')
      const col = ref ? columnIndex(ref) : cellIndex
      const type = cell.getAttribute('t')
      let value = ''
      if (type === 's') {
        value = shared[Number(cell.getElementsByTagName('v')[0]?.textContent ?? -1)] ?? ''
      } else if (type === 'inlineStr') {
        value = Array.from(cell.getElementsByTagName('t'))
          .map((t) => t.textContent ?? '')
          .join('')
      } else if (type === 'b') {
        value = cell.getElementsByTagName('v')[0]?.textContent === '1' ? 'TRUE' : 'FALSE'
      } else {
        value = cell.getElementsByTagName('v')[0]?.textContent ?? ''
      }
      cells[col] = value.trim()
    })
    table[rowNo - 1] = Array.from(cells, (cell) => cell ?? '')
  })
  return table.filter((row): row is string[] => Array.isArray(row) && row.some((cell) => cell !== ''))
}

/** CSV 解析（带引号转义）：Excel 另存的 CSV 是逗号分隔、可能带 BOM 与引号 */
function parseCsv(text: string): string[][] {
  const clean = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < clean.length; i += 1) {
    const ch = clean[i]
    if (quoted) {
      if (ch === '"' && clean[i + 1] === '"') {
        cell += '"'
        i += 1
      } else if (ch === '"') {
        quoted = false
      } else {
        cell += ch
      }
      continue
    }
    if (ch === '"') quoted = true
    else if (ch === ',') {
      row.push(cell.trim())
      cell = ''
    } else if (ch === '\n') {
      row.push(cell.trim())
      if (row.some((item) => item !== '')) rows.push(row)
      row = []
      cell = ''
    } else cell += ch
  }
  row.push(cell.trim())
  if (row.some((item) => item !== '')) rows.push(row)
  return rows
}

/**
 * 读取上传的表格（.xlsx / .csv）。
 *
 * 返回的是「首行当表头」的二维字符串表，不含任何业务语义 —— 列名的含义由调用方决定
 * （学生导入认得「姓名 / 学号 / 班级…」这些列名，换一份表格就是另一套映射）。
 */
export async function readSpreadsheet(file: File): Promise<SheetTable> {
  const buffer = await file.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b
  let table: string[][]

  if (isZip) {
    const files = await unzip(buffer, (name) => name === 'xl/sharedStrings.xml' || /^xl\/(workbook|worksheets)\//.test(name) || name === 'xl/_rels/workbook.xml.rels')
    const shared = readSharedStrings(files.get('xl/sharedStrings.xml') ? decoder.decode(files.get('xl/sharedStrings.xml')!) : undefined)
    const sheetPath = firstSheetPath(files)
    if (!sheetPath) throw new Error('Excel 里没有找到工作表')
    table = readSheetRows(decoder.decode(files.get(sheetPath)!), shared)
  } else if (/\.csv$/i.test(file.name)) {
    table = parseCsv(decoder.decode(bytes))
  } else {
    throw new Error('仅支持 .xlsx 或 .csv，请用 Excel 另存为 .xlsx 后再导入')
  }

  if (!table.length) throw new Error('表格是空的，没有可读取的内容')
  const headers = table[0].map((cell) => cell.trim())
  const width = headers.length
  const rows = table.slice(1).map((row) => Array.from({ length: width }, (_, i) => row[i] ?? ''))
  return { headers, rows }
}

/* ==================== XLSX：写 ==================== */

/** CRC-32（zip 校验用）：查表法，一次建表全文件复用 */
const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i += 1) {
    let c = i
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[i] = c >>> 0
  }
  return table
})()

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (let i = 0; i < bytes.length; i += 1) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

interface ZipFile {
  name: string
  bytes: Uint8Array
}

/** 打一个 store（不压缩）方式的 zip —— Excel 对这个子集是完全兼容的 */
function zipStore(files: ZipFile[]): Blob {
  const encoder = new TextEncoder()
  const parts: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0

  for (const file of files) {
    const nameBytes = encoder.encode(file.name)
    const crc = crc32(file.bytes)

    const local = new Uint8Array(30 + nameBytes.length)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true)
    lv.setUint16(4, 20, true) // version needed
    lv.setUint16(6, 0x0800, true) // flags：文件名按 UTF-8
    lv.setUint16(8, 0, true) // method：store
    /* 固定时间戳（1980-01-01 00:00）：每次生成的模板字节一致，便于排查与缓存 */
    lv.setUint16(10, 0, true)
    lv.setUint16(12, 0x0021, true)
    lv.setUint32(14, crc, true)
    lv.setUint32(18, file.bytes.length, true)
    lv.setUint32(22, file.bytes.length, true)
    lv.setUint16(26, nameBytes.length, true)
    lv.setUint16(28, 0, true)
    local.set(nameBytes, 30)

    const cent = new Uint8Array(46 + nameBytes.length)
    const cv = new DataView(cent.buffer)
    cv.setUint32(0, 0x02014b50, true)
    cv.setUint16(4, 20, true) // version made by
    cv.setUint16(6, 20, true) // version needed
    cv.setUint16(8, 0x0800, true)
    cv.setUint16(10, 0, true)
    cv.setUint16(12, 0, true)
    cv.setUint16(14, 0x0021, true)
    cv.setUint32(16, crc, true)
    cv.setUint32(20, file.bytes.length, true)
    cv.setUint32(24, file.bytes.length, true)
    cv.setUint16(28, nameBytes.length, true)
    cv.setUint16(30, 0, true)
    cv.setUint16(32, 0, true)
    cv.setUint16(34, 0, true)
    cv.setUint16(36, 0, true)
    cv.setUint32(38, 0, true)
    cv.setUint32(42, offset, true)
    cent.set(nameBytes, 46)

    parts.push(local, file.bytes)
    central.push(cent)
    offset += local.length + file.bytes.length
  }

  const centralSize = central.reduce((sum, item) => sum + item.length, 0)
  const eocd = new Uint8Array(22)
  const ev = new DataView(eocd.buffer)
  ev.setUint32(0, 0x06054b50, true)
  ev.setUint16(4, 0, true)
  ev.setUint16(6, 0, true)
  ev.setUint16(8, files.length, true)
  ev.setUint16(10, files.length, true)
  ev.setUint32(12, centralSize, true)
  ev.setUint32(16, offset, true)
  ev.setUint16(20, 0, true)

  return new Blob([...parts, ...central, eocd], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`

const WORKBOOK_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`

/* 最小样式表：样式 0 = 正文，样式 1 = 加粗（表头用） */
const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="宋体"/></font><font><b/><sz val="11"/><name val="宋体"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>`

function buildSheetXml(rows: string[][], widths: number[]): string {
  const cols = widths.length
    ? `<cols>${widths
        .map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`)
        .join('')}</cols>`
    : ''
  const body = rows
    .map((row, rowIndex) => {
      const cells = row
        .map((value, colIndex) => {
          if (value === '' || value == null) return ''
          /* 一律按文本写（inlineStr）：学号 / 手机号是「数字样子的字符串」，
             写成数值会被 Excel 显示成 1.38E+10 并吃掉前导零 */
          const style = rowIndex === 0 ? ' s="1"' : ''
          return `<c r="${columnLetter(colIndex)}${rowIndex + 1}" t="inlineStr"${style}><is><t xml:space="preserve">${escapeXml(String(value))}</t></is></c>`
        })
        .join('')
      return `<row r="${rowIndex + 1}">${cells}</row>`
    })
    .join('')
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${cols}<sheetData>${body}</sheetData></worksheet>`
}

/**
 * 生成一个单工作表的 .xlsx。
 *
 * 只覆盖「表头 + 若干行文本」这一种形态（导入模板正是如此）：没有公式、没有合并单元格、
 * 没有日期格式 —— 需要这些时应该走服务端导出，而不是在前端继续堆 OOXML。
 */
export function buildXlsx(options: {
  sheetName: string
  rows: string[][]
  /** 可选列宽（按列顺序，单位同 Excel 的字符宽） */
  widths?: number[]
}): Blob {
  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${escapeXml(options.sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`

  const encoder = new TextEncoder()
  return zipStore([
    { name: '[Content_Types].xml', bytes: encoder.encode(CONTENT_TYPES) },
    { name: '_rels/.rels', bytes: encoder.encode(ROOT_RELS) },
    { name: 'xl/workbook.xml', bytes: encoder.encode(workbook) },
    { name: 'xl/_rels/workbook.xml.rels', bytes: encoder.encode(WORKBOOK_RELS) },
    { name: 'xl/styles.xml', bytes: encoder.encode(STYLES) },
    { name: 'xl/worksheets/sheet1.xml', bytes: encoder.encode(buildSheetXml(options.rows, options.widths ?? [])) },
  ])
}
