/**
 * 机构端新模块 Mock 仓库：班级与学生管理（T-08）、AI 学情画像（T-07-08~10）、
 * AI 能力中心（T-10）、机构系统设置（T-11）。
 *
 * 与 org-store 同一套约定：
 * - 种子时间写死（相对时间会让每次刷新数据都在变，老师会以为数据丢了）；
 * - 成绩/掌握度用确定性伪随机（线性同余），同一个人每次进来看到的画像一致；
 * - 学生个人信息最小化（T-08-04）：仓库里存的是全量，列表接口返回前做脱敏。
 */
import type {
  AiArtifactReview,
  AiCapabilityCard,
  AiCenterTask,
  ClassProfileReport,
  ConsentRecord,
  MasteryNode,
  OrgClass,
  OrgSettings,
  OrgStudent,
  ReviewFlowConfig,
  StudentProfile,
} from '../api/models'

const UPDATED = '2026-09-26 18:20:00'

/* ================= 确定性伪随机（与 org-store 同思路） ================= */

let seed = 20260926
function rand(): number {
  seed = (seed * 1103515245 + 12345) % 2147483648
  return seed / 2147483648
}
function pickOne<T>(list: T[]): T {
  return list[Math.floor(rand() * list.length)]
}

/* ================= 班级与花名册（与阅卷 ROSTER 同一套名单，保证跨模块一致） ================= */

const ROSTER: Array<{ className: string; headTeacher: string; room: string; names: Array<[string, '男' | '女']> }> = [
  {
    className: '高一(1)班',
    headTeacher: '李文博',
    room: '教学楼 A301',
    names: [
      ['张一鸣', '男'], ['李思远', '男'], ['王梓涵', '女'], ['陈亦帆', '男'], ['刘梦琪', '女'],
      ['赵子谦', '男'], ['孙嘉悦', '女'], ['周浩然', '男'], ['吴欣怡', '女'], ['郑天宇', '男'],
      ['冯语彤', '女'], ['蒋泽楷', '男'], ['韩雨薇', '女'], ['杨博文', '男'], ['何佳宁', '女'],
    ],
  },
  {
    className: '高一(2)班',
    headTeacher: '孙悦',
    room: '教学楼 A302',
    names: [
      ['曹峻熙', '男'], ['彭思睿', '男'], ['董一诺', '女'], ['袁子墨', '男'], ['于书瑶', '女'],
      ['余泽楷', '男'], ['叶知秋', '女'], ['程思远', '男'], ['苏子航', '男'], ['魏灵犀', '女'],
      ['吕明轩', '男'], ['丁若曦', '女'], ['任嘉树', '男'], ['沈亦舟', '男'], ['姚静姝', '女'],
    ],
  },
  {
    className: '高一(3)班',
    headTeacher: '王静宜',
    room: '教学楼 A303',
    names: [
      ['卢俊熙', '男'], ['傅诗涵', '女'], ['钟子昂', '男'], ['姜雨泽', '男'], ['崔艺萌', '女'],
      ['谭博衍', '男'], ['陆思彤', '女'], ['汪子睿', '男'], ['范晓萱', '女'], ['金昊然', '男'],
      ['石佳怡', '女'], ['廖晨曦', '女'], ['贾一凡', '男'], ['韦思远', '男'], ['樊悦然', '女'],
    ],
  },
]

let classSeq = 100
let studentSeq = 5000
let consentSeq = 300
let pushSeq = 900
let taskSeq = 4000
let artifactSeq = 5000

/* ================= 班级 ================= */

export const classes: OrgClass[] = ROSTER.map((row) => ({
  id: ++classSeq,
  name: row.className,
  grade: '高一',
  headTeacher: row.headTeacher,
  assistant: rand() < 0.6 ? pickOne(['周敏', '吴倩', '郑海涛']) : undefined,
  studentCount: row.names.length,
  subjects: ['数学', '语文', '英语', '物理'],
  room: row.room,
  enabled: true,
  createdAt: '2026-09-01 09:00:00',
}))

