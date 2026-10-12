/**
 * 平台管理端「公共题库 / 公共试卷库」的数据访问层。
 *
 * ⚠️ 现状：这两个页面的 UI 与交互要与机构端「题库管理 / 试卷库」**完全一致**，所以当前
 * 直接复用了机构端的数据接口与数据模型（题目 `OrgQuestion` / 试卷 `OrgPaper`）—— 两端读同一份
 * 共享 mock（`@aiteach/shared` 的 `/tenant/*` 路由）。
 *
 * 接平台自己的公共库时，把下面这些 `fetchXxx` 的 URL 换成 `/admin/platform/**` 即可，
 * 页面与公共组件不需要动：它们只认 `@aiteach/business-common` 的 `BusinessApi` 契约与 `Org*` 结构，
 * 而**查询参数、权限、`tenant_id` 过滤都收在本文件**（这正是公共层不管数据来源的原因）。
 *
 * 末尾的 `businessApi` 对象是给 `provideBusinessApi()` 用的：写成对象字面量而不是 `import * as`，
 * 是为了让「契约成员有没有漏」在编译期就暴露出来。
 */
import { request } from '@aiteach/shared'
import type {
  FileFolder,
  OrgFile,
  OrgKnowledgeNode,
  OrgMaterial,
  OrgMedia,
  OrgPaper,
  OrgQuestion,
  QuestionCorrection,
  QuestionCorrectionType,
  TextbookOption,
} from '@aiteach/shared'
import type { BusinessApi, TenantDictItem } from '@aiteach/business-common'

function withQuery<T extends object>(url: string, params: T): string {
  const search = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') search.append(key, String(value))
  })
  const qs = search.toString()
  return qs ? `${url}?${qs}` : url
}

/* ===== 字典 / 知识点树 / 教材级联 ===== */
export function fetchTenantDict(type: string) {
  return request<TenantDictItem[]>(withQuery('/tenant/dict', { type }))
}
export function fetchTextbookMatrix() {
  return request<TextbookOption[]>('/tenant/knowledge/textbooks')
}
export function fetchKnowledgeTree(grade: string, subject: string, version: string) {
  return request<OrgKnowledgeNode[]>(withQuery('/tenant/knowledge/tree', { grade, subject, version }))
}

/* ===== 题目 ===== */
export function fetchQuestions() {
  return request<OrgQuestion[]>('/tenant/questions')
}
/** 上架 / 下架：`approved ⇄ offline`，返回更新后的题目 */
export function toggleQuestionOffline(id: number) {
  return request<OrgQuestion>('/tenant/questions/offline', { method: 'POST', data: { id } })
}
export function variantOf(id: number) {
  return request<OrgQuestion>('/tenant/questions/variant', { method: 'POST', data: { id } })
}
/** 提交题目纠错反馈（类型多选 + 描述） */
export function submitQuestionCorrection(data: {
  questionId: number
  types: QuestionCorrectionType[]
  description: string
}) {
  return request<QuestionCorrection>('/tenant/questions/correct', { method: 'POST', data })
}
/** 全部纠错记录（按提交时间倒序），页面本地按 questionId 分组 */
export function fetchQuestionCorrections() {
  return request<QuestionCorrection[]>('/tenant/questions/corrections')
}

/* ===== 试卷 ===== */
export function fetchPapers() {
  return request<OrgPaper[]>('/tenant/papers')
}
export function deletePaper(id: number) {
  return request<null>('/tenant/papers/delete', { method: 'POST', data: { id } })
}
/** 生成平行卷（FR-PP-015）：固定产出 1 份 B 卷 */
export function generateParallels(motherId: number, folderId: number) {
  return request<OrgPaper[]>('/tenant/papers/parallels', { method: 'POST', data: { motherId, folderId } })
}
/** 浏览计数：试卷库「预览」时累加（列表本地同步 +1） */
export function browsePaper(id: number) {
  return request<null>('/tenant/papers/browse', { method: 'POST', data: { id } })
}
/** 下载计数：试卷库「导出 Word / PDF」时累加 */
export function downloadPaper(id: number) {
  return request<null>('/tenant/papers/download', { method: 'POST', data: { id } })
}

/* ===== 我的文件（平行卷落库要选文件夹） ===== */
export function fetchFolders() {
  return request<FileFolder[]>('/tenant/folders')
}
export function saveFolder(data: { id?: number; name: string; parentId: number | null }) {
  return request<FileFolder>('/tenant/folders/save', { method: 'POST', data })
}
export function fetchFiles() {
  return request<{ list: OrgFile[]; usage: { usedGb: number; quotaGb: number } }>('/tenant/files')
}

/* ===== 教辅 / 多媒体（预览里的「相似题」需要完整题池） ===== */
export function fetchMaterials() {
  return request<OrgMaterial[]>('/tenant/materials')
}
export function fetchMedia() {
  return request<OrgMedia[]>('/tenant/media')
}

/**
 * 注入给 `@aiteach/business-common` 的实现（见 `main.ts` 的 `provideBusinessApi`）。
 * 写成对象字面量而不是 `export *`：契约里少一个方法、或多一个不兼容的签名，这里就编译不过。
 */
export const businessApi: BusinessApi = {
  fetchTenantDict,
  fetchTextbookMatrix,
  fetchKnowledgeTree,
  fetchQuestions,
  fetchQuestionCorrections,
  submitQuestionCorrection,
  fetchPapers,
  generateParallels,
  fetchMaterials,
  fetchMedia,
  fetchFolders,
  fetchFiles,
  saveFolder,
}
