/**
 * 租户管理 Mock 仓库（FR-PT-005 ~ 014）。
 * 模块级可变状态：页面上的通过/驳回/禁用/续费等操作会真实修改数据，
 * 会话内保持一致，模拟真实后端行为。
 */
import type {
  ApplyStatus,
  FeatureSwitches,
  PackageRecord,
  PageResult,
  TenantApply,
  TenantDetailModel,
  TenantRecord,
  TenantStatus,
} from '../api/models'

/* ---------------- 时间工具 ---------------- */

function dateAfter(days: number, hours = 0): string {
  const d = new Date(Date.now() + days * 86400_000 + hours * 3600_000)
  return d.toISOString().slice(0, 19).replace('T', ' ')
}

function dateOnly(dateTime: string): string {
  return dateTime.slice(0, 10)
}

/* ---------------- 套餐 sys_package ---------------- */

function defaultFeatures(overrides: Partial<FeatureSwitches> = {}): FeatureSwitches {
  return {
    aiGenerate: true,
    aiVariant: true,
    aiPhoto: true,
    docImport: true,
    collab: true,
    customPrompt: false,
    ...overrides,
  }
}

export const packages: PackageRecord[] = [
  {
    id: 1,
    name: '轻量版',
    monthlyPrice: 299,
    aiQuota: 1000,
    storageGb: 50,
    maxStaff: 5,
    maxConcurrent: 10,
    features: defaultFeatures({ aiPhoto: false }),
    smsEnabled: false,
  },
  {
    id: 2,
    name: '标准版',
    monthlyPrice: 599,
    aiQuota: 3000,
    storageGb: 200,
    maxStaff: 20,
    maxConcurrent: 20,
    features: defaultFeatures(),
    smsEnabled: true,
  },
  {
    id: 3,
    name: '专业版',
    monthlyPrice: 1299,
    aiQuota: 10000,
    storageGb: 500,
    maxStaff: 60,
    maxConcurrent: 60,
    features: defaultFeatures({ customPrompt: true }),
    smsEnabled: true,
  },
  {
    id: 4,
    name: '旗舰版',
    monthlyPrice: 2999,
    aiQuota: 50000,
    storageGb: 2048,
    maxStaff: 200,
    maxConcurrent: 200,
    features: defaultFeatures({ customPrompt: true }),
    smsEnabled: true,
  },
]

export function getPackage(id: number): PackageRecord {
  const pkg = packages.find((item) => item.id === id)
  if (!pkg) throw new Error(`套餐不存在: ${id}`)
  return pkg
}

/** 续费时长：月/季/年，年享 9 折 */
export const RENEW_DURATIONS = [
  { key: 'month', label: '1 个月', months: 1, discount: 1 },
  { key: 'quarter', label: '3 个月', months: 3, discount: 1 },
  { key: 'year', label: '12 个月', months: 12, discount: 0.9 },
] as const

export type RenewDurationKey = (typeof RENEW_DURATIONS)[number]['key']

/* ---------------- 入驻申请 ---------------- */

interface ApplySeed {
  id: number
  applyNo: string
  orgName: string
  orgType: string
  stages: string[]
  contact: string
  phone: string
  email: string
  intro: string
  submittedDaysAgo: number
  status: ApplyStatus
  rejectReason?: string
}