/* ================= 学生档案 ================= */

const GUARDIANS = ['张先生', '李女士', '王先生', '刘女士', '陈先生', '赵女士', '周先生', '吴女士']
const TAG_POOL = ['基础扎实', '思维活跃', '粗心易错', '表达优秀', '进步明显', '需关注', '压轴题弱', '计算速度慢']

export const students: OrgStudent[] = ROSTER.flatMap((row, classIndex) =>
  row.names.map(([name, gender], index) => {
    const roll = rand()
    const warning: OrgStudent['warning'] = roll < 0.12 ? 'risk' : roll < 0.3 ? 'watch' : 'none'
    const percentile = 5 + Math.round(rand() * 90)
    return {
      id: ++studentSeq,
      name,
      studentNo: `2026${String(classIndex + 1).padStart(2, '0')}${String(index + 1).padStart(2, '0')}`,
      className: row.className,
      grade: '高一',
      gender,
      guardianPhone: `138${String(Math.floor(rand() * 100000000)).padStart(8, '0')}`,
      guardianName: pickOne(GUARDIANS),
      consentStatus: (rand() < 0.78 ? 'granted' : rand() < 0.85 ? 'pending' : 'withdrawn') as OrgStudent['consentStatus'],
      tags: Array.from(new Set([pickOne(TAG_POOL), ...(rand() < 0.4 ? [pickOne(TAG_POOL)] : [])])),
      warning,
      lastScore: 62 + Math.round(rand() * 82),
      lastPercentile: percentile,
      enrolledAt: '2026-09-01',
      status: rand() < 0.94 ? '在读' : pickOne(['休学', '转班']),
    }
  }),
)

export function listStudents(keyword: string, className: string): OrgStudent[] {
  /* 最小化收集（T-08-04）：列表侧 guardianPhone 一律脱敏后返回 */
  const mask = (phone: string) => `${phone.slice(0, 3)}****${phone.slice(-4)}`
  return students
    .filter((row) => {
      if (className && row.className !== className) return false
      if (keyword) {
        const lower = keyword.toLowerCase()
        return row.name.toLowerCase().includes(lower) || row.studentNo.includes(lower)
      }
      return true
    })
    .map((row) => ({ ...row, guardianPhone: mask(row.guardianPhone) }))
}

export function getStudent(id: number): OrgStudent {
  const student = students.find((row) => row.id === id)
  if (!student) throw new Error('学生不存在')
  return student
}

export function saveStudent(input: Partial<OrgStudent> & { name: string; className: string }): OrgStudent {
  if (!input.name.trim()) throw new Error('学生姓名必填')
  const cls = classes.find((row) => row.name === input.className)
  if (!cls) throw new Error('班级不存在')
  if (input.id != null) {
    const student = students.find((row) => row.id === input.id)
    if (!student) throw new Error('学生不存在')
    const oldClass = student.className
    Object.assign(student, input)
    student.className = cls.name
    student.grade = cls.grade
    if (oldClass !== cls.name) student.status = '转班'
    return student
  }
  const student: OrgStudent = {
    id: ++studentSeq,
    name: input.name.trim(),
    studentNo: input.studentNo || `2026${String(cls.id).padStart(2, '0')}${String(cls.studentCount + 1).padStart(2, '0')}`,
    className: cls.name,
    grade: cls.grade,
    gender: input.gender ?? '男',
    guardianPhone: input.guardianPhone || '13800000000',
    guardianName: input.guardianName || '家长',
    consentStatus: 'pending',
    tags: input.tags ?? [],
    warning: 'none',
    enrolledAt: '2026-09-27',
    status: '在读',
  }
  students.push(student)
  cls.studentCount += 1
  return student
}

