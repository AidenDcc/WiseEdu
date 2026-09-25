<script setup lang="ts">
/**
 * 知识点多选器（题库组卷工作台的试题筛选、知识点组卷共用）。
 *
 * 为什么不复用 `ui/KnowledgeFilter.vue`：那个是题库管理/BankView 与标准公式库的**单选**面板
 * ——固定宽 272px 的 `aside`、只保留一个 activeNode、emit 该子树的 tag 或 null，而且还独占
 * 教材级联并单向绑定顶部栏全局作用域（useScope）。组卷工作台要的是：内联、**任意多选**、
 * 可逐个删的 chip，且页面自带教材级联（全屏页没有顶部栏，绑定 useScope 是错的）。
 * 硬要泛化会把 BankView 与 StandardView 两个现有消费方一起搭进去，仓库既有做法是各页 scoped
 * 复制（见 `question/QuestionResultList.vue` 头部注释），这里沿用。
 *
 * 交互口径：**点节点 = 整棵子树的知识点标签一起选中/取消**。教师是按「三角函数」这个层级
 * 想事情的，让他逐个勾 15 个叶子标签不合理；个别不想要的标签可以在上方 chip 里单独删。
 */
import { computed, ref, watch } from 'vue'
import { AppIcon } from '@aiteach/shared'
import type { OrgKnowledgeNode } from '@aiteach/shared'
import { useKnowledgePool } from '@/composables/useKnowledgePool'

const props = defineProps<{
  modelValue: string[]
  subject: string
  grade?: string
  version?: string
  /** 用于节点计数（传当前题源列表即可）；不传则不显示计数 */
  rows?: Array<{ knowledge: string[] }>
  /** 树区最大高度 */
  maxHeight?: string
  /**
   * 撑满父容器剩余高度（试题页签左栏那种常驻面板用）。**要求父容器是 flex 纵向布局**
   * ——树靠 `flex: 1` 吃掉剩余空间并自行滚动，弹层里不能开（弹层高度由内容决定，
   * 撑满会把树压成一条缝）。
   */
  fill?: boolean
}>()

const emit = defineEmits<{ 'update:modelValue': [tags: string[]] }>()

const { nodes, loading } = useKnowledgePool(() => ({
  grade: props.grade ?? '',
  subject: props.subject,
  version: props.version ?? '',
}))

const query = ref('')
const expanded = ref<Set<string>>(new Set())

const byId = computed(() => new Map(nodes.value.map((node) => [node.id, node] as const)))
const childrenMap = computed(() => {
  const map = new Map<string, OrgKnowledgeNode[]>()
  nodes.value.forEach((node) => {
    if (node.parentId == null) return
    const bucket = map.get(node.parentId) ?? []
    bucket.push(node)
    map.set(node.parentId, bucket)
  })
  return map
})

/** 节点子树的全部知识点标签（叶子 tag；整棵子树无 tag 时退化为节点名） */
function subtreeTags(id: string): string[] {
  const root = byId.value.get(id)
  if (!root) return []
  const tags: string[] = []
  const stack = [root]
  while (stack.length) {
    const node = stack.pop()!
    if (node.tag) tags.push(node.tag)
    childrenMap.value.get(node.id)?.forEach((child) => stack.push(child))
  }
  return tags.length > 0 ? tags : [root.name]
}

const selected = computed(() => new Set(props.modelValue))

/** 节点三态：整棵子树都已选 / 部分已选 / 未选 */
function nodeState(id: string): 'on' | 'part' | 'off' {
  const tags = subtreeTags(id)
  if (!tags.length) return 'off'
  const hit = tags.filter((tag) => selected.value.has(tag)).length
  if (hit === 0) return 'off'
  return hit === tags.length ? 'on' : 'part'
}

function countOf(id: string): number | null {
  if (!props.rows) return null
  const tags = subtreeTags(id)
  return props.rows.filter((row) => row.knowledge.some((tag) => tags.includes(tag))).length
}

function toggleNode(id: string) {
  const tags = subtreeTags(id)
  if (!tags.length) return
  const next = new Set(props.modelValue)
  if (nodeState(id) === 'on') tags.forEach((tag) => next.delete(tag))
  else tags.forEach((tag) => next.add(tag))
  emit('update:modelValue', [...next])
}

