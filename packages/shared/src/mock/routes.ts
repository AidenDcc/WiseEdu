import type { MockRoute } from './engine'
import { mockFail } from './engine'
import { getAppConfig, getTokenKey } from '../config'
import { findAuthAccount, verifyPassword } from '../auth/accounts'
import { mockUsers, adminOverview, tenantOverview } from './data'
import * as store from './tenant-store'
import * as admin from './admin-store'
import * as org from './org-store'
import * as student from './student-store'
import * as content from './content-store'
import type {
  CertFile,
  DictTypeKey,
  FeatureSwitches,
  PackageRecord,
  PhotoResultEdit,
  TenantRecord,
} from '../api/models'
import type { SessionUser, MockUser } from './types'

/** 资料 → 会话用户（SessionUser 不含密码，也不含只对 Mock 有意义的 appId） */
function toSessionUser(user: MockUser): SessionUser {
  const { appId: _appId, ...rest } = user
  return rest
}

function createToken(user: MockUser): string {
  return `mock.${user.appId}.${user.id}.${Math.random().toString(36).slice(2, 10)}`
}

function userFromToken(token: string | undefined): MockUser | null {
  if (!token?.startsWith('mock.')) return null
  const [, appId, id] = token.split('.')
  return mockUsers.find((user) => user.appId === appId && String(user.id) === id) ?? null
}

/* ================= 机构端业务路由 ================= */

