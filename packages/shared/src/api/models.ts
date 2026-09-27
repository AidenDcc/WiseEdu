/** 超管端工作台概览（FR-PT-001 ~ 004） */
export interface AdminOverview {
  totalTenants: number
  trialTenants: number
  expiringSoon: number
  newTenantsToday: number
  aiCallsThisMonth: number
  aiCallsGrowth: number
  tenantGrowth: number
  trend: {
    days: string[]
    tenants: number[]
    aiCalls: number[]
  }
  pendingApplies: Array<{
    applyNo: string
    orgName: string
    orgType: string
    stages: string
    contact: string
    phone: string
    submittedAt: string
    waitingHours: number
    overtime: boolean
  }>
  expiringTenants: Array<{
    name: string
    packageName: string
    expireTime: string
    daysLeft: number
  }>
}

/** 机构端工作台概览（FR-WS-001 ~ 004） */
export interface TenantOverview {
  stats: {
    questionCount: number
    paperCount: number
    materialCount: number
    fileCount: number
    aiUsed: number
    aiQuota: number
  }
  quickActions: Array<{
    key: string
    label: string
    icon: string
  }>
  todos: Array<{
    type: string
    title: string
    submitter: string
    submittedAt: string
    waitingHours: number
    overtime: boolean
  }>
  trend: {
    days: string[]
    newQuestions: number[]
    newPapers: number[]
  }
}

/* ================ 租户管理（FR-PT-005 ~ 014） ================ */

export interface PageResult<T> {
  list: T[]
  total: number
}

export type ApplyStatus = '待审核' | '已通过' | '已驳回'

export interface TenantApply {
  id: number
  applyNo: string
  orgName: string
  orgType: string
  stages: string[]
  contact: string
  phone: string
  email?: string
  intro?: string
  certFiles: Array<{ name: string; type: 'pdf' | 'img' }>
  submittedAt: string
  waitingHours: number
  status: ApplyStatus
  rejectReason?: string
}

/** 功能开关（FR-PT-012）：关闭即机构端对应菜单隐藏 */
export interface FeatureSwitches {
  aiGenerate: boolean
  aiVariant: boolean
  aiPhoto: boolean
  docImport: boolean
  collab: boolean
  customPrompt: boolean
}

export interface PackageRecord {
  id: number
  name: string
  /** 月费（元） */
  monthlyPrice: number
  aiQuota: number
  storageGb: number
  maxStaff: number
  maxConcurrent: number
  features: FeatureSwitches
  smsEnabled: boolean
}

/** 机构状态：1 试用 2 正式 3 已到期 4 已禁用（sys_tenant.status） */
export type TenantStatus = 1 | 2 | 3 | 4

export interface TenantRecord {
  id: number
  code: string
  name: string
  logoHue: number
  orgType: string
  stages: string[]
  packageId: number
  status: TenantStatus
  expireTime: string
  trialEndTime?: string
  aiUsed: number
  storageUsedGb: number
  createdAt: string
  contact: string
  phone: string
  city: string
  intro: string
  /** 机构资质档案（入驻时提交，随租户留存） */
  certFiles: Array<{ name: string; type: 'pdf' | 'img' }>
  isolationType: 1 | 2
  storageRegion: string
  disableReason?: string
  switches: FeatureSwitches
  quotas: {
    aiQuota: number
    storageGb: number
    maxStaff: number
    maxConcurrent: number
  }
}

export interface TenantDetailModel {
  tenant: TenantRecord
  pkg: PackageRecord
  stats: {
    questionCount: number
    paperCount: number
    materialCount: number
    staffCount: number
  }
  aiMonthly: {
    months: string[]
    calls: number[]
  }
}

/* ================ 全局字典（FR-PT-015 / 016） ================ */

/** copyright：机构端首页页脚文案，每条 name 为一段（版权主体 / 备案号 / 客服方式 …），按排序拼接展示 */
export type DictTypeKey = 'subject' | 'grade' | 'term' | 'questionType' | 'difficulty' | 'examType' | 'copyright'

export interface DictItem {
  id: number
  name: string
  /** 编码（学科类必填，创建后不可改） */
  code?: string
  sort: number
  enabled: boolean
  /** 被机构引用数（>0 时禁止删除，仅可停用） */
  refCount: number
  /** 类型特有字段：grade=学段；term=学年/学期/起止；questionType=作答类型；difficulty=系数 */
  stage?: string
  year?: string
  termHalf?: string
  dateFrom?: string
  dateTo?: string
  answerType?: string
  coefficient?: number
}

