export { setupApp, getAppConfig, getTokenKey, getUserKey } from './config'
export type { AppConfig, AppName } from './config'

export { request } from './request/client'
export { ApiError } from './request/api-error'
export { resolveApiMode } from './request/mock-switch'
export type { ApiMode } from './request/mock-switch'
export { BACKEND_READY_PATHS, isBackendReady } from './request/backend-ready'
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
export { appConfirm } from './utils/confirm'
export type { ConfirmType, ConfirmOptions } from './utils/confirm'
export { copyText } from './utils/clipboard'
/* 浮层栈：`AppModal` / `AppConfirm` / `AppDrawer` 之外的浮层（如试卷预览）也要进来登记，
   否则它在 document 上的 Esc 监听不受仲裁 —— 一次 Esc 会把子弹窗和它自己一起关掉 */
export { enterOverlay, exitOverlay, isTopOverlay } from './utils/overlay-stack'
export { default as AppIcon } from './components/AppIcon.vue'

/* ===== 共享 UI 组件（机构端 / 超管端通用，样式自带、只取 CSS 变量） =====
   这些原本散落在单个页面的 scoped 样式里（题库管理的 `.opt-chip` / `.filter-panel` /
   `.search-box` / `.list-toolbar` 等），别的页面无法复用，只能各写一份。 */
export { default as AppPageHeader } from './components/ui/AppPageHeader.vue'
export { default as AppFilterPanel } from './components/ui/AppFilterPanel.vue'
export { default as AppFilterChips } from './components/ui/AppFilterChips.vue'
export { default as AppSearchInput } from './components/ui/AppSearchInput.vue'
export { default as AppListToolbar } from './components/ui/AppListToolbar.vue'
export { default as AppTabs } from './components/ui/AppTabs.vue'
export { default as AppSegmented } from './components/ui/AppSegmented.vue'
/* 浮层（弹窗 / 抽屉）：与 appConfirm 共用 overlay 栈，Esc 只关最上层 */
export { default as AppModal } from './components/ui/AppModal.vue'
export { default as AppDrawer } from './components/ui/AppDrawer.vue'
export type { FilterRowDef, TabDef } from './components/ui/types'
export { buildBreadcrumb } from './utils/breadcrumb'
export type { Crumb, CrumbMenuItem } from './utils/breadcrumb'
export { default as TrendChart } from './components/TrendChart.vue'
export type ChartSeries = {
  name: string
  data: number[]
  color: string
}
export { default as BarChart } from './components/BarChart.vue'
export { default as ComboChart } from './components/ComboChart.vue'
/* 与上面的 ChartSeries 同一写法：类型在 barrel 里重述一遍，不从 .vue 里再导出 */
export type ComboAxis = {
  position: 'left' | 'right'
  offset?: number
  name: string
  suffix?: string
  hidden?: boolean
}
export type ComboBar = {
  name: string
  data: number[]
  color: string
  axis: number
  unit?: string
}
export type ComboLine = {
  name: string
  data: number[]
  color: string
  axis: number
  unit?: string
}
export { default as RingChart } from './components/RingChart.vue'
export type RingDatum = { name: string; value: number }

/* 富文本：正文改存 HTML 后的公共能力（渲染器 + 纯文本/净化工具） */
export { default as RichTextViewer } from './components/RichTextViewer.vue'
export {
  isRichContent,
  toPlainText,
  truncateRich,
  sanitizeRichHtml,
  renderMathIn,
  normalizeRichHtml,
  hasImage,
  FILL_BLANK,
  ANSWER_PAREN,
} from './utils/richtext'
export { registerMediaSrc, resolveMediaIn, resolveMediaSrc, unregisterMediaSrc } from './utils/media-ref'
/* 统一 KaTeX 入口：已注册 mhchem（\ce{} 化学式），各渲染点一律从这里取 katex */
export { default as katex } from './utils/katex'

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
  QuestionCorrection,
  QuestionCorrectionType,
  FillBlankAnswer,
  OptionColumns,
  PhotoResultEdit,
  OrgCategory,
  OrgKnowledgeNode,
  TextbookOption,
  PaperSection,
  PaperStatus,
  PaperSource,
  PaperCategory,
  PaperAttachment,
  PaperExtra,
  PaperExtraKind,
  OrgPaper,
  AiComposeParams,
  AiComposeTemplate,
  CollabTaskStatus,
  CollabMemberStatus,
  CollabMember,
  PaperVersion,
  CollabRequirement,
  OrgCollabTask,
  TeachDocKind,
  LectureBlockKind,
  GuideBlockKind,
  BlockKind,
  LectureBlock,
  SlideLayout,
  CoursewareSlide,
  TeachDoc,
  PlanStepKind,
  PlanStep,
  PlanDetail,
  AnswerStatus,
  GradingDuty,
  ExamSession,
  AnswerItem,
  ExamAnswer,
  AnalysisQuestionStat,
  PaperAnalysis,
  MistakeMastery,
  MistakeEntry,
  PrepMember,
  PrepComment,
  PrepVersion,
  PrepTaskStatus,
  PrepTask,
  ResourceScope,
  ApprovalStatus,
  ApprovalKind,
  ResourceApproval,
  VideoClip,
  HomeworkStatus,
  Homework,
  HomeworkSubmission,
  MaterialExample,
  MaterialStatus,
  OrgMaterial,
  MediaKind,
  DrawEditorType,
  OrgMedia,
  FileFolder,
  OrgFileKind,
  OrgFile,
  OrgSearchResult,
  ComposeSearchIntent,
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
  /* 班级与学生管理（T-08） */
  OrgClass,
  ConsentStatus,
  ConsentRecord,
  OrgStudent,
  /* AI 学情画像（T-07-08 ~ 10） */
  MasteryNode,
  StudentProfile,
  ClassProfileReport,
  /* AI 能力中心（T-10） */
  AiTaskStatus,
  AiCenterTask,
  AiCapabilityCard,
  ArtifactReviewStatus,
  AiArtifactReview,
  /* 机构系统设置（T-11） */
  OrgSettings,
  ReviewFlowConfig,
} from './api/models'

