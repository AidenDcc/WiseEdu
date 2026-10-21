/**
 * 加载 esbuild 打包后的 mock 模块，合并导出为 JSON。
 * 用法：node scripts/dump-mock-bundled.mjs <bundle目录> <输出文件>
 */
import { writeFileSync } from 'node:fs'
import path from 'node:path'

const bundleDir = process.argv[2] ?? '/tmp/mockbundle'
const outFile = process.argv[3] ?? '/tmp/mock-dump.json'

const modules = [
  'org-store',
  'admin-store',
  'tenant-store',
  'content-store',
  'student-store',
  'exam-seeds',
  'data',
]

const dump = {}
const stats = []

for (const name of modules) {
  try {
    const mod = await import(path.join(bundleDir, `${name}.mjs`))
    let n = 0
    for (const [key, value] of Object.entries(mod)) {
      if (typeof value === 'function') continue
      if (value === null || value === undefined) continue
      if (typeof value !== 'object') continue
      dump[`${name}.${key}`] = value
      n += 1
    }
    stats.push(`${name}: ${n}`)
  } catch (err) {
    stats.push(`${name}: FAIL ${err.message}`)
  }
}

const json = JSON.stringify(dump, null, 2)
writeFileSync(outFile, json, 'utf8')

// 打印每个导出的条目数，便于核对映射覆盖
const detail = []
for (const [key, value] of Object.entries(dump)) {
  if (Array.isArray(value)) detail.push(`  ${key}: ${value.length} 条`)
  else detail.push(`  ${key}: 对象`)
}
console.log(stats.join(' | '))
console.log(detail.join('\n'))
console.log(`\n写入 ${outFile}（${(json.length / 1024).toFixed(1)} KB）`)
