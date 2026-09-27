/**
 * 讲义 / 课件的模板骨架。
 *
 * 放在前端而不是服务端，是因为模板只是「新建时填一份初始结构」：
 * 之后每一段都可以自由增删改，模板本身不需要版本化，也没必要为一个初始值往返一次接口。
 * 服务端仍保留一份默认骨架（`defaultLectureBlocks`），供未选模板的场景兜底。
 */
import type {
  CoursewareSlide,
  GuideBlockKind,
  LectureBlock,
  LectureBlockKind,
  PlanDetail,
  PlanStep,
  PlanStepKind,
  SlideLayout,
} from '@aiteach/shared'

export interface LectureTemplate {
  key: string
  name: string
  desc: string
  blocks: Array<{ kind: LectureBlockKind; title: string; body: string }>
}

export const LECTURE_TEMPLATES: LectureTemplate[] = [
  {
    key: 'basic',
    name: '新课讲授讲义',
    desc: '目标 → 讲解 → 例题 → 练习 → 小结 → 作业',
    blocks: [
      { kind: 'goal', title: '学习目标', body: '<p>1. 理解本节核心概念；<br>2. 掌握基本方法并能解决基础问题。</p>' },
      { kind: 'explain', title: '知识点讲解', body: '<p>（在此编辑讲解内容，可插入公式与配图）</p>' },
      { kind: 'example', title: '典型例题', body: '<p>选取 1～2 道典型题讲透方法。</p>' },
      { kind: 'practice', title: '随堂练习', body: '<p>学生当堂完成，教师巡视指导。</p>' },
      { kind: 'summary', title: '课堂小结', body: '<p>回顾知识结构与易错点。</p>' },
      { kind: 'homework', title: '课后作业', body: '<p>分层作业：基础必做 + 提升选做。</p>' },
    ],
  },
  {
    key: 'review',
    name: '复习课讲义',
    desc: '知识网络 → 方法归纳 → 真题精讲 → 变式训练 → 易错提醒',
    blocks: [
      { kind: 'goal', title: '复习目标', body: '<p>梳理本章知识网络，形成解题方法体系。</p>' },
      { kind: 'explain', title: '知识网络梳理', body: '<p>（在此编辑知识结构图或思维导图要点）</p>' },
      { kind: 'explain', title: '解题方法归纳', body: '<p>（在此归纳通法与技巧）</p>' },
      { kind: 'example', title: '真题精讲', body: '<p>选取近年真题精讲，突出通性通法。</p>' },
      { kind: 'practice', title: '变式训练', body: '<p>一变多练，检验方法迁移能力。</p>' },
      { kind: 'summary', title: '易错提醒', body: '<p>（在此列出本届学生的高频错误）</p>' },
      { kind: 'homework', title: '课后巩固', body: '<p>布置综合练习。</p>' },
    ],
  },
  {
    key: '培优',
    name: '培优 / 竞赛讲义',
    desc: '思维起点 → 高阶方法 → 竞赛真题 → 拓展探究',
    blocks: [
      { kind: 'goal', title: '培优目标', body: '<p>突破中档题瓶颈，接触高阶思维方法。</p>' },
      { kind: 'explain', title: '高阶方法', body: '<p>（在此讲解高阶方法，如不等式放缩、构造法）</p>' },
      { kind: 'example', title: '经典难题', body: '<p>选取压轴题精讲，暴露思维过程。</p>' },
      { kind: 'practice', title: '拓展探究', body: '<p>给出开放性探究任务。</p>' },
      { kind: 'summary', title: '思维总结', body: '<p>总结可迁移的思维方式。</p>' },
    ],
  },
]

/** 课件版式模板：新建课件时的默认幻灯片序列 */
export const COURSEWARE_TEMPLATES: Array<{ key: string; name: string; desc: string; slides: Array<Pick<CoursewareSlide, 'layout' | 'title' | 'bullets'>> }> = [
  {
    key: 'lesson',
    name: '新课授课课件',
    desc: '封面 → 目标 → 讲解 → 例题 → 小结 → 结束',
    slides: [
      { layout: 'cover', title: '（课件标题）', bullets: [] },
      { layout: 'bullets', title: '学习目标', bullets: ['理解核心概念', '掌握基本方法', '能解决中档问题'] },
      { layout: 'section', title: '一、概念精讲', bullets: [] },
      { layout: 'bullets', title: '核心概念', bullets: ['定义与表示', '关键性质', '常见变形'] },
      { layout: 'question', title: '典型例题', bullets: ['先独立完成，再对照解析'] },
      { layout: 'bullets', title: '课堂小结', bullets: ['知识结构回顾', '易错点提醒', '作业布置'] },
      { layout: 'end', title: '谢谢观看', bullets: [] },
    ],
  },
  {
    key: 'review',
    name: '复习课件',
    desc: '封面 → 知识网络 → 方法归纳 → 真题 → 变式 → 结束',
    slides: [
      { layout: 'cover', title: '（复习课件标题）', bullets: [] },
      { layout: 'bullets', title: '本章知识网络', bullets: ['知识点一', '知识点二', '知识点三'] },
      { layout: 'bullets', title: '解题方法归纳', bullets: ['通法一', '通法二'] },
      { layout: 'question', title: '真题精讲', bullets: ['限时完成，讲评通法'] },
      { layout: 'bullets', title: '变式训练', bullets: ['一题多变', '多题一法'] },
      { layout: 'end', title: '谢谢观看', bullets: [] },
    ],
  },
]