function removeTag(tag: string) {
  emit('update:modelValue', props.modelValue.filter((row) => row !== tag))
}

function clearAll() {
  emit('update:modelValue', [])
}

function toggleExpand(id: string) {
  const next = new Set(expanded.value)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  expanded.value = next
}

const searchMode = computed(() => query.value.trim().length > 0)
const hitIds = computed(() => {
  const keyword = query.value.trim()
  if (!keyword) return new Set<string>()
  return new Set(
    nodes.value
      .filter((node) => node.name.includes(keyword) || (node.tag ?? '').includes(keyword))
      .map((node) => node.id),
  )
})
/** 搜索时保留命中节点及其祖先链，其余折叠掉 */
const visibleIds = computed(() => {
  if (!searchMode.value) return null
  const keep = new Set<string>()
  hitIds.value.forEach((id) => {
    let current = byId.value.get(id)
    while (current) {
      keep.add(current.id)
      current = current.parentId == null ? undefined : byId.value.get(current.parentId)
    }
  })
  return keep
})

interface TreeRow {
  node: OrgKnowledgeNode
  depth: number
  hasChildren: boolean
  open: boolean
  hit: boolean
}

const treeRows = computed<TreeRow[]>(() => {
  const rows: TreeRow[] = []
  const walk = (parentId: string | null, depth: number) => {
    const children =
      parentId == null
        ? nodes.value.filter((node) => node.parentId == null)
        : childrenMap.value.get(parentId) ?? []
    children.forEach((node) => {
      if (searchMode.value && visibleIds.value && !visibleIds.value.has(node.id)) return
      const hasChildren = (childrenMap.value.get(node.id) ?? []).length > 0
      const open = searchMode.value || expanded.value.has(node.id)
      rows.push({ node, depth, hasChildren, open, hit: hitIds.value.has(node.id) })
      if (open) walk(node.id, depth + 1)
    })
  }
  walk(null, 0)
  return rows
})

/* 学科/版本变了，旧展开状态与选中标签都对应不上新树了 */
watch(
  () => `${props.grade ?? ''}|${props.subject}|${props.version ?? ''}`,
  () => {
    query.value = ''
    expanded.value = new Set(nodes.value.filter((node) => node.parentId == null).map((node) => node.id))
    if (props.modelValue.length) emit('update:modelValue', [])
  },
)

/* 首次加载完成后展开所有根节点 */
watch(nodes, (list) => {
  if (expanded.value.size === 0 && list.length) {
    expanded.value = new Set(list.filter((node) => node.parentId == null).map((node) => node.id))
  }
})

const treeStyle = computed(() => (props.fill ? undefined : { maxHeight: props.maxHeight ?? '300px' }))
</script>

<template>
  <div class="kp-picker" :class="{ fill }">
    <!-- 已选知识点：可逐个删除 -->
    <div v-if="modelValue.length" class="kp-selected">
      <span class="kp-selected-label">已选 {{ modelValue.length }} 个知识点</span>
      <button v-for="tag in modelValue" :key="tag" class="kp-chip" type="button" @click="removeTag(tag)">
        {{ tag }}
        <AppIcon name="close" :size="11" />
      </button>
      <button class="kp-clear-all" type="button" @click="clearAll">清空</button>
    </div>

    <div class="kp-search">
      <AppIcon name="search" :size="14" />
      <input v-model="query" placeholder="搜索知识点" />
      <button v-if="query" class="kp-search-clear" type="button" @click="query = ''">
        <AppIcon name="close" :size="12" />
      </button>
    </div>

    <div class="kp-tree" :style="treeStyle">
      <p v-if="loading" class="kp-empty">正在加载知识点…</p>
      <p v-else-if="!subject" class="kp-empty">请先选择学科</p>
      <p v-else-if="treeRows.length === 0" class="kp-empty">未找到匹配的知识点</p>
      <template v-else>
        <div
          v-for="row in treeRows"
          :key="row.node.id"
          class="kp-item"
          :class="[`state-${nodeState(row.node.id)}`, { hit: row.hit }]"
          :style="{ paddingLeft: `${6 + row.depth * 15}px` }"
          @click="toggleNode(row.node.id)"
        >
          <button
            v-if="row.hasChildren"
            class="kp-caret"
            :class="{ open: row.open }"
            type="button"
            @click.stop="toggleExpand(row.node.id)"
          >
            <AppIcon name="chevron-right" :size="12" />
          </button>
          <span v-else class="kp-dot" />
          <span class="kp-check" :class="`s-${nodeState(row.node.id)}`">
            <AppIcon v-if="nodeState(row.node.id) === 'on'" name="check" :size="10" />
            <span v-else-if="nodeState(row.node.id) === 'part'" class="kp-dash" />
          </span>
          <span class="kp-name">{{ row.node.name }}</span>
          <span v-if="countOf(row.node.id) !== null" class="kp-count">{{ countOf(row.node.id) }}</span>
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.kp-picker { display: flex; flex-direction: column; gap: 8px; }

