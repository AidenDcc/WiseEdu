/**
 * 文档流 HTML 与「旧的结构化正文」之间的桥。
 *
 * 备课文档在数据里有两代正文：`blocks`（讲义 / 学案的段落流）与 `plan`（教案的教学设计骨架）
 * 是**第一代**，写在文档编辑器出现之前；`content` 是**第二代** —— 一份 Word 式的整体文档流，
 * 文档编辑器编辑的就是它。
 *
 * 为什么保留两代而不是一次性迁移：一批种子数据、列表卡片上的题量统计、以及「转为课件」
 * 都还在读第一代；而且库里的旧文档总得能打开。所以**新写入一律走 `content`，读取时按
 * 「有 content 用 content，没有就由旧结构现场转一份」**（见 `docToHtml`）。
 *
 * 转出来的那一份是**只读的中间态**，不写回服务端：老师一旦在文档编辑器里改过并保存，
 * `content` 就落库了，此后再也不走这条转换路径 —— 因此转换只需要「看起来对」，
 * 不必追齐旧编辑器里所有字段的排版细节。
 */
import {
  GUIDE_BLOCK_TEXT,
  LECTURE_BLOCK_TEXT,
  PLAN_STEP_TEXT,
  type LectureBlock,
  type PlanDetail,
  type TeachDoc,
  type TeachDocKind,
} from '@aiteach/shared'

/** 段落类型的兜底标题：`blocks[].kind` 是讲义与学案两个枚举的并集，索引时统一放宽成 string */
const BLOCK_TITLE = { ...LECTURE_BLOCK_TEXT, ...GUIDE_BLOCK_TEXT } as Record<string, string>

/** 一份文档的三种「主体名」：教案叫课题、学案叫课题、讲义叫章节 */
const SUBJECT_TITLE: Record<TeachDocKind, string> = {
  plan: '（课题名称）',
  guide: '（课题名称）',
  lecture: '（章节名称）',
  courseware: '（课件标题）',
}

/** 转义：旧字段里的纯文本要当文本插进 HTML，带 `<` 的内容否则会被当成标签吃掉 */
function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** 把一段可能是富文本、也可能是纯文本的字段转成 `<p>` */
function para(text: string | undefined, fallback = ''): string {
  const raw = (text ?? '').trim()
  if (!raw) return fallback ? `<p>${esc(fallback)}</p>` : ''
  /* 富文本（带标签）原样保留：`blocks[].body` 本来就是 HTML 片段 */
  return /<[a-z][\s\S]*>/i.test(raw) ? raw : `<p>${esc(raw)}</p>`
}

/* ================= 教案（PlanDetail）→ 文档流 ================= */

function planToHtml(plan: PlanDetail, name: string): string {
  const out: string[] = [`<h1>${esc(name || SUBJECT_TITLE.plan)}</h1>`]

  out.push('<h2>一、教学目标</h2>')
  out.push(para(plan.objectives.knowledge, '知识与技能：……'))
  out.push(para(plan.objectives.process, '过程与方法：……'))
  out.push(para(plan.objectives.emotion, '情感态度与价值观：……'))

  out.push('<h2>二、教学重点与难点</h2>')
  out.push(para(plan.keyPoints, '教学重点：……'))
  out.push(para(plan.hardPoints, '教学难点：……'))

  out.push('<h2>三、教学方法与教具</h2>')
  out.push(`<p>教学方法：${esc(plan.methods.join('、') || '讲授法')}</p>`)
  out.push(`<p>教具与媒体：${esc(plan.aids.join('、') || '多媒体课件')}</p>`)

  out.push('<h2>四、教学过程</h2>')
  if (plan.steps.length) {
    plan.steps.forEach((step, index) => {
      const title = step.title || PLAN_STEP_TEXT[step.kind] || `环节${index + 1}`
      out.push(`<h3>环节${index + 1}　${esc(title)}（${step.minutes} 分钟）</h3>`)
      if (step.teacher) out.push(`<p><strong>教师活动：</strong>${esc(step.teacher)}</p>`)
      if (step.student) out.push(`<p><strong>学生活动：</strong>${esc(step.student)}</p>`)
      if (step.intent) out.push(`<p><strong>设计意图：</strong>${esc(step.intent)}</p>`)
      if (step.questionIds.length) out.push(`<p><em>本环节关联题目 ${step.questionIds.length} 道（在结构化编辑器里管理）</em></p>`)
    })
  } else {
    out.push('<p>（尚未编排教学环节）</p>')
  }

  out.push('<h2>五、板书设计</h2>')
  out.push(para(plan.blackboard, '（在此写板书设计）'))

  out.push('<h2>六、教学反思</h2>')
  out.push(para(plan.reflection, '（课后填写）'))

  return out.join('')
}

