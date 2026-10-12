<script setup lang="ts" generic="T extends FlatTreeNode">
/**
 * 通用树组件（知识点树 / 考试类型树 / 教材目录树三处共用）。
 *
 * 版式固定：左上角搜索框，右上角「展开 / 收起」，可选「新增根节点」；下方是树体。
 *
 * 树体统一支持：拖拽移动（before / inside / after 三种落点）、启用 / 停用、
 * 添加子节点、上移 / 下移、编辑、删除 —— 通过 `show*` 开关与 `rowConfig` 决定
 * 某个场景展示哪些按钮（如教材目录只留拖拽、考试类型的分类根不可编辑 / 拖拽）。
 *
 * 「启用 / 停用」用**文字按钮**（不用滑块）：已启用显示「停用」，已停用显示「启用」，
 * 排在「删除」之前 —— 与 编辑 / 删除 同一套 mini-btn 样式，扫一眼就知道能做什么。
 *
 * 行内操作有两种形态（`iconActions`）：文字按钮（知识点树 / 考试类型树，动作字面量清晰）
 * 或图标按钮（教材目录树，一行动作多、字面量会把行撑爆）。图标形态靠 `title` 悬浮提示兜底。
 *
 * 另外两个可选扩展位，都是给教材目录树用的：
 * - `showAttach`：名称右侧多一个「关联知识点」图标按钮（emit `attach`）；
 * - `rowNote`：名称之后的省略附注（章节关联的知识点），超出宽度打省略号，
 *   悬浮看全文靠原生 `title`。
 *
 * 受控组件：只读取 `nodes`，一切数据变更都 emit 给宿主（宿主自己调 API 或改本地数据）。
 * 内部仅持有视图态（搜索词、折叠集合、拖拽状态）。
 */
import { computed, ref } from 'vue'
import { AppIcon, AppListToolbar, AppSearchInput, showToast } from '@aiteach/shared'
import type { FlatTreeNode, TreeRowConfig, TreeTag } from './tree-utils'
import { childrenOf, depthOf, isDescendant } from './tree-utils'

const props = withDefaults(
  defineProps<{
    nodes: T[]
    /** 层级上限（超出后不能加子节点、不能拖入） */
    maxDepth?: number
    searchPlaceholder?: string
    emptyText?: string
    loading?: boolean
    /** 右上角「新增根节点」按钮文案；传空串则不显示该按钮 */
    rootLabel?: string
    /** 是否显示右上角「展开 / 收起」 */
    showExpandCollapse?: boolean
    /** 行内操作总开关 */
    showToggle?: boolean
    showAddChild?: boolean
    /** 上移 / 下移按钮（拖拽不受它控制） */
    showMove?: boolean
    showEdit?: boolean
    showRemove?: boolean
    /** 拖拽总开关 */
    draggable?: boolean
    /** 是否允许拖到根层级（parentId = null） */
    allowRootLevel?: boolean
    /** 缩进像素 */
    indent?: number
    /** 行标签补充（排在「第 N 级 / 已停用」之前） */
    rowTags?: (node: T, depth: number) => TreeTag[]
    /**
     * 名称之后的一段附注（教材目录：该章节关联的知识点）。
     * 返回 null 则该行不显示；`title` 用于鼠标悬浮查看全文（省略号看不全时）。
     */
    rowNote?: (node: T, depth: number) => { text: string; title: string } | null
    /** 行内操作渲染成图标按钮（配 `title` 悬浮提示）；默认 false = 文字按钮 */
    iconActions?: boolean
    /** 名称右侧的「关联」动作（教材目录 → 关联知识点） */
    showAttach?: boolean
    attachIcon?: string
    attachTitle?: string
    /** 单行能力（如分类根不可编辑 / 不可拖拽） */
    rowConfig?: (node: T, depth: number) => TreeRowConfig
    /** 是否允许点击行选中（配合 `activeId` 高亮）—— 仅左侧导航型树需要，默认关 */
    selectable?: boolean
    /** 当前选中行的 id（`selectable` 为真时生效） */
    activeId?: NodeId | null
  }>(),
  {
    maxDepth: 5,
    searchPlaceholder: '搜索名称，自动定位高亮',
    emptyText: '暂无节点，可新增根节点',
    loading: false,
    rootLabel: '新增根节点',
    showExpandCollapse: true,
    showToggle: true,
    showAddChild: true,
    showMove: false,
    showEdit: true,
    showRemove: true,
    draggable: true,
    allowRootLevel: true,
    indent: 18,
    selectable: false,
    activeId: null,
    rowNote: undefined,
    iconActions: false,
    showAttach: false,
    attachIcon: 'branch',
    attachTitle: '关联知识点',
  },
)

