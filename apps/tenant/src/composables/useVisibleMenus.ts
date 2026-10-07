/**
 * 侧边栏「实际渲染哪些菜单」的唯一实现 —— 机构菜单开关 × 角色权限 两个维度的交集。
 *
 * 为什么必须抽出来：菜单在机构端有**三处独立的消费点**（AppLayout 的侧边栏 / 折叠浮层 /
 * 底部固定入口、DashboardView 的快捷入口与「更多」），只改其中一处，另外几处会继续显示
 * 无权访问的入口，用户点进去被路由守卫弹回来，比不做裁剪更让人困惑。
 *
 * **两个维度的分工**：
 * - `/org/roles` 的角色权限：这个**角色**能不能碰这个模块（`MenuItem.module`）；
 * - `/org/menus` 的机构菜单开关：这个**机构**整体开不开这个菜单（按路径 key 查）。
 * 任一为否即隐藏。
 *
 * **面包屑不在这里**：`buildBreadcrumb` 用菜单树做前缀匹配，靠全量菜单才能把
 * `/material/media/video` 这种深层页显示成「素材管理 / 媒体库 / …」。面包屑是描述性的，
 * 不参与裁剪 —— 换成裁剪后的菜单，被隐藏分组的子页会退化成单层标题。
 */
import { computed, ref } from 'vue'
import type { MenuItem } from '@/menu'
import { footerMenus, menus } from '@/menu'
import type { OrgMenuNodeApi } from '@/api/org'
import { fetchOrgMenus } from '@/api/org'
import { usePermission } from '@/composables/usePermission'

/** 机构菜单开关：路径（去前导斜杠）→ 是否开放。树里没有的 key 视为开放 */
const enabledKeys = ref<Map<string, boolean>>(new Map())
let loading: Promise<void> | null = null

