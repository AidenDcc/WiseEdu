/**
 * 通用树工具：知识点树 / 考试类型树 / 教材目录树三处共用。
 *
 * 三处数据源形态不同 —— 知识点树、考试类型树拿到的是扁平的 `parentId` 数组，
 * 教材目录树是嵌套的 `children`。统一在「扁平树」这一层收敛：`AppTreeView` 只认
 * 扁平数组，嵌套的调用方（教材目录）自己拍平 / 还原。这样一棵树的渲染、拖拽、
 * 折叠、搜索逻辑只写一遍。
 */

/** 树组件认的最小节点形状 —— 只保留树机制真正用到的字段 */
export interface FlatTreeNode {
  id: number | string
  parentId: number | string | null
  name: string
  enabled: boolean
  /** 同级序号：越小越靠前。缺省（如教材目录）时退回「数组原顺序」 */
  sort?: number
}

/** 行尾标签 */
export interface TreeTag {
  text: string
  tone?: 'gray' | 'blue' | 'green' | 'orange' | 'red'
}

/** 单行的操作能力（不传 = 全开）。用于「分类根」这类不可编辑 / 不可拖拽的行 */
export interface TreeRowConfig {
  /** 是否可编辑 / 删除（false 时两按钮都不显示） */
  editable?: boolean
  /** 是否可新增子节点（仍受层级上限约束） */
  addable?: boolean
  /** 是否可作为拖拽源 */
  draggable?: boolean
  /** 是否显示行内启停用开关（false 时不显示；如「学段 / 学科」这类字典节点） */
  toggleable?: boolean
}

/** 某父节点下的子节点，按 `sort` 升序、相同则按原数组顺序（稳定排序） */
export function childrenOf<T extends FlatTreeNode>(nodes: T[], parentId: T['id'] | null): T[] {
  return nodes
    .map((node, index) => ({ node, index }))
    .filter((entry) => entry.node.parentId === parentId)
    .sort((a, b) => (a.node.sort ?? 0) - (b.node.sort ?? 0) || a.index - b.index)
    .map((entry) => entry.node)
}

/** 节点深度（根 = 1）；节点不存在时返回 0 */
export function depthOf<T extends FlatTreeNode>(nodes: T[], id: T['id']): number {
  const index = new Map(nodes.map((node) => [node.id, node]))
  let current = index.get(id)
  const seen = new Set<T['id']>()
  let depth = 1
  while (current?.parentId != null) {
    if (seen.has(current.id)) break
    seen.add(current.id)
    depth += 1
    current = index.get(current.parentId)
  }
  return current ? depth : 0
}

/** candidateId 是否落在 rootId 的子树里（用于阻止把节点拖进自己的后代里） */
export function isDescendant<T extends FlatTreeNode>(nodes: T[], rootId: T['id'], candidateId: T['id']): boolean {
  const index = new Map(nodes.map((node) => [node.id, node]))
  let current = index.get(candidateId)
  const seen = new Set<T['id']>()
  while (current?.parentId != null) {
    if (seen.has(current.id)) return false
    seen.add(current.id)
    if (current.parentId === rootId) return true
    current = index.get(current.parentId)
  }
  return false
}

/** 从根到 id 的名称路径（含自身）；用于弹窗里的「上级路径 / 所属节点」展示 */
export function pathOf<T extends FlatTreeNode>(nodes: T[], id: T['id'] | null): T[] {
  if (id == null) return []
  const index = new Map(nodes.map((node) => [node.id, node]))
  const path: T[] = []
  let current = index.get(id)
  const seen = new Set<T['id']>()
  while (current && !seen.has(current.id)) {
    seen.add(current.id)
    path.unshift(current)
    current = current.parentId == null ? undefined : index.get(current.parentId)
  }
  return path
}

/** 从根到 id 的名称路径字符串（「A > B > C」），空路径返回 '' */
export function pathText<T extends FlatTreeNode>(nodes: T[], id: T['id'] | null, separator = ' > '): string {
  return pathOf(nodes, id)
    .map((node) => node.name)
    .join(separator)
}