const emit = defineEmits<{
  'create-root': []
  'add-child': [node: T]
  edit: [node: T]
  remove: [node: T]
  toggle: [node: T]
  attach: [node: T]
  select: [node: T]
  move: [payload: { id: T['id']; parentId: T['id'] | null; beforeId: T['id'] | null }]
  'move-by': [payload: { node: T; direction: -1 | 1 }]
}>()

type DropPosition = 'before' | 'inside' | 'after'
/** 视图态里的 id 统一按 `string | number` 存：`ref` 会对 `T['id']` 做解包，
 *  导致 `Set<T['id']>` / `Array<T['id']>` 的类型表达式对不上（UnwrapRefSimple） */
type NodeId = string | number

const keyword = ref('')
const collapsedIds = ref<NodeId[]>([])
const draggingId = ref<NodeId | null>(null)
const dropTarget = ref<{ id: NodeId; position: DropPosition } | null>(null)

function expandAll() {
  collapsedIds.value = []
}
function collapseAll() {
  collapsedIds.value = props.nodes.map((node) => node.id)
}
function toggleCollapse(id: NodeId) {
  const index = collapsedIds.value.indexOf(id)
  if (index >= 0) collapsedIds.value.splice(index, 1)
  else collapsedIds.value.push(id)
}

/** 搜索命中集合（含命中节点的祖先链）——仅用于「自动展开 + 高亮」，不过滤 */
const matchedIds = computed<Set<NodeId>>(() => {
  const set = new Set<NodeId>()
  const kw = keyword.value.trim()
  if (!kw) return set
  const index = new Map<NodeId, T>(props.nodes.map((node) => [node.id, node]))
  props.nodes.forEach((node) => {
    if (!node.name.includes(kw)) return
    let current: T | undefined = node
    const seen = new Set<NodeId>()
    while (current && !seen.has(current.id)) {
      seen.add(current.id)
      set.add(current.id)
      current = current.parentId == null ? undefined : index.get(current.parentId)
    }
  })
  return set
})

function configOf(node: T, depth: number): Required<TreeRowConfig> {
  const raw = props.rowConfig?.(node, depth) ?? {}
  return {
    editable: raw.editable !== false,
    addable: raw.addable !== false,
    draggable: raw.draggable !== false,
    toggleable: raw.toggleable !== false,
  }
}

/** 行内动作：文字 / 图标两种形态共用一份清单，模板只负责按形态渲染 */
interface RowAction {
  key: 'attach' | 'add-child' | 'move-up' | 'move-down' | 'edit' | 'toggle' | 'remove'
  icon: string
  label: string
  /** 删除用红色，其余为主色 */
  danger?: boolean
  disabled?: boolean
}

interface TreeRow {
  node: T
  depth: number
  hasChildren: boolean
  /** 当前是否处于展开态（供箭头旋转）。搜索命中路径会被强制展开，这里一并反映 */
  expanded: boolean
  cfg: Required<TreeRowConfig>
  tags: TreeTag[]
  note: { text: string; title: string } | null
  actions: RowAction[]
}

