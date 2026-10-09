/**
 * 共享 UI 组件的公共类型。
 *
 * 放在独立 `.ts` 里而不是 SFC 的 `<script>` 块中：`packages/shared` 的 typecheck 用裸
 * `tsc`（不是 vue-tsc），只靠 `declare module '*.vue'` 垫片拿到 `default` 导出，
 * 从 `.vue` 里再导出具名类型会解析不到。
 */

/** 可折叠筛选面板里的一行：标签 + 候选项 */
export interface FilterRowDef {
  key: string
  label: string
  options: string[]
  /** false = 单选；默认多选 */
  multiple?: boolean
  /**
   * 少数选项的显示文案与取值不同时用它改写（取值不变）。
   *
   * 主要给「历史数据引用了已停用字典值」这种场景：值必须留在选项里（否则会被静默改写），
   * 但文案要标出「（已停用）」才不会看着像还能选。见 `useBaseData` 的 `optionLabel`。
   */
  optionLabels?: Record<string, string>
  /**
   * 选项多到会换行时，默认只显示一行 + 一个「展开 / 收起」开关。
   *
   * 给取值集合天生很长的行用：地区铺满 34 个省级行政区后就是典型 —— 这种行的高度不该由
   * 「字典里配了几项」决定，否则往字典里加几个地区就把筛选面板凭空撑高三行。
   * 只对确实放不下的行出开关（组件量出来的），放得下的行不会多一个点了没反应的按钮。
   */
  collapsible?: boolean
  /**
   * 自定义控件行：本面板不渲染它的 chip，控件由宿主用 `#extra` 插槽自己画（如日期区间）。
   *
   * 存在的意义是「汇总与清空」：这类条件同样会筛掉数据，折叠时必须在头部露出来、
   * 也必须被「清空」清掉 —— 否则界面上会出现一个点不掉的幽灵条件。
   * 取值照旧走 `modelValue[key]`，宿主往里放一份展示文案即可（面板只拿它拼摘要）。
   */
  custom?: boolean
}

/** 标签页 / 分段控件的一项 */
export interface TabDef {
  key: string
  label: string
  count?: number
  icon?: string
}