export function deleteStudent(id: number): void {
  const index = students.findIndex((row) => row.id === id)
  if (index < 0) throw new Error('学生不存在')
  const student = students[index]
  const cls = classes.find((row) => row.name === student.className)
  if (cls) cls.studentCount = Math.max(0, cls.studentCount - 1)
  students.splice(index, 1)
}

export function saveClass(input: Partial<OrgClass> & { name: string }): OrgClass {
  if (!input.name.trim()) throw new Error('班级名称必填')
  if (input.id != null) {
    const cls = classes.find((row) => row.id === input.id)
    if (!cls) throw new Error('班级不存在')
    Object.assign(cls, input)
    return cls
  }
  const cls: OrgClass = {
    id: ++classSeq,
    name: input.name.trim(),
    grade: input.grade || '高一',
    headTeacher: input.headTeacher || '',
    assistant: input.assistant,
    studentCount: 0,
    subjects: input.subjects?.length ? input.subjects : ['数学', '语文', '英语'],
    room: input.room,
    enabled: true,
    createdAt: UPDATED,
  }
  classes.push(cls)
  return cls
}

export function toggleClass(id: number): OrgClass {
  const cls = classes.find((row) => row.id === id)
  if (!cls) throw new Error('班级不存在')
  /* 停用前必须转出学生：否则该班会出现在作业/考试/学情的下拉里却点不动，留下脏数据 */
  if (cls.enabled && cls.studentCount > 0) throw new Error('班级下仍有学生，不能停用')
  cls.enabled = !cls.enabled
  return cls
}

/* ================= 监护人知情同意（T-08-06） ================= */

const CONSENT_SCOPES = ['学情分析', '个性化练习推送', '错题本生成', 'AI 问答记录']

export const consents: ConsentRecord[] = students.map((student) => {
  const status = student.consentStatus
  return {
    id: ++consentSeq,
    studentId: student.id,
    studentName: student.name,
    guardianName: student.guardianName,
    relation: student.gender === '男' ? '父亲' : '母亲',
    docVersion: 'V2026.2',
    status,
    scopes: status === 'granted' ? CONSENT_SCOPES.slice(0, 2 + Math.floor(rand() * 3)) : [],
    signedAt: status === 'granted' ? '2026-09-05 10:24:00' : undefined,
    withdrawnAt: status === 'withdrawn' ? '2026-09-18 15:40:00' : undefined,
  }
})

export function listConsents(keyword: string): ConsentRecord[] {
  return consents.filter((row) => !keyword || row.studentName.includes(keyword) || row.guardianName.includes(keyword))
}

export function signConsent(id: number, scopes: string[]): ConsentRecord {
  const record = consents.find((row) => row.id === id)
  if (!record) throw new Error('同意记录不存在')
  if (!scopes.length) throw new Error('请至少勾选一项授权范围')
  record.status = 'granted'
  record.scopes = [...scopes]
  record.signedAt = UPDATED
  record.withdrawnAt = undefined
  const student = students.find((row) => row.id === record.studentId)
  if (student) student.consentStatus = 'granted'
  return record
}

export function withdrawConsent(id: number): ConsentRecord {
  const record = consents.find((row) => row.id === id)
  if (!record) throw new Error('同意记录不存在')
  record.status = 'withdrawn'
  record.scopes = []
  record.withdrawnAt = UPDATED
  record.signedAt = undefined
  const student = students.find((row) => row.id === record.studentId)
  if (student) student.consentStatus = 'withdrawn'
  return record
}

/* ================= AI 学情画像（T-07-08 ~ 10） ================= */

const KNOWLEDGE: Record<string, string[]> = {
  数学: ['集合与逻辑', '函数概念与性质', '指数与对数', '三角函数', '平面向量', '数列', '不等式'],
  语文: ['文言文阅读', '现代文阅读', '古诗词鉴赏', '语言文字运用', '写作'],
  英语: ['阅读理解', '完形填空', '语法填空', '应用文写作', '听力'],
  物理: ['运动学', '相互作用', '牛顿运动定律', '机械能', '曲线运动'],
}

