/**
 * 知情同意书 PDF 生成（零依赖）。
 *
 * ## 为什么是「画布 → 图片 → PDF」而不是「文本 → PDF」
 *
 * PDF 里的中文文本必须**内嵌字体**（CID 字体 + ToUnicode 表），仓里既没有字体文件，
 * 也不该为一份留档文档塞进上兆的字库。于是换一条路：用 Canvas 把同意书**排版好再栅格化**，
 * 把每页 JPEG 塞进 PDF 的图片对象（`/DCTDecode`，PDF 原生支持的 JPEG 直通，不需要压缩库）。
 *
 * 代价是 PDF 里没有可检索的文字层 —— 对「已签署的同意书」这类**扫描件性质**的留档完全可接受
 * （纸质签署的扫描件同样没有文字层）；签名文字、版本号、时间这些**结构化数据**仍在
 * `ConsentRecord` 里，检索与导出走接口，不依赖这份 PDF。
 *
 * ## 排版约定
 *
 * - A4 @150dpi（1240 × 1754），页边距 96px，与打印出来的观感一致；
 * - 正文按「块」排：标题 / 元信息表 / 段落 / 条款 / 勾选项 / 签署区，块高不足时自动换页，
 *   页脚统一补「第 x 页 / 共 n 页」（总页数在排版结束后回填 —— 所以页脚是**第二遍**画的）；
 * - 一切取值来自参数，函数本身不读全局状态：同一份记录任何时候生成的 PDF 都一致。
 */
import type { ConsentRecord } from '@aiteach/shared'

/** 授权范围的中文解释：同意书正文要写清楚「同意了什么」，不能只列四个词 */
export const CONSENT_SCOPE_DETAILS: Array<{ name: string; desc: string }> = [
  { name: '学情分析', desc: '基于作业、测评与考试数据生成知识点掌握画像与薄弱点归因' },
  { name: '个性化练习推送', desc: '按薄弱知识点自动组题并向学生推送练习' },
  { name: '错题本生成', desc: '归集错题并生成班级 / 个人错题本用于复习' },
  { name: 'AI 问答记录', desc: '保存学生使用 AI 答疑时的提问记录，用于改进讲解与教研' },
]

export interface ConsentDocInput {
  record: ConsentRecord
  student: {
    name: string
    studentNo: string
    className: string
    grade: string
    campus: string
    guardianName: string
    guardianPhone?: string
  }
  /** 机构名称（页眉与印章） */
  orgName: string
}

/* ==================== 画布排版 ==================== */

const PAGE = { w: 1240, h: 1754, margin: 96 }
const FONT = '"PingFang SC", "Microsoft YaHei", "Hiragino Sans GB", sans-serif'
const INK = '#1c2434'
const SUB = '#5b6478'
const LINE = '#c9d2e6'

interface PageState {
  ctx: CanvasRenderingContext2D
  /** 已开始的页面（最后一页就是正在画的那一页） */
  pages: HTMLCanvasElement[]
  /** 当前笔位（自上而下） */
  y: number
  /** 页眉内容：每页都要有，换页时自动补 */
  header: { orgName: string; docNo: string }
}

function newPage(): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas')
  canvas.width = PAGE.w
  canvas.height = PAGE.h
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('当前浏览器不支持 Canvas，无法生成同意书')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, PAGE.w, PAGE.h)
  ctx.textBaseline = 'top'
  return { canvas, ctx }
}

function setFont(ctx: CanvasRenderingContext2D, size: number, weight: 400 | 600 | 700 = 400) {
  ctx.font = `${weight} ${size}px ${FONT}`
}

/** 按字符宽度断行（中文逐字断、英文按空格断），返回每一行的文本 */
function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = []
  let line = ''
  const chars = Array.from(text)
  for (let i = 0; i < chars.length; i += 1) {
    const next = line + chars[i]
    if (ctx.measureText(next).width > maxWidth && line) {
      /* 英文单词不劈开：回退到最后一个空格 */
      const lastSpace = line.lastIndexOf(' ')
      if (lastSpace > 0 && /[A-Za-z0-9]/.test(chars[i])) {
        lines.push(line.slice(0, lastSpace))
        line = line.slice(lastSpace + 1) + chars[i]
      } else {
        lines.push(line)
        line = chars[i]
      }
    } else {
      line = next
    }
  }
  if (line) lines.push(line)
  return lines.length ? lines : ['']
}

