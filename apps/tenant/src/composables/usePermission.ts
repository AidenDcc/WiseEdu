/**
 * 机构端「当前身份能做什么」的唯一判据 —— 把 `/org/roles` 那张角色权限矩阵接成真生效。
 *
 * 在这之前，那张矩阵只有「保存后实时生效」六个字的承诺：侧边栏、路由、按钮都不读它，
 * 改完矩阵回到业务页毫无变化。现在菜单裁剪、页面准入、页内按钮三处都走 `can()`。
 *
 * **判据来源**：当前演示身份 → `permRoleId` → 矩阵里的那条角色。走 id 不走角色名，
 * 理由见 useDemoRole.ts 的字段注释（角色名机构可改）。
 *
 * **三条放行规则，都是为了让权限出问题时「宁可见多、不可见空」**：
 * 1. 矩阵还没加载完 → 放行。首次进入时路由守卫必然比接口先跑，此时拦人只会白屏；
 *    加载完成后 `refresh()` 的回调会回头校验当前路由（见 router/index.ts）。
 * 2. `module` 不在 `PERM_MODULES` 里 → 放行。菜单加了、矩阵还没跟上时，不该整页消失。
 * 3. 矩阵里找不到对应的角色 → 放行。角色被误删 / 自定义角色未纳入时同理。
 * 只有在「模块已收录 + 角色存在 + 该角色确实没有这个模块权限」时才拒绝 —— 那才是真的没权限。
 */
import { computed, ref } from 'vue'
import { showToast } from '@aiteach/shared'
import type { OrgRole } from '@aiteach/shared'
import { fetchRoles } from '@/api/org'
import { useDemoRole } from '@/composables/useDemoRole'

/** 模块准入位：任何模块的「查看」都没有，整个模块的菜单与页面都不放行 */
export const VIEW_OP = '查看'

const roles = ref<OrgRole[]>([])
const modules = ref<Array<{ key: string; title: string; ops: string[] }>>([])
/** 矩阵是否已成功加载。未加载完一律放行，见文件头第 1 条 */
const loaded = ref(false)
let loading: Promise<void> | null = null

async function load(): Promise<void> {
  const data = await fetchRoles()
  roles.value = data.roles
  modules.value = data.modules
  loaded.value = true
}

/**
 * 拉取角色矩阵（并发去重）。
 * 失败重试一次；再失败就把失败**说出来**，而不是静默地一直按全量菜单显示 ——
 * 那样用户会以为权限配置没生效，实际是接口挂了，排查方向完全错。
 */
function ensureLoaded(): Promise<void> {
  if (loaded.value) return Promise.resolve()
  if (loading) return loading
  loading = load()
    .catch(() => load())
    .catch(() => {
      showToast('角色权限加载失败，菜单与按钮暂按全量显示', 'error')
    })
    .finally(() => {
      loading = null
    })
  return loading
}

export function usePermission() {
  const { identity } = useDemoRole()

  /** 当前身份对应的角色；未加载完或找不到时为 null（→ 放行） */
  const role = computed(() => (loaded.value ? (roles.value.find((row) => row.id === identity.value.permRoleId) ?? null) : null))

  /**
   * 有没有某个模块（或模块里的某个操作）的权限。
   * `op` 默认「查看」—— 只关心「能不能进这个模块」时就只传模块。
   */
  function can(module: string, op: string = VIEW_OP): boolean {
    if (!loaded.value) return true
    if (!modules.value.some((row) => row.key === module)) return true
    if (!role.value) return true
    return (role.value.perms[module] ?? []).includes(op)
  }

  /**
   * 重新拉取矩阵（保存角色权限后调用）。
   *
   * 刻意**不先清空 `loaded`**：清了的话，从点击保存到接口返回这段时间里 `can()` 一律放行，
   * 侧边栏会先弹回全量菜单再收回去，闪一下。直接换数据则是一步到位。
   */
  async function refresh(): Promise<void> {
    try {
      await load()
    } catch {
      showToast('角色权限加载失败，菜单仍按上一次的配置显示', 'error')
    }
  }

  return { can, role, modules, loaded, ensureLoaded, refresh }
}
