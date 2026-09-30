/**
 * 平台端新模块 Mock 仓库：全局内容运营（P-03）、AI 安全治理与计费（P-05-10~14）、
 * 系统监控与配置（P-06-06 / P-07-04~07）。
 *
 * 平台铁律（BR-001）：本端只做全局配置与只读审计 —— 所有「审核 / 上下架 / 开关」
 * 均为配置动作，不触碰机构业务数据。
 */
import type {
  AiBillingRule,
  AiQualityEval,
  AiTraceRecord,
  BackupRecord,
  ComplianceSpotCheck,
  ContentDistribution,
  ContentFeedbackTicket,
  MessageTemplate,
  PlatformPaper,
  PlatformQuestion,
  SensitivePolicyGroup,
  ServiceHealthItem,
  StoragePolicy,
  SystemParam,
  TenantAiSwitch,
} from '../api/models'

const UPDATED = '2026-09-26 18:20:00'

let qSeq = 10000
let paperSeq = 2000
let distSeq = 300
let checkSeq = 400
let ticketSeq = 500
let evalSeq = 600
let traceSeq = 700
let ruleSeq = 800
let tplSeq = 900
let backupSeq = 1000

/* ================= 公共题库（P-03-01 ~ 09） ================= */

const PLATFORM_QUESTION_SEEDS: Array<{
  stem: string
  type: string
  subject: string
  grade: string
  difficulty: string
  knowledge: string[]
  status: PlatformQuestion['status']
  quality: PlatformQuestion['quality']
  source: string
  refs: number
}> = [
  { stem: '已知集合 A={x|x²-3x+2=0}，B={x|1<x<3}，则 A∩B=', type: '单选题', subject: '数学', grade: '高一', difficulty: '容易', knowledge: ['集合与逻辑'], status: 'published', quality: 'A', source: '2025 某省期中真题', refs: 128 },
  { stem: '函数 f(x)=ln x + 2x - 6 的零点所在区间是', type: '单选题', subject: '数学', grade: '高一', difficulty: '中等', knowledge: ['函数概念与性质'], status: 'published', quality: 'A', source: '教辅《同步精练》', refs: 96 },
  { stem: '化简：sin(α+β)cosβ - cos(α+β)sinβ =', type: '填空题', subject: '数学', grade: '高一', difficulty: '较易', knowledge: ['三角函数'], status: 'published', quality: 'A', source: '教研自研', refs: 73 },
  { stem: '阅读下面的文言文，完成后面题目：《劝学》节选……下列加点词解释不正确的一项是', type: '阅读理解', subject: '语文', grade: '高一', difficulty: '中等', knowledge: ['文言文阅读'], status: 'published', quality: 'B', source: '2025 某市月考真题', refs: 64 },
  { stem: '下列各句中，没有语病的一句是', type: '单选题', subject: '语文', grade: '高二', difficulty: '中等', knowledge: ['语言文字运用'], status: 'pending', quality: 'B', source: '教师投稿', refs: 12 },
  { stem: 'Which of the following best states the main idea of the passage?', type: '阅读理解', subject: '英语', grade: '高一', difficulty: '中等', knowledge: ['阅读理解'], status: 'published', quality: 'A', source: '2025 某省期中真题', refs: 152 },
  { stem: '完形填空：From that day on, Mark made up his mind to ___ his old habits…', type: '完形填空', subject: '英语', grade: '高二', difficulty: '较难', knowledge: ['完形填空'], status: 'pending', quality: 'B', source: '教辅《完形专练》', refs: 8 },
  { stem: '一物体沿直线运动，其 v-t 图像为过原点的倾斜直线，则该物体做', type: '单选题', subject: '物理', grade: '高一', difficulty: '容易', knowledge: ['运动学'], status: 'published', quality: 'A', source: '教研自研', refs: 88 },
  { stem: '质量为 m 的物体静止在倾角为 θ 的斜面上，求斜面对物体的支持力与摩擦力。', type: '解答题', subject: '物理', grade: '高一', difficulty: '中等', knowledge: ['相互作用'], status: 'published', quality: 'A', source: '教研自研', refs: 57 },
  { stem: '已知等差数列 {aₙ} 满足 a₃=5，a₇=13，求其通项公式与前 20 项和。', type: '解答题', subject: '数学', grade: '高一', difficulty: '中等', knowledge: ['数列'], status: 'pending', quality: 'C', source: '教师投稿', refs: 3 },
  { stem: '古诗词鉴赏：阅读《登高》，请分析颔联「无边落木萧萧下，不尽长江滚滚来」的意境与手法。', type: '解答题', subject: '语文', grade: '高二', difficulty: '较难', knowledge: ['古诗词鉴赏'], status: 'published', quality: 'A', source: '2025 某省高考真题', refs: 201 },
  { stem: '语法填空：The new bridge ___ (complete) by the end of last month…', type: '语法填空', subject: '英语', grade: '高一', difficulty: '较易', knowledge: ['语法填空'], status: 'offline', quality: 'B', source: '教辅《同步精练》', refs: 41 },
]

