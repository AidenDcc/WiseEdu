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
 * 受控组件：只读取 `nodes`，一切数据变更都 emit 给宿主（宿主自己调 API 或改本地数据）。
 * 内部仅持有视图态（搜索词、折叠集合、拖拽状态）。
 */
import { computed, ref } from 'vue'
import { AppIcon, AppListToolbar, AppSearchInput, showToast } from '@aiteach/shared'
import AppSwitch from '@/components/ui/AppSwitch.vue'
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
    /** 单行能力（如分类根不可编辑 / 不可拖拽） */
    rowConfig?: (node: T, depth: number) => TreeRowConfig
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
  },
)

const emit = defineEmits<{
  'create-root': []
  'add-child': [node: T]
  edit: [node: T]
  remove: [node: T]
  toggle: [node: T]
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
  }
}

interface TreeRow {
  node: T
  depth: number
  hasChildren: boolean
  cfg: Required<TreeRowConfig>
  tags: TreeTag[]
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
        result.push({ node, depth, hasChildren: childrenOf(props.nodes, node.id).length > 0, cfg: configOf(node, depth), tags })
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
            'drop-before': dropTarget?.id === row.node.id && dropTarget.position === 'before',
            'drop-after': dropTarget?.id === row.node.id && dropTarget.position === 'after',
            'drop-inside': dropTarget?.id === row.node.id && dropTarget.position === 'inside',
          }"
          :style="{ paddingLeft: `${12 + row.depth * indent}px` }"
          @dragover="onDragOver($event, row.node)"
          @drop="onDrop"
        >
          <button
            class="drag-handle"
            :class="{ invisible: !draggable || !row.cfg.draggable }"
            type="button"
            :draggable="draggable && row.cfg.draggable && !keyword.trim()"
            title="拖拽移动"
            @dragstart="onDragStart($event, row)"
            @dragend="onDragEnd"
          >⠿</button>
          <button class="chev-btn" :class="{ invisible: !row.hasChildren }" type="button" @click="toggleCollapse(row.node.id)">
            <AppIcon name="chevron-right" :size="14" />
          </button>
          <span class="node-name">{{ row.node.name }}</span>
          <span v-for="(tag, tagIndex) in row.tags" :key="`${tagIndex}-${tag.text}`" class="tag" :class="`tag-${tag.tone ?? 'gray'}`">{{ tag.text }}</span>

          <div class="row-ops">
            <AppSwitch v-if="showToggle" :model-value="row.node.enabled" @update:model-value="emit('toggle', row.node)" />
            <button
              v-if="showAddChild && row.cfg.addable"
              class="mini-btn"
              type="button"
              :disabled="row.depth + 1 >= maxDepth"
              @click="emit('add-child', row.node)"
            >加子节点</button>
            <template v-if="showMove">
              <button class="mini-btn" type="button" :disabled="!canMove(row.node, -1)" @click="emit('move-by', { node: row.node, direction: -1 })">上移</button>
              <button class="mini-btn" type="button" :disabled="!canMove(row.node, 1)" @click="emit('move-by', { node: row.node, direction: 1 })">下移</button>
            </template>
            <template v-if="row.cfg.editable">
              <button v-if="showEdit" class="mini-btn" type="button" @click="emit('edit', row.node)">编辑</button>
              <button v-if="showRemove" class="mini-btn danger" type="button" @click="emit('remove', row.node)">删除</button>
            </template>
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
.tree-row.hit,
.tree-row.drop-inside { background: var(--brand-soft); }
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
.node-name { font-weight: 500; }
.row-ops {
  margin-left: auto;
  display: none;
  align-items: center;
  gap: 2px;
}
.tree-row:hover .row-ops { display: inline-flex; }
.row-ops button:disabled { opacity: 0.4; cursor: not-allowed; }
</style>
