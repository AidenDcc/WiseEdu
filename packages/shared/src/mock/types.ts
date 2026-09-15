/** Mock 演示账号（仅前端演示用，后端就绪后由真实账号体系替代） */
export interface MockUser {
  id: number
  /** 归属端：admin=超级管理端，tenant=机构端 */
  appId: 'admin' | 'tenant'
  account: string
  password: string
  name: string
  role: 'super' | 'orgAdmin' | 'auditor' | 'teacher'
  roleName: string
  orgName: string
  /** 头像色相，用于生成初始字母头像 */
  avatarHue: number
}

/** 登录成功后下发的会话用户信息（脱敏，不含密码） */
export interface SessionUser {
  id: number
  name: string
  account: string
  role: MockUser['role']
  roleName: string
  orgName: string
  avatarHue: number
}
