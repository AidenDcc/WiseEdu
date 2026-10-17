/**
 * 机构端「演示身份」：右上角下拉里点一下，就把当前是谁、能看哪些菜单、能审批什么一起换掉。
 *
 * **为什么需要它**：机构端真实场景里，机构管理员 / 年级学科组长 / 参与组卷老师看到的菜单与能做的
 * 操作完全不同，而演示主账号只有一个（orgadmin）。逐个建账号、逐个退出重登，演示一遍要登三次；
 * 这里用「就地换身份」把这三次登录变成三次点击。
 *
 * 切换时改三处，缺一处就会出现自相矛盾的界面：
 * 1. **mock 的 `CURRENT`**（shared `setMockCurrent`）：全仓约 50 处 `owner / actor / createdBy`
 *    取自 `CURRENT.name`，不同步就会看到「组长发起协同组卷，发起人写着陈明远」。
 * 2. **会话用户 `auth.user`**：右上角姓名 / 角色、个人中心、以及各页面「是不是我」的判断都读它。
 * 3. **localStorage 缓存**：刷新页面后身份还在（mock 内存态一刷新就还原，靠这里恢复）。
 *
 * **已知裂缝（可以接受，但必须知道）**：这只是前端演示身份，**不重新登录、不动 token** ——
 * token 永远指向 id=101 的 orgadmin。由此推出一条硬约束：
 * **全仓不得调用 `/auth/me`（shared 的 `fetchCurrentUser`）**。真实后端会用 token 反查用户，
 * 那样一调，演示身份立刻被打回陈明远，且刷新后菜单与身份对不上。当前该函数调用点为 0，
 * 以后要接真实登录态时，第一步就是删掉本文件。
 *
 * 演示身份只对 `DEMO_ACCOUNT`（orgadmin）生效；`admin` 账号登录后保留自己的资料，
 * 见下方 DEMO_ACCOUNT 的注释。
 *
 * 会话有效期（30 分钟固定窗口）由**前端**按 `aiteach:<app>:tokenExpire` 强制，token 本身仍不
 * 会过期。因此切换身份**不能**调 `setSession`（那会把有效期续满 30 分钟），只用
 * `updateSessionUser` 换用户缓存 —— 见 shared/api/auth.ts 的注释。
 */
import { computed, ref } from 'vue'
import { getAppConfig, getAvatarOverride, setAvatarOverride, setMockCurrent, updateSessionUser } from '@aiteach/shared'
import type { SessionUser } from '@aiteach/shared'
import { useAuthStore } from '@/stores/auth'

/**
 * 演示身份的角色值。`leader`（年级学科组长）**不是登录账号**，只存在于这套演示机制里
 * （理由见 shared/mock/types.ts 的同名注释）。
 */
export type DemoRole = 'orgAdmin' | 'leader' | 'teacher'

/**
 * 演示身份**只作用于这一个账号**。
 *
 * 机构端现在有两个账号：`orgadmin`（标准版，用来换身份演示「同一个机构里不同角色看到什么」）
 * 与 `admin`（全功能版，用来演示「全部菜单」）。`admin` 是实打实的一个人（周正），
 * 若也按身份表贴一遍，登录后右上角会变成「陈明远 · 机构管理员」——账号与界面对不上。
 * 所以非演示账号一律保留自己的会话资料，只把 mock 的当前操作人同步成本人。
 */
export const DEMO_ACCOUNT = 'orgadmin'

export interface DemoIdentity {
  role: DemoRole
  /** 与种子数据的 `ownerId` 同一套编号：101 陈明远 / 103 李文博，这样「个人题库」也跟着切 */
  id: number
  name: string
  roleName: string
  /** 头像色相：换身份时头像换色，是最快的一眼反馈 */
  avatarHue: number
  /** 下拉里的说明，直接写「这个身份能演示什么」 */
  desc: string
  /**
   * 对应**角色权限矩阵里那条角色**的 id（`orgRoles[].id`），菜单裁剪据此查权限。
   *
   * 按 id 对而不是按名字对：角色名是机构可改的配置（「老师」可以被改成「任课教师」），
   * 一改名就断掉对应关系的话，演示会毫无征兆地变成「这个身份看不到任何菜单」。
   * id 是稳定的 —— 预置角色还都是 `builtin`，删不掉。
   */
  permRoleId: number
  /* 联系方式与简介：个人中心（ProfileView）那几项原本是写死的「陈明远」，换个身份就自相矛盾。
     放在这里而不是让 ProfileView 自己再抄一份，是为了身份相关的信息只有一处可改。 */
  phone: string
  email: string
  intro: string
}

