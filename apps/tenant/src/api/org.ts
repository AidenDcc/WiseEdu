/**
 * 机构端业务 API 封装（FR-TM / FR-PP / FR-JC / FR-FL / FR-FX / FR-PM / FR-SQ / FR-OS）。
 * Mock 模式下 query 参数不生效，统一用 withQuery 手动拼接查询串。
 */
import { request } from '@aiteach/shared'
import type {
  Campus,
  FileFolder,
  GeneratedQuestion,
  MaterialExample,
  NotifyMatrixRow,
  OrgCategory,
  OrgFile,
  OrgFormula,
  OrgKnowledgeNode,
  OrgMaterial,
  OrgMedia,
  OrgMessage,
  OrgOperationLog,
  OrgPaper,
  OrgQuestion,
  OrgPrompt,
  OrgRole,
  RecycleItem,
  SquareResource,
  StaffMember,
  StandardFormula,
  TextbookOption,
} from '@aiteach/shared'
import type { PhotoTask } from '@aiteach/shared'

function withQuery<T extends object>(url: string, params: T): string {
  const search = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') search.append(key, String(value))
  })
  const qs = search.toString()
  return qs ? `${url}?${qs}` : url
}

/* ===== 分类树 ===== */
export function fetchCategories() {
  return request<OrgCategory[]>('/tenant/categories')
}
export function saveCategory(data: { id?: number; name: string; parentId: number | null; library?: OrgCategory['library'] }) {
  return request<OrgCategory>('/tenant/categories/save', { method: 'POST', data })
}
export function deleteCategory(id: number) {
  return request<null>('/tenant/categories/delete', { method: 'POST', data: { id } })
}

/* ===== 题目 ===== */
export function fetchQuestions() {
  return request<OrgQuestion[]>('/tenant/questions')
}
export function saveQuestion(data: Partial<OrgQuestion> & { stem: string; submit: boolean }) {
  return request<OrgQuestion>('/tenant/questions/save', { method: 'POST', data })
}
export function submitQuestions(ids: number[]) {
  return request<{ count: number }>('/tenant/questions/submit', { method: 'POST', data: { ids } })
}
export function deleteQuestions(ids: number[]) {
  return request<{ count: number }>('/tenant/questions/delete', { method: 'POST', data: { ids } })
}
export function moveQuestions(ids: number[], categoryId: number) {
  return request<{ count: number }>('/tenant/questions/move', { method: 'POST', data: { ids, categoryId } })
}
export function reviewQuestion(id: number, pass: boolean, opinion: string) {
  return request<OrgQuestion>('/tenant/questions/review', { method: 'POST', data: { id, pass, opinion } })
}
export function variantOf(id: number) {
  return request<OrgQuestion>('/tenant/questions/variant', { method: 'POST', data: { id } })
}

/* ===== 字典 / 知识点树（题库管理筛选） ===== */
export interface TenantDictItem {
  id: number
  name: string
  sort: number
  enabled: boolean
}
export function fetchTenantDict(type: string) {
  return request<TenantDictItem[]>(withQuery('/tenant/dict', { type }))
}
export function fetchTextbookMatrix() {
  return request<TextbookOption[]>('/tenant/knowledge/textbooks')
}
export function fetchKnowledgeTree(grade: string, subject: string, version: string) {
  return request<OrgKnowledgeNode[]>(withQuery('/tenant/knowledge/tree', { grade, subject, version }))
}

/* ===== AI 出题 / 额度 ===== */
export function fetchQuota() {
  return request<{ used: number; quota: number }>('/tenant/quota')
}
export function generateQuestions(count: number) {
  return request<GeneratedQuestion[]>('/tenant/ai/generate', { method: 'POST', data: { count } })
}
export function adoptGenerated(data: { stem: string; options: string[]; answer: string; analysis: string; knowledge: string[]; difficulty: string; subject: string; grade: string; type: string }) {
  return request<OrgQuestion>('/tenant/ai/adopt', { method: 'POST', data })
}

/* ===== 拍照识题 ===== */
export function fetchPhotoTasks() {
  return request<PhotoTask[]>('/tenant/photo/tasks')
}
export function uploadPhotos(names: string[]) {
  return request<PhotoTask[]>('/tenant/photo/upload', { method: 'POST', data: { names } })
}
export function recognizePhoto(id: string) {
  return request<PhotoTask>('/tenant/photo/recognize', { method: 'POST', data: { id } })
}
export function decidePhoto(taskId: string, resultId: string, decision: 'import' | 'draft' | 'drop') {
  return request<PhotoTask>('/tenant/photo/decide', { method: 'POST', data: { taskId, resultId, decision } })
}

