<script setup lang="ts">
/**
 * 教材版本树（左侧导航）：`学段 → 学科 → 教材版本`。
 *
 * UI 对齐机构端「题库管理」左侧的知识点树：顶部标题 → 搜索框 → 树体，
 * 每行 = 展开箭头（叶子为圆点）+ 名称 + 右侧「数据条数」（该节点下的分册数量）；
 * 行内操作（学科「添加教材」、版本「状态 / 编辑 / 删除」）在悬浮时浮出，
 * 且一律走**图标按钮** —— 状态修改点开后弹出小框，可选「启用 / 禁用」；
 * 不做「展开 / 收起」整体按钮，也不支持拖拽。
 *
 * 学段 / 学科两层不落库，分别来自基础字典：
 * - 学段：年级字典（「年级 / 学段」）的 `stage` 汇总；
 * - 学科：学科字典（按当前学段收窄，逻辑与知识点树一致）。
 *
 * 所以学段 / 学科没有状态 / 编辑 / 删除按钮（数据在字典里维护），学科只保留
 * 「添加教材」入口；只有第三层「教材版本」可编辑 / 删除 / 启停用，也只能在学科下新增。
 */
import { computed, ref, watch } from 'vue'
import { AppIcon } from '@aiteach/shared'
import type { DictItem, TextbookVersion, TextbookVolume } from '@aiteach/shared'
import AppDropdownMenu from '@/components/ui/AppDropdownMenu.vue'

/** 学段展示顺序：小学 → 初中 → 高中（字典无序，顺序只在这里定） */
const STAGE_ORDER = ['小学', '初中', '高中']

type NodeKind = 'stage' | 'subject' | 'version'

interface TreeNode {
  id: string
  parentId: string | null
  name: string
  kind: NodeKind
  stage: string
  subject?: string
  versionId?: number
  enabled: boolean
  sort: number
}

const props = defineProps<{
  versions: TextbookVersion[]
  /** 全量分册：只用于统计每行右侧的「数据条数」 */
  volumes: TextbookVolume[]
  /** 年级字典（含 `stage`，学段清单由它汇总） */
  grades: DictItem[]
  /** 学科字典 */
  subjects: DictItem[]
  /** 当前选中的教材版本 id */
  activeVersionId: number | null
}>()

const emit = defineEmits<{
  select: [versionId: number]
  create: [payload: { stage: string; subject: string }]
  edit: [version: TextbookVersion]
  remove: [version: TextbookVersion]
  toggle: [version: TextbookVersion]
}>()

const keyword = ref('')
const expandedIds = ref<string[]>([])
let inited = false

function stageRank(stage: string) {
  const index = STAGE_ORDER.indexOf(stage)
  return index < 0 ? STAGE_ORDER.length : index
}

const enabledGrades = computed(() => props.grades.filter((item) => item.enabled))
const enabledSubjects = computed(() => props.subjects.filter((item) => item.enabled))

/** 学段清单：年级字典的 `stage` 汇总，兜底带上版本里出现过的学段 */
const stageList = computed(() => {
  const stages = new Set<string>()
  enabledGrades.value.forEach((item) => { if (item.stage) stages.add(item.stage) })
  props.versions.forEach((item) => stages.add(item.stage))
  return [...stages].sort((a, b) => stageRank(a) - stageRank(b) || a.localeCompare(b))
})

/** 年级名 → 学段：学科「适配年级」要换算成学段才能判断挂不挂得上当前学段 */
const gradeStage = computed(() => new Map(props.grades.map((item) => [item.name, item.stage])))

/**
 * 某学段下该展示哪些学科：适配年级留空 = 不限（各学段都有），否则只要有任一
 * 适配年级落在该学段就算命中 —— 于是小学学段下不会出现物理、化学。
 * 一个都匹配不上时退回全量，免得树整个空掉。
 */
function subjectsOfStage(stage: string): DictItem[] {
  const scoped = enabledSubjects.value.filter(
    (item) => !item.grades?.length || item.grades.some((name) => gradeStage.value.get(name) === stage),
  )
  return scoped.length ? scoped : enabledSubjects.value
}

