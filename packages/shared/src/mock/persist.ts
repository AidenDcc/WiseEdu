/**
 * Mock 内存态的跨标签页持久化。
 *
 * 起因是一件看起来不像 Mock 问题的事：组卷车点「生成试卷」、选完存储位置后跳转试卷编辑页，
 * 编辑页却报「试卷不存在或已删除」并退回试卷库。根因是编辑页**一律开在新标签页**
 * （见 apps/tenant/src/utils/paper-edit.ts），而 Mock 数据是模块级内存态：新标签页是全新的
 * JS 上下文，Mock 重新播种，刚建的那份卷（id 由 `++paperSeq` 生成、不在种子里）自然查不到。
 * AI 组卷 / 协同组卷 / 文档识别建卷走的是同一条路，只是入口不同。
 *
 * 做法：每次写请求成功后，把注册过的 store 的**可变部分整体**写进 localStorage；页面加载时
 * 按版本号还原。整份快照而不是增量 —— 删除、改名这类「少了一条」的变更只有整体覆盖才追得回来。
 *
 * 三个已知取舍，写在这里免得以后当成 bug 查：
 *
 * 1. **多标签页之间是后写覆盖**：两个标签页都开着时，后写的那一页会覆盖另一页期间的改动
 *    （Mock 没有并发控制，也没有「以服务端为准」这回事）。要命中它得两页交替操作，演示场景
 *    够用；接上真后端后这层自然失效 —— 数据在服务端。
 * 2. **改了 Mock 种子要让旧快照作废**，否则本机看到的还是快照里那份数据，表现为「代码改了、
 *    页面却没变」这种最费时间的假 bug。为此还原时会在控制台打一行说明（哪个键、怎么清），
 *    各 store 的 `*_STATE_VERSION` 供结构性变更时 +1。**曾试过用「种子指纹」自动判断，行不通**：
 *    种子里有 `Math.random()` 生成的字段（AI 组卷模板的 `useCount` / `updatedAt` 等），同一版
 *    代码两次启动的序列化结果都不一样，指纹恒不相等，只会把好快照全判成过期。
 * 3. **快照不含会话级数据**：上传字节（org-store 的 `mediaBlobs`）本就设计成刷新即失效，
 *    收进快照会把 localStorage 配额吃满。后果是当前会话上传的图片在新标签页里显示不出来。
 *
 * 存储键不带 appName：还原发生在 `setupApp()` 之前（`request/client.ts` 里的 `import '../mock'`
 * 是模块求值期的副作用导入，那时还读不到端标识）。机构端数据只有机构端用，开发期两端不同端口、
 * 生产期不同域名，不会互相覆盖。
 */

/** 一次快照：版本号 + 该 store 的自有结构（结构由各 store 的 capture / restore 约定） */
interface MockStateSnapshot {
  version: number
  data: Record<string, unknown>
}

export interface MockPersistTarget {
  /** 存储键后缀，如 `'org'` → `aiteach:mock:org` */
  key: string
  /** 快照结构版本，对应各 store 导出的 `*_STATE_VERSION` */
  version: number
  /** 取出当前内存态；返回活对象即可，序列化在写入时同步完成 */
  capture: () => Record<string, unknown>
  /** 把快照灌回内存态（版本已核对） */
  restore: (data: Record<string, unknown>) => void
}

const STORAGE_PREFIX = 'aiteach:mock:'

const targets: MockPersistTarget[] = []

/** 配额写满的告警只报一次：之后每次都报会把控制台刷满，反而盖住了别的日志 */
const warned = new Set<string>()

export function registerMockPersist(target: MockPersistTarget): void {
  targets.push(target)
}

function storageKey(target: MockPersistTarget): string {
  return STORAGE_PREFIX + target.key
}

/**
 * 页面加载时还原全部已注册的 store。由 `mock/index.ts` 在模块求值期调用一次 ——
 * 必须早于任何一次请求，否则前端可能先拿着种子数据渲染了一屏。
 */
export function restoreMockState(): void {
  for (const target of targets) {
    const key = storageKey(target)
    let raw: string | null = null
    try {
      raw = localStorage.getItem(key)
    } catch {
      /* 隐私模式等禁用 localStorage 的环境：跳过持久化，退回纯内存态（与接入本机制之前一致） */
      return
    }
    if (!raw) continue
    try {
      const snapshot = JSON.parse(raw) as MockStateSnapshot
      /* 版本不符就整份丢弃：半新半旧的数据比种子数据更难排查 */
      if (snapshot.version !== target.version || !snapshot.data) continue
      target.restore(snapshot.data)
      /* 明说一句「数据不是来自种子」—— 否则改了 Mock 数据却没生效的人，会先怀疑代码而不是快照 */
      console.info(`[mock] 已还原跨标签页快照 ${key}（要回到种子数据：调用 resetMockState() 或清掉该键）`)
    } catch (error) {
      console.warn(`[mock] 快照还原失败（${key}），已退回种子数据`, error)
    }
  }
}

/**
 * 写请求成功后落一份快照。
 *
 * 必须是**同步**写入、且紧跟在 handler 返回之后：机构端「生成试卷 / AI 组卷」都是拿到结果就
 * 立刻开新标签页，快照晚一步落盘，新标签页读到的就还是种子数据 —— 那正是本机制要修的问题。
 */
export function persistMockState(): void {
  for (const target of targets) {
    const key = storageKey(target)
    try {
      const snapshot: MockStateSnapshot = { version: target.version, data: target.capture() }
      localStorage.setItem(key, JSON.stringify(snapshot))
    } catch (error) {
      if (warned.has(key)) continue
      warned.add(key)
      console.warn(`[mock] 快照写入失败（${key}），本次演示数据将不再跨标签页保留`, error)
    }
  }
}

/**
 * 清掉全部快照：下次加载回到种子数据。
 *
 * 演示前想从干净状态开始、或改完 Mock 种子需要作废旧数据时用它。已从 `@aiteach/shared` 导出；
 * 没接界面入口，需要时由调用方（演示脚本 / 调试按钮）自行接上，或直接清掉浏览器里
 * `aiteach:mock:*` 这几个键。
 */
export function resetMockState(): void {
  for (const target of targets) {
    try {
      localStorage.removeItem(storageKey(target))
    } catch {
      /* 与 restore 同一处理：禁用 localStorage 时本就什么都没写 */
    }
  }
  warned.clear()
}