/* 知识点/考点树（最多 6 级） */
export interface KnowledgeNode {
  id: number
  parentId: number | null
  name: string
  subject: string
  enabled: boolean
}

/* 教材版本 */
export interface TextbookVersion {
  id: number
  subject: string
  name: string
  publisher: string
  hue: number
  sort: number
  enabled: boolean
  refCount: number
}

/* ================ AI 服务配置（FR-PT-017 ~ 027） ================ */

export type AiModelType = 'llm' | 'multimodal' | 'ocr'

export interface AiModel {
  id: number
  name: string
  type: AiModelType
  provider: string
  apiUrl: string
  /** 脱敏显示的 Key（sk-****xxxx） */
  apiKeyMasked: string
  qps: number
  /** 元 / 千 tokens */
  pricePerK: number
  enabled: boolean
  callsThisMonth: number
  costThisMonth: number
  lastCheckAt?: string
  lastCheckOk?: boolean
}

export interface AgentCheckItem {
  key: string
  label: string
  enabled: boolean
  modelId: number | null
  weight: number
  timeoutSec: number
  /** true 时仅可绑定多模态 / OCR 模型 */
  ocrOnly: boolean
}

export interface AgentConfig {
  items: AgentCheckItem[]
  autoFix: {
    /** 可自动修复的错误类型 */
    types: string[]
    /** 自动修复置信度阈值（0-100，默认 90） */
    threshold: number
  }
  manualReview: {
    minConfidence: number | null
    maxSimilarity: number | null
  }
  version: number
  versions: Array<{ version: number; savedAt: string; note: string }>
}

export interface PromptTemplate {
  id: number
  name: string
  scene: string
  /** 模板正文，支持 {{变量}} 占位符 */
  content: string
  status: 'draft' | 'published' | 'disabled'
  isDefault: boolean
  updatedAt: string
  versions: Array<{ version: number; savedAt: string; content: string }>
}

/* ================ 数据审计（FR-PT-028 ~ 032 / 035） ================ */

export interface AiCallLog {
  id: number
  time: string
  orgMasked: string
  user: string
  scene: string
  model: string
  inputTokens: number
  outputTokens: number
  costMs: number
  ok: boolean
  error?: string
}

export interface PublicQuestion {
  id: number
  stem: string
  subject: string
  knowledge: string
  type: string
  difficulty: string
  orgMasked: string
  variantCount: number
  aiStatus: string
  createdAt: string
  options: string[]
  answer: string
  analysis: string
  report: string
  variants: string[]
}

export interface PublicPaper {
  id: number
  name: string
  subject: string
  totalScore: number
  questionCount: number
  parallelCount: number
  orgMasked: string
  createdAt: string
  parallels: string[]
}

export interface AuditRecord {
  id: number
  objectType: string
  objectName: string
  agentPassed: number
  agentTotal: number
  autoFixed: number
  reviewer: string
  conclusion: string
  reviewedAt: string
  timeline: Array<{ time: string; step: string; detail: string }>
}

export interface LoginLog {
  id: number
  account: string
  ip: string
  device: string
  ok: boolean
  time: string
}

export interface OperationLog {
  id: number
  account: string
  module: string
  action: string
  target: string
  ok: boolean
  time: string
}

export interface ErrorLog {
  id: number
  level: 'ERROR' | 'WARN'
  stack: string
  time: string
}

/* ================ 系统管理（FR-PT-033 / 034） ================ */

export type AdminRole = 'super' | 'ops'

export interface AdminAccount {
  id: number
  account: string
  name: string
  role: AdminRole
  enabled: boolean
  lastLoginAt: string
}

export interface TenantMenuItem {
  key: string
  title: string
  enabled: boolean
  children?: Array<{ key: string; title: string; enabled: boolean }>
}

/* ================ 消息中心 ================ */

export interface PlatformNotification {
  id: number
  title: string
  content: string
  type: 'apply' | 'quota' | 'system'
  time: string
  read: boolean
}

/* ================ 机构端业务（FR-TM / FR-PP / FR-JC / FR-FL / FR-FX / FR-PM / FR-SQ / FR-OS / FR-GN-030） ================ */