export const SLIDE_LAYOUTS: Array<{ key: SlideLayout; name: string; desc: string }> = [
  { key: 'cover', name: '封面页', desc: '标题 + 副标题，开篇' },
  { key: 'bullets', name: '要点页', desc: '标题 + 若干要点' },
  { key: 'image', name: '图文页', desc: '标题 + 图示说明' },
  { key: 'question', name: '例题页', desc: '标题 + 关联题库题目' },
  { key: 'section', name: '过渡页', desc: '章节分隔' },
  { key: 'end', name: '结束页', desc: '结语' },
]

/* ============ 教案模板 ============ */

export interface PlanTemplate {
  key: string
  name: string
  desc: string
  /** 课时 */
  periods: number
  methods: string[]
  steps: Array<{ kind: PlanStepKind; title: string; minutes: number; teacher: string; student: string; intent: string }>
}

/**
 * 教案模板的差异在「教学过程的环节编排」：新授课讲究导入—探究—应用，
 * 复习课先建网络再刷真题，习题课则以讲评与变式为主。模板只决定初始环节，
 * 之后老师可自由增删，所以这里不放服务端。
 */
export const PLAN_TEMPLATES: PlanTemplate[] = [
  {
    key: 'new',
    name: '新授课教案',
    desc: '情境导入 → 新知探究 → 巩固应用 → 小结 → 作业',
    periods: 1,
    methods: ['讲授法', '探究式学习', '合作交流'],
    steps: [
      { kind: 'lead', title: '情境导入', minutes: 5, teacher: '呈现生活情境，提出驱动性问题。', student: '观察情境，思考并尝试用已有知识解释。', intent: '从学生熟悉的情境切入，激发兴趣并暴露认知冲突。' },
      { kind: 'teach', title: '新知探究', minutes: 20, teacher: '引导学生观察、猜想、论证，板书规范步骤。', student: '小组合作探究，代表板演与互评。', intent: '让学生经历知识的形成过程，而不是直接记忆结论。' },
      { kind: 'consolidate', title: '巩固应用', minutes: 12, teacher: '出示分层例题，巡视点拨，归纳通法。', student: '独立完成基础题，尝试变式题。', intent: '及时检测达成度，形成可迁移的解题方法。' },
      { kind: 'summary', title: '课堂小结', minutes: 5, teacher: '与学生共同梳理知识结构与方法要点。', student: '用自己的话复述本节收获与易错点。', intent: '把零散知识结构化，形成长时记忆。' },
      { kind: 'homework', title: '作业布置', minutes: 3, teacher: '布置分层作业并说明要求。', student: '记录作业要求。', intent: '分层满足不同水平学生的巩固需求。' },
    ],
  },
  {
    key: 'review',
    name: '复习课教案',
    desc: '知识网络 → 方法归纳 → 真题精讲 → 变式 → 易错',
    periods: 2,
    methods: ['归纳法', '讲练结合'],
    steps: [
      { kind: 'lead', title: '考情回顾', minutes: 5, teacher: '展示本章考点分布与常见题型。', student: '对照自己的掌握情况做标记。', intent: '明确复习方向，避免平均用力。' },
      { kind: 'teach', title: '知识网络构建', minutes: 18, teacher: '引导学生自主梳理并补全结构图。', student: '独立绘制知识网络，小组互评补充。', intent: '把知识点连成网，便于提取。' },
      { kind: 'teach', title: '方法归纳', minutes: 15, teacher: '归纳通性通法与适用条件。', student: '整理方法清单与典型样例。', intent: '从「会做一道」到「会做一类」。' },
      { kind: 'consolidate', title: '真题精讲与变式', minutes: 30, teacher: '精讲真题，暴露思维过程；组织变式训练。', student: '限时完成，对照反思错因。', intent: '在真实难度下检验方法迁移。' },
      { kind: 'summary', title: '易错提醒', minutes: 7, teacher: '汇总高频错误与规范要求。', student: '整理个人易错清单。', intent: '把错误资源化，避免重复失分。' },
    ],
  },
  {
    key: 'exercise',
    name: '习题 / 讲评课教案',
    desc: '错情通报 → 典型讲评 → 变式补偿 → 反思整理',
    periods: 1,
    methods: ['讲评法', '错因分析'],
    steps: [
      { kind: 'lead', title: '错情通报', minutes: 5, teacher: '公布得分率与典型错误分布。', student: '对照自己的答卷定位问题。', intent: '用数据说话，让讲评有的放矢。' },
      { kind: 'teach', title: '典型错题讲评', minutes: 20, teacher: '按错因分类讲评，示范规范书写。', student: '订正并标注错因。', intent: '纠正错误概念，建立规范表达。' },
      { kind: 'consolidate', title: '变式补偿训练', minutes: 12, teacher: '给出同类变式题限时训练。', student: '独立完成并互批。', intent: '确认错误真正被纠正。' },
      { kind: 'summary', title: '反思整理', minutes: 8, teacher: '引导整理错因与通法。', student: '完善错题本。', intent: '把一次讲评沉淀为长期能力。' },
    ],
  },
]