const TRENDS: Array<MasteryNode['trend']> = ['up', 'flat', 'down']

/** 按学生生成画像（确定性：同一学生每次进来相同） */
function buildProfile(student: OrgStudent): StudentProfile {
  const base = student.lastPercentile ?? 50
  const subjects = Object.entries(KNOWLEDGE).map(([subject, nodes]) => {
    const list = nodes.map((knowledge) => {
      /* 百分位越高整体掌握度越高，个体知识点上下浮动 */
      const mastery = Math.max(18, Math.min(98, Math.round(base * 0.7 + 18 + rand() * 34)))
      return {
        knowledge,
        mastery,
        trend: pickOne(TRENDS),
        practices: 2 + Math.floor(rand() * 14),
        weak: mastery < 60,
      }
    })
    return { subject, mastery: Math.round(list.reduce((sum, row) => sum + row.mastery, 0) / list.length), nodes: list }
  })
  const overall = Math.round(subjects.reduce((sum, row) => sum + row.mastery, 0) / subjects.length)
  const weakest = subjects
    .flatMap((row) => row.nodes)
    .filter((row) => row.weak)
    .slice(0, 3)
    .map((row) => row.knowledge)
  return {
    studentId: student.id,
    studentName: student.name,
    className: student.className,
    overall,
    percentile: base,
    subjects,
    diagnosis: weakest.length
      ? `薄弱点集中在「${weakest.join('、')}」，结合近期作业正确率与错题归因，主要失分来自概念理解不牢与综合题迁移不足（AI 归因，仅供参考）。`
      : '各知识点掌握度均衡，无显著薄弱点，可适当增加压轴题与综合应用训练（AI 归因，仅供参考）。',
    suggestion: weakest.length
      ? `建议推送「${weakest[0]}」专项练习 8 题（含 2 道变式），两周后复测掌握度。`
      : '建议参加拓展练习，保持综合题手感。',
    pushes: [
      {
        id: ++pushSeq,
        title: weakest.length ? `「${weakest[0]}」专项巩固（AI 推送）` : '综合应用拓展卷（AI 推送）',
        questionCount: 8,
        weakPoints: weakest.length ? weakest.slice(0, 2) : ['综合应用'],
        pushedAt: '2026-09-24 08:30:00',
        done: Math.floor(rand() * 9),
      },
    ],
  }
}

export function getStudentProfile(studentId: number): StudentProfile {
  const student = students.find((row) => row.id === studentId)
  if (!student) throw new Error('学生不存在')
  seed = student.id * 7919
  return buildProfile(student)
}

export function getClassProfileReport(className: string): ClassProfileReport {
  const roster = students.filter((row) => row.className === className && row.status === '在读')
  if (!roster.length) throw new Error('班级暂无在读学生')
  seed = roster.reduce((sum, row) => sum + row.id, 0)
  const subjectMastery = Object.keys(KNOWLEDGE).map((subject) => ({
    subject,
    mastery: Math.round(55 + rand() * 30),
    lastTerm: Math.round(50 + rand() * 32),
  }))
  const weakNodes = Object.entries(KNOWLEDGE)
    .flatMap(([subject, nodes]) => nodes.map((knowledge) => ({ subject, knowledge, mastery: Math.round(30 + rand() * 50) })))
    .sort((a, b) => a.mastery - b.mastery)
    .slice(0, 6)
    .map((row) => ({
      knowledge: `${row.subject} · ${row.knowledge}`,
      mastery: row.mastery,
      trend: pickOne(TRENDS),
      practices: 10 + Math.floor(rand() * 30),
      weak: row.mastery < 60,
    }))
  const bands = ['90+', '80-89', '70-79', '60-69', '<60']
  const scoreBands = bands.map((band, index) => ({
    band,
    count: index === 0 ? 1 + Math.floor(rand() * 4) : index === 4 ? 1 + Math.floor(rand() * 3) : 3 + Math.floor(rand() * 6),
  }))
  const advice = [
    `「${weakNodes[0]?.knowledge ?? '综合应用'}」为全班共性薄弱点，建议安排一节专题复习课并配套课后变式练习。`,
    '分数段呈中间大、两头小分布；按成长型激励要求不做公开排名，建议在讲评时只呈现分布与自身区间。',
    `较上学期，${subjectMastery.filter((row) => row.mastery > row.lastTerm).map((row) => row.subject).join('、') || '各学科'}平均掌握度上升，注意保持训练强度。`,
  ]
  return {
    className,
    studentCount: roster.length,
    subjectMastery,
    weakNodes,
    scoreBands,
    advice,
  }
}