export type QuestionStatus = 'draft' | 'checking' | 'pending' | 'approved' | 'rejected'
export type QuestionSource = '手动录入' | 'AI 出题' | 'AI 变式' | '拍照识别' | '文档导入' | '教辅导入'
export type QuestionLibrary = 'personal' | 'org' | 'wrong'

export interface AiCheckResult {
  name: string
  pass: boolean
  note: string
  fixed?: string
}

export interface OrgQuestion {
  id: number
  stem: string
  subject: string
  grade: string
  type: string
  difficulty: string
  knowledge: string[]
  textbook?: string
  sourceRemark?: string
  source: QuestionSource
  status: QuestionStatus
  library: QuestionLibrary
  categoryId: number
  ownerId: number
  owner: string
  options: string[]
  answer: string
  analysis: string
  variantOf?: number
  useCount: number
  updatedAt: string
  /** 学期（上学期 / 下学期） */
  term?: string
  /** 考试类型（字典表 examType） */
  examType?: string
  aiChecks?: AiCheckResult[]
  aiSuspects?: string[]
  reviewOpinion?: string
}

/* ================ 知识点树 / 教材（题库管理） ================ */

/** 年级 → 学科 → 教材版本 级联矩阵 */
export interface TextbookOption {
  grade: string
  subjects: Array<{ name: string; versions: string[] }>
}

/** 知识点树节点（叶子 tag 与题目 knowledge 匹配） */
export interface OrgKnowledgeNode {
  id: string
  parentId: string | null
  name: string
  /** 叶子知识点标签（与题目 knowledge 值一致） */
  tag?: string
}

export interface OrgCategory {
  id: number
  name: string
  library: QuestionLibrary
  parentId: number | null
  ownerId: number
}

export interface PaperSection {
  id: number
  title: string
  questions: Array<{ questionId: number; score: number }>
  /**
   * 大题材料（现代文 / 文言文 / 古诗 / 英语阅读短文…）：印在大题标题之下，整版通栏，
   * 本大题各小题共用。没有材料的大题（选择题、填空、默写…）留空。
   */
  material?: string
  /** 材料前的作答提示，如「阅读下面的文字，完成 1～5 题。」（与 material 同印） */
  materialHint?: string
}

export type PaperStatus = 'draft' | 'aiReview' | 'pending' | 'approved' | 'rejected'

export interface OrgPaper {
  id: number
  name: string
  subject: string
  grade: string
  duration: number
  status: PaperStatus
  sections: PaperSection[]
  owner: string
  updatedAt: string
  parallelOf?: number
  parallelLabel?: string
  sharedSquare: boolean
  aiChecks?: AiCheckResult[]
  aiSuspects?: string[]
  reviewOpinion?: string
  collaborators?: Array<{ name: string; perms: string[]; online: boolean }>
  dynamics?: Array<{ time: string; actor: string; action: string }>
}

/* ================ 协同组卷（FR-PP-004 ~ 007 / 017 ~ 021） ================ */

/** 任务状态：收题中 → 待审校 → 已完成 */
export type CollabTaskStatus = 'collecting' | 'reviewing' | 'done'

export const COLLAB_STATUS_TEXT: Record<CollabTaskStatus, string> = {
  collecting: '收题中',
  reviewing: '待审校',
  done: '已完成',
}

/** 任务处理人的状态 */
export type CollabMemberStatus = 'invited' | 'working' | 'submitted'

export const COLLAB_MEMBER_TEXT: Record<CollabMemberStatus, string> = {
  invited: '待接受',
  working: '组卷中',
  submitted: '已提交',
}

/**
 * 任务成员：一位老师承担哪几个题型、要交几道题、交了多少。
 *
 * `questionTypes` 是本模块最关键的约束 —— 任务处理人在组卷界面**只能**把这里的题型加进试卷，
 * 但可以查看整张试卷（含他人负责的题型），否则「分工」就退化成一句口头约定。
 */
export interface CollabMember {
  name: string
  /** 负责的题型；该成员只能为这些题型选题入卷 */
  questionTypes: string[]
  /** 授权范围：选题 / 改分值 / 编辑卷头 / 只读 */
  perms: string[]
  /** 分配的题数（按题型题数之和得出） */
  quota: number
  status: CollabMemberStatus
  online: boolean
  lastActiveAt: string
}

/**
 * 版本快照：撤销与替换都基于它。
 *
 * 必须存**完整 sections 深拷贝**而不是 diff —— 撤销要求「点一下就回到那一刻」，
 * 用 diff 回放一旦有一版漏记就会回滚出一个从未存在过的卷面。
 */
