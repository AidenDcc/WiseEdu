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

export type DictTypeKey = 'subject' | 'grade' | 'term' | 'questionType' | 'difficulty' | 'examType'

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
  kind: '题目' | '试卷' | '教辅' | '文件'
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
