import { ref } from 'vue'
import { ADMIN_SUPER_ROLE_CODE } from '@aiteach/shared'
import type { AdminMenuItem } from '@aiteach/shared'
import type { MenuItem } from '@/menu'
import { fetchAdminMenus, fetchAdminRoles } from '@/api/platform'
import { useAuthStore } from '@/stores/auth'

/**
 * 管理端侧边菜单：从「菜单管理」维护的菜单树取回，按当前登录角色的可见权限过滤。
 *
 * 模块级单例 ref —— AppLayout 与「菜单管理」页共用同一个实例，菜单管理保存后调 `reload()`
 * 侧边栏即时刷新（这是「菜单管理驱动侧边栏」的关键，若各组件各持一份 ref 就刷不动）。
 *
 * 过滤规则：分组不单独授权，只看组内是否还有可见叶子；「平台工作台」这类顶级叶子按自身路径判。
 * 内置超级管理员（`permissions: ['*']`）不过滤，避免把唯一的演示账号锁在门外。
 */
const menus = ref<MenuItem[]>([])

/** 扁平节点 → 树；只保留启用项，同级按 sort 升序 */
function buildTree(items: AdminMenuItem[]): MenuItem[] {
  const enabled = items.filter((item) => item.enabled)
  const childrenOf = (parentId: number | null) =>
    enabled.filter((item) => item.parentId === parentId).sort((a, b) => a.sort - b.sort)

  const walk = (parentId: number | null): MenuItem[] =>
    childrenOf(parentId).map((node) => {
      const children = walk(node.id)
      return {
        path: node.path,
        title: node.title,
        icon: node.icon,
        children: children.length ? children : undefined,
      }
    })

  return walk(null)
}

/** 是否对该菜单路径有可见权限 */
function visiblePaths(allowed: string[] | null): (path: string) => boolean {
  if (!allowed) return () => true
  const set = new Set(allowed)
  return (path: string) => set.has(path)
}

/** 过滤掉无权限的叶子；分组无可见子节点时整组隐藏 */
function filterByPermission(tree: MenuItem[], canSee: (path: string) => boolean): MenuItem[] {
  const result: MenuItem[] = []
  for (const item of tree) {
    if (item.children?.length) {
      const children = item.children.filter((child) => canSee(child.path))
      if (children.length) result.push({ ...item, children })
    } else if (canSee(item.path)) {
      result.push(item)
    }
  }
  return result
}

async function reload(): Promise<void> {
  const [flat, roles] = await Promise.all([fetchAdminMenus(), fetchAdminRoles()])
  const tree = buildTree(flat)

  const auth = useAuthStore()
  const role = roles.find((item) => item.code === auth.user?.role)
  const unrestricted = !role || role.code === ADMIN_SUPER_ROLE_CODE || role.permissions.includes('*')
  menus.value = unrestricted ? tree : filterByPermission(tree, visiblePaths(role.permissions))
}

export function useAdminMenus() {
  return { menus, reload }
}