export const platformQuestions: PlatformQuestion[] = PLATFORM_QUESTION_SEEDS.map((row) => ({
  id: ++qSeq,
  stem: row.stem,
  type: row.type,
  subject: row.subject,
  grade: row.grade,
  difficulty: row.difficulty,
  knowledge: row.knowledge,
  answer: '（演示数据：答案与解析见详情弹窗）',
  analysis: '本题考查基础知识与基本方法，解答过程略（演示数据）。平台审核要点：答案自洽、解析完整、无超纲内容、版权来源清晰。',
  status: row.status,
  quality: row.quality,
  source: row.source,
  refs: row.refs,
  updatedAt: UPDATED,
}))

export function listPlatformQuestions(keyword: string, subject: string, status: string): PlatformQuestion[] {
  return platformQuestions.filter((row) => {
    if (subject && row.subject !== subject) return false
    if (status && row.status !== status) return false
    if (keyword && !row.stem.includes(keyword) && !row.source.includes(keyword)) return false
    return true
  })
}

/** 题目审核（P-03-06）：通过后上架，驳回需填意见 */
export function reviewPlatformQuestion(id: number, pass: boolean): PlatformQuestion {
  const question = platformQuestions.find((row) => row.id === id)
  if (!question) throw new Error('题目不存在')
  if (question.status !== 'pending') throw new Error('该题目不在待审核状态')
  question.status = pass ? 'published' : 'rejected'
  question.updatedAt = UPDATED
  return question
}

/** 上下架（P-03-08） */
export function togglePlatformQuestion(id: number): PlatformQuestion {
  const question = platformQuestions.find((row) => row.id === id)
  if (!question) throw new Error('题目不存在')
  if (question.status === 'published') question.status = 'offline'
  else if (question.status === 'offline') question.status = 'published'
  else throw new Error('仅上架 / 已下架状态可切换')
  question.updatedAt = UPDATED
  return question
}

/* ================= 公共试卷库（P-03-11 ~ 13） ================= */

const PLATFORM_PAPER_SEEDS: Array<{
  name: string
  subject: string
  grade: string
  questionCount: number
  fullScore: number
  source: string
  status: PlatformPaper['status']
  refs: number
}> = [
  { name: '2026 届高一数学期中统考卷', subject: '数学', grade: '高一', questionCount: 22, fullScore: 150, source: '某省真题', status: 'published', refs: 46 },
  { name: '高一物理 9 月月考卷', subject: '物理', grade: '高一', questionCount: 18, fullScore: 100, source: '教研自研', status: 'published', refs: 31 },
  { name: '高二语文期中模拟卷', subject: '语文', grade: '高二', questionCount: 20, fullScore: 150, source: '教辅授权', status: 'pending', refs: 4 },
  { name: '高一英语单元检测卷（Unit 1-3）', subject: '英语', grade: '高一', questionCount: 25, fullScore: 120, source: '教研自研', status: 'published', refs: 58 },
  { name: '高三数学模拟卷（一）', subject: '数学', grade: '高三', questionCount: 22, fullScore: 150, source: '某省真题', status: 'offline', refs: 12 },
]

export const platformPapers: PlatformPaper[] = PLATFORM_PAPER_SEEDS.map((row) => ({
  id: ++paperSeq,
  name: row.name,
  subject: row.subject,
  grade: row.grade,
  questionCount: row.questionCount,
  fullScore: row.fullScore,
  source: row.source,
  status: row.status,
  refs: row.refs,
  updatedAt: UPDATED,
}))

export function listPlatformPapers(keyword: string, subject: string): PlatformPaper[] {
  return platformPapers.filter((row) => {
    if (subject && row.subject !== subject) return false
    if (keyword && !row.name.includes(keyword)) return false
    return true
  })
}

export function reviewPlatformPaper(id: number, pass: boolean): PlatformPaper {
  const paper = platformPapers.find((row) => row.id === id)
  if (!paper) throw new Error('试卷不存在')
  if (paper.status !== 'pending') throw new Error('该试卷不在待审核状态')
  paper.status = pass ? 'published' : 'rejected'
  paper.updatedAt = UPDATED
  return paper
}

/* ================= 内容分发（P-03-25 ~ 27） ================= */