export interface PaperVersion {
  id: number
  no: number
  time: string
  actor: string
  summary: string
  questionCount: number
  totalScore: number
  sections: PaperSection[]
  /** 已被后续版本替换（替换时留痕，不删除记录） */
  replaced?: boolean
  /** 替换说明 */
  note?: string
}

/** 试卷基本要求：所有任务处理人共享同一份约束，AI 抽题也读它 */
export interface CollabRequirement {
  subject: string
  grade: string
  duration: number
  /** 题型要求：题型 → 题数 / 单题分值 */
  structure: Array<{ type: string; count: number; score: number }>
  /** 难点要求：难度档 → 占比（%） */
  difficulty: Array<{ level: string; ratio: number }>
  /** 考察知识点要求 */
  knowledge: string[]
  /** 命题说明（命题范围 / 风格 / 注意事项） */
  remark: string
}

export interface OrgCollabTask {
  id: number
  /** 关联的试卷 id：任务与试卷是一对一，任务只是「分工 + 版本」这层壳 */
  paperId: number
  name: string
  requirement: CollabRequirement
  members: CollabMember[]
  versions: PaperVersion[]
  status: CollabTaskStatus
  createdAt: string
  /** 发起人 */
  owner: string
}

export interface MaterialExample {
  id: number
  stem: string
  answer: string
  analysis: string
  status: 'pending' | 'imported' | 'ignored'
}

export type MaterialStatus = 'recognizing' | 'proofreading' | 'done' | 'failed'

export interface OrgMaterial {
  id: number
  name: string
  type: string
  subject: string
  knowledge: string[]
  sizeMb: number
  status: MaterialStatus
  owner: string
  createdAt: string
  failReason?: string
  chapters: Array<{ id: number; title: string; knowledge: string[]; examples: MaterialExample[] }>
}

export type MediaKind = 'video' | 'animation' | 'image'

/** 理科配图绘图工程类型（静态 SVG 配图，见绘图模块规格） */
export type DrawEditorType = 'jsxgraph' | 'fabric-chem' | 'ketcher' | 'fabric-general'

export interface OrgMedia {
  id: number
  name: string
  kind: MediaKind
  subject: string
  knowledge: string[]
  sizeMb: number
  durationSec?: number
  linkedCount: number
  owner: string
  createdAt: string
  /** 可引用地址（题目正文里的图片即引用此地址）；无字节的存量记录不带该字段 */
  url?: string
  mime?: string
  /** 绘图工程：来源编辑器类型（存草稿时已有，纯上传的图片不带） */
  editorType?: DrawEditorType
  /** 绘图工程原始数据（jsxgraph / fabric 的 project JSON 字符串） */
  projectJson?: string
  /** Ketcher 分子工程（molfile V2000 文本） */
  molfileText?: string
}

export interface FileFolder {
  id: number
  name: string
  parentId: number | null
}

export type OrgFileKind = 'pdf' | 'word' | 'image' | 'ppt' | 'zip'

export interface OrgFile {
  id: number
  name: string
  kind: OrgFileKind
  folderId: number
  sizeMb: number
  recognize: 'none' | 'recognizing' | 'done' | 'failed'
  owner: string
  uploadedAt: string
}

/* ================ 讲义课件（FR-JC-005 ~ 012） ================ */

export type TeachDocKind = 'lecture' | 'courseware' | 'plan' | 'guide'

export const TEACH_KIND_TEXT: Record<TeachDocKind, string> = {
  lecture: '讲义',
  courseware: '课件',
  plan: '教案',
  guide: '学案',
}

/** 讲义的段落类型：与教研云 / 菁优网的「教辅模板」对齐 */
export type LectureBlockKind = 'goal' | 'explain' | 'example' | 'practice' | 'summary' | 'homework' | 'text'

export const LECTURE_BLOCK_TEXT: Record<LectureBlockKind, string> = {
  goal: '学习目标',
  explain: '知识点讲解',
  example: '典型例题',
  practice: '随堂练习',
  summary: '课堂小结',
  homework: '课后作业',
  text: '自由段落',
}

/** 学案专属段落：学生用，强调「先学后教」，与讲义的段落类型互不干扰 */
export type GuideBlockKind = 'preview' | 'explore' | 'check' | 'extend' | 'text'

