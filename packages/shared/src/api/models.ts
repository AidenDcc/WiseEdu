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
    /** 机构编码：与入驻审核列表的「机构编号」同一口径（`T` 开头），不用申请单号 */
    code: string
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

/**
 * 用户ID。真实后端返回的是 sys_user 的雪花ID（19 位），超出 JS Number.MAX_SAFE_INTEGER，
 * 只能当字符串传；Mock 模式仍是数字。凡是要与登录用户 id 做等值比较的字段都用这个类型，
 * 比较前记得 String() 归一化。
 */
export type UserId = string | number

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

/**
 * 资质材料分类。新增机构时按这三类分组上传，申请审核与机构详情里也按这三类分组展示。
 * 数组顺序即界面顺序（营业执照 → 许可证 → 法人信息），所以用数组常量而不是枚举。
 */
export type CertCategory = 'license' | 'permit' | 'legal'

export const CERT_CATEGORIES: CertCategory[] = ['license', 'permit', 'legal']

export const CERT_CATEGORY_TEXT: Record<CertCategory, string> = {
  license: '营业执照',
  permit: '许可证',
  legal: '法人信息',
}

/** 资质材料。演示环境只登记文件名与分类，不保存文件内容本身 */
export interface CertFile {
  name: string
  type: 'pdf' | 'img'
  category: CertCategory
}

export interface TenantApply {
  id: number
  applyNo: string
  /**
   * 机构编号：申请创建时生成（`T` + 日期 + 序号），审核通过开通租户时**原样沿用**为
   * 租户 `code` —— 同一机构从申请到租户全程只有一个编号，列表的「机构编号」列读它。
   */
  code: string
  orgName: string
  orgType: string
  stages: string[]
  contact: string
  phone: string
  email?: string
  /** 所在地区（省市区连着写，如「湖北省武汉市江岸区」）；审核通过后原样写进租户的 `city` */
  city?: string
  /** 机构详细地址（与 `city` 分开：city 是所在地区，这里是门牌级地址） */
  address?: string
  intro?: string
  certFiles: CertFile[]
  submittedAt: string
  waitingHours: number
  status: ApplyStatus
  /** 审核时间 / 操作人：通过或驳回时盖章，待审核为空（审核留痕） */
  reviewedAt?: string
  reviewer?: string
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
  /** 机构详细地址（门牌级），与 `city`（所在城市）分开两份数据 */
  address: string
  intro: string
  /** 机构资质档案（入驻时提交，随租户留存） */
  certFiles: CertFile[]
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
  /* 近 6 个自然月（「半年」那张图），是下面 aiDaily 的后 6 段 */
  aiMonthly: {
    months: string[]
    calls: number[]
  }
  /* 按天的调用量，覆盖近 12 个自然月（比 aiMonthly 的 6 个月宽，详情页的月份日历拿它标「有数据」）。
     每项都摊满该月天数：下标 i 即该月第 i+1 日，当月的未来日子补 0。
     两种粒度共用同一份月总量，所以各天之和（0 不加分）恰好等于该月的月值 */
  aiDaily: Array<{
    month: string
    calls: number[]
  }>
}

/* ================ 全局字典（FR-PT-015 / 016） ================ */

/**
 * 字典类型键。
 *
 * 管理端按维护入口把类型分成两组（见 admin-store 的 `BASE_DICT_TYPES` / `SYSTEM_DICT_TYPES`）：
 * 「基础字典」管业务字典，`copyright`（机构端首页页脚文案，每条 name 为一段 —— 版权主体 /
 * 备案号 / 客服方式 …，按排序拼接展示）单独归「系统数据字典」。
 */
export type DictTypeKey =
  | 'subject'
  | 'grade'
  | 'term'
  | 'questionType'
  | 'difficulty'
  | 'examType'
  | 'copyright'
  /* 题库筛选维度：杯赛名称、题目来源地区（地区与考纲字典，见大纲 P-04-05） */
  | 'competition'
  | 'region'

export interface DictItem {
  id: number
  name: string
  /** 编码（学科 / 年级 / 题型 / 地区必填。前三种创建后不可改；地区的行政区划代码允许编辑订正） */
  code?: string
  sort: number
  enabled: boolean
  /** 被机构引用数（>0 时禁止删除，仅可停用） */
  refCount: number
  /**
   * 类型特有字段：grade=学段；term=学年/学期/起止；questionType=作答类型；difficulty=系数。
   *
   * examType 的字典项由「考试类型」树投影写入（见 `ExamTypeNode`），这里的
   * `stage` 在它上面表示**适配学段**：留空 = 全学段通用，有值 = 只在机构端选到该学段时
   * 才出现在试卷类型树 / 筛选条件里。管理端不再直接编辑它。
   */
  stage?: string
  year?: string
  termHalf?: string
  dateFrom?: string
  dateTo?: string
  answerType?: string
  coefficient?: number
  /**
   * 适用学科：questionType = 学科专属题型，examType = 适配学科（同样由「考试类型」树投影写入）。
   * 留空 = 全学科通用；有值 = 只在机构端选到这些学科时才出现。
   * （如「完形填空」只属于英语，「物理竞赛」只在物理下出现。）
   */
  subjects?: string[]
  /**
   * 适配年级（仅 subject 使用）：留空 = 不限年级；有值 = 只在这些年级下可选。
   * 取值是年级字典项的 name（与 `subjects` 用名字而非 id 同口径）。
   */
  grades?: string[]
  /**
   * 试卷分类（仅 examType，取值见 `PAPER_CATEGORIES`）：组卷工作台「试卷」页签
   * 左侧那棵试卷类型树的第一级。由「考试类型」树投影写入 —— 值就是该项所属
   * 一级根节点的名字，因此不会留空。
   */
  paperCategory?: string
}

