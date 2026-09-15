export { setupApp, getAppConfig, getTokenKey, getUserKey } from './config'
export type { AppConfig, AppName } from './config'

export { request } from './request/client'
export { ApiError } from './request/api-error'
export { resolveApiMode } from './request/mock-switch'
export type { ApiMode } from './request/mock-switch'
export type { ApiResponse, RequestOptions, HttpMethod } from './request/types'

export {
  loginApi,
  fetchCurrentUser,
  logoutApi,
  getToken,
  setSession,
  getCacheUser,
  clearSession,
} from './api/auth'
export type { LoginPayload, LoginResult } from './api/auth'
export type { AdminOverview, TenantOverview } from './api/models'
export type {
  PageResult,
  ApplyStatus,
  TenantApply,
  FeatureSwitches,
  PackageRecord,
  TenantStatus,
  TenantRecord,
  TenantDetailModel,
  DictTypeKey,
  DictItem,
  KnowledgeNode,
  TextbookVersion,
  AiModelType,
  AiModel,
  AgentCheckItem,
  AgentConfig,
  PromptTemplate,
  AiCallLog,
  PublicQuestion,
  PublicPaper,
  AuditRecord,
  LoginLog,
  OperationLog,
  ErrorLog,
  AdminRole,
  AdminAccount,
  TenantMenuItem,
  PlatformNotification,
} from './api/models'
export type { SessionUser, MockUser } from './mock/types'

export { formatCount, formatDelta, hueColor, formatQuota } from './utils/format'
export { showToast } from './utils/toast'
export type { ToastType } from './utils/toast'
export { default as AppIcon } from './components/AppIcon.vue'
export { default as TrendChart } from './components/TrendChart.vue'
export type ChartSeries = {
  name: string
  data: number[]
  color: string
}
export { default as BarChart } from './components/BarChart.vue'

/* 字典 / AI 配置元数据（页面下拉与说明用） */
export {
  DICT_TYPES,
  PROMPT_SCENES,
  PROMPT_VARIABLES,
  AI_MODEL_TYPE_TEXT,
  ADMIN_ROLE_TEXT,
} from './mock/admin-store'

/* 机构端业务类型 */
export type {
  QuestionStatus,
  QuestionSource,
  QuestionLibrary,
  AiCheckResult,
  OrgQuestion,
  OrgCategory,
  OrgKnowledgeNode,
  TextbookOption,
  PaperSection,
  PaperStatus,
  OrgPaper,
  MaterialExample,
  MaterialStatus,
  OrgMaterial,
  MediaKind,
  OrgMedia,
  FileFolder,
  OrgFileKind,
  OrgFile,
  StandardFormula,
  FormulaScope,
  OrgFormula,
  OrgPrompt,
  SquareResource,
  StaffRole,
  StaffMember,
  OrgRole,
  Campus,
  OrgOperationLog,
  NotifyMatrixRow,
  RecycleItem,
  OrgMessage,
  GeneratedQuestion,
} from './api/models'

/* 机构端业务常量与文本 */
export {
  QUESTION_STATUS_TEXT,
  PAPER_STATUS_TEXT,
  MATERIAL_STATUS_TEXT,
  ORG_PROMPT_SCENES,
  platformPrompts,
  PERM_MODULES,
} from './mock/org-store'
export type { PhotoTask } from './mock/org-store'