const APPLY_SEEDS: ApplySeed[] = [
  {
    id: 1,
    applyNo: 'AP202609060001',
    orgName: '杭州市西湖实验中学',
    orgType: '公立学校',
    stages: ['初中', '高中'],
    contact: '陈建国',
    phone: '13857102266',
    email: 'chenjg@xhsy.edu.cn',
    intro: '市属重点中学，在校学生 2300 余人，计划在数学、物理学科试点 AI 组卷与个性化练习。',
    submittedDaysAgo: 3.2,
    status: '待审核',
  },
  {
    id: 2,
    applyNo: 'AP202609080002',
    orgName: '南京启航教育培训中心',
    orgType: '培训机构',
    stages: ['小学', '初中'],
    contact: '刘思远',
    phone: '15950533188',
    email: 'service@qihang-edu.com',
    intro: '专注 K12 课后辅导，在读学员 1200 人，希望通过 AI 出题提升讲义更新效率。',
    submittedDaysAgo: 1.6,
    status: '待审核',
  },
  {
    id: 3,
    applyNo: 'AP202609110003',
    orgName: '成都七中育才附属小学',
    orgType: '公立学校',
    stages: ['小学'],
    contact: '赵晓梅',
    phone: '13688045521',
    email: 'zhaoxm@qcys.edu.cn',
    intro: '区属实验小学，开展智慧课堂课题研究，需要文档识别入库与协同组卷能力。',
    submittedDaysAgo: 0.5,
    status: '待审核',
  },
  {
    id: 4,
    applyNo: 'AP202609120004',
    orgName: '深圳湾区国际学校',
    orgType: '民办学校',
    stages: ['小学', '初中', '高中'],
    contact: 'David 郭',
    phone: '13798206677',
    email: 'david.guo@bayarea-is.cn',
    intro: '双语国际学校，A-Level 与 IB 课程体系，计划搭建校本 AI 题库。',
    submittedDaysAgo: 0.2,
    status: '待审核',
  },
  {
    id: 5,
    applyNo: 'AP202608290005',
    orgName: '武汉光谷第二高级中学',
    orgType: '公立学校',
    stages: ['高中'],
    contact: '何俊',
    phone: '13971304482',
    email: 'hejun@ggez.edu.cn',
    intro: '省级示范高中，全校推行精细化教学，目标月度组卷 300 套。',
    submittedDaysAgo: 15,
    status: '已通过',
  },
  {
    id: 6,
    applyNo: 'AP202609010006',
    orgName: '西安领航考研培训学校',
    orgType: '培训机构',
    stages: ['高中'],
    contact: '马腾',
    phone: '15829217730',
    email: 'mateng@lhky.cn',
    intro: '考研公共课培训机构。',
    submittedDaysAgo: 12,
    status: '已驳回',
    rejectReason: '资质材料不完整：缺少办学许可证年审页，请补交后重新提交申请。',
  },
]

export const applies: TenantApply[] = APPLY_SEEDS.map((seed) => ({
  id: seed.id,
  applyNo: seed.applyNo,
  orgName: seed.orgName,
  orgType: seed.orgType,
  stages: seed.stages,
  contact: seed.contact,
  phone: seed.phone,
  email: seed.email,
  intro: seed.intro,
  certFiles: [
    { name: '营业执照.pdf', type: 'pdf' },
    { name: '办学许可证.jpg', type: 'img' },
    { name: '法人身份证.jpg', type: 'img' },
  ],
  submittedAt: dateAfter(-seed.submittedDaysAgo),
  waitingHours: Math.round(seed.submittedDaysAgo * 24),
  status: seed.status,
  rejectReason: seed.rejectReason,
}))

export function listApplies(query: {
  status?: string
  orgType?: string
  keyword?: string
}): TenantApply[] {
  let result = [...applies]
  if (query.status) result = result.filter((item) => item.status === query.status)
  if (query.orgType) result = result.filter((item) => item.orgType === query.orgType)
  if (query.keyword) {
    const kw = query.keyword.trim().toLowerCase()
    result = result.filter(
      (item) =>
        item.orgName.toLowerCase().includes(kw) || item.applyNo.toLowerCase().includes(kw),
    )
  }
  /* 待审核优先，其余按提交时间倒序 */
  return result.sort((a, b) => {
    if (a.status !== b.status) return a.status === '待审核' ? -1 : 1
    return b.submittedAt.localeCompare(a.submittedAt)
  })
}

/* ---------------- 机构租户 ---------------- */