/* ================= 段落流（blocks）→ 文档流 ================= */

function blocksToHtml(blocks: LectureBlock[], name: string): string {
  const out: string[] = [`<h1>${esc(name || SUBJECT_TITLE.plan)}</h1>`]
  if (!blocks.length) {
    out.push('<p>（尚无内容）</p>')
    return out.join('')
  }
  for (const block of blocks) {
    out.push(`<h2>${esc(block.title || BLOCK_TITLE[block.kind] || '正文')}</h2>`)
    out.push(para(block.body))
    /* 关联题目只在题库里（题干、选项、答案解析都不在文档流上），这里如实留一句提示 ——
       直接不写会让老师以为「挂了五道题，纸上一道也没有」。要出带题的稿子走「版式预览」，
       那里按 blocks + questions 排版，还能切学生版 / 教师版。 */
    if (block.questionIds.length) {
      out.push(`<p><em>本段关联题目 ${block.questionIds.length} 道（用「版式预览」出带题的稿子）</em></p>`)
    }
  }
  return out.join('')
}

/* ================= 对外入口 ================= */

/**
 * 取一份文档的文档流 HTML。
 *
 * 优先级：新字段 `content` → 旧结构（`plan` / `blocks` / `slides`）→ 类型骨架。
 * 第三个兜底是给「刚建出来、还没来得及选模板就打开编辑器」的文档用的，
 * 免得编辑器里是一张白纸，连往哪写都没提示。
 */
export function docToHtml(doc: Pick<TeachDoc, 'kind' | 'name' | 'content' | 'blocks' | 'plan' | 'slides'>): string {
  if (doc.content && doc.content.trim()) return doc.content
  if (doc.kind === 'plan' && doc.plan) return planToHtml(doc.plan, doc.name)
  if (doc.kind === 'guide' || doc.kind === 'lecture') return blocksToHtml(doc.blocks ?? [], doc.name)
  /* 课件不进文档编辑器（它有自己的分页编辑器），这里只是类型上把路走通 */
  return `<h1>${esc(doc.name || SUBJECT_TITLE[doc.kind])}</h1><p>（正文）</p>`
}

/**
 * 一份空文档的骨架。
 *
 * 与 `docToHtml` 的第三个兜底同义，但**不依赖已有数据** —— 模板维护页的「新建空白模板」
 * 也用它，那里没有文档对象可传。
 */
export function emptyDocHtml(kind: TeachDocKind, name = ''): string {
  return `<h1>${esc(name || SUBJECT_TITLE[kind])}</h1><p>（正文）</p>`
}

/** 新文档若引用了模板，用模板骨架把「（课题名称）」这类占位换成实际的名称 */
export function applyTemplateName(skeleton: string, name: string): string {
  if (!name.trim()) return skeleton
  return skeleton.replace(/<h1>([^<]*)<\/h1>/, (_all, inner: string) => {
    /* 模板里 h1 是「（课题名称）」这类占位才替换：老师自己写的标题不该被新建流程改掉 */
    return /^（[^）]*）$|^\([^)]*\)$/.test(inner.trim()) ? `<h1>${esc(name.trim())}</h1>` : `<h1>${inner}</h1>`
  })
}
