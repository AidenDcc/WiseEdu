import { request } from '@aiteach/shared'
import type {
  CertFile,
  FeatureSwitches,
  PackageRecord,
  PageResult,
  TenantApply,
  TenantDetailModel,
  TenantRecord,
} from '@aiteach/shared'

/** 把非空查询参数拼进 URL（mock 模式下 params 不经过 fetch，需显式拼接） */
function withQuery<T extends object>(url: string, params: T): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      search.append(key, String(value))
    }
  }
  const qs = search.toString()
  return qs ? `${url}?${qs}` : url
}

/* ===== 入驻审核（FR-PT-005 ~ 007） ===== */

export interface ApplyQuery {
  status?: string
  orgType?: string
  keyword?: string
  /** 已 join 成逗号串的学段（`withQuery` 会 `String(value)`，数组直接传会变成 "小学,初中" 的另一种拼法） */
  stages?: string
  contact?: string
  page?: number
  pageSize?: number
}

export function fetchApplies(params: ApplyQuery) {
  return request<PageResult<TenantApply>>(withQuery('/admin/tenant/applies', params))
}

export function approveApply(
  id: number,
  payload: { trialDays: number; packageId: number; adminAccount: string; reviewer?: string },
) {
  return request<{ tenantName: string; expireTime: string; adminAccount: string }>(
    `/admin/tenant/applies/${id}/approve`,
    { method: 'POST', data: payload },
  )
}

/* reviewer = 当前登录管理员的姓名，落进申请的审核留痕（列表的「审核时间 / 操作人」读它） */
export function rejectApply(id: number, reason: string, reviewer?: string) {
  return request<null>(`/admin/tenant/applies/${id}/reject`, {
    method: 'POST',
    data: { reason, reviewer },
  })
}

/** 新增机构：生成一条待审核的入驻申请（FR-PT-005） */
export function createApply(data: {
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
}) {
  return request<TenantApply>('/admin/tenant/applies', { method: 'POST', data })
}

/* ===== 机构列表（FR-PT-008 ~ 014） ===== */

export interface TenantQuery {
  status?: string
  packageId?: string
  orgType?: string
  keyword?: string
  expireFrom?: string
  expireTo?: string
  /** 本月 AI 用量区间（闭区间，与列表「本月 AI 用量」列同口径） */
  aiMin?: string
  aiMax?: string
  page?: number
  pageSize?: number
}

export function fetchTenants(params: TenantQuery) {
  return request<PageResult<TenantRecord>>(withQuery('/admin/tenants', params))
}

export function fetchTenantDetail(id: number) {
  return request<TenantDetailModel>(`/admin/tenants/${id}`)
}

export function disableTenant(id: number, reason: string) {
  return request<null>(`/admin/tenants/${id}/disable`, {
    method: 'POST',
    data: { reason },
  })
}

export function enableTenant(id: number) {
  return request<null>(`/admin/tenants/${id}/enable`, { method: 'POST' })
}

export function renewTenant(id: number, packageId: number, duration: string) {
  return request<{ expireTime: string; amount: number }>(`/admin/tenants/${id}/renew`, {
    method: 'POST',
    data: { packageId, duration },
  })
}

export function extendTrial(id: number, days: number) {
  return request<{ expireTime: string }>(`/admin/tenants/${id}/trial-extend`, {
    method: 'POST',
    data: { days },
  })
}

export function activateTenant(id: number, packageId: number) {
  return request<{ expireTime: string }>(`/admin/tenants/${id}/activate`, {
    method: 'POST',
    data: { packageId },
  })
}

export function updateTenantBase(
  id: number,
  data: {
    name: string
    contact: string
    phone: string
    city: string
    address: string
    intro: string
    stages: string[]
  },
) {
  return request<null>(`/admin/tenants/${id}/base`, { method: 'POST', data })
}

export function updateTenantFeature(
  id: number,
  data: { switches: FeatureSwitches; quotas: TenantRecord['quotas'] },
) {
  return request<null>(`/admin/tenants/${id}/feature`, { method: 'POST', data })
}

export function updateTenantIsolation(id: number, isolationType: 1 | 2, storageRegion: string) {
  return request<null>(`/admin/tenants/${id}/isolation`, {
    method: 'POST',
    data: { isolationType, storageRegion },
  })
}

/* ===== 套餐管理（sys_package） ===== */

export function fetchPackages() {
  return request<PackageRecord[]>('/admin/packages')
}

export function savePackage(data: Partial<PackageRecord>) {
  return request<PackageRecord>('/admin/packages/save', { method: 'POST', data })
}
