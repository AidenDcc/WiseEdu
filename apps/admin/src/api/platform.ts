import { request } from '@aiteach/shared'
import type {
  AdminAccount,
  AgentConfig,
  AiCallLog,
  AiModel,
  AuditRecord,
  DictItem,
  DictTypeKey,
  ErrorLog,
  KnowledgeNode,
  LoginLog,
  OperationLog,
  PlatformNotification,
  PromptTemplate,
  PublicPaper,
  PublicQuestion,
  TenantMenuItem,
  TextbookVersion,
} from '@aiteach/shared'

function withQuery(url: string, params: Record<string, unknown>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') search.append(key, String(value))
  }
  const qs = search.toString()
  return qs ? `${url}?${qs}` : url
}

/* ===== 全局字典（FR-PT-015 / 016） ===== */

export function fetchDict(type: DictTypeKey) {
  return request<DictItem[]>(`/admin/dict/${type}`)
}

export function saveDictItem(type: DictTypeKey, data: Partial<DictItem>) {
  return request<DictItem>(`/admin/dict/${type}/save`, { method: 'POST', data })
}

export function toggleDictItem(type: DictTypeKey, id: number) {
  return request<{ enabled: boolean }>(`/admin/dict/${type}/toggle`, {
    method: 'POST',
    data: { id },
  })
}

export function deleteDictItem(type: DictTypeKey, id: number) {
  return request<null>(`/admin/dict/${type}/delete`, { method: 'POST', data: { id } })
}

export function moveDictItem(type: DictTypeKey, id: number, direction: -1 | 1) {
  return request<null>(`/admin/dict/${type}/move`, { method: 'POST', data: { id, direction } })
}

/* ===== 知识点树 / 教材版本 ===== */

export function fetchKnowledge() {
  return request<KnowledgeNode[]>('/admin/knowledge')
}

export function saveKnowledgeNode(data: Partial<KnowledgeNode>) {
  return request<KnowledgeNode>('/admin/knowledge/save', { method: 'POST', data })
}

export function toggleKnowledgeNode(id: number) {
  return request<{ enabled: boolean }>('/admin/knowledge/toggle', { method: 'POST', data: { id } })
}

export function deleteKnowledgeNode(id: number) {
  return request<null>('/admin/knowledge/delete', { method: 'POST', data: { id } })
}

export function fetchTextbooks() {
  return request<TextbookVersion[]>('/admin/textbooks')
}

export function saveTextbook(data: Partial<TextbookVersion>) {
  return request<TextbookVersion>('/admin/textbooks/save', { method: 'POST', data })
}

export function toggleTextbook(id: number) {
  return request<{ enabled: boolean }>('/admin/textbooks/toggle', { method: 'POST', data: { id } })
}

export function deleteTextbook(id: number) {
  return request<null>('/admin/textbooks/delete', { method: 'POST', data: { id } })
}

/* ===== AI 模型接入（FR-PT-017 ~ 019） ===== */

export function fetchAiModels() {
  return request<AiModel[]>('/admin/ai/models')
}

export function saveAiModel(data: Partial<AiModel> & { apiKey?: string }) {
  return request<AiModel>('/admin/ai/models/save', { method: 'POST', data })
}

export function testAiModel() {
  return request<{ latencyMs: number }>('/admin/ai/models/test', { method: 'POST' })
}

export function healthCheckAiModel(id: number) {
  return request<{ ok: boolean; latencyMs: number; lastCheckAt: string }>('/admin/ai/models/health', {
    method: 'POST',
    data: { id },
  })
}

export function toggleAiModel(id: number) {
  return request<{ enabled: boolean }>('/admin/ai/models/toggle', { method: 'POST', data: { id } })
}

/* ===== 多智能体编排（FR-PT-020 ~ 023） ===== */

export function fetchAgentConfig() {
  return request<AgentConfig>('/admin/ai/agents')
}

export function saveAgentConfig(config: AgentConfig) {
  return request<AgentConfig>('/admin/ai/agents/save', { method: 'POST', data: config })
}

export function rollbackAgentConfig(version: number) {
  return request<AgentConfig>('/admin/ai/agents/rollback', { method: 'POST', data: { version } })
}

/* ===== Prompt 模板（FR-PT-024 ~ 027） ===== */

export function fetchPrompts() {
  return request<PromptTemplate[]>('/admin/prompts')
}

export function savePrompt(data: Partial<PromptTemplate> & { content: string }) {
  return request<PromptTemplate>('/admin/prompts/save', { method: 'POST', data })
}

export function setDefaultPrompt(id: number) {
  return request<null>('/admin/prompts/default', { method: 'POST', data: { id } })
}

export function togglePrompt(id: number) {
  return request<PromptTemplate>('/admin/prompts/toggle', { method: 'POST', data: { id } })
}

export function testPrompt() {
  return request<{ output: string; costMs: number; tokens: number }>('/admin/prompts/test', {
    method: 'POST',
  })
}

export function rollbackPrompt(id: number, version: number) {
  return request<PromptTemplate>('/admin/prompts/rollback', { method: 'POST', data: { id, version } })
}

/* ===== AI 调用日志（FR-PT-028） ===== */

export interface AiLogStats {
  total: number
  successRate: number
  totalTokens: number
  totalCost: number
}

export function fetchAiLogs(params: { org?: string; scene?: string; model?: string; result?: string }) {
  return request<{ list: AiCallLog[]; stats: AiLogStats }>(withQuery('/admin/ai-logs', params))
}


/* ===== 平台资源总库（FR-PT-029 ~ 032） ===== */

export function fetchPublicQuestions() {
  return request<PublicQuestion[]>('/admin/resources/questions')
}

export function fetchPublicPapers() {
  return request<PublicPaper[]>('/admin/resources/papers')
}

export function fetchAuditRecords() {
  return request<AuditRecord[]>('/admin/resources/audit-records')
}

/* ===== 日志审计（FR-PT-035） ===== */

export function fetchLoginLogs() {
  return request<LoginLog[]>('/admin/logs/login')
}

export function fetchOperationLogs() {
  return request<OperationLog[]>('/admin/logs/operation')
}

export function fetchErrorLogs() {
  return request<ErrorLog[]>('/admin/logs/error')
}

/* ===== 系统管理（FR-PT-033 / 034） ===== */

export function fetchAdmins() {
  return request<AdminAccount[]>('/admin/accounts')
}

export function saveAdmin(data: Partial<AdminAccount>) {
  return request<AdminAccount>('/admin/accounts/save', { method: 'POST', data })
}

export function toggleAdmin(id: number) {
  return request<{ enabled: boolean }>('/admin/accounts/toggle', { method: 'POST', data: { id } })
}

export function resetAdminPassword(id: number) {
  return request<null>('/admin/accounts/reset-password', { method: 'POST', data: { id } })
}

export function fetchTenantMenus() {
  return request<TenantMenuItem[]>('/admin/tenant-menus')
}

export function saveTenantMenus(items: TenantMenuItem[]) {
  return request<null>('/admin/tenant-menus/save', { method: 'POST', data: { items } })
}

/* ===== 消息中心 ===== */

export function fetchNotifications() {
  return request<{ list: PlatformNotification[]; unread: number }>('/admin/notifications')
}

export function markNotificationRead(id: number) {
  return request<{ unread: number }>('/admin/notifications/read', { method: 'POST', data: { id } })
}

export function markAllNotificationsRead() {
  return request<{ unread: number }>('/admin/notifications/read-all', { method: 'POST' })
}