/** 个性化练习推送（T-07-10）：给指定学生按薄弱点生成一份练习 */
export function pushPractice(studentId: number, knowledge: string, count: number): StudentProfile['pushes'][number] {
  const student = students.find((row) => row.id === studentId)
  if (!student) throw new Error('学生不存在')
  if (!knowledge) throw new Error('请选择薄弱知识点')
  const push = {
    id: ++pushSeq,
    title: `「${knowledge}」个性化练习（AI 推送）`,
    questionCount: count,
    weakPoints: [knowledge],
    pushedAt: UPDATED,
    done: 0,
  }
  /* 推送记录写回画像（演示：直接挂在内存 push 池） */
  pushPool.push({ studentId, push })
  return push
}

const pushPool: Array<{ studentId: number; push: StudentProfile['pushes'][number] }> = []

export function listPushes(studentId: number): StudentProfile['pushes'] {
  return pushPool.filter((row) => row.studentId === studentId).map((row) => row.push)
}

/* ================= AI 能力中心（T-10） ================= */

export const AI_CAPABILITIES: AiCapabilityCard[] = [
  { key: 'gen-question', title: 'AI 出题', desc: '按学科、知识点、难度批量生成题目，自动质检后入库', scene: '出题', monthUses: 128, icon: 'edit', link: '/question/create?mode=ai' },
  { key: 'gen-paper', title: 'AI 组卷', desc: '输入考试场景与范围，一键生成完整试卷与质量报告', scene: '组卷', monthUses: 46, icon: 'file', link: '/paper/compose' },
  { key: 'gen-lecture', title: 'AI 讲义', desc: '按课题生成讲义初稿：知识梳理、例题、变式练习', scene: '讲义', monthUses: 32, icon: 'book', link: '/teach/lecture' },
  { key: 'gen-courseware', title: 'AI 课件', desc: '按教学目标生成课件页面结构与互动环节设计', scene: '课件', monthUses: 28, icon: 'presentation', link: '/teach/courseware' },
  { key: 'photo-question', title: 'AI 拍照识题', desc: '拍照或截图识别单题，结构化为可编辑题目', scene: '识题', monthUses: 96, icon: 'image', link: '/question/photo' },
  { key: 'ai-grading', title: 'AI 阅卷', desc: '主观题与作文按评分标准分步给分，教师复核生效', scene: '阅卷', monthUses: 18, icon: 'clipboard', link: '/exam/grading' },
  { key: 'ai-profile', title: 'AI 学情分析', desc: '知识点掌握画像、薄弱归因与个性化练习推送', scene: '学情', monthUses: 54, icon: 'chart', link: '/exam/profile' },
  { key: 'ai-assistant', title: '教师 AI 助手', desc: '教学问答、素材检索、思路启发', scene: '问答', monthUses: 210, icon: 'sparkles', link: '/ai-center/workbench' },
]

