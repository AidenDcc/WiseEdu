/**
 * `@aiteach/business-common` —— 题库 / 试卷 / 组卷三块业务的共用层。
 *
 * 三件事：
 * 1. **UI 组件**：两端不变的题库列表骨架、试卷列表 / 预览 / 分析、知识点与考试类型树、
 *    组卷筛选条等。它们只渲染骨架，差异一律走 props 与插槽（`extraFilter` / `renderOperation`），
 *    **内部不写 admin/tenant 分支**，也不碰租户权限与 `tenant_id` 过滤。
 * 2. **TS 类型**：`TenantDictItem`、试卷类型树、`ComposeFilter` 等两端同义的模型。
 * 3. **基础接口契约**：`BusinessApi` + `provideBusinessApi` / `useBusinessApi`。
 *    组件不 import 任何 `apps/**`，查询实现（URL、参数、权限、`tenant_id`）留在各端 api 目录。
 *
 * 组件级差异的落点：
 * - 专属筛选 → `#extraFilter` 插槽（非 chip 形态的控件）或 `BankFilterBar` 的 `extraRows`（仍是 chip 行）
 * - 操作按钮 → `#renderOperation` 插槽（预览 / 编辑 / 变式 / 上下架 / 审核入库各端自定）
 * - 行内差异 → `#renderQuestionNo` / `#renderStem` / `#renderCardMeta`（编号标识、题干、卡片信息行）
 * - 其余查询参数与数据 → props
 *
 * 已知取舍：`QuestionCorrectionDialog` 的描述框默认是 `<textarea>`，机构端原来的 tiptap 富文本
 * 编辑器（能插公式 / 图片）没有跟着进公共包 —— 它体积大且只有机构端有。插槽 `#description` 已经
 * 留好，宿主把编辑器传进去即可；目前 `QuestionPreviewDrawer` / `PaperPreviewModal` 内部直接
 * 使用该弹窗、未把插槽再转发一层，所以两端都退化为纯文本描述。要恢复富文本，需要在这两个容器
 * 组件上各加一层插槽转发，再由页面传 `RichTextEditor`。
 */

/* ===== 类型与筛选模型 ===== */
export * from './types'

/* ===== 基础接口契约 ===== */
export * from './api/business-api'

/* ===== 组合式（模块级单例 + 通用工具） ===== */
export * from './composables/useViewMode'
export * from './composables/useScope'
export * from './composables/useBaseData'
export * from './composables/useKnowledgePool'
export * from './composables/useComposeData'
export * from './composables/useComposeBasket'
export * from './composables/useQuestionFavorites'
export * from './composables/useComposeKeyword'

/* ===== 纯函数工具 ===== */
export * from './utils/question-card'
export * from './utils/question-match'
export * from './utils/folders'
export * from './utils/file'
export * from './utils/paper-years'
export * from './utils/paper-export'
export * from './utils/theme-tokens'

/* ===== 试卷结构（组卷车的归类规则） ===== */
export * from './compose/paper-sections'

/* ===== 列表筛选模型 =====
   两端的筛选条件逐字相同，行定义 / 候选项解析 / 取值映射放这里；
   数据查询、权限、`tenant_id` 过滤仍归各端页面。 */
export * from './bank/filter-model'
export * from './paper/filter-model'

/* ===== 骨架组件 ===== */
/* 题库列表骨架：左树槽位 + 筛选条（extraFilter）+ 表格 / 详细列表（renderOperation）+ 分页 */
export { default as QuestionBankPanel } from './components/bank/QuestionBankPanel.vue'
/* 通用筛选面板：包一层共享 AppFilterPanel，透出 extraFilter 插槽给各端的专属条件 */
export { default as BankFilterBar } from './components/bank/BankFilterBar.vue'

/* ===== 筛选面板 / 树 ===== */
export { default as KnowledgeFilterPanel } from './components/filter/KnowledgeFilterPanel.vue'
export { default as PaperTypeTree } from './components/compose/PaperTypeTree.vue'
export { default as ComposeFilterBar } from './components/compose/ComposeFilterBar.vue'
export { default as KnowledgePicker } from './components/compose/KnowledgePicker.vue'
export { default as KnowledgePickerModal } from './components/compose/KnowledgePickerModal.vue'
export { default as SimilarQuestionsModal } from './components/compose/SimilarQuestionsModal.vue'

/* ===== 题目 ===== */
export { default as QuestionOptions } from './components/question/QuestionOptions.vue'
export { default as QuestionPreviewBody } from './components/question/QuestionPreviewBody.vue'
export { default as QuestionPreviewDrawer } from './components/question/QuestionPreviewDrawer.vue'
export { default as QuestionCorrectionDialog } from './components/question/QuestionCorrectionDialog.vue'

/* ===== 试卷 ===== */
export { default as PaperListPanel } from './components/paper/PaperListPanel.vue'
export { default as PaperPreviewModal } from './components/paper/PaperPreviewModal.vue'
export { default as PaperAnalysisModal } from './components/paper/PaperAnalysisModal.vue'
export { default as PaperBlock } from './components/paper/PaperBlock.vue'
export { default as PaperShareDialog } from './components/paper/PaperShareDialog.vue'
export { default as PaperFolderSelect } from './components/paper/PaperFolderSelect.vue'
export { default as ParallelPaperDialog } from './components/paper/ParallelPaperDialog.vue'
export { default as QuestionActionBar } from './components/paper/QuestionActionBar.vue'
export { default as QuestionActionBarHost } from './components/paper/QuestionActionBarHost.vue'

/* 版式令牌 / 分版 / 统计 / 推荐：预览弹窗与组卷编辑页共用同一套排版实现 */
export * from './components/paper/paginate'
export * from './components/paper/paper-stats'
export * from './components/paper/paper-analysis'
export * from './components/paper/paper-recommend'
/*
 * `paper-layouts` 里的 `PaperBlock`（版面块的联合类型）与本包的 `PaperBlock` 组件重名，
 * 所以逐项列出、并把类型以 `PaperBlockModel` 的名字导出 —— 组件仍叫 `PaperBlock`。
 * 改名放在 barrel 上（而不是让各页面自己 `as`）：预览弹窗与编辑页两处的 import 才能逐字一致。
 */
export {
  MM,
  PANEL_GAP,
  COL_GAP,
  ANSWER_LINES,
  PAPER_SIZES,
  PAPER_LAYOUTS,
  PAPER_EXTRAS,
  DEFAULT_PAPER_NOTICES,
  presetOf,
  presetVars,
  makePaperExtra,
  isObjective,
  fillColumns,
  fillChunk,
  answerBoxHeight,
  paperGeometry,
  type CardFillItem,
  type PaperGeometry,
  type PaperHeadStyle,
  type PaperLayoutPreset,
  type PaperOrientation,
  type PaperSize,
  type PaperSizeKey,
  type PaperBlock as PaperBlockModel,
} from './components/paper/paper-layouts'

/* ===== 我的文件 ===== */
export { default as FolderPickerDialog } from './components/file/FolderPickerDialog.vue'
