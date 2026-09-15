import { request, type AdminOverview } from '@aiteach/shared'

/** 平台工作台概览（FR-PT-001 ~ 004） */
export function fetchAdminOverview(): Promise<AdminOverview> {
  return request<AdminOverview>('/admin/dashboard/overview')
}