export const GUIDE_BLOCK_TEXT: Record<GuideBlockKind, string> = {
  preview: '预习导学',
  explore: '课堂探究',
  check: '达标检测',
  extend: '拓展提升',
  text: '自由段落',
}

/** 段落类型的全集：`TeachDoc.blocks` 用它，讲义 / 学案各取自己那份字典渲染 */
export type BlockKind = LectureBlockKind | GuideBlockKind

/** 段落类型全集字典：列表 / 预览要按任意段落类型取名称，用各自的字典会漏 */
export const BLOCK_KIND_TEXT: Record<BlockKind, string> = {
  ...LECTURE_BLOCK_TEXT,
  preview: '预习导学',
  explore: '课堂探究',
  check: '达标检测',
  extend: '拓展提升',
}

export interface LectureBlock {
  id: number
  kind: BlockKind
  title: string
  /** 富文本正文（与题目题干同一套富文本格式，支持公式 / 图片） */
  body: string
  /** 例题 / 随堂练习引用的题库题目 */
  questionIds: number[]
}

/* ================ 教案（教学设计） ================ */

/** 教学过程的环节类型 */
export type PlanStepKind = 'lead' | 'teach' | 'consolidate' | 'summary' | 'homework' | 'free'

export const PLAN_STEP_TEXT: Record<PlanStepKind, string> = {
  lead: '情境导入',
  teach: '新知探究',
  consolidate: '巩固应用',
  summary: '课堂小结',
  homework: '作业布置',
  free: '自定义环节',
}

/**
 * 教案的教学过程是以「环节」为单位的，每个环节都要写清教师活动 / 学生活动 / 设计意图
 * —— 这是教案与讲义的本质区别：讲义写「讲什么」，教案写「怎么教、为什么这么教」。
 */
export interface PlanStep {
  id: number
  kind: PlanStepKind
  title: string
  /** 教师活动 */
  teacher: string
  /** 学生活动 */
  student: string
  /** 设计意图 */
  intent: string
  /** 时间分配（分钟） */
  minutes: number
  /** 本环节用到的题目（例题 / 巩固练习） */
  questionIds: number[]
}

/** 教案专属结构：三维目标 + 重难点 + 教学过程 + 板书 + 反思 */
export interface PlanDetail {
  /** 三维教学目标 */
  objectives: { knowledge: string; process: string; emotion: string }
  /** 教学重点 */
  keyPoints: string
  /** 教学难点 */
  hardPoints: string
  /** 教学方法（讲授 / 探究 / 合作 …） */
  methods: string[]
  /** 教具与媒体 */
  aids: string[]
  /** 课时数 */
  periods: number
  steps: PlanStep[]
  /** 板书设计 */
  blackboard: string
  /** 教学反思（课后填写） */
  reflection: string
}

/** 课件版式：封面 / 要点 / 图文 / 例题 / 章节过渡 / 结束页 */
export type SlideLayout = 'cover' | 'bullets' | 'image' | 'question' | 'section' | 'end'

export const SLIDE_LAYOUT_TEXT: Record<SlideLayout, string> = {
  cover: '封面',
  bullets: '要点页',
  image: '图文页',
  question: '例题页',
  section: '过渡页',
  end: '结束页',
}

export interface CoursewareSlide {
  id: number
  layout: SlideLayout
  title: string
  subtitle?: string
  bullets: string[]
  /** 讲稿备注（放映时对教师可见，不投屏） */
  note: string
  /** 例题页引用的题库题目 */
  questionId?: number
}

/**
 * 讲义 / 课件统一模型。
 *
 * 两者共用一套元数据（名称 / 学科 / 年级 / 知识点 / 归属），差别只在正文结构：
 * 讲义是 `blocks`（段落流），课件是 `slides`（分页）。合成一个模型而不是两张表，
 * 是因为列表、筛选、权限、回收站这些逻辑对两者完全一致，分成两个模型只会到处写 if。
 */
export interface TeachDoc {
  id: number
  kind: TeachDocKind
  name: string
  subject: string
  grade: string
  textbook?: string
  knowledge: string[]
  status: 'draft' | 'published'
  blocks: LectureBlock[]
  slides: CoursewareSlide[]
  /** 教案专属结构（kind === 'plan' 时存在） */
  plan?: PlanDetail
  owner: string
  updatedAt: string
  views: number
  sharedSquare: boolean
}