const BODY_SIZE = 21
const LINE_HEIGHT = 36
const CONTENT_WIDTH = PAGE.w - PAGE.margin * 2
/** 正文下边界：页脚要留出位置（页脚在排版结束后统一回填） */
const BOTTOM = PAGE.h - PAGE.margin - 40

/**
 * 签署区整体高度（分隔线 20 + 签名框 330 + 上下留白）。
 *
 * 单独抽成常量是因为「这一块会不会被挤到下一页」要在**画之前**就知道：
 * 签署区一旦换页就成了整页只有一块的签名页，得按签名页的排法处理（见 signatureBlock）。
 */
const SIGN_HEIGHT = 408

/** 放不下就换页：块的切分只按「笔位 + 需要的高度」，不做孤行控制（条款都短，够用） */
function ensureSpace(state: PageState, height: number) {
  if (state.y + height <= BOTTOM) return
  startPage(state)
}

function paragraph(state: PageState, text: string, options: { indent?: boolean; size?: number; color?: string; gap?: number } = {}) {
  const size = options.size ?? BODY_SIZE
  const color = options.color ?? INK
  setFont(state.ctx, size)
  const indent = options.indent === false ? 0 : size * 2
  const lines = wrap(state.ctx, text, CONTENT_WIDTH - indent)
  lines.forEach((line, index) => {
    ensureSpace(state, LINE_HEIGHT)
    setFont(state.ctx, size)
    state.ctx.fillStyle = color
    state.ctx.fillText(line, PAGE.margin + (index === 0 ? indent : 0), state.y)
    state.y += LINE_HEIGHT
  })
  state.y += options.gap ?? 10
}

function sectionTitle(state: PageState, text: string) {
  ensureSpace(state, 56)
  state.y += 8
  setFont(state.ctx, 23, 700)
  state.ctx.fillStyle = INK
  state.ctx.fillText(text, PAGE.margin, state.y)
  state.y += 44
}

function rule(state: PageState, color = LINE) {
  ensureSpace(state, 20)
  state.ctx.strokeStyle = color
  state.ctx.lineWidth = 1.5
  state.ctx.beginPath()
  state.ctx.moveTo(PAGE.margin, state.y)
  state.ctx.lineTo(PAGE.w - PAGE.margin, state.y)
  state.ctx.stroke()
  state.y += 20
}

/** 元信息表：两列（左标签 130px），行高 46 */
function metaTable(state: PageState, rows: Array<[string, string]>) {
  const labelWidth = 132
  const rowHeight = 46
  rows.forEach(([label, value]) => {
    ensureSpace(state, rowHeight)
    setFont(state.ctx, 20)
    state.ctx.fillStyle = SUB
    state.ctx.fillText(label, PAGE.margin, state.y)
    setFont(state.ctx, 20, 600)
    state.ctx.fillStyle = INK
    state.ctx.fillText(value, PAGE.margin + labelWidth, state.y)
    state.y += rowHeight
  })
  state.y += 6
}

/** 勾选项：☑ / ☐ + 名称 + 说明（说明折行后按名称缩进对齐） */
function checklistItem(state: PageState, checked: boolean, name: string, desc: string) {
  setFont(state.ctx, BODY_SIZE)
  const box = checked ? '☑' : '☐'
  const nameWidth = state.ctx.measureText(`　${name}`).width + 30
  const lines = wrap(state.ctx, desc, CONTENT_WIDTH - nameWidth)
  lines.forEach((line, index) => {
    ensureSpace(state, LINE_HEIGHT)
    if (index === 0) {
      setFont(state.ctx, BODY_SIZE, 600)
      state.ctx.fillStyle = checked ? '#0aa396' : SUB
      state.ctx.fillText(box, PAGE.margin, state.y)
      state.ctx.fillStyle = INK
      state.ctx.fillText(name, PAGE.margin + 30, state.y)
    }
    setFont(state.ctx, 19)
    state.ctx.fillStyle = SUB
    state.ctx.fillText(line, PAGE.margin + nameWidth, state.y)
    state.y += LINE_HEIGHT
  })
  state.y += 6
}