/**
 * 试卷分类：组卷工作台「试卷」页签左树的四个一级分组，也是「考试类型」树四个
 * 一级节点的名字（`ExamTypeNode.name`）。定义在这里而不是管理端页面里 ——
 * 树的根、工作台树的顺序、种子数据的分组共用同一份，各写一份必然对不上。
 */
export const PAPER_CATEGORIES = ['同步教学', '阶段测试', '小升初', '竞赛'] as const
export type PaperCategory = (typeof PAPER_CATEGORIES)[number]

/* 知识点/考点树（最多 6 级） */
export interface KnowledgeNode {
  id: number
  parentId: number | null
  name: string
  subject: string
  enabled: boolean
}

/**
 * 考试类型树（最多 5 级）：合并了原先基础字典里的「考试类型」与「杯赛」两个平铺列表。
 *
 * 四个一级节点就是 `PAPER_CATEGORIES`（根节点的 `name` 即 `paperCategory` 值），
 * 它们由机构端组卷「试卷类型树」的分组口径决定，不在本树上增删改。
 *
 * `kind` 是合并的关键：竞赛根下同时挂着考试类型（数学竞赛 / 物理竞赛）与杯赛
 * （华罗庚金杯…），靠它分流回机构端的 `examType` / `competition` 两个只读字典——
 * 少了这个字段，杯赛会被混进机构端的试卷类型树。
 */
export type ExamTypeNodeKind = 'category' | 'examType' | 'competition'

