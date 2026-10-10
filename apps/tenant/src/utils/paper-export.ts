/**
 * 试卷导出：Word（.doc）与 PDF（打印）。
 *
 * 为什么自己拼 HTML 而不是直接 `window.print()` 现有页面：
 * 1. 预览弹窗是**按真实纸面缩放渲染**的（缩放、阴影、版心边框），打印出来会带上这些装饰；
 * 2. 预览是分版拼版的 DOM，打印时浏览器不认识「版」，会把它当普通块重排，分页全乱；
 * 3. 导出要能脱离 UI 跑（试卷库列表里一键导出，不必先打开预览）。
 *
 * 所以这里从 **试卷数据** 重新生成一份干净的打印用 HTML：Word 走 `application/msword`
 * 的 HTML 文档（Word 可直接打开并另存为 .docx），PDF 走新窗口 + 系统打印。
 *
 * 注意：公式节点在导出文档里没有 KaTeX 可渲染，统一转成 `$LaTeX$` 源码，保证可读、可补。
 */
import type { OrgPaper, OrgQuestion } from '@aiteach/shared'
import { isRichContent, sanitizeRichHtml } from '@aiteach/shared'
import { ANSWER_LINES, DEFAULT_PAPER_NOTICES } from '@/components/paper/paper-layouts'
import { isJudgeNoOptions, judgeAnswerText, optionColumnsOf } from '@/utils/question-card'

/** 学生版（只有题）/ 教师版（附答案与解析）/ 纯答案页 */
export type ExportVersion = 'student' | 'teacher' | 'answer'

export interface ExportOptions {
  version: ExportVersion
  /** 卷头考生信息栏（学校 / 班级 / 姓名 / 考号） */
  withInfo?: boolean
  /** 附答题卡（客观题填涂表） */
  withAnswerCard?: boolean
}

const NUMBERS = '一二三四五六七八九十'
/** 大题标题已自带序号的写法，不再补卷面序号（与预览弹窗同一口径） */
const NUMBERED_TITLE =
  /^([一二三四五六七八九十]+[、.．]|（[一二三四五六七八九十]+）|第[一二三四五六七八九十百]+[部分章节]|\d+[、.．])/

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** 富文本 → 可嵌入导出文档的 HTML（纯文本按文本转义，公式回落为 LaTeX 源码） */
function richHtml(content: string): string {
  if (!content) return ''
  if (!isRichContent(content)) return escapeHtml(content)
  const doc = new DOMParser().parseFromString(sanitizeRichHtml(content), 'text/html')
  doc.querySelectorAll('[data-type="inline-math"],[data-type="block-math"]').forEach((el) => {
    const latex = el.getAttribute('data-latex') ?? ''
    el.textContent = `$${latex}$`
    el.removeAttribute('data-type')
    el.removeAttribute('data-latex')
    el.removeAttribute('class')
  })
  return doc.body.innerHTML
}

const LETTERS = 'ABCDEF'

/** 选项序号：判断题按卷面习惯用 √ / ×，其余题型用 A/B/C…（与预览的 PaperBlock 同一口径） */
function optionMark(type: string, index: number): string {
  return type === '判断' ? (index === 0 ? '√' : '×') : LETTERS[index] ?? ''
}

/**
 * 答案在纸面上的写法：无选项判断题归一到「对 / 错」（库里可能存 A/B），
 * 其余题型原样（客观题是字母，主观题是富文本，交给 richHtml 转义）。
 */
function answerHtml(item: OrgQuestion): string {
  const text = isJudgeNoOptions(item) ? judgeAnswerText(item.answer) : item.answer
  return richHtml(text)
}

