/**
 * 浏览器端 Node 全局兜底。
 *
 * 绘图依赖链里有几处按 Node 环境写的第三方代码，浏览器里缺全局就白屏：
 * - `util@0.12.5`（被 assert 依赖）在模块顶层直接读 `process.env.NODE_DEBUG`，
 *   `util.promisify` 还会调用 `process.nextTick` → ReferenceError: process is not defined；
 * - Ketcher 的 store 初始化（redux 系）会引用 `global` → ReferenceError: global is not defined。
 *
 * 这里在应用入口最先引入，补上这两个全局，让上述 polyfill 走浏览器分支。
 * 注意必须放在其他 import 之前：ESM 静态导入按声明顺序求值，晚于本文件的依赖
 * 会在全局就位前执行。
 */
import process from 'process'

const globalScope = globalThis as unknown as { process?: typeof process; global?: typeof globalThis }
if (!globalScope.process) globalScope.process = process
if (!globalScope.global) globalScope.global = globalThis
