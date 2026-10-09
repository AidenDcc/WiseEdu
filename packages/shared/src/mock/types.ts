/** Mock 演示账号（仅前端演示用，后端就绪后由真实账号体系替代） */
export interface MockUser {
  id: number
  /** 归属端：admin=超级管理端，tenant=机构端 */
  appId: 'admin' | 'tenant'
  account: string
  /**
   * 这里**没有密码字段**：凭据只存在于 `auth/accounts.ts`（盐 + 哈希），
   * 本结构只描述登录成功后的用户资料。要加账号请见该文件的说明。
   */
  name: string
  /**
   * `leader`（年级学科组长）不是登录账号，而是机构端「演示身份」切换出来的一个角色值 ——
   * 机构端的演示需要用组长身份演示发起/验收协同组卷。真实场景由组织架构决定，不走这张账号表。
   */
  role: 'super' | 'orgAdmin' | 'leader' | 'auditor' | 'teacher'
  roleName: string
  orgName: string
  /** 头像色相，用于生成初始字母头像 */
  avatarHue: number
  /** 登录租户ID，平台侧为 0。与后端 EduSessionUserVo.tenantId 同义 */
  tenantId: number
  /* 个人中心（ProfileView）的联系方式与简介。可空：机构端这些信息不在这里 ——
     它有「演示身份」切换，联系方式跟着身份表走（apps/tenant/src/composables/useDemoRole.ts），
     同一份资料放两处迟早对不上。只有管理端（账号固定、无身份切换）从这里取。
     接真实后端时由 `/auth/me` 的 VO 一并下发。 */
  phone?: string
  email?: string
  intro?: string
  /** 自定义头像（图片地址或 data URL）；空则用 avatarHue + 姓名首字生成字母头像 */
  avatar?: string
}

/** 登录成功后下发的会话用户信息（脱敏，不含密码） */
export interface SessionUser {
  /**
   * 真实后端返回的是 sys_user 的雪花ID（19 位字符串），超出 JS Number.MAX_SAFE_INTEGER，
   * 只能当字符串传；Mock 模式仍是数字。故此处是联合类型。
   * 拿它做等值比较的地方（如按 ownerId 过滤）需要先 String() 归一化。
   */
  id: string | number
  name: string
  account: string
  role: MockUser['role']
  roleName: string
  orgName: string
  avatarHue: number
  /**
   * 登录租户ID，平台侧为 0。请求层据此发 X-Tenant-Id（见 request/client.ts）。
   * 可空：Mock 模式下老数据不一定带，且后端不可用时也不该因此报错。
   */
  tenantId?: number
  /** 个人中心资料（见 MockUser 的同名字段注释） */
  phone?: string
  email?: string
  intro?: string
  /**
   * 自定义头像。管理端由登录响应带出、上传后就地改写；机构端每次切换演示身份时
   * 按身份重新贴一次（见 useDemoRole），否则换个人还顶着上一位的脸。
   * 接真实后端后对应 `sys_user.avatar`。
   */
  avatar?: string
}