export const distributions: ContentDistribution[] = [
  { id: ++distSeq, contentType: '题目', contentName: '2025 某省期中真题包 · 数学（120 题）', tenantCount: 18, scopeType: 'package', scopeText: '标准版及以上套餐', status: 'synced', syncedAt: UPDATED },
  { id: ++distSeq, contentType: '试卷', contentName: '2026 届高一数学期中统考卷', tenantCount: 18, scopeType: 'package', scopeText: '标准版及以上套餐', status: 'synced', syncedAt: '2026-09-25 10:00:00' },
  { id: ++distSeq, contentType: '教辅', contentName: '《同步精练》高一数学全一册', tenantCount: 6, scopeType: 'tenant', scopeText: '指定 6 家租户（已购版权）', status: 'synced', syncedAt: '2026-09-20 14:30:00' },
  { id: ++distSeq, contentType: '素材', contentName: '物理实验演示动画包（30 个）', tenantCount: 24, scopeType: 'all', scopeText: '全部租户', status: 'syncing', syncedAt: UPDATED },
  { id: ++distSeq, contentType: '题目', contentName: '古诗词鉴赏专项题包（80 题）', tenantCount: 0, scopeType: 'package', scopeText: '专业版套餐', status: 'paused', syncedAt: '2026-09-22 09:00:00' },
]

export function listDistributions(): ContentDistribution[] {
  return [...distributions]
}

export function createDistribution(input: {
  contentType: ContentDistribution['contentType']
  contentName: string
  scopeType: ContentDistribution['scopeType']
  scopeText: string
}): ContentDistribution {
  if (!input.contentName.trim()) throw new Error('内容名称必填')
  const record: ContentDistribution = {
    id: ++distSeq,
    contentType: input.contentType,
    contentName: input.contentName.trim(),
    tenantCount: 0,
    scopeType: input.scopeType,
    scopeText: input.scopeText,
    status: 'syncing',
    syncedAt: UPDATED,
  }
  distributions.unshift(record)
  return record
}

export function toggleDistribution(id: number): ContentDistribution {
  const record = distributions.find((row) => row.id === id)
  if (!record) throw new Error('分发记录不存在')
  if (record.status === 'syncing') throw new Error('同步进行中，暂不能操作')
  record.status = record.status === 'synced' ? 'paused' : 'synced'
  record.syncedAt = UPDATED
  return record
}

/* ================= 内容合规抽检（P-03-23） ================= */

export const spotChecks: ComplianceSpotCheck[] = [
  {
    id: ++checkSeq,
    title: '9 月公共题库全量抽检',
    scope: '公共题库 · 全学科',
    sampleCount: 500,
    flagged: 12,
    confirmed: 3,
    status: 'done',
    createdAt: '2026-09-24 02:00:00',
    samples: [
      { contentName: '英语完形填空（编号 10067）', reason: '原文疑似超出高一词汇大纲', level: 'mid' },
      { contentName: '语文语言运用（编号 10094）', reason: '题干含敏感表述，建议下架复核', level: 'high' },
      { contentName: '数学解答题（编号 10102）', reason: '解析步骤缺失中间结论', level: 'low' },
    ],
  },
  {
    id: ++checkSeq,
    title: '教辅授权内容抽检（第二批）',
    scope: '教辅书籍 · 已授权',
    sampleCount: 200,
    flagged: 5,
    confirmed: 1,
    status: 'running',
    createdAt: '2026-09-26 02:00:00',
    samples: [{ contentName: '《完形专练》高二分册 · 第 12 篇', reason: '与另一教辅重合度 82%，疑似版权范围外', level: 'high' }],
  },
  {
    id: ++checkSeq,
    title: 'AI 生成内容入库前抽检',
    scope: 'AI 出题 · 自动质检 error 级',
    sampleCount: 120,
    flagged: 9,
    confirmed: 9,
    status: 'closed',
    createdAt: '2026-09-18 02:00:00',
    samples: [{ contentName: 'AI 生成题（trace-20260918-04）', reason: '答案与解析结论不一致，已拦截入库', level: 'high' }],
  },
]

export function listSpotChecks(): ComplianceSpotCheck[] {
  return [...spotChecks]
}

export function createSpotCheck(scope: string, sampleCount: number): ComplianceSpotCheck {
  if (!scope.trim()) throw new Error('抽检范围必填')
  const record: ComplianceSpotCheck = {
    id: ++checkSeq,
    title: `${scope}抽检（${UPDATED.slice(0, 10)}）`,
    scope: scope.trim(),
    sampleCount,
    flagged: 0,
    confirmed: 0,
    status: 'running',
    createdAt: UPDATED,
    samples: [],
  }
  spotChecks.unshift(record)
  return record
}

