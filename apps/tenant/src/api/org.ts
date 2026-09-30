/**
 * 机构端业务 API 封装（FR-TM / FR-PP / FR-JC / FR-FL / FR-FX / FR-PM / FR-SQ / FR-OS）。
 * GET 查询串统一用 withQuery 手动拼接（mock 路由与真实后端按同一 URL 契约解析）。
 */
import { request } from '@aiteach/shared'
import type {
  AnswerStatus,
  ApprovalKind,
  ApprovalStatus,
  Campus,
  CollabMember,
  CollabRequirement,
  ComposeSearchIntent,
  DrawEditorType,
  ExamAnswer,
  ExamSession,
  FileFolder,
  GeneratedQuestion,
  GradingDuty,
  Homework,
  HomeworkSubmission,
  MaterialExample,
  MistakeEntry,
  MistakeMastery,
  NotifyMatrixRow,
  OrgCategory,
  OrgCollabTask,
  OrgFile,
  OrgFileKind,
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
  OrgSearchResult,
  PaperAnalysis,
  PaperVersion,
  PrepTask,
  RecycleItem,
  ResourceApproval,
  ResourceScope,
  SquareResource,
  StaffMember,
  StandardFormula,
  TeachDoc,
  TeachDocKind,
  TextbookOption,
  VideoClip,
} from '@aiteach/shared'
import type { PhotoTask, RecognizedImportQuestion } from '@aiteach/shared'

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

/* ===== 全局搜索（FR-GN-026） ===== */
/** 一次检索返回题目 / 试卷 / 同步备课 / 视频 / 我的文件五个分类，搜索面板按页签展示 */
export function fetchGlobalSearch(keyword: string) {
  return request<OrgSearchResult>(withQuery('/tenant/search', { keyword }))
}
/** 图片搜索的本地演示口径（未配置视觉通道时用）：按文件名返回一个演示关键词 */
export function recognizeSearchImage(name: string) {
  return request<{ keyword: string }>('/tenant/search/image', { method: 'POST', data: { name } })
}

/**
 * 题库组卷工作台 AI 搜索的本地演示解读（未配置 AI Key 时的回退）：
 * 后端按题库语料做确定性的词表匹配，保证同一输入每次得到同一份解读。
 */