interface TenantSeed {
  id: number
  code: string
  name: string
  logoHue: number
  orgType: string
  stages: string[]
  packageId: number
  status: TenantStatus
  /** 相对今天的到期天数（负数=已过期） */
  expireInDays: number
  aiUsedRatio: number
  storageUsedGb: number
  createdDaysAgo: number
  contact: string
  phone: string
  city: string
  intro: string
  isolationType: 1 | 2
  storageRegion: string
  disableReason?: string
  certFiles?: Array<{ name: string; type: 'pdf' | 'img' }>
}

/** 默认资质档案 */
const DEFAULT_CERTS: Array<{ name: string; type: 'pdf' | 'img' }> = [
  { name: '营业执照.pdf', type: 'pdf' },
  { name: '办学许可证.jpg', type: 'img' },
]

const TENANT_SEEDS: TenantSeed[] = [
  {
    id: 101,
    code: 'T20250301001',
    name: '武汉光谷第二高级中学',
    logoHue: 212,
    orgType: '公立学校',
    stages: ['高中'],
    packageId: 3,
    status: 2,
    expireInDays: 210,
    aiUsedRatio: 0.63,
    storageUsedGb: 312,
    createdDaysAgo: 560,
    contact: '何俊',
    phone: '13971304482',
    city: '湖北省武汉市',
    intro: '省级示范高中，全校推行精细化教学，AI 组卷覆盖九大学科。',
    isolationType: 1,
    storageRegion: '华东 1（杭州）',
  },
  {
    id: 102,
    code: 'T20241115002',
    name: '上海杨浦双语实验学校',
    logoHue: 268,
    orgType: '民办学校',
    stages: ['初中', '高中'],
    packageId: 4,
    status: 2,
    expireInDays: 95,
    aiUsedRatio: 0.86,
    storageUsedGb: 1480,
    createdDaysAgo: 670,
    contact: '孙倩',
    phone: '13817894456',
    city: '上海市',
    intro: '十五年一贯制双语学校，自建校本 AI 题库 4.2 万题。',
    isolationType: 2,
    storageRegion: '华东 2（上海）',
  },
  {
    id: 103,
    code: 'T20250620003',
    name: '广州明师教育科技有限公司',
    logoHue: 22,
    orgType: '培训机构',
    stages: ['初中', '高中'],
    packageId: 2,
    status: 2,
    expireInDays: 18,
    aiUsedRatio: 0.42,
    storageUsedGb: 96,
    createdDaysAgo: 445,
    contact: '罗敏',
    phone: '13660401177',
    city: '广东省广州市',
    intro: 'K12 课外辅导机构，12 个校区共用一个租户。',
    isolationType: 1,
    storageRegion: '华南 1（深圳）',
  },
  {
    id: 104,
    code: 'T20250801004',
    name: '北京海淀实验小学',
    logoHue: 152,
    orgType: '公立学校',
    stages: ['小学'],
    packageId: 2,
    status: 1,
    expireInDays: 9,
    aiUsedRatio: 0.28,
    storageUsedGb: 40,
    createdDaysAgo: 5,
    contact: '李文博',
    phone: '13701256633',
    city: '北京市',
    intro: '区属实验小学，智慧课堂课题试点校。',
    isolationType: 1,
    storageRegion: '华北 2（北京）',
  },
  {
    id: 105,
    code: 'T20250812005',
    name: '长沙岳麓区博才寄宿小学',
    logoHue: 330,
    orgType: '公立学校',
    stages: ['小学'],
    packageId: 3,
    status: 1,
    expireInDays: 2,
    aiUsedRatio: 0.74,
    storageUsedGb: 210,
    createdDaysAgo: 12,
    contact: '周灿',
    phone: '13574822906',
    city: '湖南省长沙市',
    intro: '开展跨学科主题教学，需协同组卷与变式训练。',
    isolationType: 1,
    storageRegion: '华东 1（杭州）',
  },
  {
    id: 106,
    code: 'T20250318006',
    name: '重庆巴蜀常春藤学校',
    logoHue: 190,
    orgType: '民办学校',
    stages: ['小学', '初中', '高中'],
    packageId: 4,
    status: 3,
    expireInDays: -23,
    aiUsedRatio: 1,
    storageUsedGb: 1930,
    createdDaysAgo: 540,
    contact: '高翔',
    phone: '13983705526',
    city: '重庆市',
    intro: '国际化学校，已到期待续费。',
    isolationType: 2,
    storageRegion: '西南 1（成都）',
  },
  {
    id: 107,
    code: 'T20241009007',
    name: '天津海河教育培训学校',
    logoHue: 44,
    orgType: '培训机构',
    stages: ['初中'],
    packageId: 1,
    status: 3,
    expireInDays: -6,
    aiUsedRatio: 0.55,
    storageUsedGb: 22,
    createdDaysAgo: 700,
    contact: '范晓芸',
    phone: '15122779034',
    city: '天津市',
    intro: '中考冲刺培训机构，到期未续费。',
    isolationType: 1,
    storageRegion: '华北 1（青岛）',
  },
  {
    id: 108,
    code: 'T20250225008',
    name: '苏州工业园区星海中学',
    logoHue: 246,
    orgType: '公立学校',
    stages: ['初中', '高中'],
    packageId: 3,
    status: 2,
    expireInDays: 130,
    aiUsedRatio: 0.91,
    storageUsedGb: 402,
    createdDaysAgo: 565,
    contact: '吴建平',
    phone: '13915408871',
    city: '江苏省苏州市',
    intro: '园区直属完全中学，AI 月度额度使用率长期偏高。',
    isolationType: 1,
    storageRegion: '华东 1（杭州）',
  },
  {
    id: 109,
    code: 'T20250506009',
    name: '青岛崂山第一中学',
    logoHue: 8,
    orgType: '公立学校',
    stages: ['高中'],
    packageId: 2,
    status: 4,
    expireInDays: 77,
    aiUsedRatio: 0.1,
    storageUsedGb: 18,
    createdDaysAgo: 490,
    contact: '姜涛',
    phone: '15865572109',
    city: '山东省青岛市',
    intro: '因多次违规采集试题被平台停用整改。',
    isolationType: 1,
    storageRegion: '华北 1（青岛）',
    disableReason: '违规上传侵权试卷，已通知限期整改并提交申诉材料。',
  },
  {
    id: 110,
    code: 'T20250910010',
    name: '杭州市西湖实验中学（新入驻）',
    logoHue: 172,
    orgType: '公立学校',
    stages: ['初中', '高中'],
    packageId: 2,
    status: 1,
    expireInDays: 13,
    aiUsedRatio: 0.05,
    storageUsedGb: 6,
    createdDaysAgo: 1,
    contact: '陈建国',
    phone: '13857102266',
    city: '浙江省杭州市',
    intro: '创建未满 24 小时的新租户（用于演示数据隔离可调整窗口）。',
    isolationType: 1,
    storageRegion: '华东 1（杭州）',
    certFiles: [
      { name: '营业执照.pdf', type: 'pdf' },
      { name: '办学许可证.jpg', type: 'img' },
      { name: '法人身份证.jpg', type: 'img' },
    ],
  },
]

