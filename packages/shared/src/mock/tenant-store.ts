/**
 * 租户管理 Mock 仓库（FR-PT-005 ~ 014）。
 * 模块级可变状态：页面上的通过/驳回/禁用/续费等操作会真实修改数据，
 * 会话内保持一致，模拟真实后端行为。
 */
import type {
  ApplyStatus,
  CertFile,
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
  /** 机构编号：与 applyNo 同源（申请创建时一起生成），通过后成为租户 code */
  code: string
  orgName: string
  orgType: string
  stages: string[]
  contact: string
  phone: string
  email: string
  /* 所在地区（省市区连写）与门牌级详细地址。与 TenantSeed 同构 —— 申请通过后
     approveApply 会把这两项原样搬进租户，所以种子这里不给值，新建的租户地址就是空串 */
  city: string
  address: string
  intro: string
  submittedDaysAgo: number
  status: ApplyStatus
  /** 审核留痕：仅已通过 / 已驳回的种子需要给，天数同样是「相对今天」 */
  reviewedDaysAgo?: number
  reviewer?: string
  rejectReason?: string
}

const APPLY_SEEDS: ApplySeed[] = [
  {
    id: 1,
    applyNo: 'AP202609060001',
    code: 'T20260906001',
    orgName: '杭州市西湖实验中学',
    orgType: '公立学校',
    stages: ['初中', '高中'],
    contact: '陈建国',
    phone: '13857102266',
    email: 'chenjg@xhsy.edu.cn',
    city: '浙江省杭州市西湖区',
    address: '西湖区文二西路 118 号',
    intro: '市属重点中学，在校学生 2300 余人，计划在数学、物理学科试点 AI 组卷与个性化练习。',
    submittedDaysAgo: 3.2,
    status: '待审核',
  },
  {
    id: 2,
    applyNo: 'AP202609080002',
    code: 'T20260908002',
    orgName: '南京启航教育培训中心',
    orgType: '培训机构',
    stages: ['小学', '初中'],
    contact: '刘思远',
    phone: '15950533188',
    email: 'service@qihang-edu.com',
    city: '江苏省南京市鼓楼区',
    address: '鼓楼区中山北路 88 号 5 楼',
    intro: '专注 K12 课后辅导，在读学员 1200 人，希望通过 AI 出题提升讲义更新效率。',
    submittedDaysAgo: 1.6,
    status: '待审核',
  },
  {
    id: 3,
    applyNo: 'AP202609110003',
    code: 'T20260911003',
    orgName: '成都七中育才附属小学',
    orgType: '公立学校',
    stages: ['小学'],
    contact: '赵晓梅',
    phone: '13688045521',
    email: 'zhaoxm@qcys.edu.cn',
    city: '四川省成都市锦江区',
    address: '锦江区滨江东路 66 号',
    intro: '区属实验小学，开展智慧课堂课题研究，需要文档识别入库与协同组卷能力。',
    submittedDaysAgo: 0.5,
    status: '待审核',
  },
  {
    id: 4,
    applyNo: 'AP202609120004',
    code: 'T20260912004',
    orgName: '深圳湾区国际学校',
    orgType: '民办学校',
    stages: ['小学', '初中', '高中'],
    contact: 'David 郭',
    phone: '13798206677',
    email: 'david.guo@bayarea-is.cn',
    city: '广东省深圳市南山区',
    address: '南山区科苑南路 2666 号',
    intro: '双语国际学校，A-Level 与 IB 课程体系，计划搭建校本 AI 题库。',
    submittedDaysAgo: 0.2,
    status: '待审核',
  },
  {
    id: 5,
    applyNo: 'AP202608290005',
    /* 机构编号刻意用 T20250301001 —— 与租户种子 101 同号：这条申请正是 101 的来源，
       两处编号一致才看得出「申请 → 审核通过 → 租户」是同一个机构。 */
    code: 'T20250301001',
    orgName: '武汉光谷第二高级中学',
    orgType: '公立学校',
    stages: ['高中'],
    contact: '何俊',
    phone: '13971304482',
    email: 'hejun@ggez.edu.cn',
    /* 与租户种子 101（武汉光谷二中）同址：这条申请「已通过」，正是 101 的来源，
       两处地址保持一致才看得出「申请 → 审核通过 → 租户」的延续 */
    city: '湖北省武汉市洪山区',
    address: '洪山区珞喻路 152 号光谷教育园区 3 号楼',
    intro: '省级示范高中，全校推行精细化教学，目标月度组卷 300 套。',
    submittedDaysAgo: 15,
    status: '已通过',
    reviewedDaysAgo: 14,
    reviewer: '平台运营',
  },
  {
    id: 6,
    applyNo: 'AP202609010006',
    code: 'T20260901006',
    orgName: '西安领航考研培训学校',
    orgType: '培训机构',
    stages: ['高中'],
    contact: '马腾',
    phone: '15829217730',
    email: 'mateng@lhky.cn',
    city: '陕西省西安市雁塔区',
    address: '雁塔区小寨东路 168 号',
    intro: '考研公共课培训机构。',
    submittedDaysAgo: 12,
    status: '已驳回',
    reviewedDaysAgo: 11,
    reviewer: '平台运营',
    rejectReason: '资质材料不完整：缺少办学许可证年审页，请补交后重新提交申请。',
  },
]