/* 机构端业务常量与文本 */
export {
  QUESTION_STATUS_TEXT,
  PAPER_STATUS_TEXT,
  MATERIAL_STATUS_TEXT,
  ORG_PROMPT_SCENES,
  platformPrompts,
  PERM_MODULES,
  TEACH_DOC_STATUS_TEXT,
  COLLAB_TASK_STATUS_TEXT,
  COLLAB_MEMBER_STATUS_TEXT,
  UPLOAD_KIND_TEXT,
  /* 卷内小题总数：试卷列表的「题量」（实现在 org-store，机构端几处各抄过一份 sections.reduce） */
  paperQuestionCount,
  /* 卷面总分：分值占比类统计的分母，同样只在 org-store 里有一份实现 */
  paperTotalScore,
  /* 演示身份切换：机构端右上角换身份时改「当前操作人」，让 owner / actor / createdBy 跟着走
     （见 apps/tenant/src/composables/useDemoRole.ts 的说明） */
  setMockCurrent,
} from './mock/org-store'
export type { MockRole } from './mock/org-store'
/* 这几个字典定义在 models 里（与类型同源），值需单独导出给前端 */
export {
  QUESTION_CORRECTION_TYPES,
  QUESTION_SOURCE_OPTIONS,
  PAPER_SOURCE_OPTIONS,
  PAPER_CATEGORIES,
  /* 年份筛选的档位口径：试卷筛选与智能组卷「优先年份」共用（mock 侧打分也要判哨兵） */
  EARLIER_YEAR,
  RECENT_YEAR_COUNT,
  isEarlierYear,
  COLLAB_STATUS_TEXT,
  COLLAB_MEMBER_TEXT,
  TEACH_KIND_TEXT,
  FILE_KIND_TEXT,
  FILE_KIND_ICON,
  FILE_KIND_COLOR,
  FILE_KIND_GROUPS,
  LECTURE_BLOCK_TEXT,
  GUIDE_BLOCK_TEXT,
  BLOCK_KIND_TEXT,
  PLAN_STEP_TEXT,
  SLIDE_LAYOUT_TEXT,
  ANSWER_STATUS_TEXT,
  MISTAKE_MASTERY_TEXT,
  MISTAKE_REASONS,
  PREP_TASK_STATUS_TEXT,
  RESOURCE_SCOPE_TEXT,
  APPROVAL_STATUS_TEXT,
  HOMEWORK_STATUS_TEXT,
  CONSENT_STATUS_TEXT,
  STUDENT_WARNING_TEXT,
  AI_TASK_STATUS_TEXT,
  ARTIFACT_REVIEW_STATUS_TEXT,
  PLATFORM_CONTENT_STATUS_TEXT,
} from './api/models'
/* 平台端 · 内容运营 / AI 治理 / 系统配置（仅类型） */
export type {
  PlatformContentStatus,
  PlatformQuestion,
  PlatformPaper,
  ContentDistribution,
  ComplianceSpotCheck,
  ContentFeedbackTicket,
  SensitivePolicyGroup,
  AiQualityEval,
  AiTraceRecord,
  AiBillingRule,
  TenantAiSwitch,
  ServiceHealthItem,
  SystemParam,
  MessageTemplate,
  StoragePolicy,
  BackupRecord,
} from './api/models'
/* 班级名册：阅卷、作业按班统计时需要，真实场景来自教务系统 */
export { CLASS_NAMES } from './mock/org-store'
export type { PhotoTask, RecognizedImportQuestion } from './mock/org-store'