/** 排版共用样式：Word 与打印窗口共用，保证两条导出路径长得一样 */
function baseCss(): string {
  return `
    @page { size: A4; margin: 20mm 18mm; }
    * { box-sizing: border-box; }
    /* text-underline-offset：下划线离文字太近，抬开一点。写 body 上靠继承覆盖全文
       —— 编辑器与只读端（RichTextViewer.vue）各有一份同样的声明。 */
    body { font-family: "Songti SC", SimSun, "Noto Serif SC", serif; font-size: 12pt; line-height: 1.75; color: #111; text-underline-offset: 0.2em; }
    .p-title { font-family: "Heiti SC", "Microsoft YaHei", sans-serif; font-size: 20pt; text-align: center; margin: 0 0 6px; }
    .p-sub { text-align: center; font-size: 10.5pt; color: #444; margin-bottom: 10px; }
    .p-info { border: 1px solid #333; border-radius: 3px; padding: 6px 10px; font-size: 10.5pt; margin-bottom: 16px; }
    .p-info span { display: inline-block; min-width: 22%; }
    /* 卷首注意事项：与卷面上一样，上下两道横线夹住，条目逐条缩进 */
    .p-notice { border-top: 1px solid #333; border-bottom: 1px solid #333; padding: 6px 2px; margin-bottom: 14px; font-size: 10.5pt; line-height: 1.7; }
    .p-notice b { font-family: "Heiti SC", "Microsoft YaHei", sans-serif; }
    .p-notice p { margin: 2px 0 0; }
    /* 附加区块的格子：表格走 border-collapse 的真表格（Word 认得），
       四线格是「顶上一条线 + 三条带下边框的行」= 四条横线，横线是逐行带下边框的定高块。
       都按 100% 铺满版心。行高用 px 定死：Word 对百分比高度与弹性布局都不认，定死才印得准。 */
    .p-grid { width: 100%; border-collapse: collapse; margin: 12px 0; }
    .p-grid td { border: 1px solid #333; height: 26px; }
    .p-en { margin: 12px 0; }
    .p-en-row { border-top: 1px solid #999; margin-bottom: 16px; }
    .p-en-row i { display: block; height: 10px; border-bottom: 1px solid #999; }
    .p-en-row i.strong { border-bottom: 2px solid #333; }
    .p-lines { margin: 12px 0; }
    .p-line { height: 26px; border-bottom: 1px solid #666; }
    h2.sec { font-family: "Heiti SC", "Microsoft YaHei", sans-serif; font-size: 13pt; margin: 18px 0 8px; }
    .sec-note { font-size: 10.5pt; font-weight: normal; color: #555; margin-left: 8px; }
    .material { border: 1px solid #bbb; background: #fafafa; padding: 10px 12px; margin: 6px 0 12px; font-size: 11pt; }
    .material-hint { font-weight: bold; margin-bottom: 6px; }
    .q { margin: 0 0 12px; page-break-inside: avoid; }
    .q-inner { display: block; }
    .q-no { font-weight: bold; margin-right: 2px; }
    .q-score { color: #666; font-size: 10pt; }
    .q-stem { display: inline; }
    .q-opt { margin: 4px 0 0 22px; }
    .q-opt-line { display: block; }
    .q-opt-letter { font-weight: bold; margin-right: 4px; }
    /* 一行 N 个：由题目自身的选项排布决定，靠 inline-block 宽度分列（Word 对 grid / flex 支持不稳） */
    .q-opt.c2 .q-opt-line { display: inline-block; width: 49%; vertical-align: top; }
    .q-opt.c4 .q-opt-line { display: inline-block; width: 24%; vertical-align: top; }
    .q-ans { margin: 6px 0 0 22px; font-size: 10.5pt; color: #0a5; border-left: 3px solid #0a5; padding-left: 8px; }
    .q-space { height: 60px; border-bottom: 1px dashed #bbb; margin: 8px 0 0 22px; }
    .card-title { font-family: "Heiti SC", "Microsoft YaHei", sans-serif; font-size: 13pt; margin: 20px 0 8px; }
    .card-hint { font-size: 10pt; color: #666; margin-bottom: 8px; }
    table.ans { border-collapse: collapse; width: 100%; font-size: 11pt; }
    table.ans td { border: 1px solid #333; padding: 5px 8px; }
    table.ans td.no { width: 90px; text-align: center; font-weight: bold; }
    .foot { margin-top: 18px; text-align: center; font-size: 10pt; color: #888; }

    /* ---- 以下为「题干里的富文本」服务，与编辑器（RichTextEditor.vue）、只读端
       （packages/shared/src/components/RichTextViewer.vue）三处保持同一套样式。
       这一份能生效的是**打印窗口**这条路径（真浏览器）；.doc 那条由 Word 解析，
       不认 @counter-style，①/(1)/一、 会退化成 1.，其余样式 Word 都认。 ---- */

    /* 题目里手插的表格。:not([class]) 是为了避开上面两张自带样式的表（.p-grid / .ans）。
       table-layout: fixed 才能让 <colgroup><col style="width"> 说了算（auto 会按内容重排），
       行高则由 <tr style="height"> 给。两者都是编辑器落下来的行内样式。 */
    table:not([class]) { border-collapse: collapse; table-layout: fixed; width: 100%; margin: 6px 0; }
    table:not([class]) td,
    table:not([class]) th { border: 1px solid #333; padding: 4px 8px; vertical-align: top; }
    table:not([class]) th { background: #f4f6fa; font-weight: bold; }
    /* 单元格里 Tiptap 一定包一层 <p>，那层默认下边距会把行撑虚 */
    table:not([class]) td > p,
    table:not([class]) th > p { margin: 0; }

    /* 序号样式 ①、(1)、一、 的定义。这三个是 @counter-style，**文档级 at-rule** ——
       导出的 Word / 打印 HTML 是另一份文档，必须在这里再写一份，跟
       apps/tenant/src/styles/main.css 与 RichTextViewer.vue 里那两份互为指认，改一处要改三处。 */
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
  `
}