const orgRoutes: MockRoute[] = [
  // 分类树
  { method: 'GET', path: '/tenant/categories', handler: () => guard(() => org.categories) },
  { method: 'POST', path: '/tenant/categories/save', handler: ({ body }) => guard(() => org.saveCategory(body as never)) },
  { method: 'POST', path: '/tenant/categories/delete', handler: ({ body }) => guard(() => { org.deleteCategory(Number(body.id)); return null }) },

  // 题目
  { method: 'GET', path: '/tenant/questions', handler: () => guard(() => org.questions) },
  // 字典（只读，仅返回启用项，用于筛选条件）
  {
    method: 'GET',
    path: '/tenant/dict',
    handler: ({ query }) =>
      guard(() => admin.listDict(String(query.type ?? '') as DictTypeKey).filter((item) => item.enabled)),
  },
  // 知识点树 / 教材级联
  { method: 'GET', path: '/tenant/knowledge/textbooks', handler: () => guard(() => org.textbookMatrix) },
  {
    method: 'GET',
    path: '/tenant/knowledge/tree',
    handler: ({ query }) =>
      guard(() =>
        org.listKnowledgeTree(String(query.grade ?? ''), String(query.subject ?? ''), String(query.version ?? '')),
      ),
  },
  { method: 'POST', path: '/tenant/questions/save', handler: ({ body }) => guard(() => org.saveQuestion(body as never)) },
  { method: 'POST', path: '/tenant/questions/submit', handler: ({ body }) => guard(() => ({ count: org.submitQuestions(body.ids as number[]) })) },
  { method: 'POST', path: '/tenant/questions/delete', handler: ({ body }) => guard(() => ({ count: org.deleteQuestions(body.ids as number[]) })) },
  { method: 'POST', path: '/tenant/questions/move', handler: ({ body }) => guard(() => ({ count: org.moveQuestions(body.ids as number[], Number(body.categoryId)) })) },
  { method: 'POST', path: '/tenant/questions/review', handler: ({ body }) => guard(() => org.reviewQuestion(Number(body.id), Boolean(body.pass), String(body.opinion ?? ''))) },
  { method: 'POST', path: '/tenant/questions/offline', handler: ({ body }) => guard(() => org.toggleQuestionOffline(Number(body.id))) },
  { method: 'POST', path: '/tenant/questions/variant', handler: ({ body }) => guard(() => org.variantOf(Number(body.id))) },
  { method: 'POST', path: '/tenant/questions/correct', handler: ({ body }) => guard(() => org.submitQuestionCorrection(body as never)) },
  { method: 'GET', path: '/tenant/questions/corrections', handler: () => guard(() => org.questionCorrections) },

  // AI 出题 / 额度
  { method: 'GET', path: '/tenant/quota', handler: () => guard(() => org.QUOTA_TEXT) },
  { method: 'POST', path: '/tenant/ai/generate', handler: ({ body }) => guard(() => org.generateQuestions(Number(body.count ?? 5))) },
  { method: 'POST', path: '/tenant/ai/adopt', handler: ({ body }) => guard(() => org.adoptGenerated(body as never, String(body.subject ?? '数学'), String(body.grade ?? '高一'), String(body.type ?? '单选'))) },

  // 拍照识题
  { method: 'GET', path: '/tenant/photo/tasks', handler: () => guard(() => org.photoTasks) },
  { method: 'POST', path: '/tenant/photo/upload', handler: ({ body }) => guard(() => org.uploadPhotos(body.names as string[])) },
  { method: 'POST', path: '/tenant/photo/recognize', handler: ({ body }) => guard(() => org.recognizePhoto(String(body.id))) },
  { method: 'POST', path: '/tenant/photo/register', handler: ({ body }) => guard(() => org.registerPhotoTask(body.task as never)) },
  {
    method: 'POST',
    path: '/tenant/photo/decide',
    handler: ({ body }) =>
      guard(() =>
        org.decidePhotoResult(
          String(body.taskId),
          String(body.resultId),
          body.decision as 'import' | 'draft' | 'drop',
          body.edit as PhotoResultEdit | undefined,
        ),
      ),
  },

  // 试卷
  { method: 'GET', path: '/tenant/papers', handler: () => guard(() => org.papers) },
  { method: 'POST', path: '/tenant/papers/save', handler: ({ body }) => guard(() => org.savePaper(body as never)) },
  { method: 'POST', path: '/tenant/papers/delete', handler: ({ body }) => guard(() => { org.deletePaper(Number(body.id)); return null }) },
  { method: 'POST', path: '/tenant/papers/review', handler: ({ body }) => guard(() => org.reviewPaper(Number(body.id), Boolean(body.pass), String(body.opinion ?? ''))) },
  { method: 'POST', path: '/tenant/papers/ai-compose', handler: ({ body }) => guard(() => org.aiComposePaper(body as never)) },
  // 我的模板：只返回当前用户自己的（组卷成功时由 aiComposePaper 自动落一条）
  { method: 'GET', path: '/tenant/papers/ai-templates', handler: () => guard(() => org.listAiComposeTemplates()) },
  { method: 'POST', path: '/tenant/papers/ai-templates/delete', handler: ({ body }) => guard(() => { org.deleteAiComposeTemplate(Number(body.id)); return null }) },
  { method: 'POST', path: '/tenant/papers/swap-question', handler: ({ body }) => guard(() => org.swapPaperQuestion(Number(body.paperId), Number(body.questionId))) },
  // 平行卷固定 1 份；folderId 判空用 == null，写成真值判断会把根目录（0）当没选
  { method: 'POST', path: '/tenant/papers/parallels', handler: ({ body }) => guard(() => org.generateParallels(Number(body.motherId), body.folderId == null ? undefined : Number(body.folderId))) },
  // 浏览 / 下载计数（试卷库 预览 / 导出 时累加，无返回值）
  { method: 'POST', path: '/tenant/papers/browse', handler: ({ body }) => guard(() => { org.browsePaper(Number(body.id)); return null }) },
  { method: 'POST', path: '/tenant/papers/download', handler: ({ body }) => guard(() => { org.downloadPaper(Number(body.id)); return null }) },

  /* 协同组卷：任务（分工）+ 入卷（题型约束）+ 版本（撤销/替换）三类接口分开，
     前端能在不重传整卷的前提下只发一个「加题」请求。 */
  { method: 'GET', path: '/tenant/collab/tasks', handler: () => guard(() => org.listCollabTasks()) },
  { method: 'GET', path: '/tenant/collab/task', handler: ({ query }) => guard(() => org.collabTaskDetail(Number(query.id))) },
  { method: 'POST', path: '/tenant/collab/tasks/save', handler: ({ body }) => guard(() => org.saveCollabTask(body as never)) },
  { method: 'POST', path: '/tenant/collab/tasks/delete', handler: ({ body }) => guard(() => { org.deleteCollabTask(Number(body.id)); return null }) },
  { method: 'POST', path: '/tenant/collab/questions/add', handler: ({ body }) => guard(() => org.collabAddQuestions(body as never)) },
  { method: 'POST', path: '/tenant/collab/questions/remove', handler: ({ body }) => guard(() => org.collabRemoveQuestion(body as never)) },
  /* 按大题增量改写卷面（改分值 / 调顺序）—— 编辑页上「改完即存」，不走整卷保存 */
  { method: 'POST', path: '/tenant/collab/section/update', handler: ({ body }) => guard(() => org.collabUpdateSection(body as never)) },
  { method: 'POST', path: '/tenant/collab/ai-compose', handler: ({ body }) => guard(() => org.collabAiCompose(body as never)) },
  { method: 'POST', path: '/tenant/collab/member/submit', handler: ({ body }) => guard(() => org.collabSubmitMember(body as never)) },
  { method: 'POST', path: '/tenant/collab/member/reopen', handler: ({ body }) => guard(() => org.collabReopenMember(body as never)) },
  /* 验收与送审（三步收尾）：逐人验收 → 全部验收完才可送审 → 审核中心驳回后原路退回。
     这四条都返回整条任务，前端拿回执直接覆盖本地对象，不必再拉一次详情。 */
  { method: 'POST', path: '/tenant/collab/member/accept', handler: ({ body }) => guard(() => org.collabAcceptMember(body as never)) },
  { method: 'POST', path: '/tenant/collab/member/reject', handler: ({ body }) => guard(() => org.collabRejectMember(body as never)) },
  { method: 'POST', path: '/tenant/collab/review/submit', handler: ({ body }) => guard(() => org.collabSubmitReview(body as never)) },
  { method: 'POST', path: '/tenant/collab/review/withdraw', handler: ({ body }) => guard(() => org.collabWithdrawReview(body as never)) },
  { method: 'POST', path: '/tenant/collab/review/reopen', handler: ({ body }) => guard(() => org.collabReopenAfterReject(body as never)) },
  { method: 'GET', path: '/tenant/collab/versions', handler: ({ query }) => guard(() => org.listPaperVersions(Number(query.paperId))) },
  { method: 'POST', path: '/tenant/collab/versions/restore', handler: ({ body }) => guard(() => org.restorePaperVersion(body as never)) },
  { method: 'POST', path: '/tenant/collab/versions/replace', handler: ({ body }) => guard(() => org.replacePaperVersion(body as never)) },
  /* 卷面评论：挂在卷头 / 大题 / 题目上的批注，可手动写，也可由 AI 检测、纠错提交生成 */
  { method: 'GET', path: '/tenant/papers/comments', handler: ({ query }) => guard(() => org.listPaperComments(Number(query.paperId))) },
  { method: 'POST', path: '/tenant/papers/comments/add', handler: ({ body }) => guard(() => org.addPaperComment(body as never)) },
  { method: 'POST', path: '/tenant/papers/comments/delete', handler: ({ body }) => guard(() => { org.deletePaperComment(Number(body.id)); return null }) },

  // 讲义课件（FR-JC-005 ~ 012）
  { method: 'GET', path: '/tenant/teach/docs', handler: ({ query }) => guard(() => org.listTeachDocs(query.kind ? String(query.kind) : undefined)) },
  { method: 'POST', path: '/tenant/teach/docs/save', handler: ({ body }) => guard(() => org.saveTeachDoc(body as never)) },
  { method: 'POST', path: '/tenant/teach/docs/delete', handler: ({ body }) => guard(() => { org.deleteTeachDoc(Number(body.id)); return null }) },
  { method: 'POST', path: '/tenant/teach/docs/duplicate', handler: ({ body }) => guard(() => org.duplicateTeachDoc(Number(body.id))) },
  { method: 'POST', path: '/tenant/teach/docs/publish', handler: ({ body }) => guard(() => org.toggleTeachDocPublish(Number(body.id))) },

  // 考试与在线阅卷
  { method: 'GET', path: '/tenant/exam/sessions', handler: () => guard(() => org.listExamSessions()) },
  { method: 'GET', path: '/tenant/exam/session', handler: ({ query }) => guard(() => org.getExamSession(Number(query.id))) },
  { method: 'POST', path: '/tenant/exam/sessions/save', handler: ({ body }) => guard(() => org.saveExamSession(body as never)) },
  { method: 'POST', path: '/tenant/exam/sessions/delete', handler: ({ body }) => guard(() => { org.deleteExamSession(Number(body.id)); return null }) },
  { method: 'POST', path: '/tenant/exam/duty/assign', handler: ({ body }) => guard(() => org.assignDuty(Number(body.sessionId), Number(body.dutyId), body.graders as string[], (body.mode as 'single' | 'double') ?? 'single')) },
  { method: 'POST', path: '/tenant/exam/answers/score', handler: ({ body }) => guard(() => org.saveAnswerScore(Number(body.sessionId), Number(body.answerId), Number(body.questionId), Number(body.score))) },
  { method: 'POST', path: '/tenant/exam/answers/mark', handler: ({ body }) => guard(() => org.markAnswer(Number(body.sessionId), Number(body.answerId), body.status as never, body.remark ? String(body.remark) : undefined)) },
  { method: 'POST', path: '/tenant/exam/sessions/finish', handler: ({ body }) => guard(() => org.finishSession(Number(body.id))) },
  { method: 'GET', path: '/tenant/exam/analysis', handler: ({ query }) => guard(() => org.analyzePaper(Number(query.sessionId))) },

  // 错题本
  { method: 'GET', path: '/tenant/mistakes', handler: ({ query }) => guard(() => org.listMistakes(query.scope ? String(query.scope) : undefined)) },
  { method: 'GET', path: '/tenant/mistakes/scopes', handler: () => guard(() => org.mistakeScopes()) },
  { method: 'POST', path: '/tenant/mistakes/save', handler: ({ body }) => guard(() => org.saveMistake(body as never)) },
  { method: 'POST', path: '/tenant/mistakes/delete', handler: ({ body }) => guard(() => { org.removeMistake(Number(body.id)); return null }) },
  { method: 'POST', path: '/tenant/mistakes/mastery', handler: ({ body }) => guard(() => org.setMistakeMastery(Number(body.id), body.mastery as never)) },
  { method: 'GET', path: '/tenant/mistakes/similar', handler: ({ query }) => guard(() => org.similarQuestions(Number(query.id), Number(query.limit ?? 4))) },
  { method: 'POST', path: '/tenant/mistakes/drill', handler: ({ body }) => guard(() => org.buildMistakeDrill((body.ids as number[]) ?? [], body.withSimilar !== false)) },

  // 集体备课
  { method: 'GET', path: '/tenant/prep/tasks', handler: () => guard(() => org.listPrepTasks()) },
  { method: 'GET', path: '/tenant/prep/task', handler: ({ query }) => guard(() => org.getPrepTask(Number(query.id))) },
  { method: 'POST', path: '/tenant/prep/tasks/save', handler: ({ body }) => guard(() => org.savePrepTask(body as never)) },
  { method: 'POST', path: '/tenant/prep/tasks/delete', handler: ({ body }) => guard(() => { org.deletePrepTask(Number(body.id)); return null }) },
  { method: 'POST', path: '/tenant/prep/comments/add', handler: ({ body }) => guard(() => org.addPrepComment(Number(body.id), String(body.body ?? ''), String(body.target ?? ''))) },
  { method: 'POST', path: '/tenant/prep/comments/delete', handler: ({ body }) => guard(() => org.deletePrepComment(Number(body.id), Number(body.commentId))) },
  { method: 'POST', path: '/tenant/prep/versions/add', handler: ({ body }) => guard(() => org.addPrepVersion(Number(body.id), String(body.summary ?? ''), String(body.snapshot ?? ''))) },
  { method: 'POST', path: '/tenant/prep/versions/revert', handler: ({ body }) => guard(() => org.revertPrepVersion(Number(body.id), Number(body.versionId))) },
  { method: 'POST', path: '/tenant/prep/versions/replace', handler: ({ body }) => guard(() => org.replacePrepVersion(Number(body.id), Number(body.versionId))) },
  { method: 'POST', path: '/tenant/prep/duty/submit', handler: ({ body }) => guard(() => org.submitPrepDuty(Number(body.id), String(body.name ?? org.CURRENT.name))) },
  { method: 'POST', path: '/tenant/prep/finalize', handler: ({ body }) => guard(() => org.finalizePrepTask(Number(body.id))) },

  // 校本资源审批
  { method: 'GET', path: '/tenant/approvals', handler: ({ query }) => guard(() => org.listApprovals(query.status ? String(query.status) : undefined)) },
  { method: 'GET', path: '/tenant/approvals/summary', handler: () => guard(() => org.approvalSummary()) },
  { method: 'POST', path: '/tenant/approvals/submit', handler: ({ body }) => guard(() => org.submitApproval(body as never)) },
  { method: 'POST', path: '/tenant/approvals/review', handler: ({ body }) => guard(() => org.reviewApproval(Number(body.id), Boolean(body.pass), String(body.opinion ?? ''))) },
  { method: 'POST', path: '/tenant/approvals/revoke', handler: ({ body }) => guard(() => { org.revokeApproval(Number(body.id)); return null }) },

  // 视频切片（微课）
  { method: 'GET', path: '/tenant/clips', handler: ({ query }) => guard(() => org.listVideoClips(query.mediaId ? Number(query.mediaId) : undefined)) },
  { method: 'POST', path: '/tenant/clips/save', handler: ({ body }) => guard(() => org.saveVideoClip(body as never)) },
  { method: 'POST', path: '/tenant/clips/delete', handler: ({ body }) => guard(() => { org.deleteVideoClip(Number(body.id)); return null }) },

  // 作业系统
  { method: 'GET', path: '/tenant/homeworks', handler: () => guard(() => org.listHomeworks()) },
  { method: 'POST', path: '/tenant/homeworks/save', handler: ({ body }) => guard(() => org.saveHomework(body as never)) },
  { method: 'POST', path: '/tenant/homeworks/delete', handler: ({ body }) => guard(() => { org.deleteHomework(Number(body.id)); return null }) },
  { method: 'POST', path: '/tenant/homeworks/close', handler: ({ body }) => guard(() => org.closeHomework(Number(body.id))) },
  { method: 'GET', path: '/tenant/homeworks/submissions', handler: ({ query }) => guard(() => org.listSubmissions(Number(query.homeworkId))) },
  { method: 'POST', path: '/tenant/homeworks/submissions/grade', handler: ({ body }) => guard(() => org.gradeSubmission(Number(body.id), Number(body.score), String(body.comment ?? ''))) },

  // 教辅
  { method: 'GET', path: '/tenant/materials', handler: () => guard(() => org.materials) },
  { method: 'POST', path: '/tenant/materials/upload', handler: ({ body }) => guard(() => org.uploadMaterial(body as never)) },
  { method: 'POST', path: '/tenant/materials/recognize', handler: ({ body }) => guard(() => org.reRecognizeMaterial(Number(body.id))) },
  { method: 'POST', path: '/tenant/materials/example', handler: ({ body }) => guard(() => org.decideExample(Number(body.materialId), Number(body.exampleId), body.decision as 'import' | 'edit' | 'ignore')) },
  { method: 'POST', path: '/tenant/materials/finish', handler: ({ body }) => guard(() => ({ message: org.finishMaterial(Number(body.id), Number(body.pendingCount ?? 0)) })) },
  { method: 'POST', path: '/tenant/materials/delete', handler: ({ body }) => guard(() => { org.deleteMaterial(Number(body.id)); return null }) },

  // 多媒体
  { method: 'GET', path: '/tenant/media', handler: () => guard(() => org.mediaResources) },
  { method: 'GET', path: '/tenant/media/detail', handler: ({ query }) => guard(() => {
    const item = org.getMediaById(Number(query.id))
    if (!item) throw new Error('资源不存在')
    return item
  }) },
  { method: 'POST', path: '/tenant/media/upload', handler: ({ body }) => guard(() => org.uploadMedia(body as never)) },
  { method: 'POST', path: '/tenant/media/draw/save', handler: ({ body }) => guard(() => org.saveDrawMedia(body as never)) },
  { method: 'POST', path: '/tenant/media/ai/draw/generate', handler: ({ body }) => guard(() => org.generateAiDrawDraft(body as never)) },
  { method: 'POST', path: '/tenant/media/link', handler: ({ body }) => guard(() => ({ linkedCount: org.linkMedia(Number(body.id), body.targets as string[]) })) },
  { method: 'POST', path: '/tenant/media/delete', handler: ({ body }) => guard(() => ({ linkedCount: org.deleteMedia(Number(body.id)) })) },

  // 我的文件
  { method: 'GET', path: '/tenant/folders', handler: () => guard(() => org.folders) },
  { method: 'POST', path: '/tenant/folders/save', handler: ({ body }) => guard(() => org.saveFolder(body as never)) },
  { method: 'POST', path: '/tenant/folders/delete', handler: ({ body }) => guard(() => ({ moved: org.deleteFolder(Number(body.id)) })) },
  { method: 'POST', path: '/tenant/folders/move', handler: ({ body }) => guard(() => org.moveFolder(Number(body.id), Number(body.targetId))) },
  { method: 'POST', path: '/tenant/folders/pin', handler: ({ body }) => guard(() => org.setFolderPinned(Number(body.id), Boolean(body.pinned))) },
  { method: 'GET', path: '/tenant/files', handler: () => guard(() => ({ list: org.orgFiles, usage: org.storageUsage })) },
  { method: 'POST', path: '/tenant/files/upload', handler: ({ body }) => guard(() => org.uploadFiles(body.names as string[], Number(body.folderId ?? 0), body.sizes as number[] | undefined)) },
  { method: 'POST', path: '/tenant/files/create', handler: ({ body }) => guard(() => org.createFile({ name: String(body.name ?? ''), kind: (body.kind ?? 'doc') as never, folderId: Number(body.folderId ?? 0) })) },
  { method: 'POST', path: '/tenant/files/rename', handler: ({ body }) => guard(() => org.renameFile(Number(body.id), String(body.name ?? ''))) },
  { method: 'POST', path: '/tenant/files/move', handler: ({ body }) => guard(() => ({ moved: org.moveFiles(body.ids as number[], Number(body.targetId)) })) },
  { method: 'POST', path: '/tenant/files/copy', handler: ({ body }) => guard(() => ({ copied: org.copyFiles(body.ids as number[], Number(body.targetId)).length })) },
  { method: 'POST', path: '/tenant/files/duplicate', handler: ({ body }) => guard(() => org.duplicateFile(Number(body.id))) },
  { method: 'POST', path: '/tenant/files/pin', handler: ({ body }) => guard(() => org.setFilePinned(Number(body.id), Boolean(body.pinned))) },
  { method: 'POST', path: '/tenant/files/convert-courseware', handler: ({ body }) => guard(() => org.convertToCourseware(Number(body.id))) },
  { method: 'POST', path: '/tenant/files/delete', handler: ({ body }) => guard(() => {
    /* 兼容单个删除（id）与批量删除（ids）两种调用 */
    const ids = body.ids != null ? (body.ids as number[]) : [Number(body.id)]
    org.deleteFiles(ids)
    return null
  }) },
  { method: 'POST', path: '/tenant/files/recognize', handler: ({ body }) => guard(() => org.recognizeFile(Number(body.id))) },
  { method: 'POST', path: '/tenant/files/import-recognized', handler: ({ body }) => guard(() => org.importRecognizedFile(Number(body.id), { makePaper: Boolean(body.makePaper), paperName: String(body.paperName ?? ''), questions: body.questions as never })) },

  // 公式中心
  { method: 'GET', path: '/tenant/formulas/standard', handler: ({ query }) => guard(() => org.listStandardFormulas({
    subject: String(query.subject ?? ''),
    knowledge: String(query.knowledge ?? '').split(',').filter(Boolean),
    keyword: String(query.keyword ?? ''),
  })) },
  { method: 'POST', path: '/tenant/formulas/collect', handler: ({ body }) => guard(() => org.collectStandardFormula(Number(body.id))) },
  { method: 'GET', path: '/tenant/formulas', handler: ({ query }) => guard(() => org.listOrgFormulas({
    subject: String(query.subject ?? ''),
    keyword: String(query.keyword ?? ''),
  })) },
  { method: 'POST', path: '/tenant/formulas/save', handler: ({ body }) => guard(() => org.saveOrgFormula(body as never)) },
  { method: 'POST', path: '/tenant/formulas/share', handler: ({ body }) => guard(() => org.shareFormula(Number(body.id))) },
  { method: 'POST', path: '/tenant/formulas/review', handler: ({ body }) => guard(() => org.reviewFormula(Number(body.id), Boolean(body.pass))) },
  { method: 'POST', path: '/tenant/formulas/offshelf', handler: ({ body }) => guard(() => org.offshelfFormula(Number(body.id))) },
  { method: 'POST', path: '/tenant/formulas/delete', handler: ({ body }) => guard(() => { org.deleteFormula(Number(body.id)); return null }) },

  // 提示词模板
  { method: 'GET', path: '/tenant/prompts/platform', handler: () => guard(() => org.platformPrompts) },
  { method: 'GET', path: '/tenant/prompts', handler: () => guard(() => org.orgPrompts) },
  { method: 'POST', path: '/tenant/prompts/copy', handler: ({ body }) => guard(() => org.copyPlatformPrompt(Number(body.id))) },
  { method: 'POST', path: '/tenant/prompts/save', handler: ({ body }) => guard(() => org.saveOrgPrompt(body as never)) },
  { method: 'POST', path: '/tenant/prompts/toggle', handler: ({ body }) => guard(() => org.toggleOrgPrompt(Number(body.id))) },
  { method: 'POST', path: '/tenant/prompts/default', handler: ({ body }) => guard(() => org.setDefaultOrgPrompt(Number(body.id))) },
  { method: 'POST', path: '/tenant/prompts/test', handler: () => guard(() => org.testOrgPrompt()) },
  { method: 'POST', path: '/tenant/prompts/rollback', handler: ({ body }) => guard(() => org.rollbackOrgPrompt(Number(body.id), Number(body.version))) },
  { method: 'POST', path: '/tenant/prompts/delete', handler: ({ body }) => guard(() => { org.deleteOrgPrompt(Number(body.id)); return null }) },

  // 知识广场
  { method: 'GET', path: '/tenant/square', handler: () => guard(() => org.squareResources) },
  { method: 'POST', path: '/tenant/square/collect', handler: ({ body }) => guard(() => org.collectSquare(Number(body.id))) },
  { method: 'POST', path: '/tenant/square/download', handler: ({ body }) => guard(() => org.downloadSquare(Number(body.id))) },

  // 员工 / 角色 / 校区
  { method: 'GET', path: '/tenant/staff', handler: () => guard(() => ({ list: org.staff, quota: org.STAFF_QUOTA })) },
  { method: 'POST', path: '/tenant/staff/save', handler: ({ body }) => guard(() => org.saveStaff(body as never)) },
  { method: 'POST', path: '/tenant/staff/toggle', handler: ({ body }) => guard(() => org.toggleStaff(Number(body.id))) },
  { method: 'POST', path: '/tenant/staff/delete', handler: ({ body }) => guard(() => { org.deleteStaff(Number(body.id)); return null }) },
  { method: 'GET', path: '/tenant/roles', handler: () => guard(() => ({ roles: org.orgRoles, modules: org.PERM_MODULES })) },
  { method: 'POST', path: '/tenant/roles/save', handler: ({ body }) => guard(() => org.saveRole(body as never)) },
  { method: 'POST', path: '/tenant/roles/delete', handler: ({ body }) => guard(() => { org.deleteRole(Number(body.id)); return null }) },
  { method: 'GET', path: '/tenant/campuses', handler: () => guard(() => org.campuses) },
  { method: 'POST', path: '/tenant/campuses/save', handler: ({ body }) => guard(() => org.saveCampus(body as never)) },
  { method: 'POST', path: '/tenant/campuses/toggle', handler: ({ body }) => guard(() => org.toggleCampus(Number(body.id))) },
  { method: 'POST', path: '/tenant/campuses/delete', handler: ({ body }) => guard(() => { org.deleteCampus(Number(body.id)); return null }) },

  // 日志 / 通知
  { method: 'GET', path: '/tenant/logs/login', handler: () => guard(() => org.orgLoginLogs) },
  { method: 'GET', path: '/tenant/logs/operation', handler: () => guard(() => org.orgOperationLogs) },
  { method: 'GET', path: '/tenant/notify', handler: () => guard(() => org.notifyMatrix) },
  { method: 'POST', path: '/tenant/notify/save', handler: () => guard(() => null) },

  // 回收站（FR-GN-030 ~ 034）
  { method: 'GET', path: '/tenant/recycle', handler: ({ query }) => guard(() => org.listRecycle(String(query.kind ?? ''))) },
  { method: 'POST', path: '/tenant/recycle/restore', handler: ({ body }) => guard(() => ({ message: org.restoreRecycle(body.ids as number[]) })) },
  { method: 'POST', path: '/tenant/recycle/purge', handler: ({ body }) => guard(() => ({ message: org.purgeRecycle(body.ids as number[]) })) },

  // 消息中心（FR-GN-015 ~ 019）
  { method: 'GET', path: '/tenant/messages', handler: ({ query }) => guard(() => org.listOrgMessages(String(query.tab ?? 'all'))) },
  { method: 'POST', path: '/tenant/messages/read', handler: ({ body }) => guard(() => { org.markOrgMessageRead(Number(body.id)); return null }) },
  { method: 'POST', path: '/tenant/messages/read-all', handler: ({ body }) => guard(() => { org.markAllOrgMessagesRead(String(body.tab ?? 'all')); return null }) },
  { method: 'POST', path: '/tenant/messages/delete', handler: ({ body }) => guard(() => { org.deleteOrgMessage(Number(body.id)); return null }) },
  // 机构菜单权限
  /* 深拷贝返回，与别的列表接口不同 —— 这里必须给「草稿」语义。
     `engine.detach` 对数组只做浅拷贝（换数组、留元素引用），于是 /org/menus 页上的开关一拨就
     直接改到了 store 里的活对象：**还没点保存，侧边栏已经变了**，而「重置」按钮失效
     （重新拉回来的是同一批对象，改动还在）。菜单开关是「改了要保存」的配置页，
     不能像列表那样与 store 共享元素。 */
  { method: 'GET', path: '/tenant/menus', handler: () => guard(() => structuredClone(org.orgMenuTree)) },
  { method: 'POST', path: '/tenant/menus/save', handler: ({ body }) => guard(() => { org.saveOrgMenus(body.items as never); return null }) },

  // 全局搜索（FR-GN-026）：一次检索返回各资源分类，图片搜索在真实模式下走前端视觉识别
  { method: 'GET', path: '/tenant/search', handler: ({ query }) => guard(() => org.searchAll(String(query.keyword ?? ''))) },
  { method: 'POST', path: '/tenant/search/image', handler: ({ body }) => guard(() => org.recognizeSearchImage(String(body.name ?? ''))) },

  // 题库组卷工作台：AI 搜索的本地演示解读（未配置 AI Key 时的回退口径）
  {
    method: 'POST',
    path: '/tenant/ai/compose-search',
    handler: ({ body }) =>
      guard(() => org.interpretComposeSearch({ text: body.text as string | undefined, name: body.name as string | undefined })),
  },
]

