#!/usr/bin/env node
/**
 * 生成 `packages/shared/src/auth/accounts.ts` 里那条配置用的「盐 + 密码哈希」。
 *
 *   pnpm hash-password --app tenant --account orgadmin
 *
 * 密码**交互输入且不回显**（避免落进 shell 历史与终端回滚）。也接受 `--password <值>` 供脚本化
 * 使用 —— 那样密码会留在进程列表与 shell 历史里，非必要不要用。
 *
 * 为什么用 Node 的 `node:crypto` 而不是直接 import 运行期那份纯 JS 实现（`utils/sha256.ts`）：
 * 本脚本按 `engines: node >= 18` 运行，而直接 import `.ts` 需要 Node 22.6+ 的类型剥离。
 * 两套实现会不会算出不同结果，由 `auth/accounts.ts` 顶部的 dev-only 自检向量兜底
 * （`sha256Hex('abc')` 必须等于 FIPS 180-4 的标准值），那一条过了就说明两边同源。
 *
 * 生成后把输出的条目粘进 `AUTH_ACCOUNTS` 对应那端；**明文密码不要写进仓库任何地方**
 * （登录页、README、注释都不行），这是本仓库的约定。
 */
import { createHash, randomBytes } from 'node:crypto'
import { createInterface } from 'node:readline'
import process from 'node:process'

const args = process.argv.slice(2)

function flagValue(name) {
  const index = args.indexOf(name)
  return index >= 0 ? args[index + 1] : undefined
}

/** 与运行期同序：盐在前、密码在后，UTF-8 编码（`update` 默认就是 utf8，显式写出免得被改掉） */
function hash(salt, password) {
  return createHash('sha256').update(salt + password, 'utf8').digest('hex')
}

/** 交互读一行可见输入（账号名） */
function promptLine(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  return new Promise((resolve) => rl.question(question, (answer) => {
    rl.close()
    resolve(answer)
  }))
}

/**
 * 上一次提示里多读到的字符。
 *
 * raw 模式下一个 data 事件可能一次送来多行（粘贴、或把输入重定向进来），第一次读密码时
 * 若把「换行之后」的字符直接丢掉，确认那一次就永远等不到输入 —— 脚本会挂住。
 * 所以按行切开，剩下的留给下一个提示。
 */
let leftover = ''

/** 交互读密码：raw 模式逐个字符收，不回显，支持退格与 Ctrl+C */
function promptHidden(question) {
  return new Promise((resolve) => {
    process.stdout.write(question)
    const stdin = process.stdin
    const wasRaw = stdin.isRaw
    stdin.setRawMode?.(true)
    stdin.setEncoding('utf8')
    stdin.resume()
    let value = ''
    const cleanup = () => {
      stdin.off('data', onData)
      stdin.setRawMode?.(wasRaw ?? false)
      stdin.pause()
    }
    /** 消费一段字符；遇到换行就结束本次输入。返回是否已结束 */
    const consume = (chunk) => {
      for (let i = 0; i < chunk.length; i += 1) {
        const ch = chunk[i]
        if (ch === '\r' || ch === '\n') {
          leftover = chunk.slice(i + 1)
          cleanup()
          process.stdout.write('\n')
          resolve(value)
          return true
        }
        if (ch === '\u0003') {
          cleanup()
          process.stdout.write('\n')
          process.exit(130)
        }
        if (ch === '\u007f' || ch === '\b') {
          value = value.slice(0, -1)
          continue
        }
        value += ch
      }
      return false
    }
    const onData = (chunk) => {
      if (consume(chunk)) return
    }
    if (leftover) {
      const rest = leftover
      leftover = ''
      if (consume(rest)) return
    }
    stdin.on('data', onData)
  })
}

const app = flagValue('--app') ?? 'tenant'
if (app !== 'admin' && app !== 'tenant') {
  console.error(`--app 只能是 admin 或 tenant，收到：${app}`)
  process.exit(1)
}

let account = flagValue('--account')
let password = flagValue('--password')

if (!password) {
  if (process.stdin.isTTY !== true) {
    console.error('当前不是交互终端：请用 --password <值> 传入密码，或在本机终端里跑本脚本')
    process.exit(1)
  }
  password = await promptHidden('请输入密码（不回显）: ')
  const again = await promptHidden('再输入一次确认: ')
  if (password !== again) {
    console.error('两次输入不一致，已中止')
    process.exit(1)
  }
}
if (!password) {
  console.error('密码不能为空')
  process.exit(1)
}

if (!account) {
  if (process.stdin.isTTY !== true) {
    console.error('缺少 --account <账号名>')
    process.exit(1)
  }
  account = (await promptLine('账号名: ')).trim()
}
if (!account) {
  console.error('账号名不能为空')
  process.exit(1)
}

const salt = randomBytes(16).toString('hex')
const passwordHash = hash(salt, password)

console.log(`
把它粘进 packages/shared/src/auth/accounts.ts 的 AUTH_ACCOUNTS.${app}：

  { account: '${account}', salt: '${salt}', passwordHash: '${passwordHash}' },

（机构端账号还需在 packages/shared/src/mock/data.ts 的 mockUsers 里有一条同 appId + account
  的用户资料，否则登录会报「账号资料缺失」——那条资料只放姓名 / 角色 / 机构，不放密码。）
`)