/** 全部节点（扁平行表，`AppTreeView` 那套的同一份结构，这里自己渲染） */
const nodes = computed<TreeNode[]>(() => {
  const out: TreeNode[] = []
  stageList.value.forEach((stage, index) => {
    out.push({ id: `stage:${stage}`, parentId: null, name: stage, enabled: true, sort: index + 1, kind: 'stage', stage })
  })
  stageList.value.forEach((stage) => {
    subjectsOfStage(stage).forEach((subject, index) => {
      out.push({
        id: `subject:${stage}|${subject.name}`,
        parentId: `stage:${stage}`,
        name: subject.name,
        enabled: true,
        sort: index + 1,
        kind: 'subject',
        stage,
        subject: subject.name,
      })
    })
  })
  props.versions.forEach((item, index) => {
    out.push({
      id: `version:${item.id}`,
      parentId: `subject:${item.stage}|${item.subject}`,
      name: item.name,
      enabled: item.enabled,
      sort: item.sort ?? index + 1,
      kind: 'version',
      stage: item.stage,
      subject: item.subject,
      versionId: item.id,
    })
  })
  return out
})

/** 行右侧「数据条数」：版本 = 其下分册数；学科 / 学段 = 各自分册数之和 */
const countMap = computed(() => {
  const map = new Map<string, number>()
  const perVersion = new Map<number, number>()
  props.volumes.forEach((volume) => {
    perVersion.set(volume.textbookId, (perVersion.get(volume.textbookId) ?? 0) + 1)
  })
  const perSubject = new Map<string, number>()
  const perStage = new Map<string, number>()
  props.versions.forEach((item) => {
    const count = perVersion.get(item.id) ?? 0
    map.set(`version:${item.id}`, count)
    const subjectKey = `subject:${item.stage}|${item.subject}`
    perSubject.set(subjectKey, (perSubject.get(subjectKey) ?? 0) + count)
    perStage.set(item.stage, (perStage.get(item.stage) ?? 0) + count)
  })
  perSubject.forEach((count, key) => map.set(key, count))
  perStage.forEach((count, stage) => map.set(`stage:${stage}`, count))
  return map
})

const activeNodeId = computed(() => (props.activeVersionId == null ? null : `version:${props.activeVersionId}`))

/* ===== 搜索：命中节点 + 其祖先链保留，其余隐藏（与知识点树同口径，只加粗不换色） ===== */
const searchMode = computed(() => keyword.value.trim().length > 0)
const hitIds = computed(() => {
  if (!searchMode.value) return new Set<string>()
  const kw = keyword.value.trim()
  return new Set(nodes.value.filter((node) => node.name.includes(kw)).map((node) => node.id))
})
const visibleIds = computed(() => {
  if (!searchMode.value) return null
  const byId = new Map(nodes.value.map((node) => [node.id, node] as const))
  const keep = new Set<string>()
  hitIds.value.forEach((id) => {
    let current = byId.get(id)
    while (current) {
      keep.add(current.id)
      current = current.parentId == null ? undefined : byId.get(current.parentId)
    }
  })
  return keep
})

interface TreeRow {
  node: TreeNode
  depth: number
  hasChildren: boolean
  open: boolean
  hit: boolean
  count: number
}

const rows = computed<TreeRow[]>(() => {
  const childMap = new Map<string, TreeNode[]>()
  nodes.value.forEach((node) => {
    if (node.parentId == null) return
    const bucket = childMap.get(node.parentId) ?? []
    bucket.push(node)
    childMap.set(node.parentId, bucket)
  })
  const result: TreeRow[] = []
  const walk = (parentId: string | null, depth: number) => {
    const children = (parentId == null
      ? nodes.value.filter((node) => node.parentId == null)
      : childMap.get(parentId) ?? []
    ).slice().sort((a, b) => a.sort - b.sort)
    children.forEach((node) => {
      if (searchMode.value && visibleIds.value && !visibleIds.value.has(node.id)) return
      const kids = childMap.get(node.id) ?? []
      const open = searchMode.value || expandedIds.value.includes(node.id)
      result.push({
        node,
        depth,
        hasChildren: kids.length > 0,
        open,
        hit: hitIds.value.has(node.id),
        count: countMap.value.get(node.id) ?? 0,
      })
      if (open) walk(node.id, depth + 1)
    })
  }
  walk(null, 0)
  return result
})