export const mockRoutes: MockRoute[] = [
  /* ---------------- 登录 / 会话（FR-GN-001 ~ 004） ---------------- */
  {
    method: 'POST',
    path: '/auth/login',
    handler: ({ body }) => {
      const appName = getAppConfig().appName
      const account = String(body.account ?? '').trim()
      const password = String(body.password ?? '')

      // 凭据比对走账号配置表（auth/accounts.ts）：只存盐 + 哈希，明文不在仓库里。
      // 账号不存在与密码错误返回同一句，避免泄露某个账号是否存在。
      const entry = findAuthAccount(appName, account)
      if (!entry || !verifyPassword(entry, password)) {
        mockFail(1001, '账号或密码错误')
      }

      // 凭据通过后再取用户资料：账号表只管凭据，姓名 / 角色 / 机构仍在 mockUsers
      const user = mockUsers.find(
        (item) => item.appId === appName && item.account === entry.account,
      )
      if (!user) mockFail(1001, '账号资料缺失，请联系管理员')

      return { token: createToken(user), user: toSessionUser(user) }
    },
  },
  {
    method: 'GET',
    path: '/auth/me',
    handler: () => {
      // token 由 Mock 引擎从请求头语义中获取；此处简化为从 localStorage 读取。
      // key 走 getTokenKey()：过期时间等新 key 加入后，手写的模板串正是容易漏改的地方
      const token = localStorage.getItem(getTokenKey())
      const user = userFromToken(token ?? undefined)
      if (!user) mockFail(401, '登录已失效，请重新登录')
      return toSessionUser(user)
    },
  },
  {
    method: 'POST',
    path: '/auth/logout',
    handler: () => null,
  },

  /* ---------------- 超管端工作台（FR-PT-001 ~ 004） ---------------- */
  {
    method: 'GET',
    path: '/admin/dashboard/overview',
    handler: () => adminOverview,
  },

  /* ---------------- 机构端工作台（FR-WS-001 ~ 004） ---------------- */
  {
    method: 'GET',
    path: '/tenant/dashboard/overview',
    handler: () => tenantOverview,
  },

  /* ---------------- 租户管理：入驻审核（FR-PT-005 ~ 007） ---------------- */
  {
    method: 'GET',
    path: '/admin/tenant/applies',
    handler: ({ query }) =>
      guard(() => {
        const all = store.listApplies(query)
        return store.paginate(all, Number(query.page ?? 1), Number(query.pageSize ?? 10))
      }),
  },
  {
    method: 'POST',
    path: '/admin/tenant/applies',
    handler: ({ body }) =>
      guard(() => {
        const orgName = String(body.orgName ?? '').trim()
        const orgType = String(body.orgType ?? '').trim()
        const contact = String(body.contact ?? '').trim()
        const phone = String(body.phone ?? '').trim()
        if (!orgName) mockFail(3010, '机构名称不能为空')
        if (!orgType) mockFail(3011, '请选择机构类型')
        if (!contact) mockFail(3012, '联系人不能为空')
        if (!/^1\d{10}$/.test(phone)) mockFail(3013, '请输入 11 位手机号')
        const certFiles = Array.isArray(body.certFiles) ? (body.certFiles as CertFile[]) : []
        if (certFiles.length === 0) mockFail(3014, '请至少上传一份资质材料')
        return store.createApply({
          orgName,
          orgType,
          stages: Array.isArray(body.stages) ? (body.stages as string[]) : [],
          contact,
          phone,
          email: String(body.email ?? '').trim() || undefined,
          city: String(body.city ?? '').trim() || undefined,
          address: String(body.address ?? '').trim() || undefined,
          intro: String(body.intro ?? '').trim() || undefined,
          certFiles,
        })
      }),
  },
  {
    method: 'POST',
    path: '/admin/tenant/applies/*',
    handler: ({ path, body }) =>
      guard(() => {
        const match = path.match(/^\/admin\/tenant\/applies\/(\d+)\/(approve|reject)$/)
        if (!match) mockFail(404, '接口不存在')
        const id = Number(match[1])
        if (match[2] === 'approve') {
          const trialDays = Number(body.trialDays)
          const packageId = Number(body.packageId)
          const adminAccount = String(body.adminAccount ?? '').trim()
          if (!Number.isInteger(trialDays) || trialDays < 1 || trialDays > 90) {
            mockFail(3001, '试用天数须为 1-90 的整数')
          }
          if (!adminAccount) mockFail(3002, '初始管理员账号不能为空')
          const tenant = store.approveApply(id, {
            trialDays,
            packageId,
            adminAccount,
            reviewer: String(body.reviewer ?? '').trim() || undefined,
          })
          return { tenantName: tenant.name, expireTime: tenant.expireTime, adminAccount }
        }
        const reason = String(body.reason ?? '').trim()
        if (reason.length < 5 || reason.length > 200) {
          mockFail(3003, '驳回原因须为 5-200 字')
        }
        store.rejectApply(id, reason, String(body.reviewer ?? '').trim() || undefined)
        return null
      }),
  },

  /* ---------------- 租户管理：机构列表（FR-PT-008 ~ 014） ---------------- */
  {
    method: 'GET',
    path: '/admin/tenants',
    handler: ({ query }) =>
      guard(() => {
        const all = store.listTenants(query)
        return store.paginate(all, Number(query.page ?? 1), Number(query.pageSize ?? 10))
      }),
  },
  {
    method: 'GET',
    path: '/admin/tenants/*',
    handler: ({ path }) =>
      guard(() => {
        const match = path.match(/^\/admin\/tenants\/(\d+)$/)
        if (!match) mockFail(404, '接口不存在')
        return store.getTenantDetail(Number(match[1]))
      }),
  },
  {
    method: 'POST',
    path: '/admin/tenants/*',
    handler: ({ path, body }) =>
      guard(() => {
        const match = path.match(
          /^\/admin\/tenants\/(\d+)\/(disable|enable|renew|trial-extend|activate|base|feature|isolation)$/,
        )
        if (!match) mockFail(404, '接口不存在')
        const id = Number(match[1])
        switch (match[2]) {
          case 'disable': {
            const reason = String(body.reason ?? '').trim()
            if (reason.length < 5) mockFail(3004, '请填写至少 5 个字的禁用原因')
            store.disableTenant(id, reason)
            return null
          }
          case 'enable':
            store.enableTenant(id)
            return null
          case 'renew':
            return store.renewTenant(
              id,
              Number(body.packageId),
              String(body.duration ?? 'month') as store.RenewDurationKey,
            )
          case 'trial-extend': {
            const days = Number(body.days)
            if (!Number.isInteger(days) || days < 1 || days > 90) {
              mockFail(3005, '延长天数须为 1-90 的整数')
            }
            return { expireTime: store.extendTrial(id, days) }
          }
          case 'activate':
            return { expireTime: store.activateTenant(id, Number(body.packageId)) }
          case 'base':
            store.updateTenantBase(id, {
              name: String(body.name ?? ''),
              contact: String(body.contact ?? ''),
              phone: String(body.phone ?? ''),
              city: String(body.city ?? ''),
              address: String(body.address ?? ''),
              intro: String(body.intro ?? ''),
              stages: Array.isArray(body.stages) ? (body.stages as string[]) : [],
            })
            return null
          case 'feature':
            store.updateTenantFeature(id, {
              switches: body.switches as FeatureSwitches,
              quotas: body.quotas as TenantRecord['quotas'],
            })
            return null
          case 'isolation':
            store.updateTenantIsolation(id, Number(body.isolationType) as 1 | 2, String(body.storageRegion ?? ''))
            return null
          default:
            mockFail(404, '接口不存在')
        }
        return null
      }),
  },

  /* ---------------- 租户管理：套餐（sys_package） ---------------- */
  {
    method: 'GET',
    path: '/admin/packages',
    handler: () => guard(() => [...store.packages]),
  },
  {
    method: 'POST',
    path: '/admin/packages/save',
    handler: ({ body }) =>
      guard(() => {
        const name = String(body.name ?? '').trim()
        if (!name) mockFail(3006, '套餐名称不能为空')
        return store.savePackage(body as Partial<PackageRecord>)
      }),
  },

  /* ---------------- 全局字典（FR-PT-015 / 016） ---------------- */
  {
    method: 'GET',
    path: '/admin/dict/*',
    handler: ({ path }) =>
      guard(() => {
        const type = parseDictType(path)
        return admin.listDict(type)
      }),
  },
  {
    method: 'POST',
    path: '/admin/dict/*',
    handler: ({ path, body }) =>
      guard(() => {
        const [type, action] = parseSegments(path, '/admin/dict/')
        const dictType = parseDictType(`/admin/dict/${type}`)
        if (action === 'save') return admin.saveDictItem(dictType, body as Record<string, never>)
        if (action === 'toggle') return { enabled: admin.toggleDictItem(dictType, Number(body.id)) }
        if (action === 'delete') {
          admin.deleteDictItem(dictType, Number(body.id))
          return null
        }
        mockFail(404, '接口不存在')
      }),
  },
  /* 考试类型树（合并原「考试类型」+「杯赛」字典，桥接见 admin-store 的 syncExamTypeDict） */
  {
    method: 'GET',
    path: '/admin/exam-type-nodes',
    handler: () => guard(() => admin.listExamTypeNodes()),
  },
  {
    method: 'POST',
    path: '/admin/exam-type-nodes/*',
    handler: ({ path, body }) =>
      guard(() => {
        const [, action] = parseSegments(path, '/admin/exam-type-nodes/')
        if (action === 'save') return admin.saveExamTypeNode(body as Record<string, never>)
        if (action === 'toggle') return { enabled: admin.toggleExamTypeNode(Number(body.id)) }
        if (action === 'delete') {
          admin.deleteExamTypeNode(Number(body.id))
          return null
        }
        mockFail(404, '接口不存在')
      }),
  },
  {
    method: 'GET',
    path: '/admin/knowledge',
    handler: () => guard(() => admin.listKnowledge()),
  },
  {
    method: 'POST',
    path: '/admin/knowledge/*',
    handler: ({ path, body }) =>
      guard(() => {
        const [, action] = parseSegments(path, '/admin/knowledge/')
        if (action === 'save') return admin.saveKnowledgeNode(body as Record<string, never>)
        if (action === 'toggle') return { enabled: admin.toggleKnowledgeNode(Number(body.id)) }
        if (action === 'delete') {
          admin.deleteKnowledgeNode(Number(body.id))
          return null
        }
        mockFail(404, '接口不存在')
      }),
  },
  {
    method: 'GET',
    path: '/admin/textbooks',
    handler: () => guard(() => admin.listTextbooks()),
  },
  {
    method: 'POST',
    path: '/admin/textbooks/*',
    handler: ({ path, body }) =>
      guard(() => {
        const [, action] = parseSegments(path, '/admin/textbooks/')
        if (action === 'save') return admin.saveTextbook(body as Record<string, never>)
        if (action === 'toggle') return { enabled: admin.toggleTextbook(Number(body.id)) }
        if (action === 'delete') {
          admin.deleteTextbook(Number(body.id))
          return null
        }
        mockFail(404, '接口不存在')
      }),
  },

  /* ---------------- AI 服务配置（FR-PT-017 ~ 027） ---------------- */
  {
    method: 'GET',
    path: '/admin/ai/models',
    handler: () => guard(() => admin.listAiModels()),
  },
  {
    method: 'POST',
    path: '/admin/ai/models/*',
    handler: ({ path, body }) =>
      guard(() => {
        const [, action] = parseSegments(path, '/admin/ai/models/')
        if (action === 'save') return admin.saveAiModel(body as Record<string, never>)
        if (action === 'test') return admin.testModelConnection()
        if (action === 'health') return admin.healthCheckModel(Number(body.id))
        if (action === 'toggle') return { enabled: admin.toggleAiModel(Number(body.id)) }
        mockFail(404, '接口不存在')
      }),
  },
  {
    method: 'GET',
    path: '/admin/ai/agents',
    handler: () => guard(() => admin.getAgentConfig()),
  },
  {
    method: 'POST',
    path: '/admin/ai/agents/*',
    handler: ({ path, body }) =>
      guard(() => {
        const [, action] = parseSegments(path, '/admin/ai/agents/')
        if (action === 'save') {
          return admin.saveAgentConfig(body as never)
        }
        if (action === 'rollback') return admin.rollbackAgentConfig(Number(body.version))
        mockFail(404, '接口不存在')
      }),
  },
  {
    method: 'GET',
    path: '/admin/prompts',
    handler: () => guard(() => admin.listPrompts()),
  },
  {
    method: 'POST',
    path: '/admin/prompts/*',
    handler: ({ path, body }) =>
      guard(() => {
        const [, action] = parseSegments(path, '/admin/prompts/')
        if (action === 'save') return admin.savePrompt(body as never)
        if (action === 'default') {
          admin.setDefaultPrompt(Number(body.id))
          return null
        }
        if (action === 'toggle') return admin.togglePrompt(Number(body.id))
        if (action === 'test') return admin.testPrompt()
        if (action === 'rollback') return admin.rollbackPrompt(Number(body.id), Number(body.version))
        mockFail(404, '接口不存在')
      }),
  },

  /* ---------------- 数据审计（FR-PT-028 ~ 032 / 035） ---------------- */
  {
    method: 'GET',
    path: '/admin/ai-logs',
    handler: ({ query }) =>
      guard(() => {
        const list = admin.listAiLogs(query)
        const okCount = list.filter((row) => row.ok).length
        return {
          list,
          stats: {
            total: list.length,
            successRate: list.length ? Math.round((okCount / list.length) * 1000) / 10 : 0,
            totalTokens: list.reduce((sum, row) => sum + row.inputTokens + row.outputTokens, 0),
            totalCost:
              Math.round(list.reduce((sum, row) => sum + row.inputTokens + row.outputTokens, 0) * 0.00003 * 100) / 100,
          },
        }
      }),
  },
  {
    method: 'GET',
    path: '/admin/resources/questions',
    handler: () => guard(() => admin.publicQuestions),
  },
  {
    method: 'GET',
    path: '/admin/resources/papers',
    handler: () => guard(() => admin.publicPapers),
  },
  {
    method: 'GET',
    path: '/admin/resources/audit-records',
    handler: () => guard(() => admin.auditRecords),
  },
  {
    method: 'GET',
    path: '/admin/logs/*',
    handler: ({ path }) =>
      guard(() => {
        const [, type] = parseSegments(path, '/admin/logs/')
        if (type === 'login') return admin.loginLogs
        if (type === 'operation') return admin.operationLogs
        if (type === 'error') return admin.errorLogs
        mockFail(404, '接口不存在')
      }),
  },

  /* ---------------- 系统管理（FR-PT-033 / 034） ---------------- */
  {
    method: 'GET',
    path: '/admin/accounts',
    handler: () => guard(() => admin.listAdmins()),
  },
  {
    method: 'POST',
    path: '/admin/accounts/*',
    handler: ({ path, body }) =>
      guard(() => {
        const [, action] = parseSegments(path, '/admin/accounts/')
        if (action === 'save') return admin.saveAdmin(body as Record<string, never>)
        if (action === 'toggle') return { enabled: admin.toggleAdmin(Number(body.id)) }
        if (action === 'reset-password') {
          admin.resetAdminPassword(Number(body.id))
          return null
        }
        mockFail(404, '接口不存在')
      }),
  },
  {
    method: 'GET',
    path: '/admin/tenant-menus',
    handler: () => guard(() => admin.getTenantMenus()),
  },
  {
    method: 'POST',
    path: '/admin/tenant-menus/save',
    handler: ({ body }) =>
      guard(() => {
        admin.saveTenantMenus(body.items as never)
        return null
      }),
  },

  /* ---------------- 消息中心 ---------------- */
  {
    method: 'GET',
    path: '/admin/notifications',
    handler: () =>
      guard(() => ({
        list: admin.listNotifications(),
        unread: admin.unreadNotificationCount(),
      })),
  },
  {
    method: 'POST',
    path: '/admin/notifications/read',
    handler: ({ body }) =>
      guard(() => {
        admin.markNotificationRead(Number(body.id))
        return { unread: admin.unreadNotificationCount() }
      }),
  },
  {
    method: 'POST',
    path: '/admin/notifications/read-all',
    handler: () =>
      guard(() => {
        admin.markAllNotificationsRead()
        return { unread: 0 }
      }),
  },
  /* ================= 机构端业务（FR-TM / FR-PP / FR-JC / FR-FL / FR-FX / FR-PM / FR-SQ / FR-OS / FR-GN-030） ================= */
  ...orgRoutes,

  /* ================= 机构端 · 班级与学生管理（T-08） ================= */
  { method: 'GET', path: '/tenant/students/classes', handler: () => guard(() => student.classes) },
  { method: 'POST', path: '/tenant/students/classes/save', handler: ({ body }) => guard(() => student.saveClass(body as never)) },
  { method: 'POST', path: '/tenant/students/classes/toggle', handler: ({ body }) => guard(() => student.toggleClass(Number(body.id))) },
  { method: 'GET', path: '/tenant/students', handler: ({ query }) => guard(() => student.listStudents(String(query.keyword ?? ''), String(query.className ?? ''))) },
  { method: 'GET', path: '/tenant/students/detail', handler: ({ query }) => guard(() => student.getStudent(Number(query.id))) },
  { method: 'POST', path: '/tenant/students/save', handler: ({ body }) => guard(() => student.saveStudent(body as never)) },
  { method: 'POST', path: '/tenant/students/delete', handler: ({ body }) => guard(() => { student.deleteStudent(Number(body.id)); return null }) },
  { method: 'GET', path: '/tenant/students/consents', handler: ({ query }) => guard(() => student.listConsents(String(query.keyword ?? ''))) },
  { method: 'POST', path: '/tenant/students/consents/sign', handler: ({ body }) => guard(() => student.signConsent(Number(body.id), body.scopes as string[])) },
  { method: 'POST', path: '/tenant/students/consents/withdraw', handler: ({ body }) => guard(() => student.withdrawConsent(Number(body.id))) },

  /* ================= 机构端 · AI 学情画像（T-07-08 ~ 10） ================= */
  { method: 'GET', path: '/tenant/profile/student', handler: ({ query }) => guard(() => student.getStudentProfile(Number(query.studentId))) },
  { method: 'GET', path: '/tenant/profile/class', handler: ({ query }) => guard(() => student.getClassProfileReport(String(query.className))) },
  { method: 'POST', path: '/tenant/profile/push', handler: ({ body }) => guard(() => student.pushPractice(Number(body.studentId), String(body.knowledge), Number(body.count ?? 8))) },
  { method: 'GET', path: '/tenant/profile/pushes', handler: ({ query }) => guard(() => student.listPushes(Number(query.studentId))) },

  /* ================= 机构端 · AI 能力中心（T-10） ================= */
  { method: 'GET', path: '/tenant/ai-center/capabilities', handler: () => guard(() => student.AI_CAPABILITIES) },
  { method: 'GET', path: '/tenant/ai-center/tasks', handler: ({ query }) => guard(() => student.listAiTasks(String(query.scene ?? ''))) },
  { method: 'POST', path: '/tenant/ai-center/tasks/cancel', handler: ({ body }) => guard(() => { student.cancelAiTask(Number(body.id)); return null }) },
  { method: 'GET', path: '/tenant/ai-center/artifacts', handler: ({ query }) => guard(() => student.listAiArtifacts(String(query.status ?? ''))) },
  { method: 'POST', path: '/tenant/ai-center/artifacts/review', handler: ({ body }) => guard(() => student.reviewAiArtifact(Number(body.id), Boolean(body.pass))) },
  { method: 'GET', path: '/tenant/ai-center/overview', handler: () => guard(() => student.studentOverview()) },

  /* ================= 机构端 · 系统设置（T-11） ================= */
  { method: 'GET', path: '/tenant/settings', handler: () => guard(() => student.orgSettings) },
  { method: 'POST', path: '/tenant/settings/save', handler: ({ body }) => guard(() => student.saveOrgSettings(body as never)) },
  { method: 'GET', path: '/tenant/settings/review-flows', handler: () => guard(() => student.reviewFlows) },
  { method: 'POST', path: '/tenant/settings/review-flows/save', handler: ({ body }) => guard(() => student.saveReviewFlow(String(body.key) as never, body as never)) },

  /* ================= 平台端 · 全局内容运营（P-03） ================= */
  { method: 'GET', path: '/admin/platform/questions', handler: ({ query }) => guard(() => content.listPlatformQuestions(String(query.keyword ?? ''), String(query.subject ?? ''), String(query.status ?? ''))) },
  { method: 'POST', path: '/admin/platform/questions/review', handler: ({ body }) => guard(() => content.reviewPlatformQuestion(Number(body.id), Boolean(body.pass))) },
  { method: 'POST', path: '/admin/platform/questions/toggle', handler: ({ body }) => guard(() => content.togglePlatformQuestion(Number(body.id))) },
  { method: 'GET', path: '/admin/platform/papers', handler: ({ query }) => guard(() => content.listPlatformPapers(String(query.keyword ?? ''), String(query.subject ?? ''))) },
  { method: 'POST', path: '/admin/platform/papers/review', handler: ({ body }) => guard(() => content.reviewPlatformPaper(Number(body.id), Boolean(body.pass))) },
  { method: 'GET', path: '/admin/content/distributions', handler: () => guard(() => content.listDistributions()) },
  { method: 'POST', path: '/admin/content/distributions/create', handler: ({ body }) => guard(() => content.createDistribution(body as never)) },
  { method: 'POST', path: '/admin/content/distributions/toggle', handler: ({ body }) => guard(() => content.toggleDistribution(Number(body.id))) },
  { method: 'GET', path: '/admin/content/spot-checks', handler: () => guard(() => content.listSpotChecks()) },
  { method: 'POST', path: '/admin/content/spot-checks/create', handler: ({ body }) => guard(() => content.createSpotCheck(String(body.scope ?? ''), Number(body.sampleCount ?? 200))) },
  { method: 'POST', path: '/admin/content/spot-checks/close', handler: ({ body }) => guard(() => content.closeSpotCheck(Number(body.id))) },
  { method: 'GET', path: '/admin/content/tickets', handler: ({ query }) => guard(() => content.listFeedbackTickets(String(query.status ?? ''))) },
  { method: 'POST', path: '/admin/content/tickets/handle', handler: ({ body }) => guard(() => content.handleTicket(Number(body.id), body.action as never, String(body.reply ?? ''))) },

  /* ================= 平台端 · AI 安全治理与计费（P-05-10 ~ 14） ================= */
  { method: 'GET', path: '/admin/ai-governance/policies', handler: () => guard(() => content.listSensitivePolicies()) },
  { method: 'POST', path: '/admin/ai-governance/policies/save', handler: ({ body }) => guard(() => content.saveSensitivePolicy(body as never)) },
  { method: 'POST', path: '/admin/ai-governance/policies/toggle', handler: ({ body }) => guard(() => content.toggleSensitivePolicy(Number(body.id))) },
  { method: 'POST', path: '/admin/ai-governance/policies/delete', handler: ({ body }) => guard(() => { content.deleteSensitivePolicy(Number(body.id)); return null }) },
  { method: 'GET', path: '/admin/ai-governance/evals', handler: () => guard(() => content.listQualityEvals()) },
  { method: 'POST', path: '/admin/ai-governance/evals/run', handler: ({ body }) => guard(() => content.runQualityEval(String(body.scene ?? ''))) },
  { method: 'GET', path: '/admin/ai-governance/traces', handler: ({ query }) => guard(() => content.listTraceRecords(String(query.scene ?? ''), String(query.safety ?? ''))) },
  { method: 'GET', path: '/admin/ai-billing/rules', handler: () => guard(() => content.listBillingRules()) },
  { method: 'POST', path: '/admin/ai-billing/rules/save', handler: ({ body }) => guard(() => content.saveBillingRule(Number(body.id), body as never)) },
  { method: 'GET', path: '/admin/ai-billing/tenant-switches', handler: () => guard(() => content.listTenantAiSwitches()) },
  { method: 'POST', path: '/admin/ai-billing/tenant-switches/toggle', handler: ({ body }) => guard(() => content.toggleTenantAiCapability(Number(body.tenantId), String(body.capKey))) },

  /* ================= 平台端 · 系统监控与配置（P-06-06 / P-07-04 ~ 07） ================= */
  { method: 'GET', path: '/admin/system/health', handler: () => guard(() => content.listServiceHealth()) },
  { method: 'GET', path: '/admin/system/params', handler: () => guard(() => content.listSystemParams()) },
  { method: 'POST', path: '/admin/system/params/save', handler: ({ body }) => guard(() => content.saveSystemParam(String(body.key), String(body.value))) },
  { method: 'GET', path: '/admin/system/message-templates', handler: () => guard(() => content.listMessageTemplates()) },
  { method: 'POST', path: '/admin/system/message-templates/save', handler: ({ body }) => guard(() => content.saveMessageTemplate(body as never)) },
  { method: 'POST', path: '/admin/system/message-templates/toggle', handler: ({ body }) => guard(() => content.toggleMessageTemplate(Number(body.id))) },
  { method: 'GET', path: '/admin/system/storage', handler: () => guard(() => content.listStoragePolicies()) },
  { method: 'POST', path: '/admin/system/storage/save', handler: ({ body }) => guard(() => content.saveStoragePolicy(String(body.key), body as never)) },
  { method: 'GET', path: '/admin/system/backups', handler: () => guard(() => content.listBackups()) },
  { method: 'POST', path: '/admin/system/backups/create', handler: ({ body }) => guard(() => content.createBackup(String(body.scope ?? '全平台'))) },
]