interface ExportQuestion {
  no: number
  score: number
  item?: OrgQuestion
}

function buildViews(paper: OrgPaper, questions: OrgQuestion[]) {
  let no = 0
  const byId = new Map(questions.map((row) => [row.id, row]))
  return paper.sections.map((section, si) => {
    const list: ExportQuestion[] = section.questions.map((entry) => {
      no += 1
      return { no, score: Number(entry.score) || 0, item: byId.get(entry.questionId) }
    })
    const score = list.reduce((sum, q) => sum + q.score, 0)
    const first = list[0]?.score ?? 0
    const perScore = list.length > 0 && list.every((q) => q.score === first) ? first : null
    const raw = section.title.trim()
    return {
      key: `s-${section.id}`,
      title: raw && NUMBERED_TITLE.test(raw) ? section.title : `${NUMBERS[si] ?? si + 1}、${raw}`,
      count: list.length,
      score,
      perScore,
      questions: list,
      material: section.material?.trim() ?? '',
      materialHint: section.materialHint?.trim() ?? '',
    }
  })
}

function sectionNote(view: { count: number; score: number; perScore: number | null }): string {
  const per = view.perScore !== null ? `，每小题 ${view.perScore} 分` : ''
  return `（共 ${view.count} 小题${per}，共 ${view.score} 分）`
}

function questionHtml(q: ExportQuestion, teacher: boolean): string {
  const item = q.item
  if (!item) return `<div class="q"><span class="q-no">${q.no}.</span> （题目已不存在）</div>`

  const score = `<span class="q-score">（${q.score} 分）</span>`
  const stem = `<span class="q-stem">${richHtml(item.stem)}</span>`
  const columns = optionColumnsOf(item)
  const options = item.options.length
    ? `<div class="q-opt${columns > 1 ? ` c${columns}` : ''}">${item.options
        .map(
          (opt, i) =>
            `<span class="q-opt-line"><span class="q-opt-letter">${optionMark(item.type, i)}.</span>${richHtml(opt)}</span>`,
        )
        .join('')}</div>`
    : ''

  /* 学生版给解答题留作答空白：填空 2 行、其余按分值给高度。
     无选项判断不留 —— 它在题干前的（　　）里作答（见 isJudgeNoOptions）。 */
  let space = ''
  if (!teacher && item.options.length === 0 && !isJudgeNoOptions(item)) {
    const lines = item.type.includes('填空') ? ANSWER_LINES : 0
    space = lines
      ? `<div class="q-space" style="height:${lines * 26}px"></div>`
      : `<div class="q-space" style="height:${Math.min(240, Math.max(70, Math.round(q.score * 8 + 40)))}px"></div>`
  }

  const answer =
    teacher && (item.answer || item.analysis)
      ? `<div class="q-ans"><b>答案：</b>${answerHtml(item) || '—'}${
          item.analysis ? `<br><b>解析：</b>${richHtml(item.analysis)}` : ''
        }</div>`
      : ''

  return `<div class="q"><div class="q-inner"><span class="q-no">${q.no}.</span>${score}${stem}</div>${options}${space}${answer}</div>`
}