/* ============ 学案模板 ============ */

export interface GuideTemplate {
  key: string
  name: string
  desc: string
  blocks: Array<{ kind: GuideBlockKind; title: string; body: string }>
}

export const GUIDE_TEMPLATES: GuideTemplate[] = [
  {
    key: 'basic',
    name: '标准导学案',
    desc: '预习导学 → 课堂探究 → 达标检测 → 拓展提升',
    blocks: [
      { kind: 'preview', title: '预习导学', body: '<p>阅读教材第 __ 页，完成下列预习任务：<br>1. __________<br>2. __________</p>' },
      { kind: 'explore', title: '课堂探究', body: '<p>探究一：观察下列实例，归纳共同特征。</p>' },
      { kind: 'check', title: '达标检测', body: '<p>当堂完成，检验本节课掌握情况。</p>' },
      { kind: 'extend', title: '拓展提升', body: '<p>选做：综合运用本节方法解决实际问题。</p>' },
    ],
  },
  {
    key: 'review',
    name: '复习导学案',
    desc: '知识梳理 → 典例回顾 → 易错诊断 → 综合检测',
    blocks: [
      { kind: 'preview', title: '知识梳理', body: '<p>自主构建本章知识网络。</p>' },
      { kind: 'explore', title: '典例回顾', body: '<p>回顾本章典型例题的通法。</p>' },
      { kind: 'check', title: '易错诊断', body: '<p>判断下列说法是否正确，错的请改正。</p>' },
      { kind: 'extend', title: '综合检测', body: '<p>完成综合练习，限时 40 分钟。</p>' },
    ],
  },
]

let blockSeq = 1
let slideSeq = 1
let stepSeq = 1

/** 由模板生成教案的教学过程（含三维目标、重难点、板书、反思的初始结构） */
export function makePlan(template: PlanTemplate): PlanDetail {
  return {
    objectives: {
      knowledge: '（知识与技能：学生能什么）',
      process: '（过程与方法：通过什么活动获得）',
      emotion: '（情感态度价值观：体会什么）',
    },
    keyPoints: '',
    hardPoints: '',
    methods: [...template.methods],
    aids: ['多媒体课件'],
    periods: template.periods,
    steps: template.steps.map((row) => ({ id: stepSeq++, ...row, questionIds: [] })),
    blackboard: '',
    reflection: '',
  }
}

export function makeGuideBlocks(rows: Array<{ kind: GuideBlockKind; title: string; body: string }>): LectureBlock[] {
  return rows.map((row) => ({ id: blockSeq++, kind: row.kind, title: row.title, body: row.body, questionIds: [] }))
}

export function makeBlocks(rows: Array<{ kind: LectureBlockKind; title: string; body: string }>): LectureBlock[] {
  return rows.map((row) => ({ id: blockSeq++, kind: row.kind, title: row.title, body: row.body, questionIds: [] }))
}

export function makeSlides(
  rows: Array<Pick<CoursewareSlide, 'layout' | 'title' | 'bullets'>>,
  name = '',
): CoursewareSlide[] {
  return rows.map((row) => ({
    id: slideSeq++,
    layout: row.layout,
    title: row.layout === 'cover' && row.title === '（课件标题）' && name ? name : row.title,
    subtitle: row.layout === 'cover' ? 'AI 教学云 · 课堂教学课件' : undefined,
    bullets: [...row.bullets],
    note: '',
  }))
}
