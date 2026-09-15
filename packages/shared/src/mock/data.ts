/**
 * Mock 数据：演示账号 + 两端工作台看板数据。
 * 数据结构与 SRS（FR-PT-001~004 / FR-WS-001~004）对齐，后端就绪后按同结构出真实接口即可。
 */
import type { MockUser } from './types'

export const mockUsers: MockUser[] = [
  {
    id: 1,
    appId: 'admin',
    account: 'admin',
    password: 'admin123',
    name: '平台运营',
    role: 'super',
    roleName: '超级管理员',
    orgName: 'AI教学云平台',
    avatarHue: 232,
  },
  {
    id: 101,
    appId: 'tenant',
    account: 'orgadmin',
    password: 'org123456',
    name: '陈明远',
    role: 'orgAdmin',
    roleName: '机构管理员',
    orgName: '星辰实验中学',
    avatarHue: 172,
  },
  {
    id: 102,
    appId: 'tenant',
    account: 'auditor',
    password: 'aud123456',
    name: '沈丽华',
    role: 'auditor',
    roleName: '审核员',
    orgName: '星辰实验中学',
    avatarHue: 200,
  },
  {
    id: 103,
    appId: 'tenant',
    account: 'teacher',
    password: 'tea123456',
    name: '李文博',
    role: 'teacher',
    roleName: '老师',
    orgName: '星辰实验中学',
    avatarHue: 30,
  },
]

/** 近 N 天日期标签（MM-dd） */
export function recentDays(n: number): string[] {
  const days: string[] = []
  for (let i = n - 1; i >= 0; i--) {
    const date = new Date()
    date.setDate(date.getDate() - i)
    days.push(
      `${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`,
    )
  }
  return days
}

/** 平滑随机序列（便于生成自然的趋势曲线） */
export function waveSeries(n: number, base: number, amplitude: number, step: number): number[] {
  const series: number[] = []
  let value = base
  let phase = Math.random() * Math.PI * 2
  for (let i = 0; i < n; i++) {
    phase += 0.6
    value += step + Math.sin(phase) * amplitude * 0.4 + (Math.random() - 0.45) * amplitude * 0.25
    series.push(Math.max(0, Math.round(value)))
  }
  return series
}

/* ---------------- 超管端工作台（FR-PT-001 ~ 004） ---------------- */

export const adminOverview = {
  totalTenants: 128,
  trialTenants: 23,
  expiringSoon: 6,
  newTenantsToday: 2,
  aiCallsThisMonth: 158_320,
  aiCallsGrowth: 12.4,
  tenantGrowth: 8.6,
  trend: {
    days: recentDays(30),
    tenants: waveSeries(30, 96, 4, 1.1),
    aiCalls: waveSeries(30, 3200, 900, 120),
  },
  pendingApplies: [
    {
      applyNo: 'AP20260913001',
      orgName: '博思培优教育',
      orgType: '培训机构',
      stages: '初中 / 高中',
      contact: '刘芳',
      phone: '138****6621',
      submittedAt: '2026-09-12 10:24',
      waitingHours: 26,
      overtime: false,
    },
    {
      applyNo: 'AP20260912004',
      orgName: '临江市第三中学',
      orgType: '公立学校',
      stages: '初中',
      contact: '赵国强',
      phone: '139****0217',
      submittedAt: '2026-09-10 16:05',
      waitingHours: 68,
      overtime: true,
    },
    {
      applyNo: 'AP20260912002',
      orgName: '启航外国语学校',
      orgType: '民办学校',
      stages: '小学 / 初中',
      contact: '孙晓梅',
      phone: '137****8834',
      submittedAt: '2026-09-11 09:41',
      waitingHours: 50,
      overtime: true,
    },
  ],
  expiringTenants: [
    { name: '文渊高级中学', packageName: '旗舰版', expireTime: '2026-09-17', daysLeft: 4 },
    { name: '乐学培优教育', packageName: '专业版', expireTime: '2026-09-19', daysLeft: 6 },
    { name: '青禾小学', packageName: '标准版', expireTime: '2026-09-20', daysLeft: 7 },
    { name: '明德实验中学', packageName: '专业版', expireTime: '2026-09-24', daysLeft: 11 },
  ],
}

/* ---------------- 机构端工作台（FR-WS-001 ~ 004） ---------------- */

export const tenantOverview = {
  stats: {
    questionCount: 12_680,
    paperCount: 356,
    materialCount: 89,
    fileCount: 214,
    aiUsed: 6420,
    aiQuota: 10_000,
  },
  quickActions: [
    { key: 'manual', label: '手动录题', icon: 'edit' },
    { key: 'ai-generate', label: 'AI 出题', icon: 'sparkles' },
    { key: 'ai-variant', label: 'AI 变式', icon: 'branch' },
    { key: 'new-paper', label: '新建试卷', icon: 'file' },
    { key: 'upload-doc', label: '上传文档', icon: 'upload' },
  ],
  todos: [
    {
      type: '题目终审',
      title: '一元二次方程判别式应用（含 3 题批量）',
      submitter: '李文博',
      submittedAt: '2026-09-12 15:20',
      waitingHours: 20,
      overtime: false,
    },
    {
      type: '试卷审核',
      title: '九年级上学期期中数学模拟卷（A 卷）',
      submitter: '周雪',
      submittedAt: '2026-09-11 10:02',
      waitingHours: 50,
      overtime: true,
    },
    {
      type: '文档识别',
      title: '《高中物理必修一同步讲义》第 3 章校对',
      submitter: '吴刚',
      submittedAt: '2026-09-12 09:33',
      waitingHours: 26,
      overtime: false,
    },
    {
      type: '协同消息',
      title: '王老师邀请你协同编辑《平行卷 B 卷》',
      submitter: '王芳',
      submittedAt: '2026-09-13 08:15',
      waitingHours: 3,
      overtime: false,
    },
  ],
  trend: {
    days: recentDays(30),
    newQuestions: waveSeries(30, 40, 18, 1.2),
    newPapers: waveSeries(30, 4, 3, 0.12),
  },
}