/** 首次渲染展开全部学段；选中版本时把它的祖先链一并展开，保证选中项可见 */
watch(
  [nodes, () => props.activeVersionId],
  ([list, activeId]) => {
    const next = new Set(expandedIds.value)
    if (!inited && list.length) {
      inited = true
      list.forEach((node) => { if (node.kind === 'stage') next.add(node.id) })
    }
    if (activeId != null) {
      const byId = new Map(list.map((node) => [node.id, node] as const))
      let current = byId.get(`version:${activeId}`)
      while (current && current.parentId != null) {
        next.add(current.parentId)
        current = byId.get(current.parentId)
      }
    }
    expandedIds.value = [...next]
  },
  { immediate: true },
)

function toggleNode(row: TreeRow) {
  if (!row.hasChildren) return
  const next = [...expandedIds.value]
  const index = next.indexOf(row.node.id)
  if (index >= 0) next.splice(index, 1)
  else next.push(row.node.id)
  expandedIds.value = next
}

/** 点行：版本 = 选中；学段 / 学科 = 展开收起 */
function onClickRow(row: TreeRow) {
  if (row.node.kind === 'version' && row.node.versionId != null) emit('select', row.node.versionId)
  else toggleNode(row)
}

function versionOf(node: TreeNode): TextbookVersion | undefined {
  return props.versions.find((item) => item.id === node.versionId)
}
function onEdit(row: TreeRow) {
  const version = versionOf(row.node)
  if (version) emit('edit', version)
}
function onRemove(row: TreeRow) {
  const version = versionOf(row.node)
  if (version) emit('remove', version)
}
function onAddChild(node: TreeNode) {
  if (node.kind === 'subject' && node.subject) emit('create', { stage: node.stage, subject: node.subject })
}

/** 状态小框：当前状态那一项标出来且不可点，另一项才是真正的操作 */
function statusItems(enabled: boolean) {
  return [
    { key: 'enable', label: '启用', icon: 'check', disabled: enabled },
    { key: 'disable', label: '禁用', icon: 'close', disabled: !enabled },
  ]
}
function onStatus(row: TreeRow, key: string) {
  const version = versionOf(row.node)
  if (!version) return
  if (key === 'enable' ? version.enabled : !version.enabled) return
  emit('toggle', version)
}
</script>

<template>
  <aside class="v-tree">
    <div class="tp-head">教材版本</div>

    <!-- 版本名称搜索定位 -->
    <div class="kp-search">
      <AppIcon name="search" :size="14" />
      <input v-model="keyword" placeholder="搜索教材版本名称" />
      <button v-if="keyword" class="kp-clear" type="button" @click="keyword = ''">
        <AppIcon name="close" :size="12" />
      </button>
    </div>

    <!-- 树：学段 → 学科 → 教材版本 -->
    <div class="kp-tree">
      <div
        v-for="row in rows"
        :key="row.node.id"
        class="kp-item"
        :class="{ active: row.node.id === activeNodeId, disabled: !row.node.enabled }"
        :style="{ paddingLeft: `${8 + row.depth * 15}px` }"
        @click="onClickRow(row)"
      >
        <button
          v-if="row.hasChildren"
          class="kp-caret"
          :class="{ open: row.open }"
          type="button"
          @click.stop="toggleNode(row)"
        >
          <AppIcon name="chevron-right" :size="13" />
        </button>
        <span v-else class="kp-dot" />

        <span class="kp-name" :class="{ hit: row.hit }">{{ row.node.name }}</span>
        <span class="kp-count">{{ row.count }}</span>

        <!-- 行内操作：学段无按钮；学科只有「添加教材」；版本才有 状态 / 编辑 / 删除（全是图标按钮） -->
        <div v-if="row.node.kind !== 'stage'" class="row-ops" @click.stop>
          <button
            v-if="row.node.kind === 'subject'"
            class="icon-btn"
            type="button"
            title="添加教材"
            @click="onAddChild(row.node)"
          ><AppIcon name="plus" :size="15" /></button>
          <template v-else>
            <!-- 状态修改：点图标弹出小框，选「启用 / 禁用」 -->
            <AppDropdownMenu :items="statusItems(row.node.enabled)" :width="112" @select="(key) => onStatus(row, key)">
              <button class="icon-btn" :class="row.node.enabled ? 'on' : 'off'" type="button" title="修改状态">
                <AppIcon name="power" :size="15" />
              </button>
            </AppDropdownMenu>
            <button class="icon-btn" type="button" title="编辑" @click="onEdit(row)">
              <AppIcon name="edit" :size="15" />
            </button>
            <button class="icon-btn danger" type="button" title="删除" @click="onRemove(row)">
              <AppIcon name="trash" :size="15" />
            </button>
          </template>
        </div>
      </div>

      <p v-if="rows.length === 0" class="kp-empty">{{ searchMode ? '未找到匹配的教材版本' : '暂无教材版本，可在学科下添加' }}</p>
    </div>
  </aside>