const TASK_SEEDS: Array<{ scene: string; title: string; status: AiCenterTask['status']; elapsed: number; tokens: number; outputCount: number }> = [
  { scene: '出题', title: '「三角函数」专项出题 · 10 题', status: 'success', elapsed: 42, tokens: 18600, outputCount: 10 },
  { scene: '组卷', title: '高一数学期中卷（AI 生成）', status: 'reviewing', elapsed: 76, tokens: 32400, outputCount: 1 },
  { scene: '讲义', title: '《函数概念与性质》讲义初稿', status: 'success', elapsed: 55, tokens: 24800, outputCount: 1 },
  { scene: '识题', title: '批量拍照识题 · 6 张', status: 'success', elapsed: 38, tokens: 15800, outputCount: 6 },
  { scene: '学情', title: '高一(1)班 9 月学情报告', status: 'success', elapsed: 64, tokens: 41200, outputCount: 1 },
  { scene: '阅卷', title: '期中考试解答 AI 批改', status: 'reviewing', elapsed: 118, tokens: 66800, outputCount: 45 },
  { scene: '课件', title: '《平面向量》课件生成', status: 'failed', elapsed: 12, tokens: 2100, outputCount: 0 },
  { scene: '出题', title: '「文言文阅读」出题 · 8 题', status: 'success', elapsed: 46, tokens: 20400, outputCount: 8 },
]

export const aiTasks: AiCenterTask[] = TASK_SEEDS.map((row, index) => ({
  id: ++taskSeq,
  scene: row.scene,
  title: row.title,
  creator: pickOne(['李文博', '孙悦', '王静宜', '周敏']),
  status: row.status,
  elapsed: row.elapsed,
  tokens: row.tokens,
  outputCount: row.outputCount,
  createdAt: `2026-09-2${6 - index} ${String(9 + index).padStart(2, '0')}:1${index % 10}:00`,
}))

export function listAiTasks(scene: string): AiCenterTask[] {
  return aiTasks.filter((row) => !scene || row.scene === scene)
}

export function cancelAiTask(id: number): void {
  const task = aiTasks.find((row) => row.id === id)
  if (!task) throw new Error('任务不存在')
  if (task.status !== 'running') throw new Error('仅进行中的任务可取消')
  task.status = 'failed'
}

/* AI 生成内容复核（T-10-08：治理红线 —— AI 内容须教师复核后才能发布） */

const ARTIFACT_SEEDS: Array<{
  kind: AiArtifactReview['kind']
  title: string
  scene: string
  model: string
  status: AiArtifactReview['status']
  autoCheck: AiArtifactReview['autoCheck']
  autoCheckNote: string
}> = [
  { kind: '题目', title: '「数列」AI 生成题 ×10', scene: '出题', model: 'deepseek-chat', status: 'pending', autoCheck: 'pass', autoCheckNote: '答案自洽、解析完整、年级适配' },
  { kind: '试卷', title: '高一物理 9 月月考卷（AI 生成）', scene: '组卷', model: 'deepseek-chat', status: 'pending', autoCheck: 'warn', autoCheckNote: '第 14 题解析与答案存在轻微不一致，建议人工确认' },
  { kind: '讲义', title: '《指数与对数》讲义初稿', scene: '讲义', model: 'deepseek-chat', status: 'approved', autoCheck: 'pass', autoCheckNote: '自动质检通过' },
  { kind: '课件', title: '《曲线运动》互动课件', scene: '课件', model: 'deepseek-chat', status: 'pending', autoCheck: 'pass', autoCheckNote: '自动质检通过' },
  { kind: '批改', title: '期中作文 AI 批改 · 张一鸣', scene: '阅卷', model: 'deepseek-chat', status: 'pending', autoCheck: 'error', autoCheckNote: '评分理由与分值不匹配，必须人工复核' },
  { kind: '题目', title: '「文言文」AI 生成题 ×8', scene: '出题', model: 'deepseek-chat', status: 'rejected', autoCheck: 'warn', autoCheckNote: '超纲词句较多，建议驳回重生成' },
  { kind: '画像', title: '高一(2)班学情报告（AI）', scene: '学情', model: 'deepseek-chat', status: 'approved', autoCheck: 'pass', autoCheckNote: '自动质检通过' },
]