export function interpretComposeSearch(data: { text?: string; name?: string }) {
  return request<ComposeSearchIntent>('/tenant/ai/compose-search', { method: 'POST', data })
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
/** 首页页脚版权信息：管理端「数据字典 → 版权信息」维护，接口仅返回启用项且已按排序 */
export function fetchCopyrightNotices() {
  return request<TenantDictItem[]>(withQuery('/tenant/dict', { type: 'copyright' }))
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
/** 真实 AI 识别完成后，把任务整体回注册（结果确认/入库与 mock 识别同一条链路） */
export function registerPhotoTask(task: PhotoTask) {
  return request<PhotoTask>('/tenant/photo/register', { method: 'POST', data: { task } })
}
export function decidePhoto(
  taskId: string,
  resultId: string,
  decision: 'import' | 'draft' | 'drop',
  /** 校对区改过的内容，随决策一并提交（此前未回传，改动被静默丢弃） */
  edit?: { stem?: string; options?: string[]; answer?: string; analysis?: string; subject?: string; grade?: string },
) {
  return request<PhotoTask>('/tenant/photo/decide', { method: 'POST', data: { taskId, resultId, decision, edit } })
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

/* ===== 协同组卷（FR-PP-004 ~ 007 / 017 ~ 021） =====
   接口按「任务 / 入卷 / 版本」三类拆分，与 mock 路由一一对应：
   加一道题不必回传整张试卷，冲突面因此小得多。 */

export function fetchCollabTasks() {
  return request<OrgCollabTask[]>('/tenant/collab/tasks')
}
export function fetchCollabTask(id: number) {
  return request<{ task: OrgCollabTask; paper: OrgPaper }>(withQuery('/tenant/collab/task', { id }))
}
export function saveCollabTask(data: {
  id?: number
  name: string
  requirement: CollabRequirement
  members: Array<Pick<CollabMember, 'name' | 'questionTypes' | 'perms'>>
  /** 卷面来源：把这份已有试卷的卷面复制过来当起始卷（从「试卷编辑 → 协同组卷」进来时带） */
  sourcePaperId?: number
}) {
  return request<{ task: OrgCollabTask; paper: OrgPaper }>('/tenant/collab/tasks/save', { method: 'POST', data })
}
export function deleteCollabTask(id: number) {
  return request<null>('/tenant/collab/tasks/delete', { method: 'POST', data: { id } })
}
export function collabAddQuestions(data: {
  taskId: number
  memberName: string
  questions: Array<{ questionId: number; score?: number }>
}) {
  return request<{ paper: OrgPaper; added: number }>('/tenant/collab/questions/add', { method: 'POST', data })
}
export function collabRemoveQuestion(data: { taskId: number; memberName: string; questionId: number }) {
  return request<OrgPaper>('/tenant/collab/questions/remove', { method: 'POST', data })
}
export function collabAiCompose(data: {
  taskId: number
  memberName: string
  type: string
  count?: number
  difficulty?: string
  allowGenerate?: boolean
}) {
  return request<{ paper: OrgPaper; picked: number[]; generated: number }>('/tenant/collab/ai-compose', {
    method: 'POST',
    data,
  })
}
export function collabSubmitMember(data: { taskId: number; memberName: string }) {
  return request<OrgCollabTask>('/tenant/collab/member/submit', { method: 'POST', data })
}
export function collabReopenMember(data: { taskId: number; memberName: string }) {
  return request<OrgCollabTask>('/tenant/collab/member/reopen', { method: 'POST', data })
}
export function fetchPaperVersions(paperId: number) {
  return request<PaperVersion[]>(withQuery('/tenant/collab/versions', { paperId }))
}
export function restorePaperVersion(data: { paperId: number; versionId: number }) {
  return request<{ paper: OrgPaper; versions: PaperVersion[] }>('/tenant/collab/versions/restore', {
    method: 'POST',
    data,
  })
}
export function replacePaperVersion(data: { paperId: number; versionId: number; note?: string }) {
  return request<{ paper: OrgPaper; versions: PaperVersion[] }>('/tenant/collab/versions/replace', {
    method: 'POST',
    data,
  })
}

/* ===== 讲义课件（FR-JC-005 ~ 012） ===== */
export function fetchTeachDocs(kind?: TeachDocKind) {
  return request<TeachDoc[]>(withQuery('/tenant/teach/docs', { kind }))
}
export function saveTeachDoc(data: Partial<TeachDoc> & { kind: TeachDocKind; name: string }) {
  return request<TeachDoc>('/tenant/teach/docs/save', { method: 'POST', data })
}
export function deleteTeachDoc(id: number) {
  return request<null>('/tenant/teach/docs/delete', { method: 'POST', data: { id } })
}
export function duplicateTeachDoc(id: number) {
  return request<TeachDoc>('/tenant/teach/docs/duplicate', { method: 'POST', data: { id } })
}
export function toggleTeachDocPublish(id: number) {
  return request<TeachDoc>('/tenant/teach/docs/publish', { method: 'POST', data: { id } })
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
export function uploadMedia(data: {
  name: string
  kind: OrgMedia['kind']
  subject: string
  knowledge: string[]
  /** 题目正文插图走这里：携带字节，由 mock 媒体库留存并返回可引用 URL */
  dataUrl?: string
  mime?: string
  sizeMb?: number
}) {
  return request<OrgMedia>('/tenant/media/upload', { method: 'POST', data })
}
export function linkMedia(id: number, targets: string[]) {
  return request<{ linkedCount: number }>('/tenant/media/link', { method: 'POST', data: { id, targets } })
}
export function deleteMedia(id: number) {
  return request<{ linkedCount: number }>('/tenant/media/delete', { method: 'POST', data: { id } })
}
export function fetchMediaDetail(id: number) {
  return request<OrgMedia>(`/tenant/media/detail?id=${id}`)
}
/** 保存绘图工程：仅草稿时不带 svgDataUrl；确认导出时携带 SVG 字节生成可引用 URL */
export function saveDrawMedia(data: {
  id?: number
  name: string
  subject: string
  knowledge?: string[]
  editorType: DrawEditorType
  projectJson?: string
  molfileText?: string
  svgDataUrl?: string
}) {
  return request<OrgMedia>('/tenant/media/draw/save', { method: 'POST', data })
}
/** AI 构图草稿（mock 网关）：返回原始工程 JSON / molfile，前端必须经 Schema 校验后才可载入画布 */
export function generateAiDraw(data: { mediaType: DrawEditorType; userPrompt: string }) {
  return request<{ projectJson?: string; molfileText?: string }>('/tenant/media/ai/draw/generate', {
    method: 'POST',
    data,
  })
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
/** 移动文件夹（目标为自身或子孙时后端拒绝） */
export function moveFolder(id: number, targetId: number) {
  return request<FileFolder>('/tenant/folders/move', { method: 'POST', data: { id, targetId } })
}
export function pinFolder(id: number, pinned: boolean) {
  return request<FileFolder>('/tenant/folders/pin', { method: 'POST', data: { id, pinned } })
}
export function fetchFiles() {
  return request<{ list: OrgFile[]; usage: { usedGb: number; quotaGb: number } }>('/tenant/files')
}
export function uploadFiles(names: string[], folderId: number, sizes?: number[]) {
  return request<OrgFile[]>('/tenant/files/upload', { method: 'POST', data: { names, folderId, sizes } })
}
/** 新建在线文档（无实体字节） */
export function createFile(data: { name: string; kind: OrgFileKind; folderId: number }) {
  return request<OrgFile>('/tenant/files/create', { method: 'POST', data })
}
export function renameFile(id: number, name: string) {
  return request<OrgFile>('/tenant/files/rename', { method: 'POST', data: { id, name } })
}
export function moveFiles(ids: number[], targetId: number) {
  return request<{ moved: number }>('/tenant/files/move', { method: 'POST', data: { ids, targetId } })
}
/** 删除文件（支持批量；进回收站，保留 30 天） */
export function deleteFiles(ids: number[]) {
  return request<null>('/tenant/files/delete', { method: 'POST', data: { ids } })
}
/** 复制到：保留原文件，在目标目录生成副本 */
export function copyFiles(ids: number[], targetId: number) {
  return request<{ copied: number }>('/tenant/files/copy', { method: 'POST', data: { ids, targetId } })
}
/** 创建副本：原地复制一份，名称加「（副本）」 */
export function duplicateFile(id: number) {
  return request<OrgFile>('/tenant/files/duplicate', { method: 'POST', data: { id } })
}
export function pinFile(id: number, pinned: boolean) {
  return request<OrgFile>('/tenant/files/pin', { method: 'POST', data: { id, pinned } })
}
/** 转为课件：文件类型改为课件，并在备课中心建同名课件记录 */
export function convertToCourseware(id: number) {
  return request<OrgFile>('/tenant/files/convert-courseware', { method: 'POST', data: { id } })
}
export function recognizeFile(id: number) {
  return request<{ file: OrgFile; questionCount: number; paperId: number }>('/tenant/files/recognize', { method: 'POST', data: { id } })
}
/** 文档 AI 识别确认入库：题目入题库 + 按题型归组生成草稿试卷（paperId 为 null 表示纯题集） */
export function importRecognizedFile(
  id: number,
  payload: { makePaper: boolean; paperName: string; questions: RecognizedImportQuestion[] },
) {
  return request<{ file: OrgFile; questionCount: number; paperId: number | null }>('/tenant/files/import-recognized', {
    method: 'POST',
    data: { id, ...payload },
  })
}

/* ===== 公式中心 ===== */
export interface StandardFormulaQuery {
  subject?: string
  /** 知识点叶子 tag，命中其一即可 */
  knowledge?: string[]
  keyword?: string
}
export function fetchStandardFormulas(query: StandardFormulaQuery = {}) {
  return request<StandardFormula[]>(withQuery('/tenant/formulas/standard', {
    subject: query.subject,
    keyword: query.keyword,
    knowledge: query.knowledge?.join(','),
  }))
}
export function collectStandardFormula(id: number) {
  return request<StandardFormula>('/tenant/formulas/collect', { method: 'POST', data: { id } })
}
export interface OrgFormulaQuery {
  subject?: string
  keyword?: string
}
export function fetchFormulas(query: OrgFormulaQuery = {}) {
  return request<OrgFormula[]>(withQuery('/tenant/formulas', query))
}
export function saveFormula(data: { id?: number; name: string; subject?: string; category?: string; latex: string }) {
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

/* ===== 考试与在线阅卷 ===== */
export function fetchExamSessions() {
  return request<ExamSession[]>('/tenant/exam/sessions')
}
export function fetchExamSession(id: number) {
  return request<{ session: ExamSession; paper: OrgPaper; answers: ExamAnswer[] }>(withQuery('/tenant/exam/session', { id }))
}
export function saveExamSession(data: {
  id?: number
  name: string
  paperId: number
  classes: string[]
  examAt?: string
}) {
  return request<ExamSession>('/tenant/exam/sessions/save', { method: 'POST', data })
}
export function deleteExamSession(id: number) {
  return request<null>('/tenant/exam/sessions/delete', { method: 'POST', data: { id } })
}
export function assignDuty(sessionId: number, dutyId: number, graders: string[], mode: GradingDuty['mode']) {
  return request<ExamSession>('/tenant/exam/duty/assign', { method: 'POST', data: { sessionId, dutyId, graders, mode } })
}
export function saveAnswerScore(sessionId: number, answerId: number, questionId: number, score: number) {
  return request<ExamAnswer>('/tenant/exam/answers/score', { method: 'POST', data: { sessionId, answerId, questionId, score } })
}
export function markAnswer(sessionId: number, answerId: number, status: AnswerStatus, remark?: string) {
  return request<ExamAnswer>('/tenant/exam/answers/mark', { method: 'POST', data: { sessionId, answerId, status, remark } })
}
export function finishExamSession(id: number) {
  return request<ExamSession>('/tenant/exam/sessions/finish', { method: 'POST', data: { id } })
}

/* ===== 试卷分析 ===== */
export function fetchPaperAnalysis(sessionId: number) {
  return request<PaperAnalysis>(withQuery('/tenant/exam/analysis', { sessionId }))
}

/* ===== 错题本 ===== */
export function fetchMistakes(scope?: string) {
  return request<MistakeEntry[]>(withQuery('/tenant/mistakes', { scope }))
}
export function fetchMistakeScopes() {
  return request<string[]>('/tenant/mistakes/scopes')
}
export function saveMistake(data: Partial<MistakeEntry> & { questionId: number; scope: string }) {
  return request<MistakeEntry>('/tenant/mistakes/save', { method: 'POST', data })
}
export function deleteMistake(id: number) {
  return request<null>('/tenant/mistakes/delete', { method: 'POST', data: { id } })
}
export function setMistakeMastery(id: number, mastery: MistakeMastery) {
  return request<MistakeEntry>('/tenant/mistakes/mastery', { method: 'POST', data: { id, mastery } })
}
export function fetchSimilarQuestions(mistakeId: number, limit = 4) {
  return request<OrgQuestion[]>(withQuery('/tenant/mistakes/similar', { id: mistakeId, limit }))
}
export function buildMistakeDrill(ids: number[], withSimilar = true) {
  return request<{ name: string; questionIds: number[] }>('/tenant/mistakes/drill', { method: 'POST', data: { ids, withSimilar } })
}

/* ===== 集体备课 ===== */
export function fetchPrepTasks() {
  return request<PrepTask[]>('/tenant/prep/tasks')
}
export function fetchPrepTask(id: number) {
  return request<PrepTask>(withQuery('/tenant/prep/task', { id }))
}
export function savePrepTask(data: {
  id?: number
  name: string
  subject: string
  grade: string
  docKind?: TeachDocKind
  docId?: number
  docName: string
  requirement: PrepTask['requirement']
  members: Array<Partial<PrepTask['members'][number]> & { name: string }>
}) {
  return request<PrepTask>('/tenant/prep/tasks/save', { method: 'POST', data })
}
export function deletePrepTask(id: number) {
  return request<null>('/tenant/prep/tasks/delete', { method: 'POST', data: { id } })
}
export function addPrepComment(id: number, body: string, target: string) {
  return request<PrepTask>('/tenant/prep/comments/add', { method: 'POST', data: { id, body, target } })
}
export function deletePrepComment(id: number, commentId: number) {
  return request<PrepTask>('/tenant/prep/comments/delete', { method: 'POST', data: { id, commentId } })
}
export function addPrepVersion(id: number, summary: string, snapshot: string) {
  return request<PrepTask>('/tenant/prep/versions/add', { method: 'POST', data: { id, summary, snapshot } })
}
export function revertPrepVersion(id: number, versionId: number) {
  return request<{ task: PrepTask; snapshot: string }>('/tenant/prep/versions/revert', { method: 'POST', data: { id, versionId } })
}
export function replacePrepVersion(id: number, versionId: number) {
  return request<{ task: PrepTask; snapshot: string; versions: PrepTask['versions'] }>('/tenant/prep/versions/replace', {
    method: 'POST',
    data: { id, versionId },
  })
}
export function submitPrepDuty(id: number, name: string) {
  return request<PrepTask>('/tenant/prep/duty/submit', { method: 'POST', data: { id, name } })
}
export function finalizePrepTask(id: number) {
  return request<PrepTask>('/tenant/prep/finalize', { method: 'POST', data: { id } })
}

/* ===== 校本资源审批 ===== */
export function fetchApprovals(status?: string) {
  return request<ResourceApproval[]>(withQuery('/tenant/approvals', { status }))
}
export function fetchApprovalSummary() {
  return request<{ pending: number; approved: number; rejected: number }>('/tenant/approvals/summary')
}
export function submitApproval(data: {
  kind: ApprovalKind
  name: string
  subject: string
  grade: string
  scope: ResourceScope
  note?: string
}) {
  return request<ResourceApproval>('/tenant/approvals/submit', { method: 'POST', data })
}
export function reviewApproval(id: number, pass: boolean, opinion: string) {
  return request<ResourceApproval>('/tenant/approvals/review', { method: 'POST', data: { id, pass, opinion } })
}
export function revokeApproval(id: number) {
  return request<null>('/tenant/approvals/revoke', { method: 'POST', data: { id } })
}

/* ===== 视频切片（微课） ===== */
export function fetchVideoClips(mediaId?: number) {
  return request<VideoClip[]>(withQuery('/tenant/clips', { mediaId }))
}
export function saveVideoClip(data: Partial<VideoClip> & { mediaId: number; title: string; start: number; end: number }) {
  return request<VideoClip>('/tenant/clips/save', { method: 'POST', data })
}
export function deleteVideoClip(id: number) {
  return request<null>('/tenant/clips/delete', { method: 'POST', data: { id } })
}

/* ===== 作业系统 ===== */
export function fetchHomeworks() {
  return request<Homework[]>('/tenant/homeworks')
}
export function saveHomework(data: {
  id?: number
  name: string
  subject: string
  grade: string
  paperId?: number
  questionIds: number[]
  classes: string[]
  deadline: string
  require: string
}) {
  return request<Homework>('/tenant/homeworks/save', { method: 'POST', data })
}
export function deleteHomework(id: number) {
  return request<null>('/tenant/homeworks/delete', { method: 'POST', data: { id } })
}
export function closeHomework(id: number) {
  return request<Homework>('/tenant/homeworks/close', { method: 'POST', data: { id } })
}
export function fetchSubmissions(homeworkId: number) {
  return request<HomeworkSubmission[]>(withQuery('/tenant/homeworks/submissions', { homeworkId }))
}
export function gradeSubmission(id: number, score: number, comment: string) {
  return request<HomeworkSubmission>('/tenant/homeworks/submissions/grade', { method: 'POST', data: { id, score, comment } })
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
