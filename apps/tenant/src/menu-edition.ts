/**
 * 账号「版本」—— 决定这个**账号**能看到哪些菜单。
 *
 * **为什么在角色权限之外再开一层**：`/org/roles` 的粒度是**模块**（`teach` / `material`），
 * 而「标准版不含学案、课件、集体备课……」要的是**单个叶子菜单**——同一个 `teach` 模块里
 * 教案、讲义要留，学案、课件要藏；同一个 `material` 里教辅资料、图片、视频要留，
 * 小程序动画、微课切片要藏。权限矩阵表达不了这种切分，硬塞进去只会让「角色权限」页
 * 长出一排没人看得懂的勾（`PERM_MODULES` 的注释里已经写明：不要为了整齐凑 op）。
 *
 * **版本挂在账号上，不挂在演示身份上**：演练身份（机构管理员 / 组长 / 老师）切换的是
 * **角色权限**，而版本是「这家机构买了哪些功能」。标准版没开通的功能，换个身份看也还是没开通——
 * 否则演示时切一次身份就能把藏起来的菜单全部翻出来，裁剪形同虚设。
 *
 * 由此推出一条约束：**不要把这里做成「当前角色看不到」**。角色维度的准入仍由
 * `usePermission().can()` 管，两者是各管一段的「与」关系。
 *
 * 接真实后端后，这里应换成「机构套餐 → 账号可用功能」的服务端下发（平台端套餐权限里有
 * `platformLocked` 的雏形，见 apps/admin 的套餐权限页）；本文件届时整体废弃。
 */
import { flattenMenus, menus } from './menu'

export type MenuEdition = 'full' | 'basic'

/**
 * 标准版不开放的菜单叶子。
 *
 * 按**路径前缀**匹配：`/teach/guide` 同时盖住 `/teach/guide/edit`（学案编辑是全屏页，
 * 不在侧边栏里，但路由守卫要靠同一张表把它拦下来，否则存个书签就绕过了裁剪）。
 *
 * 只列真正要藏的叶子，不要顺手把整个分组写进来 —— 备课中心、教辅管理都还有要留的页面。
 */
export const BASIC_HIDDEN_PATHS: readonly string[] = [
  '/teach/guide', // 学案
  '/teach/courseware', // 课件
  '/prep', // 集体备课（挂在备课中心下的叶子）
  '/homework', // 作业系统（一级菜单）
  '/material/media/animation', // 小程序动画
  '/material/media/clip', // 微课切片
  '/square', // 知识广场（一级菜单）
]

/**
 * 账号 → 版本。**未收录的账号一律全功能版**：
 * 新加账号时忘了登记，结果是「多看几个菜单」，而不是「进去一片空白」——
 * 与 usePermission 的三条放行规则同一个取向。
 */
const ACCOUNT_EDITIONS: Record<string, MenuEdition> = {
  /* 演示主账号：标准版。`admin` 不在表里 → 全功能版。 */
  orgadmin: 'basic',
}

export function editionOf(account: string | null | undefined): MenuEdition {
  if (!account) return 'full'
  return ACCOUNT_EDITIONS[account] ?? 'full'
}

/** 这个路径在当前版本里是否不可见（全功能版恒为 false） */
export function hiddenByEdition(path: string, account: string | null | undefined): boolean {
  if (editionOf(account) === 'full') return false
  return BASIC_HIDDEN_PATHS.some((hidden) => path === hidden || path.startsWith(`${hidden}/`))
}

/* dev-only 自检：路径写错了不会报错，只会「菜单还在」——那是最难发现的一类失效。
   菜单改名 / 挪位置时这里会先在控制台喊出来。 */
if (import.meta.env.DEV) {
  const leaves = new Set(flattenMenus(menus).map((row) => row.path))
  const missing = BASIC_HIDDEN_PATHS.filter((path) => !leaves.has(path))
  if (missing.length) {
    console.error('[menu-edition] 标准版要隐藏的路径在侧边栏菜单里不存在：', missing)
  }
}
