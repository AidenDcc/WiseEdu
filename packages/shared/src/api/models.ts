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

/**
 * 题目类别（仅录题时需要区分）。
 *
 * 「独立单题」是一道自成一体的题；「材料组合题」是**一段共用题干 / 材料 + 若干子题**的组合，
 * 它的子题才是真正作答的单位。除了录题界面，其他地方（题库列表、筛选、组卷、导出）一律
 * 只看「题型」，不看题目类别 —— 所以它不是独立字典，而是题型字典项上的一个属性
 * （见 `DictItem.questionCategory`），候选项与题型一起按学科收窄。
 */
export type QuestionCategory = '独立单题' | '材料组合题'

/** 题目类别的候选值（顺序即录题界面上的展示顺序） */
export const QUESTION_CATEGORY_OPTIONS: QuestionCategory[] = ['独立单题', '材料组合题']

/**
 * 一道材料组合题最多挂多少道子题。
 *
 * 放在这里（而不是录题页的 utils 里）是因为**两端都要用**：录题页面用它禁用「添加子题」按钮
 * 并招呼应文案，mock 侧用它做入库的结构性校验 —— 前端拦一次、服务端再拦一次，
 * 上限值只有一份，改一处两边同步。
 */
export const MAX_SUB_QUESTIONS = 50

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
   * 注意 examType 的**适配学段**不在这里，见下面的 `stages`（多选）。这个 `stage` 是单值，
   * 只服务于「年级挂靠学段」这类天生单值的场景。
   */
  stage?: string
  year?: string
  termHalf?: string
  dateFrom?: string
  dateTo?: string
  answerType?: string
  coefficient?: number
  /**
   * 题目类别（仅 questionType 使用）：留空按「独立单题」处理（存量字典项不受影响）。
   *
   * 放在题型上而不是单开一个字典：录题时「题目类别 → 题型」是一级联动（选了材料组合题，
   * 题型行只列材料组合题型），两者本就是一棵树的上下级，分开存两份必然对不上。
   */
  questionCategory?: QuestionCategory
  /**
   * 适配学段（仅 examType，由「考试类型」树投影写入）：留空 = 全学段通用，
   * 有值 = 只在机构端选到这些学段时才出现在试卷类型树 / 筛选条件里。管理端不直接编辑它。
   *
   * 用复数而非 `stage`：适配学段是**多选**（如「中考真题」同时适配初中与高中），
   * 而 `stage` 已被「年级 → 学段」的单值语义占用。
   */
  stages?: string[]
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
   * 试卷分类（仅 examType）：组卷工作台「试卷」页签左侧那棵试卷类型树的第一级。
   * 由「考试类型」树投影写入 —— 值就是该节点所属**一级节点的名字**，因此不会留空
   * （一级节点自己不是可选类型，不参与投影）。分组怎么分、叫什么，全由管理端决定。
   */
  paperCategory?: string
}

/**
 * 按试卷分类（`paperCategory`）把考试类型分组，供机构端「试卷类型树」直接铺开。
 *
 * 为什么不再有一份写死的分类常量：一级分组就是「考试类型」树的一级节点，而它在管理端
 * 可以改名 / 新增 / 删除（见 `ExamTypeNodeKind`）。常量一旦写死，管理端给分组改个名，
 * 机构端那棵树就会整棵空掉 —— 顺序也一样，固化顺序等于把分组顺序也锁死在代码里。
 *
 * 顺序取「**首次出现的顺序**」：字典是按树的前序遍历投影下来的，同一个分组的项必然
 * 连续出现，因此首次出现的先后 = 分组在管理端树上的先后。
 * 没有 `paperCategory` 的历史项不进树（仍可用于筛选），与机构端既有口径一致。
 */
export function groupByPaperCategory<T extends { paperCategory?: string }>(
  items: T[],
): Array<{ name: string; items: T[] }> {
  const groups: Array<{ name: string; items: T[] }> = []
  items.forEach((item) => {
    const name = item.paperCategory
    if (!name) return
    const group = groups.find((row) => row.name === name)
    if (group) group.items.push(item)
    else groups.push({ name, items: [item] })
  })
  return groups
}