/**
 * 页眉：机构名 + 文档编号（+ 续页标记）。
 *
 * 每一页都要有，不只是第一页 —— 同意书是**单页归档**的东西，老师打印时可能只抽某一页，
 * 没有页眉的那一页既不知道是哪家机构的、也不知道对应哪个编号。
 */
function pageHeader(state: PageState, continuation: boolean) {
  const { orgName, docNo } = state.header
  setFont(state.ctx, 19, 600)
  state.ctx.fillStyle = SUB
  state.ctx.fillText(orgName, PAGE.margin, state.y)
  /* 量宽度必须在同一字号下量，否则「（续页）」会压在机构名上或飘出去 */
  const orgWidth = state.ctx.measureText(orgName).width
  if (continuation) {
    setFont(state.ctx, 16)
    state.ctx.fillText('（续页）', PAGE.margin + orgWidth + 24, state.y + 2)
  }
  setFont(state.ctx, 16)
  state.ctx.fillStyle = SUB
  state.ctx.fillText(docNo, PAGE.w - PAGE.margin - state.ctx.measureText(docNo).width, state.y)
  state.y += 40
  rule(state)
}

/** 开新的一页（带页眉）。换页只有这一个入口，免得哪次手写漏掉页眉 */
function startPage(state: PageState) {
  const next = newPage()
  state.ctx = next.ctx
  state.pages.push(next.canvas)
  state.y = PAGE.margin
  pageHeader(state, state.pages.length > 1)
}

/**
 * 签署区：签名 + 关系 + 时间 + 印章。
 *
 * 签名文字用**楷体**写，带一条底线 —— 电子签名的落款要看得出「这是谁签的字」，
 * 混在正文里的一行黑体字没有签署感。
 *
 * 换页的排法：签字页在合同里是独立一页（内容在上一页、签字在下一页），此时把签署框
 * **压到页面下方**并补一次页眉，让空白集中在上半页 —— 否则就是一张「半页正文 + 半页白纸」
 * 的怪东西。未签署的草稿不盖章：章是机构的确认，草稿上盖章等于替家长先认了。
 */