/**
 * 从 /admin/dict/{type}/... 中解析字典类型。
 *
 * 白名单取 `ADMIN_DICT_TYPES`（不含 examType / competition）：这两类已由「考试类型」树
 * 接管，若旧接口仍可写，写进去的脏数据会被下一次 `syncExamTypeDict()` 悄悄覆盖。
 * 机构端不受影响 —— `/tenant/dict` 直接调 `listDict`，不经过这里。
 */
function parseDictType(path: string): DictTypeKey {
  const segments = path.split('/').filter(Boolean)
  const type = segments[2]
  const valid: DictTypeKey[] = admin.ADMIN_DICT_TYPES.map((item) => item.key)
  if (!valid.includes(type as DictTypeKey)) mockFail(404, `未知字典类型：${type}`)
  return type as DictTypeKey
}

/** 拆出前缀后的路径段（去掉查询串） */
function parseSegments(path: string, prefix: string): string[] {
  return path.slice(prefix.length).split('/').filter(Boolean)
}

/** 将仓库抛出的业务错误统一转换为 mockFail（{ code, message }） */
function guard<T>(fn: () => T): T {
  try {
    return fn()
  } catch (error) {
    const message = error instanceof Error ? error.message : '服务内部错误'
    mockFail(500, message)
  }
}