/* 常驻面板模式：树吃掉剩余高度、自身滚动；已选 chip 过多时自身滚动，别把树挤没 */
.kp-picker.fill { flex: 1; min-height: 0; }
.kp-picker.fill .kp-tree { flex: 1; min-height: 0; }
.kp-picker.fill .kp-selected { max-height: 84px; overflow-y: auto; }

.kp-selected { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.kp-selected-label { font-size: 11.5px; color: var(--sub); font-weight: 600; }
.kp-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: 1px solid var(--brand);
  border-radius: 999px;
  background: var(--brand-soft);
  color: var(--brand-deep);
  font-size: 12px;
  font-weight: 600;
  padding: 2px 9px;
  transition: background 0.12s;
}
.kp-chip:hover { background: #fff; }
.kp-clear-all {
  border: none;
  background: none;
  color: var(--sub);
  font-size: 11.5px;
  text-decoration: underline;
  padding: 0 2px;
}
.kp-clear-all:hover { color: var(--danger); }

.kp-search {
  display: flex;
  align-items: center;
  gap: 6px;
  border: 1.5px solid var(--border);
  border-radius: 9px;
  background: #fff;
  padding: 0 9px;
  height: 32px;
}
.kp-search:focus-within { border-color: var(--brand); }
.kp-search > :first-child { color: var(--sub); flex-shrink: 0; }
.kp-search input { flex: 1; min-width: 0; border: none; outline: none; font-size: 12.5px; background: transparent; }
.kp-search-clear { display: flex; color: var(--sub); }

.kp-tree {
  display: flex;
  flex-direction: column;
  gap: 1px;
  overflow-y: auto;
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 5px;
  background: #fcfdfe;
}
.kp-item {
  display: flex;
  align-items: center;
  gap: 6px;
  border-radius: 7px;
  padding: 6px 8px;
  font-size: 12.5px;
  color: var(--ink);
  cursor: pointer;
  user-select: none;
  transition: background 0.12s;
}
.kp-item:hover { background: #eef5f4; }
.kp-item.state-on { background: var(--brand-soft); color: var(--brand-deep); font-weight: 600; }
.kp-item.state-part { color: var(--brand-deep); }
.kp-item.hit .kp-name { font-weight: 700; }

.kp-caret {
  display: flex;
  flex-shrink: 0;
  appearance: none;
  border: none;
  background: none;
  padding: 0;
  color: var(--sub);
  transition: transform 0.18s;
}
.kp-caret.open { transform: rotate(90deg); }
.kp-dot { width: 4px; height: 4px; border-radius: 50%; background: var(--border); flex-shrink: 0; margin: 0 4px; }

/* 勾选框：三态（未选 / 部分 / 全选），部分态显示短横 */
.kp-check {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
  border: 1.5px solid var(--border);
  border-radius: 4px;
  background: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
}
.kp-check.s-on { background: var(--brand); border-color: var(--brand); }
.kp-check.s-part { background: var(--brand-soft); border-color: var(--brand); }
.kp-dash { width: 7px; height: 1.5px; background: var(--brand); border-radius: 1px; }

.kp-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.kp-count { font-size: 11px; color: var(--sub); flex-shrink: 0; }
.kp-item.state-on .kp-count { color: var(--brand-deep); }
.kp-empty { font-size: 12.5px; color: var(--sub); text-align: center; padding: 22px 0; }
</style>