/** 动作清单：顺序即渲染顺序（关联 → 加子节点 → 上移 / 下移 → 编辑 → 停用/启用 → 删除） */
function actionsOf(node: T, depth: number, cfg: Required<TreeRowConfig>): RowAction[] {
  const list: RowAction[] = []
  if (props.showAttach) list.push({ key: 'attach', icon: props.attachIcon, label: props.attachTitle })
  if (props.showAddChild && cfg.addable) {
    list.push({ key: 'add-child', icon: 'plus', label: '加子节点', disabled: depth + 1 >= props.maxDepth })
  }
  if (props.showMove) {
    list.push({ key: 'move-up', icon: 'chevron-up', label: '上移', disabled: !canMove(node, -1) })
    list.push({ key: 'move-down', icon: 'chevron-down', label: '下移', disabled: !canMove(node, 1) })
  }
  if (cfg.editable && props.showEdit) list.push({ key: 'edit', icon: 'edit', label: '编辑' })
  /* 停用 / 启用：按当前状态显示相反动作，排在删除之前 */
  if (props.showToggle && cfg.toggleable) {
    list.push({ key: 'toggle', icon: 'power', label: node.enabled ? '停用' : '启用' })
  }
  if (cfg.editable && props.showRemove) list.push({ key: 'remove', icon: 'trash', label: '删除', danger: true })
  return list
}

function emitAction(key: RowAction['key'], row: TreeRow) {
  if (key === 'attach') emit('attach', row.node)
  else if (key === 'add-child') emit('add-child', row.node)
  else if (key === 'edit') emit('edit', row.node)
  else if (key === 'toggle') emit('toggle', row.node)
  else if (key === 'remove') emit('remove', row.node)
  else emit('move-by', { node: row.node, direction: key === 'move-up' ? -1 : 1 })
}

/** 展平为带缩进的行：祖先全部展开才可见；搜索时自动展开命中路径 */
const rows = computed<TreeRow[]>(() => {
  const kw = keyword.value.trim()
  const result: TreeRow[] = []
  const walk = (parentId: T['id'] | null, depth: number, hidden: boolean, seen: Set<T['id']>) => {
    for (const node of childrenOf(props.nodes, parentId)) {
      if (seen.has(node.id)) continue
      const nextSeen = new Set(seen)
      nextSeen.add(node.id)
      const collapsed = collapsedIds.value.includes(node.id) && !(kw && matchedIds.value.has(node.id))
      const visible = !hidden || (kw && matchedIds.value.has(node.id))
      if (visible) {
        const tags: TreeTag[] = [...(props.rowTags?.(node, depth) ?? [])]
        if (depth + 1 >= props.maxDepth) tags.push({ text: `第 ${depth + 1} 级`, tone: 'orange' })
        if (!node.enabled) tags.push({ text: '已停用', tone: 'red' })
        const cfg = configOf(node, depth)
        result.push({
          node,
          depth,
          hasChildren: childrenOf(props.nodes, node.id).length > 0,
          expanded: !collapsed,
          cfg,
          tags,
          note: props.rowNote?.(node, depth) ?? null,
          actions: actionsOf(node, depth, cfg),
        })
      }
      walk(node.id, depth + 1, kw ? false : hidden || collapsed, nextSeen)
    }
  }
  walk(null, 0, false, new Set())
  return result
})

function canMove(node: T, direction: -1 | 1): boolean {
  if (keyword.value.trim()) return false
  const list = childrenOf(props.nodes, node.parentId)
  const index = list.findIndex((item) => item.id === node.id)
  return index >= 0 && index + direction >= 0 && index + direction < list.length
}

