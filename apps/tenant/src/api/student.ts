/**
 * 机构端新模块 API 封装：班级与学生管理（T-08）、AI 学情画像（T-07-08~10）、
 * AI 能力中心（T-10）、机构系统设置（T-11）。
 * 与 org.ts 同一套约定：GET 查询串手动拼接，POST 走 data。
 */
import { request } from '@aiteach/shared'
import type {
  AiArtifactReview,
  AiCapabilityCard,
  AiCenterTask,
  ClassProfileReport,
  ConsentRecord,
  OrgClass,
  OrgSettings,
  OrgStudent,
  ReviewFlowConfig,
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
export function fetchStudents(keyword: string, className: string) {
  return request<OrgStudent[]>(withQuery('/tenant/students', { keyword, className }))
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

/* ===== 监护人知情同意（T-08-06） ===== */
export function fetchConsents(keyword: string) {
  return request<ConsentRecord[]>(withQuery('/tenant/students/consents', { keyword }))
}
export function signConsent(id: number, scopes: string[]) {
  return request<ConsentRecord>('/tenant/students/consents/sign', { method: 'POST', data: { id, scopes } })
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
export function fetchAiTasks(scene: string) {
  return request<AiCenterTask[]>(withQuery('/tenant/ai-center/tasks', { scene }))
}
export function cancelAiTask(id: number) {
  return request<null>('/tenant/ai-center/tasks/cancel', { method: 'POST', data: { id } })
}
export function fetchAiArtifacts(status: string) {
  return request<AiArtifactReview[]>(withQuery('/tenant/ai-center/artifacts', { status }))
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