/* 知识点/考点树（最多 5 级） */
export interface KnowledgeNode {
  id: number
  parentId: number | null
  name: string
  /**
   * 知识点编码：平台内唯一，机构端题库 / 组卷靠它匹配知识点。
   * 只在管理端知识点树的「新增 / 编辑节点」弹窗里展示与维护，树上不展示。
   */
  code: string
  /** 所属学段：小学 / 初中 / 高中 */
  stage: string
  subject: string
  /** 同一父节点下的相对顺序，数值越小越靠前 */
  sort: number
  enabled: boolean
}

/**
 * 考试类型树（最多 5 级）：合并了原先基础字典里的「考试类型」与「杯赛」两个平铺列表。
 *
 * 一级节点（`parentId === null`）是**分组**：它既是树上的分类（阶段考试 / 真题 / 模拟试卷…），
 * 也是机构端组卷「试卷类型树」的一级分组（经 `DictItem.paperCategory` 投影下去）。
 * 分组与其它节点**一视同仁** —— 可改名、可增删、可拖拽、可启停用。早先版本把分组锁成
 * 系统固定的 `category` 类型（不可改名 / 删除），实际用起来只能靠改 mock 才能调整分类，
 * 现已放开：分类口径归管理端，代码不再持有任何分类常量。
 *
 * `kind` 是合并的关键：竞赛分组下同时挂着考试类型（数学竞赛 / 物理竞赛）与杯赛
 * （华罗庚金杯…），靠它分流回机构端的 `examType` / `competition` 两个只读字典——
 * 少了这个字段，杯赛会被混进机构端的试卷类型树。
 */
export type ExamTypeNodeKind = 'examType' | 'competition'

export interface ExamTypeNode {
  id: number
  /** null = 顶级节点（分组）。分组是分类容器、本身不是可选的考试类型，不参与字典投影 */
  parentId: number | null
  name: string
  /**
   * 节点编码：平台内唯一，机构端匹配试卷分类 / 杯赛靠它。
   * 与知识点编码同口径 —— 由平台自动生成、前端不可编辑，只在「新增 / 编辑节点」弹窗里展示。
   */
  code: string
  kind: ExamTypeNodeKind
  enabled: boolean
  /** 被题目引用数（>0 时禁止删除，仅可停用） */
  refCount: number
  /** 同一父节点下的相对顺序，数值越小越靠前（拖拽 / 上下移后重排，与知识点树同口径） */
  sort: number
  /**
   * 适配学段：留空 = 全学段通用；有值 = 只在机构端选到这些学段时才出现。
   * 多选（如「中考真题」可同时适配初中与高中）。
   */
  stages?: string[]
  /** 适配学科：留空 = 全学科通用 */
  subjects?: string[]
}

/**
 * 教材目录章节关联的知识点（存**快照**：id 用于回查，name 用于列表直接展示）。
 *
 * 为什么不只存 id：目录树是逐行渲染的，若每行都回查一次知识点接口，
 * 一张目录要发几十个请求；存名称快照后渲染零成本。名称以知识点树为准，
 * 知识点被改名后由「重新关联」纠正，不做级联同步。
 */
export interface CatalogKnowledge {
  id: number
  name: string
}

/** 单个教材目录章节最多关联的知识点数（管理端选择弹窗与 Mock 校验共用同一口径） */
export const MAX_CATALOG_KNOWLEDGE = 6

/* 教材目录树节点（章节 / 小节，可多级嵌套） */
export interface TextbookCatalogNode {
  id: string
  title: string
  /**
   * 是否启用（缺省视为启用）：停用后该节点连同整棵子树在教材目录中不再生效。
   * 与知识点树的行内开关同口径，便于「教材目录树」与「知识点树」UI / 交互保持一致。
   */
  enabled?: boolean
  /** 关联的知识点（最多 6 个，任意层级）；缺省 = 未关联 */
  knowledge?: CatalogKnowledge[]
  children?: TextbookCatalogNode[]
}