/* ===== 拖拽 ===== */
function onDragStart(event: DragEvent, row: TreeRow) {
  if (!props.draggable || !row.cfg.draggable || keyword.value.trim()) {
    event.preventDefault()
    return
  }
  draggingId.value = row.node.id
  event.dataTransfer?.setData('text/plain', String(row.node.id))
  if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move'
}
function onDragEnd() {
  draggingId.value = null
  dropTarget.value = null
}
function onDragOver(event: DragEvent, target: T) {
  if (draggingId.value == null || draggingId.value === target.id || keyword.value.trim()) return
  const source = props.nodes.find((node) => node.id === draggingId.value)
  /* 落在自己当前的父节点行上没有意义（位置不变），直接忽略 */
  if (!source || target.id === source.parentId) return
  if (isDescendant(props.nodes, source.id, target.id)) return
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  const ratio = (event.clientY - rect.top) / rect.height
  const position: DropPosition = ratio < 0.25 ? 'before' : ratio > 0.75 ? 'after' : 'inside'
  const parentId = position === 'inside' ? target.id : target.parentId
  if (parentId == null && !props.allowRootLevel) return
  event.preventDefault()
  dropTarget.value = { id: target.id, position }
}
function onDrop(event: DragEvent) {
  event.preventDefault()
  const drop = dropTarget.value
  const source = draggingId.value == null ? null : props.nodes.find((node) => node.id === draggingId.value)
  const target = drop ? props.nodes.find((node) => node.id === drop.id) : null
  onDragEnd()
  if (!source || !target || !drop || source.id === target.id) return
  if (isDescendant(props.nodes, source.id, target.id)) return
  if (drop.position === 'inside' && depthOf(props.nodes, target.id) >= props.maxDepth) {
    showToast(`最多 ${props.maxDepth} 级，无法再放入子节点`, 'error')
    return
  }
  const parentId = drop.position === 'inside' ? target.id : target.parentId
  if (parentId == null && !props.allowRootLevel) return
  const siblings = childrenOf(props.nodes, parentId).filter((item) => item.id !== source.id)
  let beforeId: T['id'] | null = null
  if (drop.position === 'before') beforeId = target.id
  else if (drop.position === 'after') beforeId = siblings[siblings.findIndex((item) => item.id === target.id) + 1]?.id ?? null
  emit('move', { id: source.id, parentId, beforeId })
}
</script>

<template>
  <div class="app-tree">
    <AppListToolbar :searchable="false">
      <template #left>
        <AppSearchInput v-model="keyword" :placeholder="searchPlaceholder" :width="240" />
      </template>
      <template #right>
        <template v-if="showExpandCollapse">
          <button class="btn btn-ghost btn-sm" type="button" @click="expandAll">展开</button>
          <button class="btn btn-ghost btn-sm" type="button" @click="collapseAll">收起</button>
        </template>
        <button v-if="rootLabel" class="btn btn-primary btn-sm" type="button" @click="emit('create-root')">
          <AppIcon name="plus" :size="15" /> {{ rootLabel }}
        </button>
      </template>
    </AppListToolbar>

    <div class="tree-body">
      <div v-if="loading" class="tree-empty">加载中…</div>
      <div v-else-if="rows.length === 0" class="tree-empty">{{ emptyText }}</div>
      <template v-else>
        <div
          v-for="row in rows"
          :key="row.node.id"
          class="tree-row"
          :class="{
            disabled: !row.node.enabled,
            hit: keyword.trim() !== '' && row.node.name.includes(keyword.trim()),
            dragging: draggingId === row.node.id,
            selected: selectable && activeId != null && row.node.id === activeId,
            'is-selectable': selectable,
            'drop-before': dropTarget?.id === row.node.id && dropTarget.position === 'before',
            'drop-after': dropTarget?.id === row.node.id && dropTarget.position === 'after',
            'drop-inside': dropTarget?.id === row.node.id && dropTarget.position === 'inside',
          }"
          :style="{ paddingLeft: `${12 + row.depth * indent}px` }"
          @click="selectable && emit('select', row.node)"
          @dragover="onDragOver($event, row.node)"
          @drop="onDrop"
        >
          <button
            class="drag-handle"
            :class="{ invisible: !draggable || !row.cfg.draggable }"
            type="button"
            :draggable="draggable && row.cfg.draggable && !keyword.trim()"
            title="拖拽移动"
            @click.stop
            @dragstart="onDragStart($event, row)"
            @dragend="onDragEnd"
          >⠿</button>
          <button
            class="chev-btn"
            :class="{ invisible: !row.hasChildren, expanded: row.expanded }"
            type="button"
            :title="row.expanded ? '收起' : '展开'"
            @click.stop="toggleCollapse(row.node.id)"
          >
            <AppIcon name="chevron-right" :size="14" />
          </button>
          <span class="node-name">{{ row.node.name }}</span>
          <!-- 名称后的附注（教材目录：关联的知识点）；超出省略，悬浮看全文 -->
          <span v-if="row.note" class="node-note" :title="row.note.title">{{ row.note.text }}</span>
          <span v-for="(tag, tagIndex) in row.tags" :key="`${tagIndex}-${tag.text}`" class="tag" :class="`tag-${tag.tone ?? 'gray'}`">{{ tag.text }}</span>

          <div class="row-ops" @click.stop>
            <button
              v-for="action in row.actions"
              :key="action.key"
              :class="[iconActions ? 'op-icon' : 'mini-btn', action.danger && 'danger']"
              type="button"
              :title="iconActions ? action.label : undefined"
              :disabled="action.disabled"
              @click="emitAction(action.key, row)"
            >
              <AppIcon v-if="iconActions" :name="action.icon" :size="15" />
              <template v-else>{{ action.label }}</template>
            </button>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