/* ================ 考试与阅卷 ================ */

/** 阅卷状态：未阅 / 已阅 / 缺考 / 违纪 */
export type AnswerStatus = 'pending' | 'graded' | 'absent' | 'cheat'

export const ANSWER_STATUS_TEXT: Record<AnswerStatus, string> = {
  pending: '待阅',
  graded: '已阅',
  absent: '缺考',
  cheat: '违纪',
}

/** 一次考试：由一份试卷下发到若干班级产生 */
export interface ExamSession {
  id: number
  name: string
  paperId: number
  paperName: string
  subject: string
  grade: string
  /** 参考班级 */
  classes: string[]
  studentCount: number
  examAt: string
  status: 'preparing' | 'grading' | 'finished'
  /** 总分 */
  fullScore: number
  /** 阅卷分工 */
  duties: GradingDuty[]
  createdBy: string
  updatedAt: string
}

/** 阅卷分工：按大题分给若干阅卷人，可选单评 / 双评 */
export interface GradingDuty {
  id: number
  /** 大题标题 */
  sectionTitle: string
  questionIds: number[]
  graders: string[]
  /** 单评：一人定分；双评：两人给分，分差超限进仲裁 */
  mode: 'single' | 'double'
  done: number
  total: number
}

/** 单题作答 */
export interface AnswerItem {
  questionId: number
  /** 卷面序号（全局第几题） */
  qIndex: number
  sectionTitle: string
  type: string
  knowledge: string[]
  /** 本题满分 */
  full: number
  score: number
  answer: string
  correct: boolean
}

/** 一份答卷 */
export interface ExamAnswer {
  id: number
  sessionId: number
  student: string
  className: string
  items: AnswerItem[]
  total: number
  status: AnswerStatus
  /** 异常备注 */
  remark?: string
}

/* ================ 试卷分析 / 学情反馈 ================ */

export interface AnalysisQuestionStat {
  questionId: number
  qIndex: number
  sectionTitle: string
  type: string
  knowledge: string[]
  full: number
  avg: number
  /** 得分率 */
  scoreRate: number
  /** 难度系数（得分率，0~1，越大越易） */
  difficulty: number
  /** 区分度（高分组得分率 - 低分组得分率） */
  discrimination: number
  /** 客观题正确率 */
  correctRate: number
}

export interface PaperAnalysis {
  sessionId: number
  paperId: number
  paperName: string
  subject: string
  grade: string
  studentCount: number
  fullScore: number
  avg: number
  max: number
  min: number
  median: number
  stdDev: number
  passRate: number
  excellentRate: number
  /** 整卷难度系数 */
  difficulty: number
  /** 整卷区分度 */
  discrimination: number
  /** 分数段分布 */
  bands: Array<{ label: string; min: number; max: number; count: number }>
  questions: AnalysisQuestionStat[]
  /** 知识点得分率 */
  knowledge: Array<{ name: string; scoreRate: number; count: number }>
  /** 班级对比 */
  classes: Array<{ name: string; count: number; avg: number; passRate: number; excellentRate: number }>
  /** 讲评建议（据得分率自动生成） */
  suggestions: string[]
}

/* ================ 错题本 ================ */

export type MistakeMastery = 'weak' | 'improving' | 'mastered'

export const MISTAKE_MASTERY_TEXT: Record<MistakeMastery, string> = {
  weak: '未掌握',
  improving: '巩固中',
  mastered: '已掌握',
}

/** 错误原因（教研云的错题分类口径） */
export const MISTAKE_REASONS = ['概念不清', '方法不当', '计算失误', '审题偏差', '表达不规范', '时间不足'] as const

export interface MistakeEntry {
  id: number
  questionId: number
  /** 归属：班级错题本用班级名，个人错题本用学生名 */
  scope: string
  /** 来源：考试名 / 作业名 */
  source: string
  student?: string
  wrongAnswer: string
  wrongCount: number
  reason: string
  mastery: MistakeMastery
  /** 重练次数 */
  practiced: number
  note: string
  addedAt: string
  lastWrongAt: string
}

/* ================ 集体备课（协同教研） ================ */

export type PrepTaskStatus = 'draft' | 'ongoing' | 'review' | 'done'

export const PREP_TASK_STATUS_TEXT: Record<PrepTaskStatus, string> = {
  draft: '草稿',
  ongoing: '备课中',
  review: '研讨中',
  done: '已定稿',
}