export function closeSpotCheck(id: number): ComplianceSpotCheck {
  const record = spotChecks.find((row) => row.id === id)
  if (!record) throw new Error('抽检任务不存在')
  if (record.status === 'closed') throw new Error('任务已关闭')
  record.status = 'closed'
  return record
}

/* ================= 内容问题反馈工单（P-03-28） ================= */

const TICKET_STATUS_TEXT: Record<ContentFeedbackTicket['status'], string> = {
  open: '待受理',
  processing: '处理中',
  resolved: '已解决',
  rejected: '已驳回',
}

export function ticketStatusText(status: ContentFeedbackTicket['status']): string {
  return TICKET_STATUS_TEXT[status]
}

export const feedbackTickets: ContentFeedbackTicket[] = [
  { id: ++ticketSeq, title: '三角函数题目答案有误', contentType: '题目', contentName: '化简 sin(α+β)cosβ-…（编号 10002）', reporter: '李老师', tenantName: '星辰教育', kind: '内容错误', priority: 'high', status: 'processing', createdAt: '2026-09-25 16:20:00' },
  { id: ++ticketSeq, title: '试卷缺第 14 题解析', contentType: '试卷', contentName: '2026 届高一数学期中统考卷', reporter: '王老师', tenantName: '启航培训', kind: '内容错误', priority: 'normal', status: 'open', createdAt: '2026-09-26 09:10:00' },
  { id: ++ticketSeq, title: '图片素材疑似未授权', contentType: '素材', contentName: '物理实验动画包 · 平抛运动', reporter: '张主任', tenantName: '博学堂', kind: '版权争议', priority: 'high', status: 'processing', createdAt: '2026-09-24 11:40:00' },
  { id: ++ticketSeq, title: '阅读材料表述不当', contentType: '题目', contentName: '英语阅读（编号 10056）', reporter: '陈老师', tenantName: '星辰教育', kind: '敏感内容', priority: 'high', status: 'resolved', createdAt: '2026-09-20 10:00:00', resolvedAt: '2026-09-21 15:00:00', reply: '已下架并替换素材，感谢反馈。' },
  { id: ++ticketSeq, title: '希望补充听力音频', contentType: '试卷', contentName: '高一英语单元检测卷', reporter: '刘老师', tenantName: '启航培训', kind: '其他', priority: 'low', status: 'rejected', createdAt: '2026-09-18 14:30:00', resolvedAt: '2026-09-19 09:00:00', reply: '音频授权洽谈中，暂无法提供。' },
]

export function listFeedbackTickets(status: string): ContentFeedbackTicket[] {
  return feedbackTickets.filter((row) => !status || row.status === status)
}

export function handleTicket(id: number, action: 'accept' | 'resolve' | 'reject', reply: string): ContentFeedbackTicket {
  const ticket = feedbackTickets.find((row) => row.id === id)
  if (!ticket) throw new Error('工单不存在')
  if (ticket.status === 'resolved' || ticket.status === 'rejected') throw new Error('工单已办结')
  if (action !== 'accept' && !reply.trim()) throw new Error('请填写处理说明')
  if (action === 'accept') ticket.status = 'processing'
  else {
    ticket.status = action === 'resolve' ? 'resolved' : 'rejected'
    ticket.resolvedAt = UPDATED
    ticket.reply = reply.trim()
  }
  return ticket
}

/* ================= AI 安全治理（P-05-10 ~ 12） ================= */

export const sensitivePolicies: SensitivePolicyGroup[] = [
  { id: 1, name: '涉政敏感词', action: 'block', words: ['演示敏感词A', '演示敏感词B', '演示敏感词C'], scope: '全部', enabled: true, hits30d: 14 },
  { id: 2, name: '未成年人保护', action: 'block', words: ['演示敏感词D', '演示敏感词E'], scope: '学生问答', enabled: true, hits30d: 6 },
  { id: 3, name: '不良内容', action: 'human', words: ['演示敏感词F', '演示敏感词G', '演示敏感词H'], scope: '全部', enabled: true, hits30d: 23 },
  { id: 4, name: '超纲内容提醒', action: 'human', words: ['竞赛超纲', '高数提前学'], scope: '学生问答', enabled: true, hits30d: 41 },
  { id: 5, name: '个人信息', action: 'mask', words: ['手机号', '身份证号', '家庭住址'], scope: '教师助手', enabled: true, hits30d: 9 },
  { id: 6, name: '广告导流', action: 'human', words: ['加微信', '扫码进群'], scope: '全部', enabled: false, hits30d: 0 },
]

export function listSensitivePolicies(): SensitivePolicyGroup[] {
  return sensitivePolicies.map((row) => ({ ...row, words: [...row.words] }))
}