export const applies: TenantApply[] = APPLY_SEEDS.map((seed) => ({
  id: seed.id,
  applyNo: seed.applyNo,
  code: seed.code,
  orgName: seed.orgName,
  orgType: seed.orgType,
  stages: seed.stages,
  contact: seed.contact,
  phone: seed.phone,
  email: seed.email,
  city: seed.city,
  address: seed.address,
  intro: seed.intro,
  certFiles: [
    { name: '营业执照.pdf', type: 'pdf', category: 'license' },
    { name: '办学许可证.jpg', type: 'img', category: 'permit' },
    { name: '法人身份证.jpg', type: 'img', category: 'legal' },
  ],
  submittedAt: dateAfter(-seed.submittedDaysAgo),
  waitingHours: Math.round(seed.submittedDaysAgo * 24),
  status: seed.status,
  reviewedAt: seed.reviewedDaysAgo != null ? dateAfter(-seed.reviewedDaysAgo) : undefined,
  reviewer: seed.reviewer,
  rejectReason: seed.rejectReason,
}))

export function listApplies(query: {
  status?: string
  orgType?: string
  keyword?: string
  /** 覆盖学段，逗号分隔；命中申请里任一学段即可（多选是「或」关系） */
  stages?: string
  /** 联系人姓名，模糊匹配 */
  contact?: string
}): TenantApply[] {
  let result = [...applies]
  if (query.status) result = result.filter((item) => item.status === query.status)
  if (query.orgType) result = result.filter((item) => item.orgType === query.orgType)
  if (query.stages) {
    const wanted = query.stages.split(',').filter(Boolean)
    result = result.filter((item) => item.stages.some((stage) => wanted.includes(stage)))
  }
  if (query.contact) {
    const contact = query.contact.trim().toLowerCase()
    result = result.filter((item) => item.contact.toLowerCase().includes(contact))
  }
  if (query.keyword) {
    const kw = query.keyword.trim().toLowerCase()
    result = result.filter(
      (item) =>
        item.orgName.toLowerCase().includes(kw) ||
        item.applyNo.toLowerCase().includes(kw) ||
        item.code.toLowerCase().includes(kw),
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
  address: string
  intro: string
  isolationType: 1 | 2
  storageRegion: string
  disableReason?: string
  certFiles?: CertFile[]
}

/** 默认资质档案：三类各一份，与新增机构表单的分组一一对应 */
const DEFAULT_CERTS: CertFile[] = [
  { name: '营业执照.pdf', type: 'pdf', category: 'license' },
  { name: '办学许可证.jpg', type: 'img', category: 'permit' },
  { name: '法人身份证.jpg', type: 'img', category: 'legal' },
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
    city: '湖北省武汉市洪山区',
    address: '洪山区珞喻路 152 号光谷教育园区 3 号楼',
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
    city: '上海市杨浦区',
    address: '杨浦区国权路 383 号',
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
    city: '广东省广州市天河区',
    address: '天河区体育东路 122 号羊城国际商贸大厦 18 层',
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
    city: '北京市海淀区',
    address: '海淀区中关村南大街 12 号',
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
    city: '湖南省长沙市岳麓区',
    address: '岳麓区麓山南路 932 号',
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
    city: '重庆市渝北区',
    address: '渝北区龙溪街道金开大道 1001 号',
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
    city: '天津市河西区',
    address: '河西区友谊路 35 号',
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
    city: '江苏省苏州市苏州工业园区',
    address: '苏州工业园区星海街 155 号',
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
    city: '山东省青岛市崂山区',
    address: '崂山区松岭路 70 号',
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
    city: '浙江省杭州市西湖区',
    address: '西湖区文一西路 522 号',
    intro: '创建未满 24 小时的新租户（用于演示数据隔离可调整窗口）。',
    isolationType: 1,
    storageRegion: '华东 1（杭州）',
    certFiles: [
      { name: '营业执照.pdf', type: 'pdf', category: 'license' },
      { name: '办学许可证.jpg', type: 'img', category: 'permit' },
      { name: '法人身份证.jpg', type: 'img', category: 'legal' },
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
    address: seed.address,
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
  /** 本月 AI 用量区间，闭区间；口径与列表「本月 AI 用量」列一致（都是 `aiUsed`） */
  aiMin?: string
  aiMax?: string
}): TenantRecord[] {
  let result = [...tenants]
  if (query.status) result = result.filter((item) => item.status === Number(query.status))
  if (query.packageId)
    result = result.filter((item) => item.packageId === Number(query.packageId))
  if (query.orgType) result = result.filter((item) => item.orgType === query.orgType)
  if (query.expireFrom) result = result.filter((item) => dateOnly(item.expireTime) >= query.expireFrom!)
  if (query.expireTo) result = result.filter((item) => dateOnly(item.expireTime) <= query.expireTo!)
  /* 空串已由请求层的 withQuery 滤掉，但 0 是合法下界，所以判 `!== undefined` 而不是真值 */
  if (query.aiMin !== undefined && query.aiMin !== '')
    result = result.filter((item) => item.aiUsed >= Number(query.aiMin))
  if (query.aiMax !== undefined && query.aiMax !== '')
    result = result.filter((item) => item.aiUsed <= Number(query.aiMax))
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

/**
 * 机构编号：`T` + 当天日期 + 3 位序号。
 *
 * 序号取**申请与租户两处**同前缀编号的最大值 + 1，只看申请是不够的 —— 租户种子里的编号
 * （如 T20250301001）本来就是从更早的申请沿用过来的，只数 `applies` 会算出与租户撞号的编号。
 */
function nextOrgCode(): string {
  const prefix = `T${new Date().toISOString().slice(0, 10).replace(/-/g, '')}`
  const used = [...applies, ...tenants]
    .map((item) => item.code)
    .filter((code) => code.startsWith(prefix))
    .map((code) => Number(code.slice(prefix.length)))
  return `${prefix}${String(Math.max(0, ...used) + 1).padStart(3, '0')}`
}

/** 审核留痕：通过 / 驳回都要盖章，列表的「审核时间」与详情里的「操作人」都读这两个字段 */
function stampReview(apply: TenantApply, reviewer?: string): void {
  apply.reviewedAt = dateAfter(0)
  apply.reviewer = reviewer || 'admin'
}

/** 通过入驻申请（FR-PT-006）：开通租户 + 试用期 + 初始管理员 */
export function approveApply(
  applyId: number,
  config: { trialDays: number; packageId: number; adminAccount: string; reviewer?: string },
): TenantRecord {
  const apply = applies.find((item) => item.id === applyId)
  if (!apply) throw new Error('申请不存在')
  if (apply.status !== '待审核') throw new Error('该申请已处理，请刷新列表')

  const pkg = getPackage(config.packageId)
  const expireTime = dateAfter(config.trialDays)
  const tenant: TenantRecord = {
    id: Math.max(...tenants.map((item) => item.id)) + 1,
    /* 机构编号在申请创建时就定了，开通租户只是沿用 —— 同一机构全程只有一个编号 */
    code: apply.code,
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
    /* 早期种子申请没有 city（那时申请表单还不收省市区），回退成空串 */
    city: apply.city ?? '',
    address: apply.address ?? '',
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
  stampReview(apply, config.reviewer)
  return tenant
}

/** 驳回申请（FR-PT-007）：必填原因 */
export function rejectApply(applyId: number, reason: string, reviewer?: string): void {
  const apply = applies.find((item) => item.id === applyId)
  if (!apply) throw new Error('申请不存在')
  if (apply.status !== '待审核') throw new Error('该申请已处理，请刷新列表')
  apply.status = '已驳回'
  apply.rejectReason = reason
  stampReview(apply, reviewer)
}

/** 管理端直接新增机构：生成一条待审核的入驻申请 */
export function createApply(payload: {
  orgName: string
  orgType: string
  stages: string[]
  contact: string
  phone: string
  email?: string
  city?: string
  address?: string
  intro?: string
  certFiles: CertFile[]
}): TenantApply {
  const apply: TenantApply = {
    id: Math.max(0, ...applies.map((item) => item.id)) + 1,
    applyNo: `AP${new Date().toISOString().slice(0, 10).replace(/-/g, '')}${String(
      applies.length + 1,
    ).padStart(4, '0')}`,
    code: nextOrgCode(),
    orgName: payload.orgName,
    orgType: payload.orgType,
    stages: payload.stages,
    contact: payload.contact,
    phone: payload.phone,
    email: payload.email,
    city: payload.city,
    address: payload.address,
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
  patch: {
    name: string
    contact: string
    phone: string
    city: string
    address: string
    intro: string
    stages: string[]
  },
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

/* ---------------- AI 调用量统计（机构详情页签） ----------------
   两种粒度来自同一份月总量：本月按天、近 6 个月按月。 */

/** 某个月的 AI 调用总量。offset 为距当月的月数（0 = 当月）。
    当月直接取机构自己的「本月已用」—— 页头、列表页、半年视图当月那根柱、
    本月视图各天之和必须是同一个数，否则切一下粒度就自相矛盾 */
function aiMonthTotal(tenant: TenantRecord, offset: number): number {
  if (offset === 0) return tenant.aiUsed
  return Math.round(tenant.quotas.aiQuota * (0.12 + ((tenant.id + offset) % 5) * 0.11))
}

/** 整数哈希 → [0,1)（mulberry32 的核心）。刻意不用 Math.random()：
    getTenantDetail 每次请求都重跑，随机数会让同一机构刷新两次看到两张不同的图 */
function seededUnit(seed: number): number {
  let t = (seed + 0x6d2b79f5) | 0
  t = Math.imul(t ^ (t >>> 15), t | 1)
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

/** 把月总量拆到每一天：形状由 (机构, 年月, 日) 哈希出，先按权重分摊再取整，
    余数按小数部分从大到小补 1 —— 直接四舍五入会差几个数，切回月视图就对不上 */
function splitToDays(
  tenantId: number,
  year: number,
  month: number,
  dayCount: number,
  total: number,
): number[] {
  const weights = Array.from(
    { length: dayCount },
    (_, i) => 0.35 + seededUnit(tenantId * 1000003 + year * 1000 + month * 37 + i) * 0.65,
  )
  const sum = weights.reduce((acc, w) => acc + w, 0)
  const exact = weights.map((w) => (w / sum) * total)
  const calls = exact.map((v) => Math.floor(v))
  let rest = total - calls.reduce((acc, v) => acc + v, 0)
  const byFraction = exact
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac)
  for (const { i } of byFraction) {
    if (rest <= 0) break
    calls[i] += 1
    rest -= 1
  }
  return calls
}

/** 最近 12 个自然月，每月一组按天数据（详情页的月份日历拿它标「有数据」）。
    每月都摊满该月天数：当月把总量分摊到「今天」为止，其余补 0 —— 演示时不该出现未来的用量，
    但横轴要看得见整月，空着的日子画 0 而不是把数组截断 */
function aiDailySeries(tenant: TenantRecord): Array<{ month: string; calls: number[] }> {
  const today = new Date()
  const series: Array<{ month: string; calls: number[] }> = []
  for (let offset = 11; offset >= 0; offset -= 1) {
    const first = new Date(today.getFullYear(), today.getMonth() - offset, 1)
    const year = first.getFullYear()
    const month = first.getMonth() + 1
    const dayCount = new Date(year, month, 0).getDate()
    const elapsed = offset === 0 ? today.getDate() : dayCount
    const calls = splitToDays(tenant.id, year, month, elapsed, aiMonthTotal(tenant, offset))
    /* 还没到的日子补 0。补 0 不改变求和，所以「各天之和 = 该月月值」这条仍然成立 */
    while (calls.length < dayCount) calls.push(0)
    series.push({ month: `${year}-${String(month).padStart(2, '0')}`, calls })
  }
  return series
}

/** 机构详情（FR-PT-011：4 个页签数据） */
export function getTenantDetail(id: number): TenantDetailModel {
  const tenant = getTenant(id)
  const seed = tenant.id
  const aiDaily = aiDailySeries(tenant)
  return {
    tenant,
    pkg: getPackage(tenant.packageId),
    stats: {
      questionCount: 3200 + (seed % 13) * 460,
      paperCount: 260 + (seed % 9) * 55,
      materialCount: 90 + (seed % 7) * 26,
      staffCount: 12 + (seed % 5) * 9,
    },
    /* 半年图只画最近 6 个月，取 aiDaily 的后 6 段 —— 月份与调用量都出同一处，两个数组天然对齐 */
    aiMonthly: {
      months: aiDaily.slice(-6).map((item) => item.month),
      calls: [5, 4, 3, 2, 1, 0].map((offset) => aiMonthTotal(tenant, offset)),
    },
    aiDaily,
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
