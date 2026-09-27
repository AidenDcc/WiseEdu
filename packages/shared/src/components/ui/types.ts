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
}

/** 标签页 / 分段控件的一项 */
export interface TabDef {
  key: string
  label: string
  count?: number
  icon?: string
}