export const aiArtifacts: AiArtifactReview[] = ARTIFACT_SEEDS.map((row, index) => ({
  id: ++artifactSeq,
  kind: row.kind,
  title: row.title,
  scene: row.scene,
  model: row.model,
  status: row.status,
  autoCheck: row.autoCheck,
  autoCheckNote: row.autoCheckNote,
  aiLabeled: true,
  createdAt: `2026-09-2${7 - index} 1${index % 9}:2${index % 8}:00`,
  reviewer: row.status === 'pending' ? undefined : '李文博',
  reviewedAt: row.status === 'pending' ? undefined : UPDATED,
}))

export function listAiArtifacts(status: string): AiArtifactReview[] {
  return aiArtifacts.filter((row) => !status || row.status === status)
}

export function reviewAiArtifact(id: number, pass: boolean): AiArtifactReview {
  const artifact = aiArtifacts.find((row) => row.id === id)
  if (!artifact) throw new Error('复核条目不存在')
  if (artifact.status !== 'pending') throw new Error('该条目已复核')
  artifact.status = pass ? 'approved' : 'rejected'
  artifact.reviewer = '当前用户'
  artifact.reviewedAt = UPDATED
  return artifact
}

/* ================= 机构系统设置（T-11） ================= */

export const orgSettings: OrgSettings = {
  name: '星辰教育培训学校',
  shortName: '星辰教育',
  contact: '李文博',
  phone: '021-6688-1000',
  address: '上海市浦东新区锦绣路 200 号',
  intro: '专注高中学科培优与 AI 精准教学的示范机构。',
  subjects: ['数学', '语文', '英语', '物理'],
  grades: ['高一', '高二', '高三'],
  preferredTextbooks: ['人教 A 版', '沪教版'],
}

export const reviewFlows: ReviewFlowConfig[] = [
  {
    key: 'question',
    label: '题目入库审核',
    enabled: true,
    levels: 1,
    level1Reviewers: ['李文博', '孙悦'],
    level2Reviewers: [],
    aiPrecheck: true,
  },
  {
    key: 'paper',
    label: '试卷发布审核',
    enabled: true,
    levels: 2,
    level1Reviewers: ['孙悦'],
    level2Reviewers: ['王静宜'],
    aiPrecheck: true,
  },
  {
    key: 'resource',
    label: '校本资源上架审核',
    enabled: false,
    levels: 1,
    level1Reviewers: ['李文博'],
    level2Reviewers: [],
    aiPrecheck: false,
  },
]

export function saveOrgSettings(input: Partial<OrgSettings>): OrgSettings {
  if (input.name != null && !input.name.trim()) throw new Error('机构名称必填')
  Object.assign(orgSettings, input)
  return orgSettings
}

export function saveReviewFlow(key: ReviewFlowConfig['key'], input: Partial<ReviewFlowConfig>): ReviewFlowConfig {
  const flow = reviewFlows.find((row) => row.key === key)
  if (!flow) throw new Error('审核流程不存在')
  if (input.levels === 2 && (!input.level2Reviewers || input.level2Reviewers.length === 0)) {
    throw new Error('双级审核必须指定二级审核人')
  }
  Object.assign(flow, input)
  return flow
}

/* ================= 供工作台汇总 ================= */

export function studentOverview(): { classCount: number; studentCount: number; consentRate: number; riskCount: number } {
  const granted = students.filter((row) => row.consentStatus === 'granted').length
  return {
    classCount: classes.length,
    studentCount: students.length,
    consentRate: Math.round((granted / Math.max(1, students.length)) * 100),
    riskCount: students.filter((row) => row.warning === 'risk').length,
  }
}