export interface ExamTypeNode {
  id: number
  /** null = 四个试卷分类根 */
  parentId: number | null
  name: string
  kind: ExamTypeNodeKind
  enabled: boolean
  /** 被题目引用数（>0 时禁止删除，仅可停用） */
  refCount: number
  /** 适配学段（仅 kind === 'examType'）：留空 = 全学段通用 */
  stage?: string
  /** 适配学科（仅 kind === 'examType'）：留空 = 全学科通用 */
  subjects?: string[]
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

/**
 * 管理端角色标识 = `AdminRoleRecord.code`。
 *
 * 从原先写死的 `'super' | 'ops'` 放宽成 `string`：角色改由「角色权限」页维护，
 * 值是用户自建的 code，编译期给不出有限集合。`'super'` 仍是内置超级管理员的 code，
 * 代码里比较它时用 `ADMIN_SUPER_ROLE_CODE` 常量，别散落字面量。
 */
export type AdminRole = string

export interface AdminAccount {
  id: number
  account: string
  name: string
  role: AdminRole
  enabled: boolean
  lastLoginAt: string
}

/**
 * 管理端角色。
 *
 * `permissions` 存可见菜单的 `AdminMenuItem.path` 列表；`['*']` 表示不受限（内置超级管理员）。
 * 分组节点（有 children 的菜单）不在列表里 —— 是否显示分组由「组内是否有可见叶子」推导。
 */
export interface AdminRoleRecord {
  id: number
  /** 角色标识，账号表的 `role` 存它；创建后不可改 */
  code: string
  name: string
  desc: string
  /** 内置角色不可删除 */
  builtin: boolean
  enabled: boolean
  permissions: string[]
  /** 引用该角色的管理员数（>0 时禁止删除） */
  memberCount: number
}

/**
 * 管理端菜单树节点（扁平结构，`parentId` 串起层级，与 `ExamTypeNode` / `KnowledgeNode` 同模型）。
 *
 * 分组节点有 `children`（即别的节点以它为 parentId）而无子节点时 `path` 仅作占位。
 * 它是「菜单管理」页与左侧边栏的**唯一事实源** —— 早先菜单写死在 `apps/admin/src/menu.ts`，
 * 改不动也看不见。
 */
export interface AdminMenuItem {
  id: number
  parentId: number | null
  title: string
  /** 叶子为路由路径（唯一）；分组节点为分组占位路径 */
  path: string
  icon?: string
  sort: number
  enabled: boolean
  /** 种子节点标记（界面上给出「内置」提示） */
  builtin: boolean
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

/**
 * 题目状态。`offline`（已下架）是终态的旁支：题目仍留在机构题库里、可随时上架，
 * 但退出可组卷池 —— 仓内「能否入卷」的判断统一是 `status === 'approved'`，加这一档
 * 后各处自动生效，无需逐个补判断。
 */
export type QuestionStatus = 'draft' | 'checking' | 'pending' | 'approved' | 'rejected' | 'offline'
export type QuestionSource = '手动录入' | 'AI 出题' | 'AI 变式' | '拍照识别' | '文档导入' | '教辅导入' | '名校考试'
/**
 * 来源的候选取值（与 `QuestionSource` 同值域）。
 *
 * 之所以给一份「值」而不只是「类型」：筛选项与录题表单都需要下拉候选，
 * 原先组卷工作台自己抄了一份 `QUESTION_SOURCES`，加取值时必然漏改一处。
 */
export const QUESTION_SOURCE_OPTIONS: QuestionSource[] = [
  '手动录入',
  'AI 出题',
  'AI 变式',
  '拍照识别',
  '文档导入',
  '教辅导入',
  '名校考试',
]
export type QuestionLibrary = 'personal' | 'org' | 'wrong'

export interface AiCheckResult {
  name: string
  pass: boolean
  note: string
  fixed?: string
}

/** 填空题的一空：标准答案 + 等价写法，两者都是富文本（可含公式 / 图片） */
export interface FillBlankAnswer {
  /** 该空的标准答案 */
  value: string
  /** 等价写法（多个以顿号 / 逗号分隔），没有则为空串 */
  equivalents: string
}

/**
 * 选项排布：1 = 单行显示（每行一个，缺省），2 = 一行 2 个，4 = 一行 4 个。
 * 与 `OrgQuestion.optionColumns` 同一个口径，四处编辑入口（录题中心 / AI 出题 / 图片识题 /
 * 文档识别）写进去的必须是同一个联合类型，故放在这里由 models 统一给出。
 */
export type OptionColumns = 1 | 2 | 4

/**
 * 拍照识别结果的校对改动：图片识题结果卡片的「编辑」保存后，随决策一并提交给
 * `decidePhotoResult`。
 *
 * 每个字段都是**选填**，语义是「教师改过才带」：`undefined` = 没动，保留识别原值。
 * 题型 / 难度 / 知识点以前要么改不了、要么改了也不落库（`decidePhotoResult` 从没写过），
 * 现在一并回传并由决策链路落回结果行。
 */
export interface PhotoResultEdit {
  stem?: string
  options?: string[]
  answer?: string
  analysis?: string
  subject?: string
  grade?: string
  type?: string
  difficulty?: string
  knowledge?: string[]
  optionColumns?: OptionColumns
  fillAnswers?: FillBlankAnswer[]
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
  ownerId: UserId
  owner: string
  options: string[]
  answer: string
  analysis: string
  /**
   * 选项排布。仅选择题 / 多选题使用；试卷侧作为「题目级覆盖」，缺省时回落到纸张预设的列数。
   */
  optionColumns?: OptionColumns
  /**
   * 填空题各空的答案（富文本，可含公式 / 图片）。缺省表示存量题 —— 此时从 `answer`
   * 按「｜」拆分回退，见 CreateView 的载入分支。`answer` 仍是各空纯文本的连接串，
   * 供列表 / 试卷 / 导出等既有渲染端直接展示。
   */
  fillAnswers?: FillBlankAnswer[]
  variantOf?: number
  useCount: number
  updatedAt: string
  /** 学期（上学期 / 下学期） */
  term?: string
  /** 考试类型（字典表 examType） */
  examType?: string
  /** 杯赛名称（字典表 competition），非杯赛题为空 */
  competition?: string
  /** 题目来源地区（字典表 region） */
  region?: string
  aiChecks?: AiCheckResult[]
  aiSuspects?: string[]
  reviewOpinion?: string
  /** 终审人（审核中心历史记录展示用） */
  reviewer?: string
  /** 终审时间 */
  reviewedAt?: string
}

/**
 * 题目纠错类型（教师反馈题目问题，可多选）。
 *
 * 是**问题分类**而不是题目属性，所以不落在 OrgQuestion 上：反馈只负责「说清哪里不对」，
 * 真正的改题仍在录题中心（题库治理动作），两者靠 questionId 关联。
 */
export const QUESTION_CORRECTION_TYPES = [
  '题干错误',
  '答案错误',
  '解析错误',
  '知识体系不符',
  '图片错误',
  '补充解析',
  '主客观有误',
  '公式乱码',
  '其他',
] as const
export type QuestionCorrectionType = (typeof QUESTION_CORRECTION_TYPES)[number]

/** 题目纠错记录：组卷工作台提交，题库治理侧处理 */
export interface QuestionCorrection {
  id: number
  questionId: number
  /** 问题类型，多选，取值见 QUESTION_CORRECTION_TYPES */
  types: QuestionCorrectionType[]
  /** 问题描述（富文本，与题干同一套编辑器，可含公式 / 图片） */
  description: string
  reporter: string
  createdAt: string
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
  ownerId: UserId
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

/**
 * 试卷随附的参考资料。
 *
 * 组卷工作台的资源页签（图片 / 视频 / 小程序）可以把媒体加进组卷车，车里的资源**不参与卷面**
 * （不加分、不归大题、不打印），而是跟着试卷一起存下来，供出好卷之后配套使用 ——
 * 故走 `OrgPaper.attachments` 而不是塞进 `PaperSection.questions`（那里的 id 空间是题库题目）。
 *
 * `name` / `sizeMb` 是冗余存的：媒体库里的资源被删除或改名后，试卷上仍要能说清当初附了什么。
 */
export interface PaperAttachment {
  /** 媒体库资源 id（`OrgMedia.id`） */
  mediaId: number
  kind: MediaKind
  name: string
  sizeMb: number
}

/** 卷面附加区块的三种形态：表格 / 四线格 / 横线 */
export type PaperExtraKind = 'table' | 'english' | 'lines'

/**
 * 卷面附加区块（FR-PP：试卷编辑「插入」）。
 *
 * 它们**不属于任何大题**：没有题号、不计分、不参与总分，只是印在卷面上供学生作答的格子
 * （表格题、英语书写、通用横线）。故与 `attachments` 同理，走 `OrgPaper.extras` 单开一个字段，
 * 而不是塞进 `PaperSection.questions`（那里的 id 空间是题库题目）。
 *
 * 存在顺序：数组顺序即卷面上的先后顺序，统一排在各答题区之后（见 PaperEditView 的 paperBlocks）。
 */
export interface PaperExtra {
  /** 块内唯一 id（同一张卷里区分两个「表格」） */
  id: number
  kind: PaperExtraKind
  /** 表格行数 / 四线格组数 / 横线条数 */
  rows: number
  /** 只有表格用得上；四线格与横线都是通栏，此值无意义（留 1） */
  cols: number
}

export type PaperStatus = 'draft' | 'aiReview' | 'pending' | 'approved' | 'rejected'

/** 试卷来源的候选取值（新建试卷按入口自动标记；试卷库「来源」筛选用同一份） */
export const PAPER_SOURCE_OPTIONS = ['手动组卷', '协同组卷', 'AI 组卷', '真题导入', '文档识别'] as const
export type PaperSource = (typeof PAPER_SOURCE_OPTIONS)[number]

/**
 * 年份筛选里「更早以前」的哨兵值。
 *
 * 它不是年份，只是年份行里的一个取值：「2026 年」和「更早以前」可以同时选中
 * （= 2026 年的卷，或比近三届更早的卷）。故意取一个不可能与真实年份相撞的字符串。
 *
 * 定义在 shared 而不是组卷工作台的 types.ts：**mock 也要判它**（智能组卷按
 * 「优先年份」给题打分，见 org-store 的 aiComposePaper），而 mock 不能反向 import 租户端代码。
 * 前端那三处仍从 `views/paper/compose/types.ts` 导入（那里 re-export，路径不变）。
 */
export const EARLIER_YEAR = 'earlier'

/** 年份行里单列的最新几届：更早的年份都并进「更早以前」，这一行才不会年年越铺越长 */
export const RECENT_YEAR_COUNT = 3

/**
 * 年份是否落在「更早以前」这一档（比最近三届更早）。
 *
 * 阈值取自**当前年份**而不是卷池：谓词逐行判定，拿不到「这一屏里有哪些年份」；
 * 若按卷池推导，同一份卷会在卷池变化时改变归属，「更早以前」就不再是一个稳定档位。
 * 空年份（没有年份的卷）不算 —— 与其它可缺省维度同一口径：缺省值不命中任何档。
 */
export function isEarlierYear(year: string | undefined): boolean {
  if (!year) return false
  return Number(year) < new Date().getFullYear() - RECENT_YEAR_COUNT + 1
}

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
  /* ===== 筛选维度（口径同 OrgQuestion：难度 / 考试类型 / 杯赛 / 地区取字典表值） ===== */
  difficulty?: string
  examType?: string
  /** 杯赛名称（字典表 competition），非竞赛卷为空 */
  competition?: string
  region?: string
  source?: PaperSource
  /**
   * 试卷年份（4 位，如 `'2026'`）与月份（`'1'`-`'12'`，个位不补零）。
   *
   * 题目没有这两个维度，故只有试卷侧有筛选；取值不是字典而是**卷池里实际出现过的值**
   * （组卷工作台的分年份 / 月份候选项直接由卷池推导，见 PapersTab 的 yearOptions），
   * 因此不存在「选了必然为空」的选项。种子卷由 `seedPaperMeta` 填，新卷在 `savePaper` 里按保存时间填。
   */
  year?: string
  month?: string
  /* ===== 我的文件联动：个人创建的试卷必须落在一个文件夹里（见 savePaper / linkPaperFile） ===== */
  /** 存储位置（我的文件文件夹 id；0 = 根目录） */
  folderId?: number
  /** 关联的文件 id（「我的文件」里那份试卷文件的 id） */
  fileId?: number
  /** 浏览次数（试卷库「预览」累加；演示口径会话内有效，刷新还原） */
  viewCount?: number
  /** 下载次数（试卷库「导出 Word / PDF」累加） */
  downloadCount?: number
  parallelOf?: number
  parallelLabel?: string
  /** 随卷保存的参考资料（组卷车里的图片 / 视频 / 小程序），见 PaperAttachment */
  attachments?: PaperAttachment[]
  /**
   * 卷面附加区块（表格 / 四线格 / 横线），见 PaperExtra。数组顺序即卷面顺序。
   */
  extras?: PaperExtra[]
  /**
   * 卷首「注意事项」的自定义条目，一条一行。
   *
   * 存 `string[]` 而不是一整段文本：卷面上本来就是逐条缩进排的，拆好的条目在导出 Word / PDF
   * 时也能各自成段。空数组 = 老师把注意事项整段删了（卷面就不印这一块），
   * 与「没配过」（`undefined`，印内置默认稿）是两种状态，不要合并。
   */
  notices?: string[]
  sharedSquare: boolean
  aiChecks?: AiCheckResult[]
  aiSuspects?: string[]
  reviewOpinion?: string
  collaborators?: Array<{ name: string; perms: string[]; online: boolean }>
  dynamics?: Array<{ time: string; actor: string; action: string }>
}

/**
 * 智能组卷的输入参数（前端 → mock）。
 *
 * 前六个字段是「三步」里的选择；`knowledge` 与其余四维的口径不同，见各自的注释。
 */
export interface AiComposeParams {
  name: string
  subject: string
  grade: string
  /**
   * 知识点 tag，与题目 `knowledge` 同值域（取自知识点树叶子）。
   *
   * **硬条件**：命中其一的题一律排在未命中的之前（见 org-store 的抽题打分）。
   * 其余四维只是「优先」，题量不足时低分题会自动补上。
   */
  knowledge: string[]
  examType: string
  difficulty: string
  /** 优先地区。`'全国'` 是「不分地区」的哨兵，不去偏袒任何地区 */
  region: string
  /**
   * 优先年份，取值域与试卷筛选一致（可能是 `EARLIER_YEAR` 哨兵）。
   *
   * 题目本身**没有年份字段**，所以判据是「这道题被哪些已入库的卷用过、那些卷是哪一年的」。
   */
  year: string
  /** 卷面结构。只有题型与题量 —— 单题分值由 mock 按题型给默认值（老师不配分值） */
  structure: Array<{ type: string; count: number }>
  /** 试卷在「我的文件」中的存储位置；必填，漏传 mock 会拒绝 */
  folderId?: number
}

/**
 * 智能组卷的「我的模板」：一套组卷参数的存档。
 *
 * 不是用户手动「保存为模板」存下来的，而是**每次组卷成功后自动记一条** ——
 * 老师第二次想用同一套参数时通常已经忘了当初勾了哪些知识点，让系统替他记着比让他自己存可靠。
 * 因此列表的语义是「最近用过的组卷方案」，不是「收藏夹」（见 org-store 的 recordAiTemplate）。
 *
 * 只存档**输入参数**（去掉 folderId —— 那是每次出卷临时选的），不存产出的试卷：
 * 那份卷在「我的文件」里，有自己的 id。
 */
export interface AiComposeTemplate extends Omit<AiComposeParams, 'folderId'> {
  id: number
  /** 归属人。列表只展示、也只允许删除自己的（口径同全仓 owner，取自 mock 的 CURRENT.name） */
  owner: string
  /** 这套参数被用来组卷的次数：首次落库即 1，复用同参数再组卷 +1（复用动作本身不加） */
  useCount: number
  updatedAt: string
}

/* ================ 协同组卷（FR-PP-004 ~ 007 / 017 ~ 021） ================ */

/**
 * 任务状态：收题中 → 待验收 → 待送审 → 已送审 → 已完成 / 已驳回。
 *
 * 「待验收」与「待送审」必须分开：前者是「还差组长逐个点头」，后者是「点头完了，只等组长按提交」。
 * 合成一个「待审校」的话，收尾阶段界面上没有任何东西变化，组长看不出自己还能做什么。
 *
 * 送审之后的状态由 `reviewPaper()` 回写（见 org-store）—— 审核中心那几个动作是通用入口，
 * 不能让协同任务自己再维护一套审核状态，否则同一张卷会在两处显示成两种结果。
 */
export type CollabTaskStatus = 'collecting' | 'reviewing' | 'ready' | 'submitted' | 'done' | 'rejected'

export const COLLAB_STATUS_TEXT: Record<CollabTaskStatus, string> = {
  collecting: '收题中',
  reviewing: '待验收',
  ready: '待送审',
  submitted: '已送审',
  done: '已完成',
  rejected: '已驳回',
}

/** 任务处理人的状态；`accepted` 是终态，被组长验收通过后不再回到组卷中 */
export type CollabMemberStatus = 'invited' | 'working' | 'submitted' | 'accepted'

export const COLLAB_MEMBER_TEXT: Record<CollabMemberStatus, string> = {
  invited: '待接受',
  working: '组卷中',
  submitted: '已提交',
  accepted: '已验收',
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
  /**
   * 发起人「退回整改」的意见；只在被退回后存在，重新提交时清空。
   * 落在成员上而不是任务上：退回是**针对某个人**的（另一个人可能已经验收通过了），
   * 记到任务上会让所有人都看到一条与自己无关的整改意见。
   */
  reviewNote?: string
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
  /**
   * 查看者（机构员工姓名）：除处理人之外，额外允许查看本任务与试卷内容的人。
   *
   * **空数组 = 不限制**（本机构所有成员都能看），不是「谁都不能看」——
   * 组卷任务默认是开放的，只有担心题目提前泄露的发起人才会来这里圈一份名单，
   * 把空值理解成「零人可见」会让所有没设过的老任务一夜之间变成谁都打不开。
   */
  viewers: string[]
  versions: PaperVersion[]
  status: CollabTaskStatus
  createdAt: string
  /** 发起人 */
  owner: string
}

/**
 * 卷面评论：挂在**卷头**、**某个大题**或**某道题**上的一条评论。
 *
 * 为什么要 `target` + `questionId` 两个字段而不是统一挂 questionId：题型级评论说的是
 * 「这个题型的整体难度/覆盖面对不对」，题目级说的是「这道题的答案有没有问题」——
 * 前者没有对应的 questionId 可挂（大题不是题）。分开记还让目录行上的评论数不必去重。
 *
 * `head` 是第三个粒度：卷面的名称 / 分值 / 密封线这类版头信息也该能被说一句，
 * 它**不属于任何大题**，所以 `sectionId` 对它是空的（这也是 `sectionId` 可选的原因）。
 *
 * 一道题允许多人评论（同一 target 可以有多条），这也是没有用「一人一条」结构的原因。
 */
export interface PaperComment {
  id: number
  paperId: number
  target: 'head' | 'section' | 'question'
  /** 所在大题 id。题型级评论只能靠它定位到是哪一段（评论本身没有题目可挂）；`head` 不填 */
  sectionId?: number
  /** target === 'question' 时为题目 id；题型级与卷头级评论不填 */
  questionId?: number
  /** 评论人姓名 */
  author: string
  at: string
  body: string
  /**
   * 手动输入 / AI 检测生成 / 提交纠错时自动生成 —— 展示上要能区分：
   * AI 的要看得出是机器结论，纠错自动生成的那条不是谁敲进去的话。
   */
  source: 'manual' | 'ai' | 'correct'
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
  /** 置顶：排在同级目录/文件之前（列表与大图都按它先排） */
  pinned?: boolean
}

/**
 * 「我的文件」的文件类型 —— 按资源形态分三组（见 FILE_KIND_GROUPS），共 17 种。
 *
 * 各类型的来路是固定的：
 * - `doc`：平台内新建的在线文档（正文存平台，无本地副本）；
 * - `word` / `pdf` / `ppt` / `video` / `audio`：上传的文件；
 * - `image`：上传的图片，或 AI 产出（拍照识题、AI 配图）；
 * - `paper`：试卷库收录的成卷；`aiPaper` / `composePaper`：智能组卷与组卷工作台产出；
 * - `courseware` / `lecture`：备课中心的课件与讲义；
 * - `book`：教辅资料；`miniapp` / `animation` / `h5`：多媒体资源；
 * - `other`：认不出格式的其余文件（压缩包、表格、纯文本…），上传时的兜底档。
 *
 * 上传时不再拒绝陌生格式（见 mock/org-store 的 uploadFiles）：以前类型表里没有归宿，
 * 只能找个相近的类型硬塞，`.zip` 会被显示成「PDF文档」；现在一律落到 `other`，
 * 「其它文件」这个说法本身就是实情，用户按类型找得到自己的文件。
 */
export type OrgFileKind =
  | 'doc'
  | 'paper'
  | 'lecture'
  | 'aiPaper'
  | 'composePaper'
  | 'courseware'
  | 'book'
  | 'word'
  | 'ppt'
  | 'pdf'
  | 'video'
  | 'audio'
  | 'h5'
  | 'image'
  | 'miniapp'
  | 'other'
  | 'animation'

/** 文件类型中文名（列表「文件类型」列与筛选面板共用，勿在页面里另写一份） */
export const FILE_KIND_TEXT: Record<OrgFileKind, string> = {
  doc: '文档',
  paper: '试卷',
  lecture: '讲义',
  aiPaper: '智能组卷',
  composePaper: '组卷',
  courseware: '课件',
  book: 'Book',
  word: 'Word',
  ppt: 'PPT',
  pdf: 'PDF',
  video: '视频',
  audio: '音频',
  h5: 'H5游戏',
  image: '图片',
  miniapp: '小程序',
  other: '其它文件',
  animation: '动画',
}

/** 文件类型对应的图标名（AppIcon 图标集）；列表、卡片与预览共用 */
export const FILE_KIND_ICON: Record<OrgFileKind, string> = {
  doc: 'file',
  paper: 'paper',
  lecture: 'clipboard',
  aiPaper: 'sparkles',
  composePaper: 'layers',
  courseware: 'presentation',
  book: 'book',
  word: 'word',
  ppt: 'presentation',
  pdf: 'pdf',
  video: 'video',
  audio: 'audio',
  h5: 'play',
  image: 'image',
  miniapp: 'smartphone',
  other: 'file',
  animation: 'chart',
}

/**
 * 文件类型的图标底色。
 *
 * 17 种类型逐个写 CSS 类会得到三十多条几乎一样的规则，这里改成一色一档、颜色跟着类型表走：
 * 换色只改这一处，也不会出现「页面里的类和类型表对不上」。
 */
export const FILE_KIND_COLOR: Record<OrgFileKind, { background: string; color: string }> = {
  doc: { background: '#e8eefc', color: '#2f6bd6' },
  paper: { background: '#fdeee4', color: '#d9702b' },
  lecture: { background: '#eef7e6', color: '#4e9420' },
  aiPaper: { background: '#efeafc', color: '#6b4fd6' },
  composePaper: { background: '#e6f6f4', color: '#0f9d92' },
  courseware: { background: '#e9f1ff', color: '#2f8fd6' },
  book: { background: '#f5eee3', color: '#a5762f' },
  word: { background: '#e8eefc', color: '#2f6bd6' },
  ppt: { background: '#e9f1ff', color: '#2f8fd6' },
  pdf: { background: '#fdeaea', color: '#d64545' },
  video: { background: '#efeafc', color: '#6b4fd6' },
  audio: { background: '#fdeaf2', color: '#d6459b' },
  h5: { background: '#e4f6f8', color: '#1a8fa8' },
  image: { background: '#eaf7f4', color: '#17a08a' },
  miniapp: { background: '#f2f8e4', color: '#6b9a1c' },
  other: { background: '#eef1f8', color: '#6b7688' },
  animation: { background: '#fff3dd', color: '#d69a1c' },
}

/**
 * 类型分组：筛选面板按这三组排（数组顺序就是面板里的行顺序，组内顺序就是勾选项顺序）。
 *
 * 分组与「资源形态」对齐而不是与「格式」对齐 —— 文档类是平台产出的成品文档，
 * 其他类是按格式分堆的上传件与媒体资源，课件独立成组。
 */
export const FILE_KIND_GROUPS: { key: string; text: string; kinds: OrgFileKind[] }[] = [
  { key: 'doc', text: '文档类型', kinds: ['doc', 'paper', 'lecture', 'aiPaper', 'composePaper'] },
  { key: 'courseware', text: '课件类型', kinds: ['courseware'] },
  {
    key: 'other',
    text: '其他类型',
    kinds: ['book', 'word', 'ppt', 'pdf', 'video', 'audio', 'h5', 'image', 'miniapp', 'other', 'animation'],
  },
]

export interface OrgFile {
  id: number
  name: string
  kind: OrgFileKind
  folderId: number
  sizeMb: number
  recognize: 'none' | 'recognizing' | 'done' | 'failed'
  /** 创建者姓名：`shared` 为真时是分享者，为假时就是当前登录人自己 */
  owner: string
  /** 由他人分享进来的文件 —— 「我的文件」里出现别人的文件只可能是这个来路，列表「创建者」列据此打分享标志 */
  shared?: boolean
  uploadedAt: string
  /** 最近一次变动时间（上传/新建 = uploadedAt；重命名、移动会刷新） */
  updatedAt: string
  /** 置顶：排在同级其他文件之前 */
  pinned?: boolean
  /** 关联的试卷 id：建卷落文件时写入，「我的文件」据此提供「打开试卷」入口 */
  paperId?: number
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
  /** 题型，取值限于 单选 / 多选 / 判断 / 填空 / 解答 / 计算 / 证明 / 连线 / 作文；未提及为空数组 */
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
  ownerId: UserId
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

/* ================ 班级与学生管理（T-08） ================ */

/** 教学班（机构端班级管理） */
export interface OrgClass {
  id: number
  /** 班级名称，如「高一(1)班」 */
  name: string
  grade: string
  /** 班主任 */
  headTeacher: string
  /** 助教 / 副班主任 */
  assistant?: string
  studentCount: number
  /** 本学期开的学科 */
  subjects: string[]
  /** 教室 */
  room?: string
  enabled: boolean
  createdAt: string
}

export type ConsentStatus = 'granted' | 'pending' | 'withdrawn'

export const CONSENT_STATUS_TEXT: Record<ConsentStatus, string> = {
  granted: '已同意',
  pending: '待签署',
  withdrawn: '已撤回',
}

/** 监护人知情同意记录（T-08-06，K12 合规红线） */
export interface ConsentRecord {
  id: number
  studentId: number
  studentName: string
  /** 监护人姓名（脱敏展示：张*） */
  guardianName: string
  relation: '父亲' | '母亲' | '其他'
  /** 知情同意书版本 */
  docVersion: string
  status: ConsentStatus
  /** 同意范围 */
  scopes: string[]
  signedAt?: string
  /** 撤回时间 */
  withdrawnAt?: string
}

/** 学生档案（T-08-03/04/07/08） */
export interface OrgStudent {
  id: number
  name: string
  studentNo: string
  className: string
  grade: string
  gender: '男' | '女'
  /** 家长手机（列表默认脱敏展示，档案详情按权限展示全量） */
  guardianPhone: string
  guardianName: string
  consentStatus: ConsentStatus
  /** 画像标签（AI 学情） */
  tags: string[]
  /** 学习预警等级 */
  warning: 'none' | 'watch' | 'risk'
  /** 最近一次考试总分与班级分位 */
  lastScore?: number
  lastPercentile?: number
  enrolledAt: string
  status: '在读' | '转班' | '休学' | '退出'
}

export const STUDENT_WARNING_TEXT: Record<OrgStudent['warning'], string> = {
  none: '正常',
  watch: '关注',
  risk: '预警',
}

/* ================ AI 学情画像（T-07-08 ~ 10） ================ */

/** 单个知识点的掌握度 */
export interface MasteryNode {
  knowledge: string
  /** 掌握度 0-100 */
  mastery: number
  /** 近期趋势：上升 / 持平 / 下降 */
  trend: 'up' | 'flat' | 'down'
  /** 练习次数 */
  practices: number
  /** 薄弱标记（掌握度 < 60） */
  weak: boolean
}

/** 学生学情画像（T-07-08） */
export interface StudentProfile {
  studentId: number
  studentName: string
  className: string
  /** 综合掌握度（加权平均） */
  overall: number
  /** 年级百分位 */
  percentile: number
  /** 掌握度明细（按学科分组） */
  subjects: Array<{ subject: string; mastery: number; nodes: MasteryNode[] }>
  /** AI 归因结论 */
  diagnosis: string
  /** AI 建议的下一步动作 */
  suggestion: string
  /** 个性化练习推送记录（T-07-10） */
  pushes: Array<{ id: number; title: string; questionCount: number; weakPoints: string[]; pushedAt: string; done: number }>
}

/** 班级学情报告（T-07-09） */
export interface ClassProfileReport {
  className: string
  studentCount: number
  /** 各学科班级平均掌握度 */
  subjectMastery: Array<{ subject: string; mastery: number; lastTerm: number }>
  /** 知识点掌握度分布（薄弱知识点按掌握度升序） */
  weakNodes: MasteryNode[]
  /** 分数段分布（最近一次统考） */
  scoreBands: Array<{ band: string; count: number }>
  /** AI 班级诊断与教学建议（不做公开排名，仅分布与区间） */
  advice: string[]
}

/* ================ AI 能力中心（T-10） ================ */

export type AiTaskStatus = 'running' | 'success' | 'failed' | 'reviewing'

export const AI_TASK_STATUS_TEXT: Record<AiTaskStatus, string> = {
  running: '进行中',
  success: '已完成',
  failed: '失败',
  reviewing: '待复核',
}

/** AI 任务中心的一条任务（T-10-02） */
export interface AiCenterTask {
  id: number
  /** 场景：出题 / 组卷 / 讲义 / 课件 / 阅卷 / 学情 / 识题 / 识卷 */
  scene: string
  title: string
  /** 发起人 */
  creator: string
  status: AiTaskStatus
  /** 耗时秒 */
  elapsed: number
  /** token 消耗（计量计费用） */
  tokens: number
  /** 产物数量 */
  outputCount: number
  createdAt: string
}

/** AI 能力入口卡片（T-10-01） */
export interface AiCapabilityCard {
  key: string
  title: string
  desc: string
  scene: string
  /** 本月使用次数 */
  monthUses: number
  icon: string
  /** 跳转路径 */
  link: string
}

export type ArtifactReviewStatus = 'pending' | 'approved' | 'rejected'

export const ARTIFACT_REVIEW_STATUS_TEXT: Record<ArtifactReviewStatus, string> = {
  pending: '待复核',
  approved: '已通过',
  rejected: '已驳回',
}

/** AI 生成内容复核条目（T-10-08：AI 内容须经教师复核后方可发布） */
export interface AiArtifactReview {
  id: number
  kind: '题目' | '试卷' | '讲义' | '课件' | '批改' | '画像'
  title: string
  scene: string
  /** 生成来源模型 */
  model: string
  status: ArtifactReviewStatus
  /** AI 自动质检结论 */
  autoCheck: 'pass' | 'warn' | 'error'
  autoCheckNote: string
  /** AI 标识（合规要求：AI 生成内容必须显著标识） */
  aiLabeled: boolean
  createdAt: string
  reviewer?: string
  reviewedAt?: string
}

/* ================ 机构系统设置（T-11） ================ */

/** 机构基础信息（T-11-01） */
export interface OrgSettings {
  name: string
  shortName: string
  contact: string
  phone: string
  address: string
  intro: string
  /** 学科范围（T-11-03） */
  subjects: string[]
  /** 年级范围（T-11-03） */
  grades: string[]
  /** 教材版本偏好 */
  preferredTextbooks: string[]
}

/** 审核流程配置（T-11-02） */
export interface ReviewFlowConfig {
  key: 'question' | 'paper' | 'resource'
  label: string
  /** 是否启用审核 */
  enabled: boolean
  /** 审核级数（1 或 2） */
  levels: 1 | 2
  /** 一级审核人 */
  level1Reviewers: string[]
  /** 二级审核人（双级审核时生效） */
  level2Reviewers: string[]
  /** AI 预审：先跑自动质检再进人工队列 */
  aiPrecheck: boolean
}

/* ================ 平台端 · 全局内容运营（P-03） ================ */

export type PlatformContentStatus = 'draft' | 'pending' | 'published' | 'rejected' | 'offline'

export const PLATFORM_CONTENT_STATUS_TEXT: Record<PlatformContentStatus, string> = {
  draft: '草稿',
  pending: '待审核',
  published: '已上架',
  rejected: '已驳回',
  offline: '已下架',
}

/** 公共题库题目（P-03-01 ~ 03） */
export interface PlatformQuestion {
  id: number
  stem: string
  type: string
  subject: string
  grade: string
  difficulty: string
  knowledge: string[]
  answer: string
  analysis: string
  status: PlatformContentStatus
  /** 质量分级（P-03-07） */
  quality: 'A' | 'B' | 'C'
  source: string
  /** 引用次数（P-03-24） */
  refs: number
  updatedAt: string
}

/** 公共试卷（P-03-11 ~ 13） */
export interface PlatformPaper {
  id: number
  name: string
  subject: string
  grade: string
  questionCount: number
  fullScore: number
  /** 来源：真题 / 教辅 / 投稿 */
  source: string
  status: PlatformContentStatus
  refs: number
  updatedAt: string
}

/** 内容分发记录（P-03-25：内容分发与租户授权） */
export interface ContentDistribution {
  id: number
  contentType: '题目' | '试卷' | '教辅' | '素材'
  contentName: string
  /** 授权租户数 */
  tenantCount: number
  /** 分发范围：全部租户 / 指定套餐 / 指定租户 */
  scopeType: 'all' | 'package' | 'tenant'
  scopeText: string
  status: 'syncing' | 'synced' | 'paused'
  syncedAt: string
}

/** 内容合规抽检任务（P-03-23） */
export interface ComplianceSpotCheck {
  id: number
  title: string
  /** 抽检范围 */
  scope: string
  /** 抽检数量 */
  sampleCount: number
  /** AI 命中疑似问题数 */
  flagged: number
  /** 人工确认违规数 */
  confirmed: number
  status: 'running' | 'done' | 'closed'
  createdAt: string
  /** 抽检命中的样例 */
  samples: Array<{ contentName: string; reason: string; level: 'high' | 'mid' | 'low' }>
}

/** 内容问题反馈工单（P-03-28） */
export interface ContentFeedbackTicket {
  id: number
  title: string
  contentType: string
  contentName: string
  reporter: string
  tenantName: string
  /** 问题类型：内容错误 / 版权争议 / 敏感内容 / 其他 */
  kind: string
  priority: 'high' | 'normal' | 'low'
  status: 'open' | 'processing' | 'resolved' | 'rejected'
  createdAt: string
  resolvedAt?: string
  reply?: string
}

/* ================ 平台端 · AI 安全治理与计费（P-05） ================ */

/** 敏感词策略分组（P-05-10） */
export interface SensitivePolicyGroup {
  id: number
  name: string
  /** 命中动作：拒答 / 转人工 / 替换脱敏 */
  action: 'block' | 'human' | 'mask'
  words: string[]
  /** 适用场景：学生问答 / 教师助手 / 出题 / 全部 */
  scope: string
  enabled: boolean
  /** 近 30 天命中次数 */
  hits30d: number
}

/** AI 输出质量评测记录（P-05-11） */
export interface AiQualityEval {
  id: number
  scene: string
  model: string
  /** 评测集名称 */
  dataset: string
  sampleCount: number
  /** 各维度得分 0-100 */
  scores: { accuracy: number; completeness: number; gradeFit: number; safety: number }
  /** 综合分 */
  overall: number
  /** 相对上一轮变化 */
  delta: number
  ranAt: string
}

/** AI 生成内容留痕记录（P-05-12） */
export interface AiTraceRecord {
  id: number
  traceId: string
  scene: string
  model: string
  tenantName: string
  /** 产物类型与摘要 */
  artifactKind: string
  artifactTitle: string
  /** 输入摘要（脱敏） */
  inputDigest: string
  /** 内容安全结论 */
  safety: 'pass' | 'masked' | 'blocked'
  createdAt: string
}

/** AI 计费规则（P-05-13） */
export interface AiBillingRule {
  id: number
  scene: string
  model: string
  /** 计价单位：次 / 千 token */
  unit: 'call' | '1k-token'
  /** 单价（元） */
  price: number
  enabled: boolean
}

/** 租户 AI 能力开关（P-05-14） */
export interface TenantAiSwitch {
  tenantId: number
  tenantName: string
  /** 各 AI 能力开关 */
  capabilities: Array<{ key: string; label: string; enabled: boolean }>
  /** 本月用量（元） */
  monthCost: number
  /** 剩余额度（元） */
  quotaLeft: number
}

/* ================ 平台端 · 系统监控与配置（P-06 / P-07） ================ */

/** 服务健康项（P-06-06） */
export interface ServiceHealthItem {
  key: string
  name: string
  status: 'up' | 'degraded' | 'down'
  /** 近 24h 可用率（%） */
  uptime: number
  /** 平均响应毫秒 */
  latencyMs: number
  /** CPU / 内存占用（%） */
  cpu: number
  memory: number
  lastAlertAt?: string
}

/** 系统参数（P-07-04） */
export interface SystemParam {
  key: string
  label: string
  value: string
  group: string
  desc: string
  editable: boolean
}

/** 消息模板（P-07-05） */
export interface MessageTemplate {
  id: number
  name: string
  scene: string
  channels: string[]
  content: string
  enabled: boolean
  updatedAt: string
}

/** 文件存储策略（P-07-06） */
export interface StoragePolicy {
  key: string
  label: string
  provider: string
  bucket: string
  /** 上传大小上限（MB） */
  maxUploadMb: number
  /** 允许的类型 */
  acceptTypes: string[]
  enabled: boolean
  usedGb: number
  quotaGb: number
}

/** 数据备份记录（P-07-07） */
export interface BackupRecord {
  id: number
  name: string
  kind: 'auto' | 'manual'
  scope: string
  sizeGb: number
  status: 'running' | 'done' | 'failed'
  startedAt: string
  finishedAt?: string
  restoreTimes: number
}
