/**
 * 全屏工作台（DocWorkbench）与三个编辑页之间的数据类型。
 *
 * 单独一个文件而不是写在 `DocWorkbench.vue` 里：`<script setup>` 不能 `export`，
 * 而三个页面都要用这个类型去生成左栏数据 —— 塞进任何一侧都会逼着另一边 `import` 一个
 * 组件文件只为拿类型（构建时能过，读代码的人会以为那儿有副作用）。
 */

/**
 * 结构化编辑左栏的一行。
 *
 * 左栏在三个页面里长得一模一样（编号方块 + 标题 + 副标题 + 上移下移删除），
 * 差别只在数据来源：教案来自 `plan.steps` 与几项固定内容，学案 / 讲义来自 `blocks`。
 * 所以行结构留在工作台，行数据由页面给。
 */
export interface StructOutlineRow {
  /** 唯一 key（页面自己编，如 `step:12`）；选中与操作回传都用它 */
  key: string
  /** 左侧小方块的文字：数字，或「目 / 重 / 法 / 板 / 思」这样的单字 */
  no: string
  title: string
  /** 第二行的说明（类型 · 时长 · n 题） */
  meta?: string
  /** 分组标题：传了就在这一行**之前**画一条分组名（如「教学过程」） */
  group?: string
  /** 是否显示上移 / 下移 / 删除（固定顺序的项、单个项不显示） */
  movable?: boolean
}

/** 大纲行的操作。只报动作，行的增删改由页面自己落到 `plan` / `blocks` 上 */
export type StructOutlineAction = 'up' | 'down' | 'remove'