/** `/paper/collab` → `paper/collab`，与 `orgMenuTree` 的 key 对齐 */
function keyOf(path: string): string {
  return path.replace(/^\//, '')
}

function indexTree(nodes: OrgMenuNodeApi[]): Map<string, boolean> {
  const map = new Map<string, boolean>()
  const walk = (rows: OrgMenuNodeApi[]) => {
    for (const row of rows) {
      map.set(row.key, row.enabled)
      if (row.children?.length) walk(row.children as OrgMenuNodeApi[])
    }
  }
  walk(nodes)
  return map
}

function loadMenuTree(): Promise<void> {
  if (loading) return loading
  loading = fetchOrgMenus()
    .then((rows) => {
      enabledKeys.value = indexTree(rows)
    })
    .catch(() => {
      /* 拉不到机构的菜单开关时按「全开」处理：这是机构级配置，默认值本来就是开，
         再叠加角色权限的裁剪，不会因此放出越权入口，只是可能多显示一个被关掉的菜单 */
      enabledKeys.value = new Map()
    })
    .finally(() => {
      loading = null
    })
  return loading
}

/** 叶子是否可见：机构开了这个菜单 + 当前角色有该模块的权限（`op` 为叶子额外要求，默认「查看」） */
function leafVisible(can: (module: string, op?: string) => boolean, item: MenuItem): boolean {
  if (!can(item.module, item.op)) return false
  return enabledKeys.value.get(keyOf(item.path)) ?? true
}

function filterMenus(can: (module: string, op?: string) => boolean, items: MenuItem[]): MenuItem[] {
  const result: MenuItem[] = []
  for (const item of items) {
    if (!item.children?.length) {
      if (leafVisible(can, item)) result.push(item)
      continue
    }
    /* 分组自己没有页面：子项全被裁掉就整组隐藏，否则留一个点不开的空壳 */
    const children = filterMenus(can, item.children)
    if (children.length) result.push({ ...item, children })
  }
  return result
}

/**
 * 把菜单摊平成叶子。**分组没有自己的页面**，它的 `path`（`/paper`）不是可着陆的地址，
 * 只有子项才是。侧边栏渲染与路由守卫必须用同一份摊平规则，否则会出现
 * 「菜单里看得见、守卫却说不存在」这类只在边界上暴露的偏差。
 */
function leavesOf(items: MenuItem[]): MenuItem[] {
  return items.flatMap((item) => (item.children?.length ? item.children : [item]))
}

/** 全部可见叶子的路径（不含新标签页的独立工作台，它不是「落在机构端框架里的页」） */
function allowedLeafPaths(): string[] {
  const { can } = usePermission()
  return leavesOf(filterMenus(can, menus))
    .filter((item) => !item.newTab)
    .map((item) => item.path)
}

/**
 * 第一个可用页面 —— 路由守卫重定向的落点。
 *
 * **必须有它，否则会跳转死循环**：守卫发现当前页不可见时若重定向到一个同样不可见的页，
 * 又会被拦回来。落到「当前身份确实能进的第一页」才是出口。
 * 全部不可见时返回空串，由调用方决定怎么办（当前实现是放行，见 router/index.ts）。
 *
 * 之所以是个独立导出的函数（而不只是 composable 的返回值）：路由守卫在模块作用域里用它，
 * 那里没有组件实例可以 `useVisibleMenus()`。实现与侧边栏共用同一套 `filterMenus`，不会漂移。
 */
export function firstAllowedPath(): string {
  return allowedLeafPaths()[0] ?? ''
}

export function useVisibleMenus() {
  const { can, ensureLoaded, refresh: refreshRoles } = usePermission()

  /* 两个维度各自异步到达（权限矩阵、机构菜单开关）。任一先到就先用已知信息渲染，
     到齐后再收窄 —— 期间可能短暂多显示几个菜单，但不会漏显示。 */
  void ensureLoaded()
  void loadMenuTree()

  const visibleMenus = computed(() => filterMenus(can, menus))
  const visibleFooterMenus = computed(() => filterMenus(can, footerMenus))
  const allowedPaths = computed(allowedLeafPaths)

  /** 保存机构菜单开关后调用 */
  async function refresh(): Promise<void> {
    await loadMenuTree()
    await refreshRoles()
  }

  return { visibleMenus, visibleFooterMenus, allowedPaths, firstAllowedPath, refresh }
}

/**
 * 侧边栏之外的页面归哪个模块。
 *
 * 这些页用新标签页打开、也不挂在 `/` 的 children 下，菜单树里没有它们的路径。
 * 若放着不管，`pathVisible` 会按「不在侧边栏里」一律放行 —— 看起来没问题，
 * 但用户把 `/paper/edit?id=300` 存成书签再打开就绕过了整个菜单裁剪。
 * 所以显式归档：**「不在侧边栏里」不等于「不受管」**。
 *
 * `/paper/compose` 不在这里，因为它是菜单叶子（标记 `newTab`），已有正式归属。
 */
const EXTRA_PATH_MODULES: Array<{ prefix: string; module: string; op?: string }> = [
  { prefix: '/paper/edit', module: 'paper' },
]

/**
 * 判断某个具体路径是否可见（路由守卫用）。
 * 按最长前缀匹配叶子：`/material/media/video` 归到 `/material/media`。
 * 匹配不到任何叶子（如 `/profile`、`/login` 这类不在侧边栏里的页面）→ 放行。
 */
export function pathVisible(
  can: (module: string, op?: string) => boolean,
  path: string,
): boolean {
  const extra = EXTRA_PATH_MODULES.find((row) => path === row.prefix || path.startsWith(`${row.prefix}/`))
  if (extra) return can(extra.module, extra.op)

  const hit = leavesOf([...menus, ...footerMenus])
    .filter((leaf) => path === leaf.path || path.startsWith(`${leaf.path}/`))
    .sort((a, b) => b.path.length - a.path.length)[0]
  if (!hit) return true
  return leafVisible(can, hit)
}