function signatureBlock(state: PageState, input: ConsentDocInput) {
  const { record, student } = input
  if (state.y + SIGN_HEIGHT > BOTTOM) {
    startPage(state)
    state.y += 24
  }
  /* 余量太多就把签署框压到页面下方（BOTTOM 已扣掉页脚占位，画完正好落在边界上）：
     签字区下面挂着半页白纸，比签字区和正文之间留一段空白更难看 */
  const spare = BOTTOM - (state.y + SIGN_HEIGHT)
  if (spare > 140) state.y += spare
  state.y += 12
  rule(state)

  const boxTop = state.y
  const boxHeight = 350
  state.ctx.strokeStyle = LINE
  state.ctx.lineWidth = 1.5
  state.ctx.strokeRect(PAGE.margin, boxTop, CONTENT_WIDTH, boxHeight)

  const left = PAGE.margin + 32
  let y = boxTop + 28

  const signed = record.status === 'granted' && !!record.signature

  setFont(state.ctx, 19)
  state.ctx.fillStyle = SUB
  state.ctx.fillText('监护人签名（电子签署）：', left, y)
  y += 34

  if (signed) {
    state.ctx.font = `700 46px "Kaiti SC", "STKaiti", "KaiTi", ${FONT}`
    state.ctx.fillStyle = '#0b3d91'
    state.ctx.fillText(record.signature ?? '', left + 12, y - 6)
    /* 手写感：签名下压一条细线 */
    state.ctx.strokeStyle = '#0b3d91'
    state.ctx.lineWidth = 2
    state.ctx.beginPath()
    const signatureWidth = Math.max(180, state.ctx.measureText(record.signature ?? '').width)
    state.ctx.moveTo(left + 8, y + 54)
    state.ctx.lineTo(left + 8 + signatureWidth, y + 54)
    state.ctx.stroke()
    /* 电子签名标识：让人一眼看出这是电子签署而非手写扫描 */
    state.ctx.strokeStyle = '#0aa396'
    state.ctx.lineWidth = 2
    state.ctx.strokeRect(left + signatureWidth + 32, y + 4, 150, 40)
    setFont(state.ctx, 18, 600)
    state.ctx.fillStyle = '#0aa396'
    state.ctx.fillText('电子签名', left + signatureWidth + 46, y + 14)
  } else {
    setFont(state.ctx, 20)
    state.ctx.fillStyle = SUB
    state.ctx.fillText('（未签署 · 以下为待签草稿，不具留档效力）', left + 12, y)
  }
  y += 110

  const cells: Array<[string, string]> = [
    ['与学生的关系', record.relation],
    ['签署时间', record.signedAt ?? '—'],
    ['签署渠道', record.channel ?? '—'],
    ['知情同意书版本', record.docVersion],
    ['学生姓名', student.name],
    ['学号 / 班级', `${student.studentNo} · ${student.className}`],
  ]
  cells.forEach(([label, value], index) => {
    const col = index % 2
    const row = Math.floor(index / 2)
    const x = left + col * (CONTENT_WIDTH / 2 - 20)
    const cellY = y + row * 46
    setFont(state.ctx, 18)
    state.ctx.fillStyle = SUB
    state.ctx.fillText(`${label}：`, x, cellY)
    setFont(state.ctx, 19, 600)
    state.ctx.fillStyle = INK
    state.ctx.fillText(value, x + 130, cellY)
  })

  /* 机构印章：右上角、略微倾斜，模拟盖章的位置与随手感 —— 落在签名右侧的空白里，
     不压签署时间 / 版本号那几行小字（盖章盖住留档信息，扫描件上就再也看不清了）。
     日期取签署日期而不是「今天」：同一份记录任何时候生成的 PDF 都要一模一样 */
  if (signed) {
    const sealX = PAGE.w - PAGE.margin - 160
    const sealY = boxTop + 78
    state.ctx.save()
    state.ctx.translate(sealX, sealY)
    state.ctx.rotate(-0.12)
    state.ctx.strokeStyle = 'rgba(198, 40, 40, 0.82)'
    state.ctx.lineWidth = 4
    state.ctx.beginPath()
    state.ctx.arc(0, 0, 86, 0, Math.PI * 2)
    state.ctx.stroke()
    state.ctx.fillStyle = 'rgba(198, 40, 40, 0.86)'
    setFont(state.ctx, 17, 700)
    const orgLine = input.orgName.length > 10 ? input.orgName.slice(0, 10) : input.orgName
    state.ctx.fillText(orgLine, -state.ctx.measureText(orgLine).width / 2, -42)
    setFont(state.ctx, 15)
    state.ctx.fillText('知情同意专用章', -60, -12)
    setFont(state.ctx, 13)
    const sealDate = (record.signedAt ?? '').slice(0, 10).replace(/-/g, '.')
    state.ctx.fillText(sealDate, -(state.ctx.measureText(sealDate).width / 2), 14)
    state.ctx.restore()
  }

  state.y = boxTop + boxHeight + 26
}

/* ==================== 正文 ==================== */

