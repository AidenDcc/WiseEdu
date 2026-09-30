/**
 * 平台端新模块 API 封装：全局内容运营（P-03）、AI 安全治理与计费（P-05-10~14）、
 * 系统监控与配置（P-06-06 / P-07-04~07）。
 */
import { request } from '@aiteach/shared'
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
} from '@aiteach/shared'

function withQuery(url: string, params: Record<string, unknown>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') search.append(key, String(value))
  }
  const qs = search.toString()
  return qs ? `${url}?${qs}` : url
}

/* ===== 公共题库（P-03-01 ~ 09） ===== */
export function fetchPlatformQuestions(keyword: string, subject: string, status: string) {
  return request<PlatformQuestion[]>(withQuery('/admin/platform/questions', { keyword, subject, status }))
}
export function reviewPlatformQuestion(id: number, pass: boolean) {
  return request<PlatformQuestion>('/admin/platform/questions/review', { method: 'POST', data: { id, pass } })
}
export function togglePlatformQuestion(id: number) {
  return request<PlatformQuestion>('/admin/platform/questions/toggle', { method: 'POST', data: { id } })
}

/* ===== 公共试卷库（P-03-11 ~ 13） ===== */
export function fetchPlatformPapers(keyword: string, subject: string) {
  return request<PlatformPaper[]>(withQuery('/admin/platform/papers', { keyword, subject }))
}
export function reviewPlatformPaper(id: number, pass: boolean) {
  return request<PlatformPaper>('/admin/platform/papers/review', { method: 'POST', data: { id, pass } })
}

/* ===== 内容分发（P-03-25 ~ 27） ===== */
export function fetchDistributions() {
  return request<ContentDistribution[]>('/admin/content/distributions')
}
export function createDistribution(data: {
  contentType: ContentDistribution['contentType']
  contentName: string
  scopeType: ContentDistribution['scopeType']
  scopeText: string
}) {
  return request<ContentDistribution>('/admin/content/distributions/create', { method: 'POST', data })
}
export function toggleDistribution(id: number) {
  return request<ContentDistribution>('/admin/content/distributions/toggle', { method: 'POST', data: { id } })
}

/* ===== 内容合规抽检（P-03-23） ===== */
export function fetchSpotChecks() {
  return request<ComplianceSpotCheck[]>('/admin/content/spot-checks')
}
export function createSpotCheck(scope: string, sampleCount: number) {
  return request<ComplianceSpotCheck>('/admin/content/spot-checks/create', { method: 'POST', data: { scope, sampleCount } })
}
export function closeSpotCheck(id: number) {
  return request<ComplianceSpotCheck>('/admin/content/spot-checks/close', { method: 'POST', data: { id } })
}

/* ===== 内容问题反馈工单（P-03-28） ===== */
export function fetchFeedbackTickets(status: string) {
  return request<ContentFeedbackTicket[]>(withQuery('/admin/content/tickets', { status }))
}
export function handleTicket(id: number, action: 'accept' | 'resolve' | 'reject', reply: string) {
  return request<ContentFeedbackTicket>('/admin/content/tickets/handle', { method: 'POST', data: { id, action, reply } })
}

/* ===== AI 安全治理（P-05-10 ~ 12） ===== */
export function fetchSensitivePolicies() {
  return request<SensitivePolicyGroup[]>('/admin/ai-governance/policies')
}
export function saveSensitivePolicy(data: Partial<SensitivePolicyGroup> & { name: string }) {
  return request<SensitivePolicyGroup>('/admin/ai-governance/policies/save', { method: 'POST', data })
}
export function toggleSensitivePolicy(id: number) {
  return request<SensitivePolicyGroup>('/admin/ai-governance/policies/toggle', { method: 'POST', data: { id } })
}
export function deleteSensitivePolicy(id: number) {
  return request<null>('/admin/ai-governance/policies/delete', { method: 'POST', data: { id } })
}
export function fetchQualityEvals() {
  return request<AiQualityEval[]>('/admin/ai-governance/evals')
}
export function runQualityEval(scene: string) {
  return request<AiQualityEval>('/admin/ai-governance/evals/run', { method: 'POST', data: { scene } })
}
export function fetchTraceRecords(scene: string, safety: string) {
  return request<AiTraceRecord[]>(withQuery('/admin/ai-governance/traces', { scene, safety }))
}

/* ===== AI 计费与租户能力开关（P-05-13 / 14） ===== */
export function fetchBillingRules() {
  return request<AiBillingRule[]>('/admin/ai-billing/rules')
}
export function saveBillingRule(id: number, data: Partial<AiBillingRule>) {
  return request<AiBillingRule>('/admin/ai-billing/rules/save', { method: 'POST', data: { id, ...data } })
}
export function fetchTenantAiSwitches() {
  return request<TenantAiSwitch[]>('/admin/ai-billing/tenant-switches')
}
export function toggleTenantAiCapability(tenantId: number, capKey: string) {
  return request<TenantAiSwitch>('/admin/ai-billing/tenant-switches/toggle', { method: 'POST', data: { tenantId, capKey } })
}

/* ===== 系统监控与配置（P-06-06 / P-07-04 ~ 07） ===== */
export function fetchServiceHealth() {
  return request<ServiceHealthItem[]>('/admin/system/health')
}
export function fetchSystemParams() {
  return request<SystemParam[]>('/admin/system/params')
}
export function saveSystemParam(key: string, value: string) {
  return request<SystemParam>('/admin/system/params/save', { method: 'POST', data: { key, value } })
}
export function fetchMessageTemplates() {
  return request<MessageTemplate[]>('/admin/system/message-templates')
}
export function saveMessageTemplate(data: Partial<MessageTemplate> & { name: string; content: string }) {
  return request<MessageTemplate>('/admin/system/message-templates/save', { method: 'POST', data })
}
export function toggleMessageTemplate(id: number) {
  return request<MessageTemplate>('/admin/system/message-templates/toggle', { method: 'POST', data: { id } })
}
export function fetchStoragePolicies() {
  return request<StoragePolicy[]>('/admin/system/storage')
}
export function saveStoragePolicy(key: string, data: Partial<StoragePolicy>) {
  return request<StoragePolicy>('/admin/system/storage/save', { method: 'POST', data: { key, ...data } })
}
export function fetchBackups() {
  return request<BackupRecord[]>('/admin/system/backups')
}
export function createBackup(scope: string) {
  return request<BackupRecord>('/admin/system/backups/create', { method: 'POST', data: { scope } })
}