export interface PrepMember {
  name: string
  /** 分工：教学目标 / 过程设计 / 例题选取 / 作业设计 … */
  duty: string
  status: 'pending' | 'working' | 'submitted'
  online: boolean
  lastActive: string
}

export interface PrepComment {
  id: number
  author: string
  at: string
  body: string
  /** 针对哪一版 / 哪一环节 */
  target: string
}

export interface PrepVersion {
  id: number
  no: number
  author: string
  at: string
  summary: string
  /** 该版正文快照（JSON 字符串） */
  snapshot: string
  replaced?: boolean
}

/** 集体备课任务：共备一份教案 / 课件，分工撰写、互相批注、版本对比、定稿 */
export interface PrepTask {
  id: number
  name: string
  subject: string
  grade: string
  /** 关联的备课文档（教案 / 课件 / 讲义） */
  docKind?: TeachDocKind
  docId?: number
  docName: string
  requirement: {
    topic: string
    goal: string
    keyPoints: string
    hardPoints: string
    deadline: string
    note: string
  }
  members: PrepMember[]
  comments: PrepComment[]
  versions: PrepVersion[]
  status: PrepTaskStatus
  owner: string
  updatedAt: string
}

/* ================ 校本资源库与审批流 ================ */

export type ResourceScope = 'personal' | 'group' | 'school' | 'public'

export const RESOURCE_SCOPE_TEXT: Record<ResourceScope, string> = {
  personal: '个人',
  group: '备课组',
  school: '校本',
  public: '公开',
}

export type ApprovalStatus = 'pending' | 'approved' | 'rejected'

export const APPROVAL_STATUS_TEXT: Record<ApprovalStatus, string> = {
  pending: '待审批',
  approved: '已通过',
  rejected: '已驳回',
}

export type ApprovalKind = '题目' | '试卷' | '讲义' | '课件' | '教案' | '学案' | '视频'

/** 提审单：资源从个人 → 备课组 → 校本 → 公开，逐级审批 */
export interface ResourceApproval {
  id: number
  kind: ApprovalKind
  name: string
  subject: string
  grade: string
  scope: ResourceScope
  applicant: string
  submittedAt: string
  status: ApprovalStatus
  reviewer?: string
  reviewedAt?: string
  opinion?: string
  logs: Array<{ at: string; by: string; action: string; note?: string }>
}

/* ================ 微课与视频切片 ================ */

/** 视频切片：在一条视频上按时间打点，标注知识点并关联题目 */
export interface VideoClip {
  id: number
  mediaId: number
  mediaName: string
  title: string
  /** 起止时间（秒） */
  start: number
  end: number
  knowledge: string[]
  questionIds: number[]
  note: string
  createdBy: string
  createdAt: string
}

/* ================ 作业系统 ================ */

export type HomeworkStatus = 'assigned' | 'ongoing' | 'closed'

export const HOMEWORK_STATUS_TEXT: Record<HomeworkStatus, string> = {
  assigned: '已布置',
  ongoing: '进行中',
  closed: '已截止',
}

export interface Homework {
  id: number
  name: string
  subject: string
  grade: string
  /** 来源试卷（可选，整卷作为作业） */
  paperId?: number
  paperName?: string
  questionIds: number[]
  classes: string[]
  assignAt: string
  deadline: string
  require: string
  status: HomeworkStatus
  submitted: number
  total: number
  owner: string
  updatedAt: string
}

export interface HomeworkSubmission {
  id: number
  homeworkId: number
  student: string
  className: string
  submittedAt: string
  status: 'submitted' | 'late' | 'missing'
  score?: number
  correctRate?: number
  wrongQuestionIds: number[]
  comment?: string
}

/* ================ 全局搜索（FR-GN-026） ================ */

/**
 * 一次检索返回各资源分类，机构端搜索面板按分类页签展示。
 * 分类与机构端资源一一对应：同步备课 = 教辅资料，视频 = 多媒体中的 video 资源。
 */
export interface OrgSearchResult {
  /** 题目（题干 / 知识点命中） */
  questions: OrgQuestion[]
  /** 试卷（卷名 / 学科 / 年级命中） */
  papers: OrgPaper[]
  /** 同步备课资料（教辅：名称 / 类型 / 章节命中） */
  preparations: OrgMaterial[]
  /** 微课视频（多媒体资源） */
  videos: OrgMedia[]
  /** 我的文件（文件名 / 上传人命中） */
  files: OrgFile[]
}