function drawDocument(input: ConsentDocInput): HTMLCanvasElement[] {
  const { record, student, orgName } = input
  const docNo = `文档编号：CN-${record.docVersion.replace(/[^0-9]/g, '')}-${String(record.id).padStart(4, '0')}`
  const first = newPage()
  const state: PageState = {
    ctx: first.ctx,
    pages: [first.canvas],
    y: PAGE.margin,
    header: { orgName, docNo },
  }

  /* —— 页眉 —— */
  pageHeader(state, false)

  /* —— 标题 —— */
  const titleLines = wrap(state.ctx, '学生个人信息保护与 AI 学情分析知情同意书', CONTENT_WIDTH)
  titleLines.forEach((line) => {
    setFont(state.ctx, 34, 700)
    state.ctx.fillStyle = INK
    const width = state.ctx.measureText(line).width
    state.ctx.fillText(line, (PAGE.w - width) / 2, state.y)
    state.y += 50
  })
  const versionText = `版本 ${record.docVersion}　·　依据《中华人民共和国个人信息保护法》《未成年人个人信息网络保护规定》`
  setFont(state.ctx, 16)
  state.ctx.fillStyle = SUB
  state.ctx.fillText(versionText, (PAGE.w - state.ctx.measureText(versionText).width) / 2, state.y)
  state.y += 44

  /* —— 当事人 —— */
  metaTable(state, [
    ['甲方（机构）', orgName],
    ['乙方（监护人）', `${student.guardianName}（${record.relation}）`],
    ['学生', `${student.name}（学号 ${student.studentNo}）`],
    ['就读班级', `${student.campus} · ${student.className}`],
  ])

  paragraph(
    state,
    `为向学生提供个性化教学服务，甲方依据上述法律法规，就收集、使用学生个人信息及开展 AI 学情分析事宜，向乙方说明如下，并请在文末签署确认。`,
  )

  sectionTitle(state, '一、信息收集范围')
  paragraph(state, '1. 基本信息：姓名、学号、性别、年级、班级、所属校区；')
  paragraph(state, '2. 学习信息：作业与测评作答、考试成绩、错题记录、知识点掌握情况；')
  paragraph(state, '3. 图像信息：作答图片与作业拍照（仅用于批改与错题归集，不用于人脸识别，不对外展示）；')
  paragraph(state, '4. 监护人联系方式（仅用于教学沟通与安全通知，不做商业推广）。')

  sectionTitle(state, '二、AI 学情分析说明')
  paragraph(state, '1. 平台基于上述学习信息，由 AI 模型生成知识点掌握画像、薄弱点归因与个性化练习推荐；')
  paragraph(state, '2. AI 生成内容仅作为教学辅助参考，须经任课教师复核后使用，不作为对学生学业水平或品行的最终评价；')
  paragraph(state, '3. 学生个人信息不会用于商业推广，不向第三方出售或提供，法律法规另有规定的除外。')

  sectionTitle(state, '三、授权范围（请监护人确认）')
  paragraph(state, '乙方同意甲方在下列范围内处理学生信息（已勾选项为本次授权范围）：', { indent: false })
  CONSENT_SCOPE_DETAILS.forEach((scope) => {
    checklistItem(state, record.scopes.includes(scope.name), scope.name, scope.desc)
  })

  sectionTitle(state, '四、监护人权利')
  paragraph(state, '1. 可随时查询、更正学生的个人信息；')
  paragraph(state, '2. 可随时撤回本同意书：撤回后平台立即停止对该生生成 AI 画像与个性化推送，已生成内容的处理方式见《隐私政策》；')
  paragraph(state, '3. 联系方式：客服热线 400-800-1234 · privacy@aiteach.cn。')

  sectionTitle(state, '五、其他约定')
  paragraph(state, '1. 本同意书自签署之日起生效，至学生毕业或监护人撤回之日止；')
  paragraph(state, '2. 本同意书一式两份，甲乙双方各执一份；电子签署与纸质签署具有同等效力。')

  sectionTitle(state, '六、签署确认')
  paragraph(
    state,
    '乙方已完整阅读并理解上述全部条款，确认第三条勾选范围为本次授权范围，知悉可随时撤回；本页签名与勾选结果真实有效。',
  )
  if (record.status !== 'granted') {
    paragraph(state, '（当前为待签草稿：监护人尚未签署，本文件不构成有效授权。）', { size: 19, color: SUB, gap: 4 })
  }

  signatureBlock(state, input)

  /* —— 页脚：总页数在这一步才知道，所以统一回填 —— */
  const pages = state.pages
  pages.forEach((canvas, index) => {
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.textBaseline = 'top'
    setFont(ctx, 15)
    ctx.fillStyle = SUB
    const footer = `第 ${index + 1} 页 / 共 ${pages.length} 页　·　电子签署留档，可凭文档编号核验`
    ctx.fillText(footer, PAGE.margin, PAGE.h - PAGE.margin + 26)
    /* 不写「生成时间」：同一份记录任何时候生成的 PDF 必须一致，能作为时间证据的只有签署时间 */
    const time = record.signedAt ? `签署时间 ${record.signedAt}` : '未签署 · 草稿预览'
    setFont(ctx, 14)
    ctx.fillText(time, PAGE.w - PAGE.margin - ctx.measureText(time).width, PAGE.h - PAGE.margin + 27)
  })
  return pages
}