</template>

<style scoped>
/* ===== 面板骨架（与机构端知识点树一致） ===== */
.v-tree {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  padding: 12px;
}
.tp-head { font-size: 13px; font-weight: 700; color: var(--ink); padding: 2px 4px 10px; flex-shrink: 0; }

/* 版本名称搜索 */
.kp-search {
  position: relative;
  display: flex;
  align-items: center;
  border: 1.5px solid var(--border);
  border-radius: 10px;
  background: #fff;
  padding: 0 8px;
  height: 34px;
  flex-shrink: 0;
}
.kp-search:focus-within { border-color: var(--brand); }
.kp-search > :first-child { color: var(--sub); }
.kp-search input { flex: 1; border: none; outline: none; font-size: 12.5px; height: 100%; background: transparent; padding: 0 6px; }
.kp-clear {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  flex-shrink: 0;
  border: none;
  border-radius: 6px;
  background: none;
  padding: 0;
  color: var(--sub);
}
.kp-clear:hover { background: var(--brand-soft); color: var(--brand-deep); }

/* ===== 树体 ===== */
.kp-tree {
  flex: 1;
  min-height: 0;
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 1px;
  overflow-y: auto;
}
.kp-item {
  position: relative;
  display: flex;
  align-items: center;
  gap: 6px;
  border-radius: 8px;
  /* 右侧预留「数据条数」的固定槽位，保证数字一律贴最右对齐 */
  padding: 7px 30px 7px 8px;
  font-size: 13px;
  color: var(--ink);
  cursor: pointer;
  transition: background 0.12s;
  user-select: none;
}
.kp-item:hover { background: #f2f6f6; }
/* 仅选中项着色，其余文字保持黑色、无背景 */
.kp-item.active { background: var(--brand-soft); color: var(--brand-deep); font-weight: 600; }
.kp-item.disabled .kp-name { color: var(--sub); text-decoration: line-through; }
.kp-caret {
  display: flex;
  flex-shrink: 0;
  appearance: none;
  border: none;
  background: none;
  padding: 0;
  color: var(--sub);
}
.kp-caret :deep(svg) { transition: transform 0.2s ease; }
.kp-caret.open :deep(svg) { transform: rotate(90deg); }
.kp-dot { width: 4px; height: 4px; border-radius: 50%; background: var(--border); flex-shrink: 0; margin: 0 5px; }
.kp-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* 搜索命中：仅加粗，不加背景、不变色 */
.kp-name.hit { font-weight: 700; }
.kp-count {
  position: absolute;
  right: 9px;
  top: 50%;
  transform: translateY(-50%);
  font-size: 11.5px;
  color: var(--sub);
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
}
.kp-item.active .kp-count { color: var(--brand-deep); }
.kp-empty { font-size: 12.5px; color: var(--sub); text-align: center; padding: 20px 0; }

/* 行内操作：位于「数据条数」左侧就位占宽，未悬浮时用 visibility 隐藏 —— 
   数字恒贴最右，按钮出现 / 消失都不会改变行高或造成横向跳动 */
.row-ops {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  visibility: hidden;
}
.kp-item:hover .row-ops { visibility: visible; }

/* 图标按钮：行内操作一律走图标（添加教材 / 状态 / 编辑 / 删除） */
.icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  flex-shrink: 0;
  border: none;
  border-radius: 6px;
  background: transparent;
  padding: 0;
  color: var(--sub);
  transition: background 0.15s, color 0.15s;
}
.icon-btn:hover { background: rgba(79, 110, 247, 0.13); color: var(--brand-deep); }
/* 状态图标：启用=绿、停用=灰，一眼看出当前状态 */
.icon-btn.on { color: var(--success); }
.icon-btn.off { color: var(--sub); }
.icon-btn.danger:hover { background: var(--danger-soft); color: var(--danger); }
</style>