/* ===== 试卷 ===== */
export function fetchPapers() {
  return request<OrgPaper[]>('/tenant/papers')
}
export function savePaper(data: Partial<OrgPaper> & { name: string; submit?: boolean; totalScore?: number }) {
  return request<OrgPaper>('/tenant/papers/save', { method: 'POST', data })
}
export function deletePaper(id: number) {
  return request<null>('/tenant/papers/delete', { method: 'POST', data: { id } })
}
export function reviewPaper(id: number, pass: boolean, opinion: string) {
  return request<OrgPaper>('/tenant/papers/review', { method: 'POST', data: { id, pass, opinion } })
}
export function aiComposePaper(data: { name: string; subject: string; grade: string; structure: Array<{ type: string; count: number; score: number }> }) {
  return request<{ paper: OrgPaper; aiPicked: number }>('/tenant/papers/ai-compose', { method: 'POST', data })
}
export function swapPaperQuestion(paperId: number, questionId: number) {
  return request<{ paper: OrgPaper; newId: number }>('/tenant/papers/swap-question', { method: 'POST', data: { paperId, questionId } })
}
export function generateParallels(motherId: number, count: number) {
  return request<OrgPaper[]>('/tenant/papers/parallels', { method: 'POST', data: { motherId, count } })
}

/* ===== 教辅 ===== */
export function fetchMaterials() {
  return request<OrgMaterial[]>('/tenant/materials')
}
export function uploadMaterial(data: { name: string; type: string; subject: string }) {
  return request<OrgMaterial>('/tenant/materials/upload', { method: 'POST', data })
}
export function reRecognizeMaterial(id: number) {
  return request<OrgMaterial>('/tenant/materials/recognize', { method: 'POST', data: { id } })
}
export function decideExample(materialId: number, exampleId: number, decision: 'import' | 'edit' | 'ignore') {
  return request<MaterialExample>('/tenant/materials/example', { method: 'POST', data: { materialId, exampleId, decision } })
}
export function finishMaterial(id: number, pendingCount: number) {
  return request<{ message: string }>('/tenant/materials/finish', { method: 'POST', data: { id, pendingCount } })
}
export function deleteMaterial(id: number) {
  return request<null>('/tenant/materials/delete', { method: 'POST', data: { id } })
}

/* ===== 多媒体 ===== */
export function fetchMedia() {
  return request<OrgMedia[]>('/tenant/media')
}
export function uploadMedia(data: { name: string; kind: OrgMedia['kind']; subject: string; knowledge: string[] }) {
  return request<OrgMedia>('/tenant/media/upload', { method: 'POST', data })
}
export function linkMedia(id: number, targets: string[]) {
  return request<{ linkedCount: number }>('/tenant/media/link', { method: 'POST', data: { id, targets } })
}
export function deleteMedia(id: number) {
  return request<{ linkedCount: number }>('/tenant/media/delete', { method: 'POST', data: { id } })
}

/* ===== 我的文件 ===== */
export function fetchFolders() {
  return request<FileFolder[]>('/tenant/folders')
}
export function saveFolder(data: { id?: number; name: string; parentId: number | null }) {
  return request<FileFolder>('/tenant/folders/save', { method: 'POST', data })
}
export function deleteFolder(id: number) {
  return request<{ moved: number }>('/tenant/folders/delete', { method: 'POST', data: { id } })
}
export function fetchFiles() {
  return request<{ list: OrgFile[]; usage: { usedGb: number; quotaGb: number } }>('/tenant/files')
}
export function uploadFiles(names: string[], folderId: number) {
  return request<OrgFile[]>('/tenant/files/upload', { method: 'POST', data: { names, folderId } })
}
export function deleteFile(id: number) {
  return request<null>('/tenant/files/delete', { method: 'POST', data: { id } })
}
export function recognizeFile(id: number) {
  return request<{ file: OrgFile; questionCount: number; paperId: number }>('/tenant/files/recognize', { method: 'POST', data: { id } })
}

/* ===== 公式中心 ===== */
export function fetchStandardFormulas() {
  return request<StandardFormula[]>('/tenant/formulas/standard')
}
export function collectStandardFormula(id: number) {
  return request<StandardFormula>('/tenant/formulas/collect', { method: 'POST', data: { id } })
}
export function fetchFormulas() {
  return request<OrgFormula[]>('/tenant/formulas')
}
export function saveFormula(data: { id?: number; name: string; category?: string; latex: string }) {
  return request<OrgFormula>('/tenant/formulas/save', { method: 'POST', data })
}
export function shareFormula(id: number) {
  return request<OrgFormula>('/tenant/formulas/share', { method: 'POST', data: { id } })
}
export function reviewFormula(id: number, pass: boolean) {
  return request<OrgFormula>('/tenant/formulas/review', { method: 'POST', data: { id, pass } })
}
export function offshelfFormula(id: number) {
  return request<OrgFormula>('/tenant/formulas/offshelf', { method: 'POST', data: { id } })
}
export function deleteFormula(id: number) {
  return request<null>('/tenant/formulas/delete', { method: 'POST', data: { id } })
}

