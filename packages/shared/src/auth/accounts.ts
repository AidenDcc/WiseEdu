/**
 * 登录账号配置表 —— **仅 Mock 模式**（`VITE_USE_MOCK` 未设为 'false' 时）的账号源。
 *
 * 接真实后端后凭据来自 `sys_user`，本表完全不参与（见 mock/routes.ts 的 /auth/login 分支）。
 *
 * ## 只存盐 + 哈希，仓库里不留明文
 *
 * 一条记录 = 账号名 + 每账号随机盐 + `sha256Hex(salt + password)`。登录时把用户输入的密码
 * 按同样方式算一遍再比对（`verifyPassword`），任何文件、注释、README、登录页都不写明文口令。
 *
 * **这不是「安全」**：盐与哈希随前端 bundle 一起发到浏览器，拿到 bundle 就能对弱口令离线爆破。
 * 它解决的是「仓库与界面上不出现明文、比对时不明文比较」；真正的密码安全必须由服务端负责。
 *
 * ## 改密码 / 加账号
 *
 * 1. `pnpm hash-password --app tenant --account orgadmin`（密码交互输入、不回显）；
 * 2. 把输出的那一行粘到下面 `AUTH_ACCOUNTS` 对应那端的数组里；
 * 3. 新增**机构端**账号还要在 `mock/data.ts` 的 `mockUsers` 里补一条同 `appId + account`
 *    的用户资料（姓名 / 角色 / 机构），否则登录会因「资料缺失」失败 —— 那条资料不含密码。
 *
 * 哈希口径必须与生成脚本一致（盐在前、密码在后、UTF-8）：脚本用 Node 的 `crypto.createHash`，
 * 运行期用 `utils/sha256.ts` 的纯 JS 实现，两边不同源就会出现「生成的哈希永远登录失败」。
 * 文件末尾的 dev-only 自检向量就是守这道门的（改动 sha256.ts 后自检必须仍然通过）。
 */
import type { AppName } from '../config'
import { sha256Hex } from '../utils/sha256'

export interface AuthAccount {
  account: string
  /** 每账号随机盐（hex，16 字节） */
  salt: string
  /** sha256Hex(salt + password)，hex */
  passwordHash: string
}

export const AUTH_ACCOUNTS: Record<AppName, AuthAccount[]> = {
  admin: [
    { account: 'admin', salt: 'b235cf0c6f2acf8a7c7e25d6e19f44f7', passwordHash: '9959015c977c7983e48bd94a30f3348e5eb5d52b4e9a52664761de1b5257c06c' },
  ],
  tenant: [
    { account: 'orgadmin', salt: '63a67271fa9351137f92b946dc3bab22', passwordHash: 'b8da3480c0678fb8771a05bb38cd494efc87eb6937c8015d210a051438355d9d' },
    { account: 'auditor', salt: '025c8560bc9cb05d627999a2e0edd258', passwordHash: '948f9867ea27d384c3f428c7757c32f1e352a07448f59d704454a8172c532dcb' },
    { account: 'teacher', salt: '998c15587352e5600b5a52d519d6b34f', passwordHash: '06f656d9a4c43afd7ab196db3142d6eb4c43c37f5a639a80d06eaf0c2d5dd967' },
  ],
}

/** 按端 + 账号名查配置。查不到**不等于**账号不存在 —— 调用方对外统一报「账号或密码错误」 */
export function findAuthAccount(appName: AppName, account: string): AuthAccount | undefined {
  const normalized = account.trim()
  return AUTH_ACCOUNTS[appName].find((item) => item.account === normalized)
}

/** 密码比对：与 `scripts/hash-password.mjs` 同序同编码（盐 + 密码，UTF-8） */
export function verifyPassword(entry: AuthAccount, password: string): boolean {
  return sha256Hex(entry.salt + password) === entry.passwordHash
}

// dev-only 自检：纯 JS 实现与 Node crypto 的已知向量对不上就没有任何正常登录可言，
// 宁可在控制台喊出来，也不要让用户面对「密码明明是对的却登不进」。
if (import.meta.env.DEV) {
  const vectors: Array<[input: string, expected: string]> = [
    ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
    ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
    ['The quick brown fox jumps over the lazy dog', 'd7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592'],
  ]
  for (const [input, expected] of vectors) {
    const actual = sha256Hex(input)
    if (actual !== expected) {
      console.error('[auth] SHA-256 自检失败，登录比对必然出错：', { input, expected, actual })
    }
  }
}
