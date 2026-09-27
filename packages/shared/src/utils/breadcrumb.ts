/**
 * 由侧边菜单推导顶栏面包屑。
 *
 * 两个端的路由都是**平铺**在 layout 之下的（`apps/tenant/src/router/index.ts` 里所有业务
 * 路由都是 `/` 的 children），层级只存在于 `menu.ts` 的菜单树里，所以面包屑只能从菜单推。
 *
 * 匹配规则：
 *   1. 先按路径**精确**命中菜单叶子；
 *   2. 命中不到则取**最长前缀**命中的叶子（覆盖 `/paper/collab/task` 这类三级子页）；
 *   3. 命中的叶子若在分组下，前面补上分组标题；
 *   4. 若当前路径比命中的叶子更深，末尾追加路由自己的标题（`route.meta.title`）；
 *   5. 完全命中不到（如 `/profile`）只显示路由标题。
 */

export interface CrumbMenuItem {
  path: string
  title: string
  children?: CrumbMenuItem[]
}

export interface Crumb {
  label: string
  /** 上级项可点；最后一项不带 to */
  to?: string
}

/** 展平菜单树，同时记住每个叶子的父级标题 */
function flatten(items: CrumbMenuItem[], parentTitle?: string) {
  const out: Array<{ item: CrumbMenuItem; parentTitle?: string }> = []
  for (const item of items) {
    if (item.children?.length) {
      out.push(...flatten(item.children, item.title))
    } else {
      out.push({ item, parentTitle })
    }
  }
  return out
}

/**
 * @param menus   当前端的菜单树（含分组）
 * @param path    当前路由路径（不含 query）
 * @param leafTitle 当前路由的 meta.title，兜底用
 */
export function buildBreadcrumb(
  menus: CrumbMenuItem[],
  path: string,
  leafTitle?: string,
): Crumb[] {
  const leaves = flatten(menus)

  const exact = leaves.find((entry) => entry.item.path === path)
  // 最长前缀命中：`/question/bank` 命中 `/question/bank`；`/paper/collab/task` 命中 `/paper/collab`
  const prefix =
    exact ??
    leaves
      .filter((entry) => path.startsWith(`${entry.item.path}/`))
      .sort((a, b) => b.item.path.length - a.item.path.length)[0]

  if (!prefix) {
    const label = leafTitle ?? ''
    return label ? [{ label }] : []
  }

  const crumbs: Crumb[] = []
  if (prefix.parentTitle) crumbs.push({ label: prefix.parentTitle })
  crumbs.push({ label: prefix.item.title, to: prefix.item.path })

  // 比菜单叶子更深的三级页：补上自己的标题
  if (path !== prefix.item.path && leafTitle && leafTitle !== prefix.item.title) {
    crumbs.push({ label: leafTitle })
  }

  // 最后一项不可点
  const last = crumbs[crumbs.length - 1]
  if (last) delete last.to

  return crumbs
}
