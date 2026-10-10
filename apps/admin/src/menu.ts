/**
 * 管理端菜单节点：AppLayout 渲染侧边栏、推导面包屑（`buildBreadcrumb`）共用这个结构。
 *
 * 菜单**数据**已不在本文件 —— 它由「系统管理 → 菜单管理」维护，存在 Mock 的 `adminMenus`
 * （`packages/shared/src/mock/admin-store.ts`），经 `useAdminMenus()` 取回并组装成这棵树。
 * 这里只留类型，供布局与组合式函数使用。
 */
export interface MenuItem {
  path: string
  title: string
  icon?: string
  children?: MenuItem[]
}
