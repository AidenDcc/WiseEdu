import type { MockRoute } from './engine'
import { mockFail } from './engine'
import { getAppConfig } from '../config'
import { mockUsers, adminOverview, tenantOverview } from './data'
import * as store from './tenant-store'
import * as admin from './admin-store'
import * as org from './org-store'
import type { DictTypeKey, FeatureSwitches, PackageRecord, TenantRecord } from '../api/models'
import type { SessionUser, MockUser } from './types'

function toSessionUser(user: MockUser): SessionUser {
  const { password: _password, appId: _appId, ...rest } = user
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
  { method: 'POST', path: '/tenant/questions/variant', handler: ({ body }) => guard(() => org.variantOf(Number(body.id))) },

  // AI 出题 / 额度
  { method: 'GET', path: '/tenant/quota', handler: () => guard(() => org.QUOTA_TEXT) },
  { method: 'POST', path: '/tenant/ai/generate', handler: ({ body }) => guard(() => org.generateQuestions(Number(body.count ?? 5))) },
  { method: 'POST', path: '/tenant/ai/adopt', handler: ({ body }) => guard(() => org.adoptGenerated(body as never, String(body.subject ?? '数学'), String(body.grade ?? '高一'), String(body.type ?? '单选题'))) },

  // 拍照识题
  { method: 'GET', path: '/tenant/photo/tasks', handler: () => guard(() => org.photoTasks) },
  { method: 'POST', path: '/tenant/photo/upload', handler: ({ body }) => guard(() => org.uploadPhotos(body.names as string[])) },
  { method: 'POST', path: '/tenant/photo/recognize', handler: ({ body }) => guard(() => org.recognizePhoto(String(body.id))) },
  {
    method: 'POST',
    path: '/tenant/photo/decide',
    handler: ({ body }) =>
      guard(() =>
        org.decidePhotoResult(
          String(body.taskId),
          String(body.resultId),
          body.decision as 'import' | 'draft' | 'drop',
          body.edit as { stem?: string; answer?: string; analysis?: string } | undefined,
        ),
      ),
  },

  // 试卷
  { method: 'GET', path: '/tenant/papers', handler: () => guard(() => org.papers) },
  { method: 'POST', path: '/tenant/papers/save', handler: ({ body }) => guard(() => org.savePaper(body as never)) },
  { method: 'POST', path: '/tenant/papers/delete', handler: ({ body }) => guard(() => { org.deletePaper(Number(body.id)); return null }) },
  { method: 'POST', path: '/tenant/papers/review', handler: ({ body }) => guard(() => org.reviewPaper(Number(body.id), Boolean(body.pass), String(body.opinion ?? ''))) },
  { method: 'POST', path: '/tenant/papers/ai-compose', handler: ({ body }) => guard(() => org.aiComposePaper(body as never)) },
  { method: 'POST', path: '/tenant/papers/swap-question', handler: ({ body }) => guard(() => org.swapPaperQuestion(Number(body.paperId), Number(body.questionId))) },
  { method: 'POST', path: '/tenant/papers/parallels', handler: ({ body }) => guard(() => org.generateParallels(Number(body.motherId), Number(body.count ?? 1))) },

  // 教辅
  { method: 'GET', path: '/tenant/materials', handler: () => guard(() => org.materials) },
  { method: 'POST', path: '/tenant/materials/upload', handler: ({ body }) => guard(() => org.uploadMaterial(body as never)) },
  { method: 'POST', path: '/tenant/materials/recognize', handler: ({ body }) => guard(() => org.reRecognizeMaterial(Number(body.id))) },
  { method: 'POST', path: '/tenant/materials/example', handler: ({ body }) => guard(() => org.decideExample(Number(body.materialId), Number(body.exampleId), body.decision as 'import' | 'edit' | 'ignore')) },
  { method: 'POST', path: '/tenant/materials/finish', handler: ({ body }) => guard(() => ({ message: org.finishMaterial(Number(body.id), Number(body.pendingCount ?? 0)) })) },
  { method: 'POST', path: '/tenant/materials/delete', handler: ({ body }) => guard(() => { org.deleteMaterial(Number(body.id)); return null }) },

  // 多媒体
  { method: 'GET', path: '/tenant/media', handler: () => guard(() => org.mediaResources) },
  { method: 'POST', path: '/tenant/media/upload', handler: ({ body }) => guard(() => org.uploadMedia(body as never)) },
  { method: 'POST', path: '/tenant/media/link', handler: ({ body }) => guard(() => ({ linkedCount: org.linkMedia(Number(body.id), body.targets as string[]) })) },
  { method: 'POST', path: '/tenant/media/delete', handler: ({ body }) => guard(() => ({ linkedCount: org.deleteMedia(Number(body.id)) })) },

  // 我的文件
  { method: 'GET', path: '/tenant/folders', handler: () => guard(() => org.folders) },
  { method: 'POST', path: '/tenant/folders/save', handler: ({ body }) => guard(() => org.saveFolder(body as never)) },
  { method: 'POST', path: '/tenant/folders/delete', handler: ({ body }) => guard(() => ({ moved: org.deleteFolder(Number(body.id)) })) },
  { method: 'GET', path: '/tenant/files', handler: () => guard(() => ({ list: org.orgFiles, usage: org.storageUsage })) },
  { method: 'POST', path: '/tenant/files/upload', handler: ({ body }) => guard(() => org.uploadFiles(body.names as string[], Number(body.folderId ?? 0))) },
  { method: 'POST', path: '/tenant/files/delete', handler: ({ body }) => guard(() => { org.deleteFile(Number(body.id)); return null }) },
  { method: 'POST', path: '/tenant/files/recognize', handler: ({ body }) => guard(() => org.recognizeFile(Number(body.id))) },

  // 公式中心
  { method: 'GET', path: '/tenant/formulas/standard', handler: () => guard(() => org.standardFormulas) },
  { method: 'POST', path: '/tenant/formulas/collect', handler: ({ body }) => guard(() => org.collectStandardFormula(Number(body.id))) },
  { method: 'GET', path: '/tenant/formulas', handler: () => guard(() => org.orgFormulas) },
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
  { method: 'GET', path: '/tenant/menus', handler: () => guard(() => org.orgMenuTree) },
  { method: 'POST', path: '/tenant/menus/save', handler: ({ body }) => guard(() => { org.saveOrgMenus(body.items as never); return null }) },
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
      const user = mockUsers.find(
        (item) => item.appId === appName && item.account === account,
      )
      if (!user || user.password !== password) {
        mockFail(1001, '账号或密码错误')
      }
      return { token: createToken(user), user: toSessionUser(user) }
    },
  },
  {
    method: 'GET',
    path: '/auth/me',
    handler: () => {
      // token 由 Mock 引擎从请求头语义中获取；此处简化为从 localStorage 读取
      const token = localStorage.getItem(
        `aiteach:${getAppConfig().appName}:token`,
      )
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
    handler: ({ query }) => guard(() => store.listApplies(query)),
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
        const certFiles = Array.isArray(body.certFiles)
          ? (body.certFiles as Array<{ name: string; type: 'pdf' | 'img' }>)
          : []
        if (certFiles.length === 0) mockFail(3014, '请至少上传一份资质材料')
        return store.createApply({
          orgName,
          orgType,
          stages: Array.isArray(body.stages) ? (body.stages as string[]) : [],
          contact,
          phone,
          email: String(body.email ?? '').trim() || undefined,
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
          const tenant = store.approveApply(id, { trialDays, packageId, adminAccount })
          return { tenantName: tenant.name, expireTime: tenant.expireTime, adminAccount }
        }
        const reason = String(body.reason ?? '').trim()
        if (reason.length < 5 || reason.length > 200) {
          mockFail(3003, '驳回原因须为 5-200 字')
        }
        store.rejectApply(id, reason)
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
        if (action === 'move') {
          admin.moveDictItem(dictType, Number(body.id), Number(body.direction) === -1 ? -1 : 1)
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
]

/** 从 /admin/dict/{type}/... 中解析字典类型 */
function parseDictType(path: string): DictTypeKey {
  const segments = path.split('/').filter(Boolean)
  const type = segments[2]
  const valid: DictTypeKey[] = ['subject', 'grade', 'term', 'questionType', 'difficulty', 'examType']
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