export function saveSensitivePolicy(input: Partial<SensitivePolicyGroup> & { name: string }): SensitivePolicyGroup {
  if (!input.name.trim()) throw new Error('策略名称必填')
  if (input.id != null) {
    const policy = sensitivePolicies.find((row) => row.id === input.id)
    if (!policy) throw new Error('策略不存在')
    Object.assign(policy, input)
    policy.words = input.words ?? policy.words
    return policy
  }
  if (!input.words?.length) throw new Error('至少添加一个敏感词')
  const policy: SensitivePolicyGroup = {
    id: sensitivePolicies.length ? Math.max(...sensitivePolicies.map((row) => row.id)) + 1 : 1,
    name: input.name.trim(),
    action: input.action ?? 'human',
    words: input.words,
    scope: input.scope ?? '全部',
    enabled: true,
    hits30d: 0,
  }
  sensitivePolicies.push(policy)
  return policy
}

export function toggleSensitivePolicy(id: number): SensitivePolicyGroup {
  const policy = sensitivePolicies.find((row) => row.id === id)
  if (!policy) throw new Error('策略不存在')
  policy.enabled = !policy.enabled
  return policy
}

export function deleteSensitivePolicy(id: number): void {
  const index = sensitivePolicies.findIndex((row) => row.id === id)
  if (index < 0) throw new Error('策略不存在')
  if (sensitivePolicies[index].enabled) throw new Error('请先停用再删除')
  sensitivePolicies.splice(index, 1)
}

export const qualityEvals: AiQualityEval[] = [
  { id: ++evalSeq, scene: 'AI 出题', model: 'deepseek-chat', dataset: '出题评测集 v3（500 题）', sampleCount: 500, scores: { accuracy: 92, completeness: 95, gradeFit: 88, safety: 99 }, overall: 93.5, delta: 1.8, ranAt: '2026-09-25 03:00:00' },
  { id: ++evalSeq, scene: 'AI 组卷', model: 'deepseek-chat', dataset: '组卷评测集 v2（80 卷）', sampleCount: 80, scores: { accuracy: 90, completeness: 92, gradeFit: 86, safety: 99 }, overall: 91.8, delta: 0.6, ranAt: '2026-09-25 04:00:00' },
  { id: ++evalSeq, scene: 'AI 阅卷', model: 'deepseek-chat', dataset: '阅卷一致性集（300 份）', sampleCount: 300, scores: { accuracy: 87, completeness: 90, gradeFit: 85, safety: 99 }, overall: 90.3, delta: 2.4, ranAt: '2026-09-24 03:00:00' },
  { id: ++evalSeq, scene: '学生 AI 问答', model: 'deepseek-chat', dataset: '引导式答疑集（600 问）', sampleCount: 600, scores: { accuracy: 89, completeness: 84, gradeFit: 93, safety: 99 }, overall: 91.3, delta: -0.4, ranAt: '2026-09-26 03:00:00' },
]

export function listQualityEvals(): AiQualityEval[] {
  return [...qualityEvals]
}

export function runQualityEval(scene: string): AiQualityEval {
  if (!scene) throw new Error('请选择评测场景')
  const base = 86 + Math.round(Math.random() * 6)
  const evalRecord: AiQualityEval = {
    id: ++evalSeq,
    scene,
    model: 'deepseek-chat',
    dataset: `${scene}评测集（即时演示轮）`,
    sampleCount: 100,
    scores: { accuracy: base, completeness: base - 2, gradeFit: base - 4, safety: 99 },
    overall: Math.round((base * 4 - 6) / 4 * 10) / 10,
    delta: Math.round(Math.random() * 12) / 10 - 0.6,
    ranAt: UPDATED,
  }
  qualityEvals.unshift(evalRecord)
  return evalRecord
}

export const traceRecords: AiTraceRecord[] = [
  { id: ++traceSeq, traceId: 'trace-20260926-0142', scene: 'AI 出题', model: 'deepseek-chat', tenantName: '星辰教育', artifactKind: '题目 ×10', artifactTitle: '「三角函数」专项出题', inputDigest: '学科=数学；知识点=三角函数；难度=中等；数量=10', safety: 'pass', createdAt: '2026-09-26 10:24:00' },
  { id: ++traceSeq, traceId: 'trace-20260926-0141', scene: 'AI 组卷', model: 'deepseek-chat', tenantName: '星辰教育', artifactKind: '试卷 ×1', artifactTitle: '高一数学期中卷（AI 生成）', inputDigest: '范围=函数+三角；时长=120 分钟；难度=中', safety: 'pass', createdAt: '2026-09-26 10:12:00' },
  { id: ++traceSeq, traceId: 'trace-20260926-0138', scene: '学生 AI 问答', model: 'deepseek-chat', tenantName: '启航培训', artifactKind: '问答 ×1', artifactTitle: '二次函数最值引导问答', inputDigest: '问题=二次函数最值怎么求（学生提问）', safety: 'masked', createdAt: '2026-09-26 09:47:00' },
  { id: ++traceSeq, traceId: 'trace-20260925-0119', scene: 'AI 阅卷', model: 'deepseek-chat', tenantName: '星辰教育', artifactKind: '批改 ×45', artifactTitle: '期中考试解答题批改', inputDigest: '试卷=期中卷；题目=解答题 17-22；份数=45', safety: 'pass', createdAt: '2026-09-25 20:31:00' },
  { id: ++traceSeq, traceId: 'trace-20260925-0102', scene: 'AI 课件', model: 'deepseek-chat', tenantName: '博学堂', artifactKind: '课件 ×1', artifactTitle: '《平面向量》课件生成', inputDigest: '课题=平面向量；课时=2', safety: 'blocked', createdAt: '2026-09-25 16:02:00' },
]