/**
 * 三个演示身份。顺序即下拉里的顺序，第一项是登录账号本身（默认）。
 *
 * 王静的 id 取 105：用户 id 空间在种子里只用到 101~104（见 exam-seeds.ts 的 ownerId），
 * 取下一个空位，免得她建的东西跟别人撞 owner。
 */
export const DEMO_IDENTITIES: DemoIdentity[] = [
  {
    role: 'orgAdmin',
    id: 101,
    name: '陈明远',
    roleName: '机构管理员',
    avatarHue: 172,
    desc: '全部菜单，可审核试卷、管理员工与角色',
    /* orgRoles[0]「管理员」 */
    permRoleId: 1,
    phone: '139****0001',
    email: 'mingyuan@xingchen.edu.cn',
    intro: '机构管理员，分管教研与题库建设。',
  },
  {
    role: 'leader',
    id: 105,
    name: '王静',
    roleName: '年级学科组长',
    avatarHue: 268,
    desc: '可发起协同组卷，负责逐人验收与提交审核',
    /* orgRoles[4]「年级学科组长」：除机构管理与班级学生外的全量业务菜单，但没有审核权 */
    permRoleId: 5,
    phone: '139****0004',
    email: 'wangjing@xingchen.edu.cn',
    intro: '高一数学年级学科组长，负责协同组卷的发起、验收与送审。',
  },
  {
    role: 'teacher',
    id: 103,
    name: '李文博',
    roleName: '老师',
    avatarHue: 30,
    desc: '可发起协同组卷，在被分配的题型内筛选题目并提交',
    /* orgRoles[2]「老师」：只保留组卷闭环要用的四个模块。四个模块内**没有**任何 op 能拦住
       发起协同组卷 —— 发起是人人都有的动作，见 org-store 的 PERM_MODULES 注释 */
    permRoleId: 3,
    phone: '139****0003',
    email: 'wenbo@xingchen.edu.cn',
    intro: '高一数学教师，在协同组卷中负责被分配的题型命题。',
  },
]

/**
 * 演示身份的 localStorage key。**必须用时才算**，不能提成模块级常量：
 * 本模块的 import 早于 main.ts 里的 `setupApp()`（router → usePermission → 本模块），
 * 模块求值那一刻 `getAppConfig().appName` 还是默认的 `admin`，算出来会落到管理端的 key 上 ——
 * 机构端把演示身份写进了 `aiteach:admin:demo-role`。
 */
function storageKey(): string {
  return `aiteach:${getAppConfig().appName}:demo-role`
}

function identityOf(role: DemoRole): DemoIdentity {
  return DEMO_IDENTITIES.find((row) => row.role === role) ?? DEMO_IDENTITIES[0]!
}

/** 缓存里的值可能是上一版遗留的旧角色名（或手改过），认不出来就退回默认身份 */
function readStored(): DemoRole {
  const raw = localStorage.getItem(storageKey())
  return DEMO_IDENTITIES.some((row) => row.role === raw) ? (raw as DemoRole) : 'orgAdmin'
}

/** 模块级单例：顶栏与各业务页读写的是同一个 ref。初值即登录账号本身的身份 */
const role = ref<DemoRole>('orgAdmin')

const identity = computed(() => identityOf(role.value))

/**
 * 头像归属键。
 *
 * 演示账号按**身份**存（三个身份共用 orgadmin 一个账号，按账号存会让「切到王静还顶着
 * 陈明远的照片」）；其它账号（如 admin）按**账号**存 —— 它不换身份，按身份存会跟
 * orgadmin 的「机构管理员」共用同一个槽位，一个人换头像，另一个人跟着变。
 */
function avatarOwner(account: string, target: DemoRole = role.value): string {
  return account === DEMO_ACCOUNT ? target : `account:${account}`
}

/**
 * 把某个演示身份落到 mock 与会话上。**必须由顶栏在挂载时也调一次**：
 * mock 是内存态，刷新后会回到种子的默认身份，需要按缓存再把身份贴回去。
 *
 * 非演示账号（`admin`）只做一件事：把 mock 的当前操作人同步成本人，右上角保留自己的
 * 姓名与角色 —— 理由见 DEMO_ACCOUNT 的注释。
 */