export const tenants: TenantRecord[] = TENANT_SEEDS.map((seed) => {
  const pkg = getPackage(seed.packageId)
  const expireTime = dateAfter(seed.expireInDays)
  const createdAt = dateAfter(-seed.createdDaysAgo)
  return {
    id: seed.id,
    code: seed.code,
    name: seed.name,
    logoHue: seed.logoHue,
    orgType: seed.orgType,
    stages: seed.stages,
    packageId: seed.packageId,
    status: seed.status,
    expireTime,
    trialEndTime: seed.status === 1 ? expireTime : undefined,
    aiUsed: Math.round(pkg.aiQuota * seed.aiUsedRatio),
    storageUsedGb: seed.storageUsedGb,
    createdAt,
    contact: seed.contact,
    phone: seed.phone,
    city: seed.city,
    intro: seed.intro,
    certFiles: seed.certFiles ?? DEFAULT_CERTS,
    isolationType: seed.isolationType,
    storageRegion: seed.storageRegion,
    disableReason: seed.disableReason,
    switches: { ...pkg.features },
    quotas: {
      aiQuota: pkg.aiQuota,
      storageGb: pkg.storageGb,
      maxStaff: pkg.maxStaff,
      maxConcurrent: pkg.maxConcurrent,
    },
  }
})

