/**
 * 机构端新模块 API 封装：班级与学生管理（T-08）、AI 学情画像（T-07-08~10）、
 * AI 能力中心（T-10）、机构系统设置（T-11）。
 * 与 org.ts 同一套约定：GET 查询串手动拼接，POST 走 data。
 */
import { request } from '@aiteach/shared'
import type {
  AiArtifactQuery,
  AiArtifactReview,
  AiCapabilityCard,
  AiCenterTask,
  AiRequestLog,
  AiTaskOutput,
  AiTaskQuery,
  AiUsageQuery,
  AiUsageReport,
  ClassFormMeta,
  ClassProfileReport,
  ConsentRecord,
  OrgClass,
  OrgSettings,
  OrgStudent,
  ReviewFlowConfig,
  StudentImportResult,
  StudentImportRow,
  StudentProfile,
} from '@aiteach/shared'

function withQuery<T extends object>(url: string, params: T): string {
  const search = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') search.append(key, String(value))
  })
  const qs = search.toString()
  return qs ? `${url}?${qs}` : url
}

/* ===== 班级管理（T-08-01） ===== */
/** 表单基础数据：校区（含当前用户所在校区）、年级、学科（带适配年级）、教师候选 */
export function fetchClassFormMeta() {
  return request<ClassFormMeta>('/tenant/students/classes/meta')
}
export function fetchClasses() {
  return request<OrgClass[]>('/tenant/students/classes')
}
export function saveClass(data: Partial<OrgClass> & { name: string }) {
  return request<OrgClass>('/tenant/students/classes/save', { method: 'POST', data })
}
export function toggleClass(id: number) {
  return request<OrgClass>('/tenant/students/classes/toggle', { method: 'POST', data: { id } })
}

/* ===== 学生档案（T-08-02/03/04） ===== */
/** 列表筛选条件：与 mock / 真实后端同一套 query 契约 */
export interface StudentListQuery {
  keyword?: string
  campus?: string
  grade?: string
  className?: string
  consentStatus?: string
  warning?: string
}

export function fetchStudents(query: StudentListQuery = {}) {
  return request<OrgStudent[]>(withQuery('/tenant/students', query))
}
export function fetchStudentDetail(id: number) {
  return request<OrgStudent>(withQuery('/tenant/students/detail', { id }))
}
export function saveStudent(data: Partial<OrgStudent> & { name: string; className: string }) {
  return request<OrgStudent>('/tenant/students/save', { method: 'POST', data })
}
export function deleteStudent(id: number) {
  return request<null>('/tenant/students/delete', { method: 'POST', data: { id } })
}
/** 新增学生前取一个学号（按班级顺序自动生成，界面上只读展示） */
export function fetchNextStudentNo(className: string) {
  return request<{ studentNo: string }>(withQuery('/tenant/students/next-no', { className }))
}
/** Excel 批量导入：逐行提交，服务端部分成功并回传逐行原因 */
export function importStudents(rows: StudentImportRow[]) {
  return request<StudentImportResult>('/tenant/students/import', { method: 'POST', data: { rows } })
}

/* ===== 监护人知情同意（T-08-06） ===== */
export function fetchConsents(keyword = '') {
  return request<ConsentRecord[]>(withQuery('/tenant/students/consents', { keyword }))
}
/** 学生档案详情里的那块「知情同意」：按学生 id 取唯一一条记录 */
export function fetchConsentOfStudent(studentId: number) {
  return request<ConsentRecord | null>(withQuery('/tenant/students/consents/by-student', { studentId }))
}
export function signConsent(id: number, scopes: string[], signature: string) {
  return request<ConsentRecord>('/tenant/students/consents/sign', { method: 'POST', data: { id, scopes, signature } })
}
export function withdrawConsent(id: number) {
  return request<ConsentRecord>('/tenant/students/consents/withdraw', { method: 'POST', data: { id } })
}

/* ===== AI 学情画像（T-07-08 ~ 10） ===== */
export function fetchStudentProfile(studentId: number) {
  return request<StudentProfile>(withQuery('/tenant/profile/student', { studentId }))
}
export function fetchClassProfile(className: string) {
  return request<ClassProfileReport>(withQuery('/tenant/profile/class', { className }))
}
export function pushPractice(studentId: number, knowledge: string, count = 8) {
  return request<StudentProfile['pushes'][number]>('/tenant/profile/push', { method: 'POST', data: { studentId, knowledge, count } })
}
export function fetchPushes(studentId: number) {
  return request<StudentProfile['pushes']>(withQuery('/tenant/profile/pushes', { studentId }))
}

/* ===== AI 能力中心（T-10） ===== */
export function fetchAiCapabilities() {
  return request<AiCapabilityCard[]>('/tenant/ai-center/capabilities')
}
/** 用量报表：额度、趋势（日/周/月）、按人、按功能、请求明细，一次取齐 */
export function fetchAiUsage(query: AiUsageQuery = {}) {
  return request<AiUsageReport>(
    withQuery('/tenant/ai-center/usage', {
      granularity: query.granularity,
      days: query.days,
      userName: query.userName,
      scene: query.scene,
    }),
  )
}
export function fetchAiTasks(query: AiTaskQuery = {}) {
  return request<AiCenterTask[]>(withQuery('/tenant/ai-center/tasks', query))
}
/** 任务下的模型调用明细 */
export function fetchTaskRequests(taskId: number) {
  return request<AiRequestLog[]>(withQuery('/tenant/ai-center/tasks/requests', { id: taskId }))
}
/** 任务产出的每份产物 */
export function fetchTaskOutputs(taskId: number) {
  return request<AiTaskOutput[]>(withQuery('/tenant/ai-center/tasks/outputs', { id: taskId }))
}
export function cancelAiTask(id: number) {
  return request<null>('/tenant/ai-center/tasks/cancel', { method: 'POST', data: { id } })
}
export function fetchAiArtifacts(query: AiArtifactQuery = {}) {
  return request<AiArtifactReview[]>(withQuery('/tenant/ai-center/artifacts', query))
}
export function reviewAiArtifact(id: number, pass: boolean) {
  return request<AiArtifactReview>('/tenant/ai-center/artifacts/review', { method: 'POST', data: { id, pass } })
}

/* ===== 机构系统设置（T-11） ===== */
export function fetchOrgSettings() {
  return request<OrgSettings>('/tenant/settings')
}
export function saveOrgSettings(data: Partial<OrgSettings>) {
  return request<OrgSettings>('/tenant/settings/save', { method: 'POST', data })
}
export function fetchReviewFlows() {
  return request<ReviewFlowConfig[]>('/tenant/settings/review-flows')
}
export function saveReviewFlow(key: ReviewFlowConfig['key'], data: Partial<ReviewFlowConfig>) {
  return request<ReviewFlowConfig>('/tenant/settings/review-flows/save', { method: 'POST', data: { key, ...data } })
}