export function applyDemoIdentity(target: DemoRole): SessionUser | null {
  const store = useAuthStore()
  const current = store.user
  if (!current) return null

  if (current.account !== DEMO_ACCOUNT) {
    /* 不动 localStorage 里的演示身份缓存：它不是这个账号的东西，留着只会被下一个
       登录 orgadmin 的会话（登出会清，但会话过期未必）误用 */
    role.value = 'orgAdmin'
    const self: SessionUser = { ...current, avatar: getAvatarOverride(avatarOwner(current.account)) }
    /* 会话里的 role 类型含管理端的 `super`，机构端只可能是这四档之一；这里收窄给 mock 层 */
    const mockRole = current.role === 'leader' || current.role === 'auditor' || current.role === 'teacher'
      ? current.role
      : 'orgAdmin'
    setMockCurrent({
      id: typeof current.id === 'number' ? current.id : undefined,
      name: current.name,
      role: mockRole,
    })
    store.user = self
    updateSessionUser(self)
    return self
  }

  const next = identityOf(target)
  role.value = target
  localStorage.setItem(storageKey(), target)

  /* 1. mock 侧的「当前操作人」—— 影响所有 owner / actor / createdBy */
  setMockCurrent({ id: next.id, name: next.name, role: next.role })

  /* 2. 会话用户。account / orgName 保持登录账号原样：我们确实是拿 orgadmin 登进来的，
     编一个「王静的账号」反而在个人中心里露馅，不如让「用谁的视角看」这件事如实呈现。 */
  const user: SessionUser = {
    ...current,
    id: next.id,
    name: next.name,
    role: next.role,
    roleName: next.roleName,
    avatarHue: next.avatarHue,
    avatar: getAvatarOverride(avatarOwner(current.account, next.role)),
  }
  store.user = user

  /* 3. 落缓存，刷新后仍然生效（mock 内存态刷新即还原，恢复靠这一步）。
     用 updateSessionUser 而不是 setSession：后者会重写会话到期时间，切一次身份就把
     30 分钟固定窗口续满，等于没有有效期。 */
  updateSessionUser(user)
  return user
}

/**
 * 按缓存恢复演示身份。AppLayout 挂载时调用 —— mock 是内存态，刷新后会回到种子的默认身份。
 *
 * 必须走本函数而不是在调用处写 `apply(identity.value.role)`：`role` 的初值是默认身份，
 * 缓存的读取要等 `setupApp()` 之后才有正确的 key（见 storageKey 的注释）。
 */
export function restoreDemoIdentity(): SessionUser | null {
  /* 哪怕缓存值与 role 当前值相同也照贴一次：刷新后 mock 的 CURRENT 已回到种子值，
     身份"看起来没变"但底层要同步 */
  return applyDemoIdentity(readStored())
}

/**
 * 复位演示身份：清缓存、回到登录账号本身的身份、同步 mock 的当前操作人。
 *
 * **登出 / 会话失效时必须调**：否则下一个会话（哪怕登录的是 orgadmin）会被
 * `restoreDemoIdentity()` 把上一个会话缓存的身份贴回来 —— 登录的是机构管理员，
 * 界面却显示「王静 · 年级学科组长」。
 *
 * 不能放进 `stores/auth.ts` 的 `logout()`：本模块已经 import 了 `useAuthStore`，
 * 反向再 import 会成环。调用点在机构端应用层：AppLayout 退出、ProfileView 退出、
 * main.ts 的会话失效处理器。
 */
export function clearDemoIdentity(): void {
  localStorage.removeItem(storageKey())
  role.value = 'orgAdmin'
  const next = identityOf('orgAdmin')
  setMockCurrent({ id: next.id, name: next.name, role: next.role })
}

/**
 * 设置**当前身份**的自定义头像（`null` 为恢复默认字母头像）。
 *
 * 必须经由这里而不是直接写 `updateSessionUser`：头像落在按身份分的覆盖表里，
 * 再走一遍 `applyDemoIdentity` 把它贴回会话（顺带把 mock 的当前操作人也同步一次），
 * 两处谁先谁后都成 —— 但只要有一处漏了，「换完头像切个身份再切回来」就会发现头像没了。
 */
export function setIdentityAvatar(dataUrl: string | null): SessionUser | null {
  const account = useAuthStore().user?.account ?? ''
  setAvatarOverride(avatarOwner(account), dataUrl)
  return applyDemoIdentity(role.value)
}

export function useDemoRole() {
  /**
   * 只有演示账号能就地换身份：`admin` 是另一个真实账号，换身份只会让姓名与账号对不上。
   *
   * `useAuthStore()` 必须写在 computed 里而不是这行外面：router/index.ts 在**模块作用域**
   * 调 `usePermission()` → `useDemoRole()`，那时 pinia 还没装（main.ts 才 install），
   * 提前取 store 会直接抛「no active Pinia」。computed 的 getter 等到渲染时才跑，那时已经有了。
   */
  const canSwitch = computed(() => useAuthStore().user?.account === DEMO_ACCOUNT)
  return { role, identity, identities: DEMO_IDENTITIES, canSwitch, apply: applyDemoIdentity }
}