/* ===== 提示词模板 ===== */
export function fetchPlatformPrompts() {
  return request<Array<{ id: number; name: string; scene: string; content: string }>>('/tenant/prompts/platform')
}
export function fetchOrgPrompts() {
  return request<OrgPrompt[]>('/tenant/prompts')
}
export function copyPlatformPrompt(id: number) {
  return request<OrgPrompt>('/tenant/prompts/copy', { method: 'POST', data: { id } })
}
export function saveOrgPrompt(data: Partial<OrgPrompt> & { name: string; content: string }) {
  return request<OrgPrompt>('/tenant/prompts/save', { method: 'POST', data })
}
export function toggleOrgPrompt(id: number) {
  return request<OrgPrompt>('/tenant/prompts/toggle', { method: 'POST', data: { id } })
}
export function setDefaultOrgPrompt(id: number) {
  return request<OrgPrompt>('/tenant/prompts/default', { method: 'POST', data: { id } })
}
export function testOrgPrompt() {
  return request<{ output: string; costMs: number; tokens: number }>('/tenant/prompts/test', { method: 'POST' })
}
export function rollbackOrgPrompt(id: number, version: number) {
  return request<OrgPrompt>('/tenant/prompts/rollback', { method: 'POST', data: { id, version } })
}
export function deleteOrgPrompt(id: number) {
  return request<null>('/tenant/prompts/delete', { method: 'POST', data: { id } })
}

/* ===== 知识广场 ===== */
export function fetchSquare() {
  return request<SquareResource[]>('/tenant/square')
}
export function collectSquare(id: number) {
  return request<SquareResource>('/tenant/square/collect', { method: 'POST', data: { id } })
}
export function downloadSquare(id: number) {
  return request<SquareResource>('/tenant/square/download', { method: 'POST', data: { id } })
}

/* ===== 员工 / 角色 / 校区 ===== */
export function fetchStaff() {
  return request<{ list: StaffMember[]; quota: { max: number; current: number } }>('/tenant/staff')
}
export function saveStaff(data: { id?: number; name: string; phone: string; role: string; campus: string }) {
  return request<StaffMember>('/tenant/staff/save', { method: 'POST', data })
}
export function toggleStaff(id: number) {
  return request<StaffMember>('/tenant/staff/toggle', { method: 'POST', data: { id } })
}
export function deleteStaff(id: number) {
  return request<null>('/tenant/staff/delete', { method: 'POST', data: { id } })
}
export function fetchRoles() {
  return request<{ roles: OrgRole[]; modules: Array<{ key: string; title: string; ops: string[] }> }>('/tenant/roles')
}
export function saveRole(data: { id?: number; name: string; perms: Record<string, string[]> }) {
  return request<OrgRole>('/tenant/roles/save', { method: 'POST', data })
}
export function deleteRole(id: number) {
  return request<null>('/tenant/roles/delete', { method: 'POST', data: { id } })
}
export function fetchCampuses() {
  return request<Campus[]>('/tenant/campuses')
}
export function saveCampus(data: { id?: number; name: string; code: string; address?: string; manager?: string }) {
  return request<Campus>('/tenant/campuses/save', { method: 'POST', data })
}
export function toggleCampus(id: number) {
  return request<Campus>('/tenant/campuses/toggle', { method: 'POST', data: { id } })
}
export function deleteCampus(id: number) {
  return request<null>('/tenant/campuses/delete', { method: 'POST', data: { id } })
}

/* ===== 日志 / 通知 ===== */
export function fetchOrgLoginLogs() {
  return request<Array<{ id: number; account: string; ip: string; device: string; ok: boolean; time: string }>>('/tenant/logs/login')
}
export function fetchOrgOperationLogs() {
  return request<OrgOperationLog[]>('/tenant/logs/operation')
}
export function fetchNotifyMatrix() {
  return request<NotifyMatrixRow[]>('/tenant/notify')
}
export function saveNotifyMatrix() {
  return request<null>('/tenant/notify/save', { method: 'POST' })
}

/* ===== 回收站 ===== */
export function fetchRecycle(kind: string) {
  return request<RecycleItem[]>(withQuery('/tenant/recycle', { kind }))
}
export function restoreRecycle(ids: number[]) {
  return request<{ message: string }>('/tenant/recycle/restore', { method: 'POST', data: { ids } })
}
export function purgeRecycle(ids: number[]) {
  return request<{ message: string }>('/tenant/recycle/purge', { method: 'POST', data: { ids } })
}

/* ===== 消息中心 ===== */
export function fetchOrgMessages(tab: string) {
  return request<OrgMessage[]>(withQuery('/tenant/messages', { tab }))
}
export function markOrgMessageRead(id: number) {
  return request<null>('/tenant/messages/read', { method: 'POST', data: { id } })
}
export function markAllOrgMessagesRead(tab: string) {
  return request<null>('/tenant/messages/read-all', { method: 'POST', data: { tab } })
}
export function deleteOrgMessage(id: number) {
  return request<null>('/tenant/messages/delete', { method: 'POST', data: { id } })
}

/* ===== 机构菜单权限 ===== */
export interface OrgMenuNodeApi {
  key: string
  title: string
  enabled: boolean
  platformLocked?: boolean
  children?: Array<{ key: string; title: string; enabled: boolean; platformLocked?: boolean }>
}
export function fetchOrgMenus() {
  return request<OrgMenuNodeApi[]>('/tenant/menus')
}
export function saveOrgMenus(items: OrgMenuNodeApi[]) {
  return request<null>('/tenant/menus/save', { method: 'POST', data: { items } })
}