/* ==================== PDF 封装 ==================== */

/**
 * 把若干 JPEG 页面写成一个 PDF。
 *
 * 结构（最朴素的 1.4 版）：Catalog → Pages → 每页 (Page, Contents, Image XObject)。
 * 图像用 `/Filter /DCTDecode` 直接塞 JPEG 字节，PDF 阅读器自己解 —— 不需要任何压缩库。
 * 交叉引用表按字节偏移现算，末尾补 trailer。
 */
function buildPdfFromJpegs(pages: Array<{ bytes: Uint8Array; width: number; height: number }>): Blob {
  const encoder = new TextEncoder()
  const chunks: Uint8Array[] = []
  let length = 0
  const offsets: number[] = []

  const push = (data: string | Uint8Array) => {
    const bytes = typeof data === 'string' ? encoder.encode(data) : data
    chunks.push(bytes)
    length += bytes.length
  }
  const object = (body: () => string | Uint8Array) => {
    offsets.push(length)
    const id = offsets.length
    push(`${id} 0 obj\n`)
    push(body())
    push('\nendobj\n')
    return id
  }

  push('%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3\n')

  /* 对象编号必须在写之前定好：1 = Catalog，2 = Pages 树，之后每页固定占 3 个
     （Page → Contents → Image XObject），Kids 里按这个规律引用 */
  object(() => '<< /Type /Catalog /Pages 2 0 R >>')
  object(() => {
    const kids = pages.map((_, index) => `${3 + index * 3} 0 R`).join(' ')
    return `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`
  })

  pages.forEach((page, index) => {
    const pageId = 3 + index * 3
    const contentId = pageId + 1
    const imageId = pageId + 2

    const width = 595.276
    const height = 841.89
    object(
      () =>
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] ` +
        `/Resources << /XObject << /Im0 ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`,
    )
    /* 内容流只有一句：把整页图像按 A4 铺满 */
    const stream = `q\n${width} 0 0 ${height} 0 0 cm\n/Im0 Do\nQ\n`
    object(() => `<< /Length ${stream.length} >>\nstream\n${stream}endstream`)
    object(() => {
      /* 图像对象的数据是二进制：头部与 JPEG 字节分开推入，不能先拼成字符串 */
      push(
        `<< /Type /XObject /Subtype /Image /Width ${page.width} /Height ${page.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.bytes.length} >>\nstream\n`,
      )
      push(page.bytes)
      push('\nendstream')
      return ''
    })
  })

  const total = offsets.length
  const xrefStart = length
  let xref = `xref\n0 ${total + 1}\n0000000000 65535 f \n`
  offsets.forEach((offset) => {
    xref += `${String(offset).padStart(10, '0')} 00000 n \n`
  })
  push(xref)
  push(`trailer\n<< /Size ${total + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`)

  const merged = new Uint8Array(length)
  let cursor = 0
  chunks.forEach((chunk) => {
    merged.set(chunk, cursor)
    cursor += chunk.length
  })
  return new Blob([merged], { type: 'application/pdf' })
}

/** 画布 → JPEG 字节 */
async function canvasToJpeg(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92))
  if (!blob) throw new Error('同意书渲染失败，请重试')
  return new Uint8Array(await blob.arrayBuffer())
}

/** 生成知情同意书 PDF（可直接塞进 `<iframe>` 或 blob 下载） */
export async function buildConsentPdf(input: ConsentDocInput): Promise<Blob> {
  const canvases = drawDocument(input)
  const pages = await Promise.all(
    canvases.map(async (canvas) => ({ bytes: await canvasToJpeg(canvas), width: canvas.width, height: canvas.height })),
  )
  return buildPdfFromJpegs(pages)
}