export function listTraceRecords(scene: string, safety: string): AiTraceRecord[] {
  return traceRecords.filter((row) => {
    if (scene && row.scene !== scene) return false
    if (safety && row.safety !== safety) return false
    return true
  })
}

/* ================= AI 计费与租户能力开关（P-05-13 / 14） ================= */

export const billingRules: AiBillingRule[] = [
  { id: ++ruleSeq, scene: 'AI 出题', model: 'deepseek-chat', unit: '1k-token', price: 0.008, enabled: true },
  { id: ++ruleSeq, scene: 'AI 组卷', model: 'deepseek-chat', unit: '1k-token', price: 0.01, enabled: true },
  { id: ++ruleSeq, scene: 'AI 讲义', model: 'deepseek-chat', unit: '1k-token', price: 0.009, enabled: true },
  { id: ++ruleSeq, scene: 'AI 课件', model: 'deepseek-chat', unit: 'call', price: 0.5, enabled: true },
  { id: ++ruleSeq, scene: 'AI 阅卷', model: 'deepseek-chat', unit: 'call', price: 0.3, enabled: true },
  { id: ++ruleSeq, scene: 'AI 画插图', model: '文生图（演示）', unit: 'call', price: 0.2, enabled: false },
]

export function listBillingRules(): AiBillingRule[] {
  return [...billingRules]
}

export function saveBillingRule(id: number, input: Partial<AiBillingRule>): AiBillingRule {
  const rule = billingRules.find((row) => row.id === id)
  if (!rule) throw new Error('计费规则不存在')
  if (input.price != null && input.price <= 0) throw new Error('单价必须大于 0')
  Object.assign(rule, input)
  return rule
}

export const AI_CAPABILITY_KEYS = [
  { key: 'gen-question', label: 'AI 出题' },
  { key: 'gen-paper', label: 'AI 组卷' },
  { key: 'gen-lecture', label: 'AI 讲义' },
  { key: 'gen-courseware', label: 'AI 课件' },
  { key: 'ai-grading', label: 'AI 阅卷' },
  { key: 'ai-profile', label: 'AI 学情分析' },
  { key: 'ai-assistant', label: '教师 AI 助手' },
  { key: 'student-qa', label: '学生 AI 问答' },
]

const TENANT_SWITCHES = ['星辰教育', '启航培训', '博学堂', '明思书院', '乐学优课']

export const tenantAiSwitches: TenantAiSwitch[] = TENANT_SWITCHES.map((tenantName, index) => ({
  tenantId: index + 1,
  tenantName,
  capabilities: AI_CAPABILITY_KEYS.map((cap) => ({
    ...cap,
    enabled: !(index === 3 && cap.key === 'student-qa') && !(index === 4 && (cap.key === 'ai-grading' || cap.key === 'gen-courseware')),
  })),
  monthCost: Math.round((30 + index * 47) * 100) / 100,
  quotaLeft: Math.round((500 - index * 60) * 100) / 100,
}))

export function listTenantAiSwitches(): TenantAiSwitch[] {
  return tenantAiSwitches.map((row) => ({ ...row, capabilities: row.capabilities.map((cap) => ({ ...cap })) }))
}

export function toggleTenantAiCapability(tenantId: number, capKey: string): TenantAiSwitch {
  const tenant = tenantAiSwitches.find((row) => row.tenantId === tenantId)
  if (!tenant) throw new Error('租户不存在')
  const cap = tenant.capabilities.find((row) => row.key === capKey)
  if (!cap) throw new Error('能力不存在')
  cap.enabled = !cap.enabled
  return tenant
}

/* ================= 系统监控与配置（P-06-06 / P-07-04 ~ 07） ================= */

