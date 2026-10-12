<script setup lang="ts">
/**
 * 教材目录「关联知识点」选择弹窗。
 *
 * 交互对齐机构端录题中心的知识点弹窗（`KnowledgePickerModal`）：树 + 已选 chip +
 * **先选后确认**（草稿态由 `v-if` 挂载保证，取消即丢弃）。三处差异：
 * - 数据源是**平台知识点树**（`/admin/knowledge`），按当前教材版本的学段 / 学科取一棵树；
 * - 选择粒度是**节点本身**（存 id + 名称快照），因此**任意层级都能选**，父节点选中
 *   也不会连带子节点 —— 与机构端「勾分类节点 = 勾整棵子树」的口径不同；
 * - 上限 `MAX_CATALOG_KNOWLEDGE`（6 个），与 mock 侧 `saveTextbookCatalog` 的归一逻辑同一口径。
 *
 * 停用的知识点仍展示（否则已关联的旧节点会凭空消失），但不可勾选（虚线灰框）。
 */
import { computed, ref } from 'vue'
import { AppIcon, AppModal, MAX_CATALOG_KNOWLEDGE, showToast } from '@aiteach/shared'
import type { CatalogKnowledge, KnowledgeNode } from '@aiteach/shared'
import { fetchKnowledge } from '@/api/platform'

const props = withDefaults(
  defineProps<{
    /** 已关联的知识点：打开时作为草稿的起点 */
    modelValue: CatalogKnowledge[]
    /** 当前教材版本的学段 / 学科（决定加载哪棵树） */
    stage: string
    subject: string
    /** 最多可选个数 */
    max?: number
    title?: string
  }>(),
  { max: MAX_CATALOG_KNOWLEDGE, title: '关联知识点' },
)

const emit = defineEmits<{ close: []; confirm: [list: CatalogKnowledge[]] }>()

const nodes = ref<KnowledgeNode[]>([])
const loading = ref(true)
/** 草稿：确认前的一切改动都在这里，取消不 emit 即丢弃 */
const draft = ref<CatalogKnowledge[]>([...props.modelValue])
const query = ref('')
const expanded = ref<number[]>([])

const scopeText = computed(() => [props.stage, props.subject].filter(Boolean).join(' / ') || '未指定教材')

const scopeNodes = computed(() =>
  nodes.value.filter((node) => node.stage === props.stage && node.subject === props.subject),
)
const byId = computed(() => new Map(scopeNodes.value.map((node) => [node.id, node] as const)))
const childrenMap = computed(() => {
  const map = new Map<number, KnowledgeNode[]>()
  scopeNodes.value.forEach((node) => {
    if (node.parentId == null) return
    const bucket = map.get(node.parentId) ?? []
    bucket.push(node)
    map.set(node.parentId, bucket)
  })
  return map
})

const selectedIds = computed(() => new Set(draft.value.map((item) => item.id)))

function isSelected(id: number) {
  return selectedIds.value.has(id)
}
/** 停用节点不可勾选（点它只展开），避免把已经下线的知识点挂到章节上 */
function selectable(node: KnowledgeNode) {
  return node.enabled
}

function toggleSelect(node: KnowledgeNode) {
  if (!selectable(node)) {
    toggleExpand(node.id)
    return
  }
  const next = [...draft.value]
  const index = next.findIndex((item) => item.id === node.id)
  if (index >= 0) next.splice(index, 1)
  else {
    if (next.length >= props.max) {
      showToast(`最多关联 ${props.max} 个知识点`, 'error')
      return
    }
    next.push({ id: node.id, name: node.name })
  }
  draft.value = next
}

function removeOne(id: number) {
  draft.value = draft.value.filter((item) => item.id !== id)
}
function clearAll() {
  draft.value = []
}

function toggleExpand(id: number) {
  const next = [...expanded.value]
  const index = next.indexOf(id)
  if (index >= 0) next.splice(index, 1)
  else next.push(id)
  expanded.value = next
}

