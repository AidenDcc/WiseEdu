/**
 * 把前端 mock 数据导出为 JSON，供数据库初始化使用。
 *
 * 用法：tsx scripts/dump-mock-data.mts [输出路径]
 * 默认输出：/tmp/mock-dump.json
 *
 * 说明：
 * - 只导出对象/数组型导出（跳过函数、字符串常量映射表）
 * - mock 模块可能访问 localStorage，这里做最小 polyfill
 */
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const g = globalThis as any
if (!g.localStorage) {
  g.localStorage = {
    getItem: () => null,
    setItem: () => undefined,
    removeItem: () => undefined,
    clear: () => undefined,
  }
}
if (!g.window) g.window = g

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const outFile = process.argv[2] ?? '/tmp/mock-dump.json'

const modules = [
  'org-store',
  'admin-store',
  'tenant-store',
  'content-store',
  'student-store',
  'exam-seeds',
  'data',
]

const dump: Record<string, unknown> = {}
const stats: string[] = []

for (const name of modules) {
  const file = path.join(root, 'packages/shared/src/mock', `${name}.ts`)
  try {
    const mod: Record<string, unknown> = await import(file)
    let n = 0
    for (const [key, value] of Object.entries(mod)) {
      if (typeof value === 'function') continue
      if (value === null || value === undefined) continue
      if (typeof value !== 'object') continue
      dump[`${name}.${key}`] = value
      n += 1
    }
    stats.push(`${name}: ${n} 个对象型导出`)
  } catch (err) {
    stats.push(`${name}: 导入失败 -> ${(err as Error).message}`)
  }
}

let json: string
try {
  json = JSON.stringify(dump, null, 2)
} catch (err) {
  // 出现循环引用时退化为：逐个导出单独序列化
  console.warn('整体序列化失败，改为逐个导出：', (err as Error).message)
  const safe: Record<string, string> = {}
  for (const [key, value] of Object.entries(dump)) {
    try {
      safe[key] = JSON.stringify(value)
    } catch {
      safe[key] = '"<unserializable>"'
    }
  }
  json = JSON.stringify(safe, null, 2)
}

writeFileSync(outFile, json, 'utf8')
console.log(stats.join('\n'))
console.log(`\n已写入 ${outFile}（${(json.length / 1024).toFixed(1)} KB）`)