export const serviceHealth: ServiceHealthItem[] = [
  { key: 'gateway', name: 'API 网关', status: 'up', uptime: 99.99, latencyMs: 42, cpu: 34, memory: 51 },
  { key: 'auth', name: '统一认证服务', status: 'up', uptime: 99.97, latencyMs: 58, cpu: 28, memory: 47 },
  { key: 'ai-gateway', name: 'AI 网关', status: 'degraded', uptime: 99.12, latencyMs: 1860, cpu: 72, memory: 78, lastAlertAt: '2026-09-26 15:40:00' },
  { key: 'question-db', name: '题库服务', status: 'up', uptime: 99.95, latencyMs: 96, cpu: 45, memory: 62 },
  { key: 'paper', name: '组卷服务', status: 'up', uptime: 99.94, latencyMs: 120, cpu: 39, memory: 55 },
  { key: 'file', name: '文件存储服务', status: 'up', uptime: 99.9, latencyMs: 88, cpu: 22, memory: 40 },
  { key: 'message', name: '消息中心', status: 'up', uptime: 99.96, latencyMs: 64, cpu: 18, memory: 35 },
  { key: 'export', name: '导出渲染服务', status: 'down', uptime: 97.8, latencyMs: 0, cpu: 0, memory: 0, lastAlertAt: '2026-09-26 14:02:00' },
]

export function listServiceHealth(): ServiceHealthItem[] {
  return [...serviceHealth]
}

export const systemParams: SystemParam[] = [
  { key: 'platform.name', label: '平台名称', value: 'AI 教学云平台', group: '基础', desc: '门户与登录页展示名', editable: true },
  { key: 'tenant.apply.enabled', label: '开放租户入驻申请', value: 'true', group: '租户', desc: '关闭后门户不再收新申请', editable: true },
  { key: 'tenant.trial.days', label: '试用时长（天）', value: '14', group: '租户', desc: '新租户默认试用天数', editable: true },
  { key: 'quota.warn.percent', label: '配额预警阈值（%）', value: '80', group: '租户', desc: '用量达到阈值推送预警', editable: true },
  { key: 'ai.daily.limit', label: '租户 AI 日调用上限', value: '20000', group: 'AI', desc: '0 表示不限制', editable: true },
  { key: 'audit.retention.days', label: '审计日志留存（天）', value: '365', group: '数据', desc: '合规最低要求 180 天', editable: true },
  { key: 'student.photo.retention.days', label: '学生照片留存（天）', value: '30', group: '数据', desc: 'K12 红线：不作他用，按策略清理', editable: false },
  { key: 'build.version', label: '当前版本号', value: 'v1.4.0-demo', group: '基础', desc: '只读', editable: false },
]

export function listSystemParams(): SystemParam[] {
  return systemParams.map((row) => ({ ...row }))
}

export function saveSystemParam(key: string, value: string): SystemParam {
  const param = systemParams.find((row) => row.key === key)
  if (!param) throw new Error('参数不存在')
  if (!param.editable) throw new Error('该参数只读')
  if (!value.trim()) throw new Error('参数值不能为空')
  param.value = value.trim()
  return param
}

export const messageTemplates: MessageTemplate[] = [
  { id: ++tplSeq, name: '租户入驻审核结果', scene: '租户管理', channels: ['站内', '短信'], content: '【AI教学云】您的入驻申请已{result}，请登录查看详情。', enabled: true, updatedAt: UPDATED },
  { id: ++tplSeq, name: '配额预警提醒', scene: '租户管理', channels: ['站内', '邮件'], content: '【AI教学云】贵机构 {quota} 使用率已超过 {percent}%，请注意用量。', enabled: true, updatedAt: '2026-09-20 10:00:00' },
  { id: ++tplSeq, name: '内容审核结果通知', scene: '内容运营', channels: ['站内'], content: '【AI教学云】您反馈的内容问题已处理：{reply}', enabled: true, updatedAt: '2026-09-18 09:00:00' },
  { id: ++tplSeq, name: '服务告警值班通知', scene: '系统监控', channels: ['短信', '电话'], content: '【AI教学云】{service} 触发 {level} 告警，请值班同学立即处理。', enabled: true, updatedAt: '2026-09-10 08:00:00' },
  { id: ++tplSeq, name: '备份完成通知', scene: '系统监控', channels: ['站内'], content: '【AI教学云】{scope} 备份已完成（{size}GB）。', enabled: false, updatedAt: '2026-09-01 09:00:00' },
]

export function listMessageTemplates(): MessageTemplate[] {
  return messageTemplates.map((row) => ({ ...row, channels: [...row.channels] }))
}