/* ===== 搜索：命中节点 + 祖先链保留并自动展开（与机构端同口径，只加粗不变色） ===== */
const searchMode = computed(() => query.value.trim().length > 0)
const hitIds = computed(() => {
  const keyword = query.value.trim()
  if (!keyword) return new Set<number>()
  return new Set(scopeNodes.value.filter((node) => node.name.includes(keyword)).map((node) => node.id))
})
const visibleIds = computed(() => {
  if (!searchMode.value) return null
  const keep = new Set<number>()
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
  node: KnowledgeNode
  depth: number
  hasChildren: boolean
  open: boolean
  hit: boolean
}

const rows = computed<TreeRow[]>(() => {
  const result: TreeRow[] = []
  const walk = (parentId: number | null, depth: number) => {
    const children = parentId == null
      ? scopeNodes.value.filter((node) => node.parentId == null)
      : childrenMap.value.get(parentId) ?? []
    children.forEach((node) => {
      if (searchMode.value && visibleIds.value && !visibleIds.value.has(node.id)) return
      const hasChildren = (childrenMap.value.get(node.id) ?? []).length > 0
      const open = searchMode.value || expanded.value.includes(node.id)
      result.push({ node, depth, hasChildren, open, hit: hitIds.value.has(node.id) })
      if (open) walk(node.id, depth + 1)
    })
  }
  walk(null, 0)
  return result
})

fetchKnowledge()
  .then((list) => {
    nodes.value = list
    /* 首屏展开一层，让用户看到「有东西」，而不是一个折叠的根 */
    expanded.value = list.filter((node) => node.parentId == null && node.stage === props.stage && node.subject === props.subject).map((node) => node.id)
  })
  .finally(() => { loading.value = false })
</script>

<template>
  <AppModal :title="title" :width="720" @close="emit('close')">
    <p class="ck-scope">
      <span class="ck-scope-label">当前教材</span>
      {{ scopeText }}
      <span class="ck-scope-tip">最多关联 {{ max }} 个，任意层级均可选</span>
    </p>

    <!-- 已选知识点：可逐个删除 / 一键清空 -->
    <div v-if="draft.length" class="ck-selected">
      <span class="ck-selected-label">已选 {{ draft.length }} / {{ max }}</span>
      <button v-for="item in draft" :key="item.id" class="ck-chip" type="button" @click="removeOne(item.id)">
        {{ item.name }}
        <AppIcon name="close" :size="11" />
      </button>
      <button class="ck-clear" type="button" @click="clearAll">清空</button>
    </div>

    <div class="ck-search">
      <AppIcon name="search" :size="14" />
      <input v-model="query" placeholder="搜索知识点名称" />
      <button v-if="query" class="ck-search-clear" type="button" @click="query = ''">
        <AppIcon name="close" :size="12" />
      </button>
    </div>

    <!-- 树要自己限高：AppModal 的 .modal-body 只负责滚动，不给固定高度 -->
    <div class="ck-tree">
      <p v-if="loading" class="ck-empty">正在加载知识点…</p>
      <p v-else-if="!scopeNodes.length" class="ck-empty">该学科下暂无知识点，请先到「知识点树」维护</p>
      <p v-else-if="rows.length === 0" class="ck-empty">未找到匹配的知识点</p>
      <template v-else>
        <div
          v-for="row in rows"
          :key="row.node.id"
          class="ck-item"
          :class="{ on: isSelected(row.node.id), hit: row.hit, locked: !selectable(row.node) }"
          :style="{ paddingLeft: `${6 + row.depth * 15}px` }"
          @click="toggleSelect(row.node)"
        >
          <button
            v-if="row.hasChildren"
            class="ck-caret"
            :class="{ open: row.open }"
            type="button"
            @click.stop="toggleExpand(row.node.id)"
          >
            <AppIcon name="chevron-right" :size="12" />
          </button>
          <span v-else class="ck-dot" />
          <span class="ck-check" :class="isSelected(row.node.id) ? 's-on' : selectable(row.node) ? '' : 's-locked'">
            <AppIcon v-if="isSelected(row.node.id)" name="check" :size="10" />
          </span>
          <span class="ck-name">{{ row.node.name }}</span>
          <span class="ck-code">{{ row.node.code }}</span>
          <span v-if="!row.node.enabled" class="tag tag-red">已停用</span>
        </div>
      </template>
    </div>

    <template #footer>
      <button class="btn btn-ghost" type="button" @click="emit('close')">取消</button>
      <button class="btn btn-primary" type="button" @click="emit('confirm', draft.slice(0, max))">
        确认（{{ draft.length }}）
      </button>
    </template>
  </AppModal>
</template>

<style scoped>
.ck-scope {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-bottom: 10px;
  font-size: 12.5px;
  color: var(--ink-2);
}
.ck-scope-label {
  font-size: 11px;
  font-weight: 700;
  color: var(--brand-deep);
  background: var(--brand-soft);
  border-radius: 6px;
  padding: 2px 7px;
}
.ck-scope-tip { margin-left: auto; font-size: 12px; color: var(--sub); }

/* 已选 chip 行 */
.ck-selected { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-bottom: 8px; }
.ck-selected-label { font-size: 11.5px; color: var(--sub); font-weight: 600; }
.ck-chip {
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
.ck-chip:hover { background: #fff; }
.ck-clear {
  border: none;
  background: none;
  color: var(--sub);
  font-size: 11.5px;
  text-decoration: underline;
  padding: 0 2px;
}
.ck-clear:hover { color: var(--danger); }

/* 搜索框 */
.ck-search {
  display: flex;
  align-items: center;
  gap: 6px;
  border: 1.5px solid var(--border);
  border-radius: 9px;
  background: #fff;
  padding: 0 9px;
  height: 32px;
  margin-bottom: 8px;
}
.ck-search:focus-within { border-color: var(--brand); }
.ck-search > :first-child { color: var(--sub); flex-shrink: 0; }
.ck-search input { flex: 1; min-width: 0; border: none; outline: none; font-size: 12.5px; background: transparent; }
.ck-search-clear { display: flex; color: var(--sub); border: none; background: none; padding: 0; }

/* 树体 */
.ck-tree {
  display: flex;
  flex-direction: column;
  gap: 1px;
  max-height: 46vh;
  overflow-y: auto;
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 5px;
  background: #fcfdfe;
}
.ck-item {
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
.ck-item:hover { background: #eef5f4; }
.ck-item.on { background: var(--brand-soft); color: var(--brand-deep); font-weight: 600; }
.ck-item.hit .ck-name { font-weight: 700; }
.ck-item.locked .ck-name { color: var(--sub); }
.ck-caret {
  display: flex;
  flex-shrink: 0;
  appearance: none;
  border: none;
  background: none;
  padding: 0;
  color: var(--sub);
  transition: transform 0.18s;
}
.ck-caret.open { transform: rotate(90deg); }
.ck-dot { width: 4px; height: 4px; border-radius: 50%; background: var(--border); flex-shrink: 0; margin: 0 4px; }

/* 勾选框：选中打勾；停用节点虚线灰框（不可勾） */
.ck-check {
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
.ck-check.s-on { background: var(--brand); border-color: var(--brand); }
.ck-check.s-locked { background: #f1f3f5; border-style: dashed; }

.ck-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ck-code { font-size: 11px; color: var(--sub); flex-shrink: 0; }
.ck-empty { font-size: 12.5px; color: var(--sub); text-align: center; padding: 22px 0; }
</style>
