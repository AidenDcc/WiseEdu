import { request, type TenantOverview } from '@aiteach/shared'

/** 机构工作台概览（FR-WS-001 ~ 004） */
export function fetchTenantOverview(): Promise<TenantOverview> {
  return request<TenantOverview>('/tenant/dashboard/overview')
}
