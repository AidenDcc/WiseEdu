import { registerMockRoutes } from './engine'
import { mockRoutes } from './routes'
import { registerMockPersist, restoreMockState } from './persist'
import { ORG_STATE_VERSION, captureOrgState, restoreOrgState } from './org-store'

registerMockRoutes(mockRoutes)

/* 机构端业务数据的跨标签页持久化：试卷编辑页一律开在新标签页，新标签页是全新的 JS 上下文，
   不还原的话「刚生成的试卷」在那一边根本不存在（机制与取舍见 persist.ts）。
   还原必须早于任何一次请求 —— 本模块由 request/client.ts 以副作用导入，求值期即完成注册。
   超管端共用这个 mock 包、也会走到这里：它不读机构端数据，只是多落一份用不到的种子快照，
   不值得为它在这里加端判断。 */
registerMockPersist({
  key: 'org',
  version: ORG_STATE_VERSION,
  capture: captureOrgState,
  restore: restoreOrgState,
})
restoreMockState()