/**
 * 教材版本（修订版次）。
 *
 * 平台侧的教材结构是「教材版本 → 教材分册」两层：
 * - **教材版本**（本接口）只描述「哪个学段、哪个学科、哪个出版社的哪个版本」；
 *   学段 / 学科 不是自由文本，分别来自基础字典「年级 / 学段」的 `stage` 与「学科」字典
 *   （管理端只关联展示，不可在教材版本里新增 / 编辑 / 删除它们）；
 * - **教材分册**（`TextbookVolume`）才承载年级 / 学期 / 封面 / 目录等册次信息。
 *
 * 于是同一版本（如「人教版·高中数学」）下可以挂多册（必修一、必修二……）。
 */
export interface TextbookVersion {
  id: number
  /** 学段（来自基础字典：年级字典的 `stage` 汇总，如 小学 / 初中 / 高中） */
  stage: string
  /** 学科（来自基础字典「学科」） */
  subject: string
  /** 版本名称（如「人教版」） */
  name: string
  publisher: string
  hue: number
  sort: number
  enabled: boolean
  /** 适用地区（多选，如 ['北京', '上海']） */
  region?: string[]
  /** 修订年份（多选，列举近 5 年 + 更久之前） */
  years?: string[]
}

/**
 * 教材分册：某个教材版本下的一个册次（如「人教版·高中数学·必修第一册」）。
 *
 * 册别名 / 年级 / 学期 / 适配学年 由管理端在「新增分册」时录入；目录（catalog）
 * 通过右侧抽屉单独维护；封面与教材电子版为非必填资产。
 */