export function saveMessageTemplate(input: Partial<MessageTemplate> & { name: string; content: string }): MessageTemplate {
  if (!input.name.trim()) throw new Error('模板名称必填')
  if (!input.content.includes('{')) throw new Error('模板内容需包含至少一个 {变量}')
  if (input.id != null) {
    const tpl = messageTemplates.find((row) => row.id === input.id)
    if (!tpl) throw new Error('模板不存在')
    Object.assign(tpl, input)
    tpl.updatedAt = UPDATED
    return tpl
  }
  const tpl: MessageTemplate = {
    id: ++tplSeq,
    name: input.name.trim(),
    scene: input.scene || '通用',
    channels: input.channels?.length ? input.channels : ['站内'],
    content: input.content,
    enabled: true,
    updatedAt: UPDATED,
  }
  messageTemplates.push(tpl)
  return tpl
}

export function toggleMessageTemplate(id: number): MessageTemplate {
  const tpl = messageTemplates.find((row) => row.id === id)
  if (!tpl) throw new Error('模板不存在')
  tpl.enabled = !tpl.enabled
  return tpl
}

export const storagePolicies: StoragePolicy[] = [
  { key: 'question-media', label: '题目图片 / 公式图', provider: '对象存储 A（华东）', bucket: 'aiteach-qmedia', maxUploadMb: 10, acceptTypes: ['png', 'jpg', 'webp', 'svg'], enabled: true, usedGb: 412, quotaGb: 1024 },
  { key: 'video', label: '视频与微课', provider: '对象存储 B（华北）', bucket: 'aiteach-video', maxUploadMb: 2048, acceptTypes: ['mp4', 'mov'], enabled: true, usedGb: 3860, quotaGb: 5120 },
  { key: 'doc', label: '文档与试卷源文件', provider: '对象存储 A（华东）', bucket: 'aiteach-doc', maxUploadMb: 100, acceptTypes: ['docx', 'pdf', 'pptx'], enabled: true, usedGb: 156, quotaGb: 512 },
  { key: 'student-photo', label: '学生作答照片（隔离）', provider: '对象存储 C（合规区）', bucket: 'aiteach-sphoto', maxUploadMb: 20, acceptTypes: ['jpg', 'png'], enabled: true, usedGb: 24, quotaGb: 256 },
  { key: 'archive', label: '归档冷存储', provider: '归档存储', bucket: 'aiteach-archive', maxUploadMb: 0, acceptTypes: [], enabled: false, usedGb: 8192, quotaGb: 20480 },
]

export function listStoragePolicies(): StoragePolicy[] {
  return storagePolicies.map((row) => ({ ...row, acceptTypes: [...row.acceptTypes] }))
}

export function saveStoragePolicy(key: string, input: Partial<StoragePolicy>): StoragePolicy {
  const policy = storagePolicies.find((row) => row.key === key)
  if (!policy) throw new Error('存储策略不存在')
  if (input.maxUploadMb != null && input.maxUploadMb < 0) throw new Error('上限不能为负')
  Object.assign(policy, input)
  return policy
}

export const backups: BackupRecord[] = [
  { id: ++backupSeq, name: '每日全量备份（自动）', kind: 'auto', scope: '全平台', sizeGb: 48.2, status: 'done', startedAt: '2026-09-26 02:00:00', finishedAt: '2026-09-26 02:41:00', restoreTimes: 0 },
  { id: ++backupSeq, name: '题库库增量备份（自动）', kind: 'auto', scope: '题库服务', sizeGb: 3.1, status: 'done', startedAt: '2026-09-26 03:00:00', finishedAt: '2026-09-26 03:04:00', restoreTimes: 1 },
  { id: ++backupSeq, name: '升级前手动备份', kind: 'manual', scope: '全平台', sizeGb: 47.8, status: 'done', startedAt: '2026-09-24 22:00:00', finishedAt: '2026-09-24 22:39:00', restoreTimes: 0 },
  { id: ++backupSeq, name: '每日全量备份（自动）', kind: 'auto', scope: '全平台', sizeGb: 47.6, status: 'failed', startedAt: '2026-09-25 02:00:00', restoreTimes: 0 },
  { id: ++backupSeq, name: '消息中心增量备份（自动）', kind: 'auto', scope: '消息中心', sizeGb: 0.8, status: 'running', startedAt: '2026-09-27 02:00:00', restoreTimes: 0 },
]

export function listBackups(): BackupRecord[] {
  return [...backups]
}

export function createBackup(scope: string): BackupRecord {
  if (!scope.trim()) throw new Error('备份范围必填')
  const record: BackupRecord = {
    id: ++backupSeq,
    name: `${scope}手动备份`,
    kind: 'manual',
    scope: scope.trim(),
    sizeGb: 0,
    status: 'running',
    startedAt: UPDATED,
    restoreTimes: 0,
  }
  backups.unshift(record)
  return record
}