/** 纯答案页：一题一行，客观题给选项字母，主观题给答案全文 */
function answerOnlyHtml(q: ExportQuestion): string {
  const item = q.item
  if (!item) return `<tr><td class="no">${q.no}</td><td>题目已不存在</td></tr>`
  const answer = item.options.length ? item.answer : answerHtml(item) || '—'
  return `<tr><td class="no">${q.no}</td><td>${answer}</td></tr>`
}

/**
 * 卷面附加区块（表格 / 四线格 / 横线）。
 *
 * 不用 CSS grid 而用 `<table>` 排格子：导出件是给 Word / WPS 打开的，
 * 那些排版引擎对 `display: grid` 支持极差（多半会退化成一列），`<table>` 才是它们认的格子。
 * 四线格与横线则是若干带边框的定高块 —— 线就是块的边框，本质是一样的东西。
 */
function extrasHtml(paper: OrgPaper): string {
  return (paper.extras ?? [])
    .map((extra) => {
      if (extra.kind === 'english') {
        /* 一组四条线，自上而下依次是：容器的上边框（淡）、三条带下边框的行。
           第 2、4 条加重（.strong）—— 与卷面上 `.pb-en-line.is-strong` 同一口径 */
        const group = '<div class="p-en-row"><i class="strong"></i><i></i><i class="strong"></i></div>'
        return `<div class="p-en">${group.repeat(extra.rows)}</div>`
      }
      if (extra.kind === 'lines') {
        return `<div class="p-lines">${'<div class="p-line"></div>'.repeat(extra.rows)}</div>`
      }
      const row = `<tr>${'<td>&nbsp;</td>'.repeat(extra.cols)}</tr>`
      return `<table class="p-grid">${row.repeat(extra.rows)}</table>`
    })
    .join('')
}

function answerCardHtml(views: ReturnType<typeof buildViews>): string {
  const rows: string[] = []
  views.forEach((view) => {
    const objective = view.questions.filter((q) => q.item && q.item.options.length > 0)
    if (!objective.length) return
    /* 每行 5 题，与常见答题卡的填涂区排布一致 */
    for (let i = 0; i < objective.length; i += 5) {
      const chunk = objective.slice(i, i + 5)
      rows.push(
        `<tr>${chunk
          .map((q) => `<td class="no">${q.no}</td><td>${escapeHtml(q.item?.answer ?? '')}</td>`)
          .join('')}</tr>`,
      )
    }
  })
  if (!rows.length) return ''
  return `<h2 class="card-title">答题卡 · 参考答案</h2><div class="card-hint">客观题答案，供阅卷核对使用。</div><table class="ans">${rows.join('')}</table>`
}

/**
 * 生成完整导出文档（含 DOCTYPE 与样式，可独立打开）。
 * Word 与打印共用同一份，保证「预览看到的」与「下载到的」一致。
 */