/* ================ 题库组卷工作台：AI 检索意图 ================ */

/**
 * AI 搜索把一句话（或一张图）解析成的结构化检索条件。
 *
 * 为什么不让 AI 直接返回资源列表：机构端资源量很小且已在前端全量持有（题目/试卷/教辅/媒体
 * 各自一次拉全），让模型去「记住」资源既不现实也会幻觉出不存在的题号。模型只负责把自然语言
 * 翻译成条件，筛选仍由前端在同一份真实数据上做 —— 检索结果因此永远可回溯、可复现。
 */
export interface ComposeSearchIntent {
  /** 检索关键词（区分度最高的学科核心概念，2-8 字，最多 3 个）；空数组表示未识别出可检索内容 */
  keywords: string[]
  /** 学科；无法判断为空串 */
  subject: string
  /** 年级；无法判断为空串 */
  grade: string
  /** 题型，取值限于 单选题 / 多选题 / 判断题 / 填空题 / 解答题；未提及为空数组 */
  questionTypes: string[]
  /** 难度，取值限于 容易 / 较易 / 中等 / 较难 / 困难；未提及为空串 */
  difficulty: string
  /** 教材知识点标签；不确定为空数组 */
  knowledge: string[]
  /** 面向教师的一句话解读（≤30 字），用于在界面上回显「AI 理解成了什么」 */
  reason: string
}

export interface StandardFormula {
  id: number
  name: string
  branch: string
  chapter: string
  latex: string
  collected: boolean
  /** 知识点叶子 tag（与所选教材树的 OrgKnowledgeNode.tag 一致），用于知识点过滤 */
  knowledge: string[]
}

export type FormulaScope = 'mine' | 'shared'

export interface OrgFormula {
  id: number
  name: string
  /** 学科（租户字典 subject），我的公式页签 / 编辑器默认筛选用，保存时必填 */
  subject: string
  /** 细分类（数列/解析几何…），新建默认「未分类」，不再单独编辑 */
  category: string
  latex: string
  scope: FormulaScope
  status: 'pending' | 'approved' | 'rejected' | 'off'
  owner: string
  updatedAt: string
}

export interface OrgPrompt {
  id: number
  name: string
  scene: string
  content: string
  status: 'enabled' | 'disabled'
  isDefault: boolean
  remark?: string
  updatedAt: string
  versions: Array<{ version: number; savedAt: string; content: string }>
}

export interface SquareResource {
  id: number
  title: string
  kind: '题目' | '试卷' | '教辅' | '视频' | '动画'
  subject: string
  knowledge: string
  sharer: string
  org: string
  collects: number
  downloads: number
  collected: boolean
  desc: string
}

export type StaffRole = '管理员' | '审核员' | '老师' | string

export interface StaffMember {
  id: number
  name: string
  phone: string
  role: StaffRole
  campus: string
  enabled: boolean
  pendingReviews: number
  lastLoginAt: string
}

export interface OrgRole {
  id: number
  name: string
  builtin: boolean
  locked: boolean
  perms: Record<string, string[]>
}

export interface Campus {
  id: number
  name: string
  code: string
  address: string
  manager: string
  staffCount: number
  enabled: boolean
}

export interface OrgOperationLog {
  id: number
  account: string
  module: string
  action: string
  target: string
  ok: boolean
  time: string
}

export interface NotifyMatrixRow {
  key: string
  label: string
  inApp: boolean
  sms: boolean
  email: boolean
}

export interface RecycleItem {
  id: number
  kind: '题目' | '试卷' | '教辅' | '文件' | '讲义' | '课件' | '教案' | '学案' | '协同组卷任务' | '集体备课' | '作业'
  name: string
  deletedBy: string
  deletedAt: string
  remainDays: number
  ownerId: number
}

export interface OrgMessage {
  id: number
  tab: 'todo' | 'review' | 'collab' | 'system'
  title: string
  summary: string
  module: string
  time: string
  read: boolean
  /** 消息跳转目标路径 */
  link: string
}

export interface GeneratedQuestion {
  id: string
  stem: string
  options: string[]
  answer: string
  analysis: string
  knowledge: string[]
  difficulty: string
  /** 拍照识别场景由模型判定的学科 / 年级（AI 出题场景由表单传入，不填） */
  subject?: string
  grade?: string
}