/* 占满宿主可用高度：宿主要么是 flex 列容器（面板），要么带 flexBody 的抽屉 */
.app-tree {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}
.tree-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 8px 10px 12px;
}
.tree-empty {
  text-align: center;
  color: var(--sub);
  font-size: 13px;
  padding: 40px 0;
}
/* 固定行高：hover 露出操作按钮 / 选中高亮时都不会改变行高（此前用 display 切换
   会让行随按钮高度撑高，鼠标扫过整棵树会「跳动」） */
.tree-row {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  height: 38px;
  padding-right: 12px;
  border-radius: 10px;
  font-size: 13.5px;
  color: var(--ink);
  transition: background 0.15s;
}
.tree-row:hover { background: #f7f9fd; }
.tree-row.disabled .node-name { color: var(--sub); text-decoration: line-through; }
.tree-row.is-selectable { cursor: pointer; }
.tree-row.hit,
.tree-row.selected,
.tree-row.drop-inside { background: var(--brand-soft); }
.tree-row.selected .node-name { color: var(--brand-deep); font-weight: 600; }
.tree-row.drop-before::before,
.tree-row.drop-after::after {
  content: '';
  position: absolute;
  left: 10px;
  right: 10px;
  height: 2px;
  background: var(--brand);
}
.tree-row.drop-before::before { top: -1px; }
.tree-row.drop-after::after { bottom: -1px; }
/* 拖拽手柄只在悬浮 / 聚焦 / 正在拖拽时露出；用 opacity 而非 display，避免出现时横向跳动 */
.drag-handle {
  border: 0;
  background: transparent;
  color: var(--sub);
  cursor: grab;
  padding: 0 2px;
  font-size: 16px;
  opacity: 0;
  transition: opacity 0.15s;
}
.tree-row:hover .drag-handle,
.tree-row.dragging .drag-handle,
.drag-handle:focus-visible { opacity: 1; }
.drag-handle.invisible { visibility: hidden; }
.chev-btn {
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--sub);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: background 0.15s;
}
.chev-btn:hover { background: #e8ecf4; }
.chev-btn.invisible { visibility: hidden; }
/* 展开态让箭头指向下方（收起 = 指向右侧）。此前只有图标、没有旋转，
   展开 / 收起时箭头始终朝右，看不出这行到底是开是合 */
.chev-btn svg { transition: transform 0.16s; }
.chev-btn.expanded svg { transform: rotate(90deg); }
.node-name { font-weight: 500; flex-shrink: 0; }
/* 名称后的附注（章节关联的知识点）：限宽 + 省略号，全文靠原生 title 悬浮查看。
   限宽是为了「悬浮露出操作按钮时不再改宽」——否则鼠标扫过整棵目录，附注会跟着伸缩跳动 */
.node-note {
  flex: 0 1 auto;
  min-width: 0;
  max-width: 420px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12.5px;
  color: var(--sub);
}
.row-ops {
  margin-left: auto;
  display: none;
  align-items: center;
  gap: 2px;
}
.tree-row:hover .row-ops { display: inline-flex; }
.row-ops button:disabled { opacity: 0.4; cursor: not-allowed; }

/* 图标形态的行内操作（教材目录）：一行动作多，用图标 + title 提示 */
.op-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  flex-shrink: 0;
  border: none;
  border-radius: 7px;
  background: transparent;
  padding: 0;
  color: var(--brand);
  transition: background 0.15s, color 0.15s;
}
.op-icon:hover { background: var(--brand-soft); }
.op-icon.danger { color: var(--danger); }
.op-icon.danger:hover { background: var(--danger-soft); }
.op-icon:disabled { color: #c3cad8; background: transparent; }
</style>