export const TENANT_STATUS_TEXT: Record<TenantStatus, string> = {
  1: '试用中',
  2: '正式',
  3: '已到期',
  4: '已禁用',
}

export function listTenants(query: {
  status?: string
  packageId?: string
  orgType?: string
  keyword?: string
  expireFrom?: string
  expireTo?: string
}): TenantRecord[] {
  let result = [...tenants]
  if (query.status) result = result.filter((item) => item.status === Number(query.status))
  if (query.packageId)
    result = result.filter((item) => item.packageId === Number(query.packageId))
  if (query.orgType) result = result.filter((item) => item.orgType === query.orgType)
  if (query.expireFrom) result = result.filter((item) => dateOnly(item.expireTime) >= query.expireFrom!)
  if (query.expireTo) result = result.filter((item) => dateOnly(item.expireTime) <= query.expireTo!)
  if (query.keyword) {
    const kw = query.keyword.trim().toLowerCase()
    result = result.filter(
      (item) => item.name.toLowerCase().includes(kw) || item.code.toLowerCase().includes(kw),
    )
  }
  return result.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export function getTenant(id: number): TenantRecord {
  const tenant = tenants.find((item) => item.id === id)
  if (!tenant) throw new Error(`机构不存在: ${id}`)
  return tenant
}

export function paginate<T>(list: T[], page: number, pageSize: number): PageResult<T> {
  const safePage = Math.max(1, page)
  return {
    list: list.slice((safePage - 1) * pageSize, safePage * pageSize),
    total: list.length,
  }
}

/* ---------------- 业务操作 ---------------- */

/** 通过入驻申请（FR-PT-006）：开通租户 + 试用期 + 初始管理员 */
export function approveApply(
  applyId: number,
  config: { trialDays: number; packageId: number; adminAccount: string },
): TenantRecord {
  const apply = applies.find((item) => item.id === applyId)
  if (!apply) throw new Error('申请不存在')
  if (apply.status !== '待审核') throw new Error('该申请已处理，请刷新列表')

  const pkg = getPackage(config.packageId)
  const expireTime = dateAfter(config.trialDays)
  const tenant: TenantRecord = {
    id: Math.max(...tenants.map((item) => item.id)) + 1,
    code: `T${new Date().toISOString().slice(0, 10).replace(/-/g, '')}${String(tenants.length + 1).padStart(3, '0')}`,
    name: apply.orgName,
    logoHue: (apply.id * 47) % 360,
    orgType: apply.orgType,
    stages: apply.stages,
    packageId: pkg.id,
    status: 1,
    expireTime,
    trialEndTime: expireTime,
    aiUsed: 0,
    storageUsedGb: 0,
    createdAt: dateAfter(0),
    contact: apply.contact,
    phone: apply.phone,
    city: '',
    intro: apply.intro ?? '',
    certFiles: apply.certFiles.length > 0 ? apply.certFiles : DEFAULT_CERTS,
    isolationType: 1,
    storageRegion: '华东 1（杭州）',
    switches: { ...pkg.features },
    quotas: {
      aiQuota: pkg.aiQuota,
      storageGb: pkg.storageGb,
      maxStaff: pkg.maxStaff,
      maxConcurrent: pkg.maxConcurrent,
    },
  }
  tenants.push(tenant)
  apply.status = '已通过'
  return tenant
}

/** 驳回申请（FR-PT-007）：必填原因 */
export function rejectApply(applyId: number, reason: string): void {
  const apply = applies.find((item) => item.id === applyId)
  if (!apply) throw new Error('申请不存在')
  if (apply.status !== '待审核') throw new Error('该申请已处理，请刷新列表')
  apply.status = '已驳回'
  apply.rejectReason = reason
}

/** 管理端直接新增机构：生成一条待审核的入驻申请 */
export function createApply(payload: {
  orgName: string
  orgType: string
  stages: string[]
  contact: string
  phone: string
  email?: string
  intro?: string
  certFiles: Array<{ name: string; type: 'pdf' | 'img' }>
}): TenantApply {
  const apply: TenantApply = {
    id: Math.max(0, ...applies.map((item) => item.id)) + 1,
    applyNo: `AP${new Date().toISOString().slice(0, 10).replace(/-/g, '')}${String(
      applies.length + 1,
    ).padStart(4, '0')}`,
    orgName: payload.orgName,
    orgType: payload.orgType,
    stages: payload.stages,
    contact: payload.contact,
    phone: payload.phone,
    email: payload.email,
    intro: payload.intro,
    certFiles: payload.certFiles,
    submittedAt: dateAfter(0),
    waitingHours: 0,
    status: '待审核',
  }
  applies.unshift(apply)
  return apply
}

/** 禁用（FR-PT-010）：记录原因，立即下线机构端登录 */
export function disableTenant(id: number, reason: string): void {
  const tenant = getTenant(id)
  if (tenant.status === 4) throw new Error('该机构已处于禁用状态')
  tenant.status = 4
  tenant.disableReason = reason
}

/** 启用：恢复原状态（到期仍到期、试用仍试用） */
export function enableTenant(id: number): void {
  const tenant = getTenant(id)
  if (tenant.status !== 4) throw new Error('该机构未处于禁用状态')
  const expired = new Date(tenant.expireTime).getTime() < Date.now()
  tenant.status = expired ? 3 : tenant.trialEndTime ? 1 : 2
  tenant.disableReason = undefined
}

/** 续费（FR-PT-009）：到期时间顺延，返回新到期时间与金额 */
export function renewTenant(
  id: number,
  packageId: number,
  durationKey: RenewDurationKey,
): { expireTime: string; amount: number } {
  const tenant = getTenant(id)
  const pkg = getPackage(packageId)
  const duration =
    RENEW_DURATIONS.find((item) => item.key === durationKey) ?? RENEW_DURATIONS[0]
  const base = Math.max(new Date(tenant.expireTime).getTime(), Date.now())
  const expireTime = new Date(base + duration.months * 86400_000)
    .toISOString()
    .slice(0, 19)
    .replace('T', ' ')
  tenant.packageId = pkg.id
  tenant.status = 2
  tenant.expireTime = expireTime
  tenant.trialEndTime = undefined
  tenant.switches = { ...pkg.features }
  tenant.quotas = {
    aiQuota: pkg.aiQuota,
    storageGb: pkg.storageGb,
    maxStaff: pkg.maxStaff,
    maxConcurrent: pkg.maxConcurrent,
  }
  return {
    expireTime,
    amount: Math.round(pkg.monthlyPrice * duration.months * duration.discount),
  }
}

/** 试用配置（FR-PT-011）：延长试用 1-90 天 */
export function extendTrial(id: number, days: number): string {
  const tenant = getTenant(id)
  if (tenant.status !== 1) throw new Error('仅试用中的机构可延长试用')
  const base = Math.max(new Date(tenant.trialEndTime ?? tenant.expireTime).getTime(), Date.now())
  const newEnd = new Date(base + days * 86400_000)
  const expireTime = newEnd.toISOString().slice(0, 19).replace('T', ' ')
  tenant.expireTime = expireTime
  tenant.trialEndTime = expireTime
  return expireTime
}

/** 试用转正式（FR-PT-011） */
export function activateTenant(id: number, packageId: number): string {
  const tenant = getTenant(id)
  const pkg = getPackage(packageId)
  if (tenant.status !== 1) throw new Error('仅试用中的机构可转正式')
  const expireTime = dateAfter(365)
  tenant.status = 2
  tenant.packageId = pkg.id
  tenant.expireTime = expireTime
  tenant.trialEndTime = undefined
  tenant.switches = { ...pkg.features }
  tenant.quotas = {
    aiQuota: pkg.aiQuota,
    storageGb: pkg.storageGb,
    maxStaff: pkg.maxStaff,
    maxConcurrent: pkg.maxConcurrent,
  }
  return expireTime
}

/** 更新基础信息 */
export function updateTenantBase(
  id: number,
  patch: { name: string; contact: string; phone: string; city: string; intro: string; stages: string[] },
): void {
  const tenant = getTenant(id)
  Object.assign(tenant, patch)
}

/** 更新套餐权限（FR-PT-012）：功能开关 + 配额 */
export function updateTenantFeature(
  id: number,
  payload: { switches: FeatureSwitches; quotas: TenantRecord['quotas'] },
): void {
  const tenant = getTenant(id)
  tenant.switches = { ...payload.switches }
  tenant.quotas = { ...payload.quotas }
}

/** 更新数据隔离策略（FR-PT-013）：创建 24 小时后才允许变更 */
export function updateTenantIsolation(
  id: number,
  isolationType: 1 | 2,
  storageRegion: string,
): void {
  const tenant = getTenant(id)
  const hoursSinceCreated = (Date.now() - new Date(tenant.createdAt).getTime()) / 3600_000
  if (hoursSinceCreated > 24) {
    throw new Error('机构创建超过 24 小时，隔离策略变更请联系平台技术支持执行')
  }
  tenant.isolationType = isolationType
  tenant.storageRegion = storageRegion
}

/** 机构详情（FR-PT-011：4 个页签数据） */
export function getTenantDetail(id: number): TenantDetailModel {
  const tenant = getTenant(id)
  const seed = tenant.id
  const monthLabels: string[] = []
  const calls: number[] = []
  for (let i = 5; i >= 0; i -= 1) {
    const d = new Date()
    d.setMonth(d.getMonth() - i)
    monthLabels.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
    calls.push(Math.round(tenant.quotas.aiQuota * (0.12 + ((seed + i) % 5) * 0.11)))
  }
  return {
    tenant,
    pkg: getPackage(tenant.packageId),
    stats: {
      questionCount: 3200 + (seed % 13) * 460,
      paperCount: 260 + (seed % 9) * 55,
      materialCount: 90 + (seed % 7) * 26,
      staffCount: 12 + (seed % 5) * 9,
    },
    aiMonthly: { months: monthLabels, calls },
  }
}

/** 套餐保存（新增或编辑） */
export function savePackage(input: Partial<PackageRecord>): PackageRecord {
  if (input.id) {
    const pkg = getPackage(input.id)
    Object.assign(pkg, input)
    /* 套餐变更同步引用该套餐的机构配额（演示效果） */
    return pkg
  }
  const pkg: PackageRecord = {
    id: Math.max(0, ...packages.map((item) => item.id)) + 1,
    name: input.name ?? '未命名套餐',
    monthlyPrice: input.monthlyPrice ?? 0,
    aiQuota: input.aiQuota ?? 1000,
    storageGb: input.storageGb ?? 100,
    maxStaff: input.maxStaff ?? 10,
    maxConcurrent: input.maxConcurrent ?? 10,
    features: input.features ?? defaultFeatures(),
    smsEnabled: input.smsEnabled ?? false,
  }
  packages.push(pkg)
  return pkg
}