export interface TextbookVolume {
  id: number
  /** 所属教材版本 id */
  textbookId: number
  /** 册别名（如「必修第一册」「上册」） */
  alias: string
  /** 年级（如「一年级」「高一」，来自年级字典） */
  grade: string
  /** 学期：上学期 / 下学期 */
  term: string
  /** 适配学年（如「2025-2026」） */
  year?: string
  /** 封面图（本地预览用 object URL / data URL） */
  cover?: string
  /** 教材电子版 PDF 文件地址（object URL / data URL） */
  fileUrl?: string
  /** 教材电子版文件名 */
  fileName?: string
  /** 目录树（章节等） */
  catalog?: TextbookCatalogNode[]
  enabled: boolean
  sort: number
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

/**
 * 材料组合题的**子题**：一道结构完整但「没有学段」的题。
 *
 * 它与 `OrgQuestion` 的差别只有一个：学科 / 年级 / 教材版本 / 学期 / 考试类型 / 来源 / 归属
 * 都继承母题，子题只描述「问什么、怎么答、难度、考点」这几件真的会逐题不同的事。
 * 同一个结构在录题页、预览抽屉、试卷渲染三处复用，故放模型层而不是某端私有。
 *
 * `type` 只取「独立单题」类别的题型 —— 材料组合题里再套材料组合题在卷面上没有意义。
 */
export interface OrgSubQuestion {
  /**
   * 子题编号（本地自增，仅用于界面 key 与拖拽排序）。
   * 卷面上的「(1) (2) (3)」是**按数组顺序现算的**，不存这个字段，所以删除 / 排序不会串号。
   */
  id: number
  type: string
  difficulty: string
  knowledge: string[]
  stem: string
  options: string[]
  /** 选项排布（同 `OrgQuestion.optionColumns`） */
  optionColumns?: OptionColumns
  /** 答案：选择题为字母串、无选项判断题为「对 / 错」、填空为各空纯文本以「｜」相连、解答为富文本 */
  answer: string
  /** 填空题各空的答案（富文本） */
  fillAnswers?: FillBlankAnswer[]
  analysis: string
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
  /**
   * 题目类别。缺省 = 独立单题 —— 存量题与既有种子都不带这个字段，读侧一律按
   * `row.questionCategory === '材料组合题'` 判组合题，不判「是否等于独立单题」。
   */
  questionCategory?: QuestionCategory
  /**
   * 子题（仅材料组合题）。**材料组合题的 `stem` 存的是共用题干 / 材料**，子题各带自己的题干；
   * 这样列表 / 试卷 / 导出这些只读 `stem` 的既有渲染端天然能显示组合题的正文，不必逐个改判。
   * `options` / `answer` / `analysis` 在组合题上留空（作答单位是子题）。
   */
  subQuestions?: OrgSubQuestion[]
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
/**
 * 文档来源：个人 / 校本 / 平台。
 *
 * 它不是「谁创建的」而是「这份稿子的权威归属于谁」，直接决定编辑权限：
 * 个人稿自己可改；校本与平台稿是学校 / 平台的定版，**只读**（只能查看与复制一份副本再改）。
 * 三者都用非空值，不用 `owner === 当前用户` 反推 —— 校本稿的作者也可能就是当前教师，
 * 但它的归属是学校，仍不可直接编辑。
 */
export type TeachDocSource = 'personal' | 'school' | 'platform'

export const TEACH_DOC_SOURCE_TEXT: Record<TeachDocSource, string> = {
  personal: '个人',
  school: '校本',
  platform: '平台',
}

/**
 * 划词 AI 的动作。
 *
 * 只放**改一段话**的动作，不放「整篇生成」——整篇生成是另一个入口（AI 教案），
 * 两者的交互与失败代价完全不同：改一段话失败了重选一次就行，整篇生成失败要重写一份稿子。
 */
export type TeachAiTextAction = 'rewrite' | 'expand' | 'shorten' | 'polish' | 'proofread' | 'translate'

export const TEACH_AI_TEXT_TEXT: Record<TeachAiTextAction, string> = {
  rewrite: '改写',
  expand: '扩写',
  shorten: '缩写',
  polish: '润色',
  proofread: '纠错',
  translate: '转文言 / 英文',
}

/** 划词 AI 的动作说明：悬浮提示与结果提示里都要用，写一处 */
export const TEACH_AI_TEXT_HINT: Record<TeachAiTextAction, string> = {
  rewrite: '换个说法，保持原意（适合把口语化表述改成书面语）',
  expand: '把一句话展开成一段，补出理由与例子',
  shorten: '压缩到要点，去掉修饰与重复',
  polish: '顺一遍语句与标点，不改变内容',
  proofread: '只改错别字与标点，其余不动',
  translate: '译成对应语言的规范表述（英语学科为英文）',
}

export interface TeachDoc {
  id: number
  kind: TeachDocKind
  name: string
  subject: string
  grade: string
  textbook?: string
  /**
   * 章节（教材目录里的那一节，如「3.2 函数的单调性」）。
   *
   * 与 `knowledge` 分开存：章节是**位置**（这份稿子教到哪儿），知识点是**范围**（这一节
   * 到底讲哪些东西）。AI 生成与学情分析都要用到「先章节、再知识点」这层关系 ——
   * 合成一个字段的话，选完章节就再也说不清「我改过知识点」这件事了。
   */
  chapter?: string
  knowledge: string[]
  status: 'draft' | 'published'
  blocks: LectureBlock[]
  slides: CoursewareSlide[]
  /**
   * 正文（Word 式文档流的富文本 HTML）。
   *
   * 教案 / 学案 / 讲义在「文档编辑器」里编辑的就是它 —— 标题层级落在 h1~h4 上，
   * 左侧目录即由这些标题推导（见 components/doc/DocOutline.vue）。
   *
   * 与 `blocks` / `plan` 的关系：那两个是**旧的结构化正文**，仍在类型里保留 ——
   * 一批种子数据与「转为课件」等功能还在读它们，且打开旧文档时要靠它们还原出文档流
   * （见 views/teach/doc-content.ts 的 legacyToHtml）。新写入一律走 `content`。
   */
  content?: string
  /**
   * 页面设置（文档编辑器「全局设置 → 页面设置」里的样式坐标）。
   *
   * 存的是**档位 key**（如 `a4` / `normal` / `song`）而不是展开后的 CSS 值：档位表在前端
   * （`components/doc/doc-options.ts`），存 key 才能在后期调整档位定义时一次性生效，
   * 也免得同一份「常规页边距」在两处各写一个 25.4。为空表示全用默认值。
   */
  page?: TeachDocPage
  /** 教案专属结构（kind === 'plan' 时存在） */
  plan?: PlanDetail
  /**
   * 来源（个人 / 校本 / 平台）。缺省按「个人」处理 —— 老数据里没有这个字段，
   * 它们全是教师自己建的稿子。权限判定读这个值，见 `TEACH_DOC_SOURCE_TEXT`。
   */
  source?: TeachDocSource
  owner: string
  updatedAt: string
  views: number
  sharedSquare: boolean
}

/* ================ 教案 / 学案 / 讲义模板 ================ */

/**
 * 文档的页面设置。
 *
 * 每个字段都是**档位 key**，与 `apps/tenant/src/components/doc/doc-options.ts` 里的
 * `DOC_PAPERS` / `DOC_MARGINS` / `DOC_FONT_FAMILIES` / `DOC_FONT_SIZES` / `DOC_LINE_HEIGHTS`
 * 一一对应。放在 shared 的模型里而不是前端自己存，是因为它要跟着文档一起保存、一起被多端读取。
 */
export interface TeachDocPage {
  /** 纸张：A4 / B5 */
  paper?: string
  /** 页边距档位：narrow / normal / wide / none */
  margin?: string
  /** 正文默认字体档位 */
  font?: string
  /** 正文默认字号档位 */
  size?: string
  /** 正文默认行距档位 */
  lineHeight?: string
  /**
   * 页眉文字。空 / 未设表示不显示页眉。
   *
   * 存纯文本而不是富文本：页眉是**纸张级的重复记号**（文档名、学科年级），
   * 每页都印同一行；允许富文本只会让「每页都要编辑一次」这件事变得没有意义。
   */
  header?: string
  /** 页脚文字（占页脚的另一侧，与页码错开） */
  footer?: string
  /** 页眉位置档位 key（见 doc-options.ts 的 DOC_HEADER_POS）：left / center / right */
  headerPos?: string
  /** 是否显示页码（页脚右侧的「第 n 页 / 共 m 页」） */
  pageNo?: boolean
  /** 页码格式档位 key（见 doc-options.ts 的 DOC_PAGE_NO_FORMATS）：zh / zh-simple / num / num-total / dash */
  pageNoFormat?: string
  /** 页码位置档位 key（见 doc-options.ts 的 DOC_PAGE_NO_POS）：left / center / right */
  pageNoPos?: string
  /** 页眉下方是否显示一条分隔线（Word 默认有） */
  headerRule?: boolean
}

/** 模板维护支持的类型：与「备课中心」的三种文档一一对应（课件另有版式模板，不走这里） */
export type TeachTemplateKind = 'plan' | 'guide' | 'lecture'

export const TEACH_TEMPLATE_KIND_TEXT: Record<TeachTemplateKind, string> = {
  plan: '教案',
  guide: '学案',
  lecture: '讲义',
}

/**
 * 教案 / 学案 / 讲义模板。
 *
 * 模板的正文骨架就是**一份文档流的 HTML**（`content`）：标题层级决定新建出来的文档有几节、
 * 每节叫什么，占位段落给出该写什么。这样「引用模板」与「编辑正文」用的是同一套模型 ——
 * 模板不必为三种文档各写一份结构定义，编辑器的「全局设置 → 引用模板」也只是把这段 HTML 换进去。
 */
export interface TeachTemplate {
  id: number
  kind: TeachTemplateKind
  name: string
  desc: string
  /** 机构模板（全员可用）/ 我的模板（仅创建者可见） */
  scope: 'org' | 'personal'
  /** 系统内置：可改可停用，但不允许删除（删了就没有兜底骨架） */
  builtin: boolean
  enabled: boolean
  /** 该类型的默认模板：新建文档时预选它 */
  isDefault: boolean
  /** 预填的基本信息 */
  subject?: string
  grade?: string
  periods?: number
  /** 文档骨架（富文本 HTML，标题用 h1~h4） */
  content: string
  owner: string
  updatedAt: string
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
  /**
   * 所属校区。多校区机构里班级必须归属到校区：学生档案的「年级 / 班级」下拉
   * 按校区带出来（见 `OrgStudent.campus`），两边不一致就会出现「A 校区的学生挂在 B 校区的班」。
   */
  campus: string
  /** 班级名称，如「高一(1)班」 */
  name: string
  /**
   * 班号（如「1」/「4 班」）。新建时由它 + 年级自动合成班级名称，姓名可再手改，
   * 所以它是**合成用的素材**，不是名称的唯一来源 —— 校验重名看的是 `name`。
   */
  classNo?: string
  grade: string
  /** 班主任 */
  headTeacher: string
  /** 助教 / 副班主任 */
  assistant?: string
  /**
   * 任课教师（可多选）。与「班主任 / 助教」是两回事：一个是教学分工，一个是管理分工，
   * 同一个人可以既是班主任又任教本班，故不去重合并成一个字段。
   */
  teachers: string[]
  studentCount: number
  /** 本学期开的学科 */
  subjects: string[]
  /** 教室 */
  room?: string
  enabled: boolean
  createdAt: string
}

/**
 * 班级 / 学生表单的基础数据（校区、年级、学科、教师候选）。
 *
 * 单独一个接口而不是让前端自己拼三份字典：这几项要在同一个表单里级联
 * （学科随年级、班级随校区），一次取齐才能保证「同一次弹窗里看到的是同一份配置」。
 */
export interface ClassFormMeta {
  campuses: Array<{ name: string; code: string; enabled: boolean }>
  /** 当前登录用户所在校区：新建时的默认值（查不到本人归属时退回首个启用校区） */
  defaultCampus: string
  grades: Array<{ name: string; stage: string }>
  /**
   * 学科 + 适配年级（`grades` 为空 = 不限年级）。
   * 来自基础字典的 `subject` 项，年级切换后按这里收窄 —— 化学不会出现在小学班级的学科里。
   */
  subjects: Array<{ name: string; grades: string[] }>
  /** 教师候选：来源是机构员工名单（班主任 / 助教 / 任课教师三处共用） */
  teachers: Array<{ name: string; role: string; campus: string }>
}

/** 学生批量导入的一行（前端按模板列解析后逐行提交，服务端负责校验与落库） */
export interface StudentImportRow {
  name: string
  gender?: string
  campus?: string
  grade?: string
  /** 班级名称（模板里可直接填「高一(1)班」；只填班号时由服务端按年级补齐） */
  className?: string
  /** 留空则自动生成 */
  studentNo?: string
  guardianName?: string
  guardianPhone?: string
}

/** 批量导入结果：成功条数 + 逐行失败原因（行号从 1 起，不含表头） */
export interface StudentImportResult {
  successCount: number
  failCount: number
  failures: Array<{ row: number; name: string; message: string }>
  created: Array<{ row: number; name: string; studentNo: string; className: string }>
}

export type ConsentStatus = 'granted' | 'pending' | 'withdrawn'

export const CONSENT_STATUS_TEXT: Record<ConsentStatus, string> = {
  granted: '已同意',
  pending: '待签署',
  withdrawn: '已撤回',
}

/**
 * 签署渠道。留档用：纸质签署（机构代录）与家长自助签署在合规审计里是两回事，
 * 前者需要人工复核原件，后者有完整的电子轨迹。
 */
export type ConsentChannel = '家长端 H5' | '纸质签署' | '机构代录'

/** 监护人知情同意记录（T-08-06，K12 合规红线） */
export interface ConsentRecord {
  id: number
  studentId: number
  studentName: string
  /** 学号：生成同意书 PDF 的正文要用，单独带一份省得页面再查一次学生 */
  studentNo?: string
  /** 监护人姓名（脱敏展示：张*） */
  guardianName: string
  relation: '父亲' | '母亲' | '其他'
  /** 知情同意书版本 */
  docVersion: string
  status: ConsentStatus
  /** 同意范围 */
  scopes: string[]
  /**
   * 监护人签名文字（电子签名的落款）。
   *
   * 与「手写签名图片」刻意分开：同意书正文里要能读到签名人，检索、脱敏、导出都靠文本；
   * 图片只在 PDF 留档里出现（见机构端 `utils/consent-pdf.ts`）。
   */
  signature?: string
  /** 签署渠道 */
  channel?: ConsentChannel
  signedAt?: string
  /** 撤回时间 */
  withdrawnAt?: string
}

/** 学生档案（T-08-03/04/07/08） */
export interface OrgStudent {
  id: number
  name: string
  studentNo: string
  /** 所属校区：与所读班级的校区一致（校区隔离的落点） */
  campus: string
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

/** AI 用量统计粒度：日 / 周 / 月 */
export type AiUsageGranularity = 'day' | 'week' | 'month'

export const AI_USAGE_GRANULARITY_TEXT: Record<AiUsageGranularity, string> = {
  day: '按日',
  week: '按周',
  month: '按月',
}

/**
 * 一次模型调用的明细（T-10-01 用量统计的最小单位）。
 *
 * 任务中心里的「请求明细」就是按 `taskId` 捞这份日志：一个「AI 组卷」任务往往要来回调十几次
 * 模型（出题 → 质检 → 改写），只给老师看一条汇总的 token 数，出问题时无从对账。
 */
export interface AiRequestLog {
  id: number
  /** 归属任务；问答、单次识题这类零散调用不落任务，故可空 */
  taskId?: number
  /** 功能场景（出题 / 组卷 / 讲义 …），「按功能统计」按它分组 */
  scene: string
  /** 使用人，「按个人统计」按它分组 */
  userName: string
  promptTokens: number
  completionTokens: number
  /** 输入 + 输出 */
  totalTokens: number
  /** 折算费用（元），按模型单价算 */
  cost: number
  /** 耗时（秒） */
  elapsed: number
  status: 'success' | 'failed'
  createdAt: string
}

/** 趋势图上的一格 */
export interface AiUsageBucket {
  /** 桶标签：日 = 09-26，周 = 09-22 ~ 09-28，月 = 2026-09 */
  label: string
  requests: number
  tokens: number
  cost: number
}

/** 按人或按功能的汇总行 */
export interface AiUsageGroupRow {
  key: string
  name: string
  requests: number
  tokens: number
  cost: number
  /** 占总量比例（0~100，保留 1 位小数） */
  share: number
}

/** AI 额度快照：token 是计量口径，金额是折算口径，两者都给才看得懂账单 */
export interface AiQuotaSnapshot {
  tokenQuota: number
  tokenUsed: number
  tokenLeft: number
  costQuota: number
  costUsed: number
  costLeft: number
  /** 额度周期重置时间 */
  resetAt: string
}

/** AI 用量报表（AI 工作台整页数据） */
export interface AiUsageReport {
  quota: AiQuotaSnapshot
  /** 当前筛选口径下的汇总 */
  summary: { requests: number; tokens: number; cost: number; failRate: number }
  granularity: AiUsageGranularity
  /** 趋势（按时间升序） */
  buckets: AiUsageBucket[]
  byUser: AiUsageGroupRow[]
  byScene: AiUsageGroupRow[]
  /** 请求明细（当前筛选口径，时间倒序） */
  logs: AiRequestLog[]
}

/** AI 用量查询条件 */
export interface AiUsageQuery {
  granularity?: AiUsageGranularity
  /** 统计最近 N 天（默认 30） */
  days?: number
  /** 按人下钻 */
  userName?: string
  /** 按功能下钻 */
  scene?: string
}

/** 任务中心查询条件 */
export interface AiTaskQuery {
  keyword?: string
  scene?: string
  status?: string
  creator?: string
}

/** 任务产出明细（一条任务产出的每份产物） */
export interface AiTaskOutput {
  id: number
  title: string
  /** 产物类型：题目 / 试卷 / 讲义 / 课件 / 批改 / 画像 */
  kind: string
  status: 'ok' | 'reviewing' | 'rejected'
  /** 该产物消耗的 token（任务总消耗按产物分摊） */
  tokens: number
  createdAt: string
  /** 产物落点，有则前端给「查看」入口 */
  link?: string
}

export const AI_TASK_OUTPUT_STATUS_TEXT: Record<AiTaskOutput['status'], string> = {
  ok: '可用',
  reviewing: '待复核',
  rejected: '已驳回',
}

/** AI 内容复核的查询条件 */
export interface AiArtifactQuery {
  keyword?: string
  kind?: string
  scene?: string
  status?: string
  autoCheck?: string
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