export function buildPaperHtml(paper: OrgPaper, questions: OrgQuestion[], options: ExportOptions): string {
  const views = buildViews(paper, questions)
  const all = views.flatMap((view) => view.questions)
  const totalScore = views.reduce((sum, view) => sum + view.score, 0)
  const teacher = options.version === 'teacher'
  /* 卷首注意事项：口径与 PaperBlock 完全一致 —— 没配过（undefined）用内置默认稿，
     配成空数组（[]）就一条都不印。导出件与卷面必须同一条不落，否则「所见即所得」是空话。 */
  const notices = (paper.notices === undefined ? DEFAULT_PAPER_NOTICES : paper.notices)
    .map((row) => row.trim())
    .filter(Boolean)

  const head = `
    <div class="p-title">${escapeHtml(paper.name)}</div>
    <div class="p-sub">${escapeHtml([paper.grade, paper.subject].filter(Boolean).join(' · '))} ｜ 满分 ${totalScore} 分 ｜ 考试时长 ${paper.duration} 分钟</div>
    ${
      options.withInfo
        ? '<div class="p-info"><span>学校：＿＿＿＿</span><span>班级：＿＿＿＿</span><span>姓名：＿＿＿＿</span><span>考号：＿＿＿＿</span></div>'
        : ''
    }
    ${notices.length ? `<div class="p-notice"><b>注意事项：</b>${notices.map((row, i) => `<p>${i + 1}．${escapeHtml(row)}</p>`).join('')}</div>` : ''}
  `

  /* 附加区块（表格 / 四线格 / 横线）接在全部答题区之后 —— 与编辑页、预览弹窗同一顺序。
     纯答案版不带：那一版只列答案，格子在那里没有意义。 */
  const body =
    options.version === 'answer'
      ? `<h2 class="card-title">参考答案</h2><table class="ans">${all.map(answerOnlyHtml).join('')}</table>`
      : views
          .map((view) => {
            const material = view.material || view.materialHint
              ? `<div class="material">${
                  view.materialHint ? `<div class="material-hint">${richHtml(view.materialHint)}</div>` : ''
                }${richHtml(view.material)}</div>`
              : ''
            return `<h2 class="sec">${escapeHtml(view.title)}<span class="sec-note">${sectionNote(view)}</span></h2>${material}${view.questions
              .map((q) => questionHtml(q, teacher))
              .join('')}`
          })
          .join('') + extrasHtml(paper)

  const card = options.withAnswerCard && options.version !== 'answer' ? answerCardHtml(views) : ''
  const versionText = options.version === 'teacher' ? '教师版（含答案解析）' : options.version === 'answer' ? '参考答案' : '学生版'

  return `<!DOCTYPE html>
<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="utf-8">
<title>${escapeHtml(paper.name)}</title>
<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom></w:WordDocument></xml><![endif]-->
<style>${baseCss()}</style>
</head>
<body>
${head}
${body}
${card}
<div class="foot">${escapeHtml(paper.name)} · ${versionText} · 由 AI 教学云平台导出</div>
</body>
</html>`
}

/** 文件名里的非法字符（Windows 最严格）统一替换为下划线 */
export function safeFileName(name: string): string {
  return (name || '试卷').replace(/[\\/:*?"<>|]/g, '_').trim() || '试卷'
}

function downloadBlob(content: string, fileName: string, mime: string): void {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  /* 立刻 revoke 会让部分浏览器的下载中断，延后一拍释放 */
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

/** 导出 Word：HTML 文档 + .doc 后缀，Word / WPS 可直接打开并另存为 .docx */
export function exportPaperDoc(paper: OrgPaper, questions: OrgQuestion[], options: ExportOptions): string {
  const suffix = options.version === 'teacher' ? '教师版' : options.version === 'answer' ? '答案' : '学生版'
  const fileName = `${safeFileName(paper.name)}-${suffix}.doc`
  downloadBlob(buildPaperHtml(paper, questions, options), fileName, 'application/msword')
  return fileName
}

/**
 * 导出 PDF：新窗口写入同一份 HTML 后调系统打印（浏览器「另存为 PDF」）。
 *
 * 不直接 `window.print()` 当前页——那会把整个工作台 UI 一起打印出去，见文件头。
 */
export function exportPaperPdf(paper: OrgPaper, questions: OrgQuestion[], options: ExportOptions): void {
  const win = window.open('', '_blank')
  if (!win) throw new Error('浏览器拦截了弹出窗口，请允许后重试')
  win.document.write(buildPaperHtml(paper, questions, options))
  win.document.close()
  win.focus()
  /* 等字体与图片就绪再唤起打印对话框，否则首屏可能打印出空白 */
  setTimeout(() => win.print(), 350)
}
