<script setup lang="ts">
/**
 * 教材知识点过滤面板（题库 BankView 与标准公式库 StandardView 共用）。
 *
 * 左侧：教材级联（年级 → 学科 → 版本）+ 知识点搜索 + 知识点树；
 * 选中节点时 emit 该子树的全部叶子 tag（null = 全部知识点），由父组件自行过滤列表。
 * 节点计数通过 `rows`（含 knowledge 标签的列表数据）计算。
 */
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { AppIcon } from '@aiteach/shared'
import type { OrgKnowledgeNode, TextbookOption } from '@aiteach/shared'
import { fetchKnowledgeTree, fetchTextbookMatrix } from '@/api/org'

const props = defineProps<{ rows: Array<{ knowledge: string[] }> }>()
const emit = defineEmits<{ change: [tags: string[] | null] }>()

const rootEl = ref<HTMLElement | null>(null)

/* ===== 教材级联（年级 → 学科（动态）→ 教材版本） ===== */
const tbMatrix = ref<TextbookOption[]>([])
/** 已应用的教材选择 */
const sel = reactive({ grade: '', subject: '', version: '' })
/** 下拉面板内的级联选择进度 */
const pick = reactive({ grade: '', subject: '', version: '' })
const tbOpen = ref(false)

const tbLabel = computed(() =>
  sel.grade ? `${sel.grade} - ${sel.subject} - ${sel.version}` : '请选择教材',
)

const tbGradeRow = computed(() => tbMatrix.value.find((row) => row.grade === pick.grade))
const tbSubjectRow = computed(() => tbGradeRow.value?.subjects.find((row) => row.name === pick.subject))

function toggleTb() {
  tbOpen.value = !tbOpen.value
  if (tbOpen.value) {
    pick.grade = sel.grade
    pick.subject = sel.subject
    pick.version = sel.version
  }
}

function pickGrade(grade: string) {
  pick.grade = grade
  const subjects = tbMatrix.value.find((row) => row.grade === grade)?.subjects ?? []
  // 学科选项随年级动态变化，原选择不在列表时清空后续级
  if (!subjects.some((row) => row.name === pick.subject)) {
    pick.subject = ''
    pick.version = ''
  }
}

function pickSubject(subject: string) {
  pick.subject = subject
  const versions = tbGradeRow.value?.subjects.find((row) => row.name === subject)?.versions ?? []
  if (!versions.includes(pick.version)) pick.version = ''
}

function pickVersion(version: string) {
  pick.version = version
}

/** 确认教材选择：回写「年级 - 学科 - 教材名称」并加载对应知识点树 */
function applyTextbook() {
  Object.assign(sel, { grade: pick.grade, subject: pick.subject, version: pick.version })
  tbOpen.value = false
  activeNode.value = null
  kpQuery.value = ''
  void loadTree()
}

function onDocClick(event: MouseEvent) {
  if (tbOpen.value && rootEl.value && !rootEl.value.contains(event.target as Node)) tbOpen.value = false
}

/* ===== 知识点树 ===== */
const tree = ref<OrgKnowledgeNode[]>([])
const expanded = ref<Set<string>>(new Set())
const activeNode = ref<OrgKnowledgeNode | null>(null)
const kpQuery = ref('')

const byId = computed(() => new Map<string, OrgKnowledgeNode>(tree.value.map((node) => [node.id, node] as const)))
const childrenMap = computed(() => {
  const map = new Map<string, OrgKnowledgeNode[]>()
  tree.value.forEach((node) => {
    if (node.parentId == null) return
    const bucket = map.get(node.parentId) ?? []
    bucket.push(node)
    map.set(node.parentId, bucket)
  })
  return map
})

/** 节点子树的全部知识点标签（叶子 tag；整棵子树无叶子时退化为节点名） */
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

const activeTags = computed(() => (activeNode.value ? subtreeTags(activeNode.value.id) : null))

function countOf(id: string): number {
  const tags = subtreeTags(id)
  return props.rows.filter((row) => row.knowledge.some((tag) => tags.includes(tag))).length
}

async function loadTree() {
  if (!sel.grade) return
  tree.value = await fetchKnowledgeTree(sel.grade, sel.subject, sel.version)
  expanded.value = new Set(tree.value.filter((node) => node.parentId == null).map((node) => node.id))
}

/** 搜索命中：名称或标签包含关键字 */
const searchMode = computed(() => kpQuery.value.trim().length > 0)
const hitIds = computed(() => {
  if (!searchMode.value) return new Set<string>()
  const keyword = kpQuery.value.trim()
  return new Set(
    tree.value
      .filter((node) => node.name.includes(keyword) || (node.tag ?? '').includes(keyword))
      .map((node) => node.id),
  )
})
/** 搜索时仅保留命中节点及其祖先链 */
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
      parentId == null ? tree.value.filter((node) => node.parentId == null) : childrenMap.value.get(parentId) ?? []
    children.forEach((node) => {
      if (searchMode.value && visibleIds.value && !visibleIds.value.has(node.id)) return
      const nodeChildren = childrenMap.value.get(node.id) ?? []
      const open = searchMode.value || expanded.value.has(node.id)
      rows.push({
        node,
        depth,
        hasChildren: nodeChildren.length > 0,
        open,
        hit: hitIds.value.has(node.id),
      })
      if (open) walk(node.id, depth + 1)
    })
  }
  walk(null, 0)
  return rows
})

function toggleNode(row: TreeRow) {
  if (!row.hasChildren) return
  const next = new Set(expanded.value)
  if (next.has(row.node.id)) next.delete(row.node.id)
  else next.add(row.node.id)
  expanded.value = next
}

/* 选中节点变化 → 通知父组件 */
watch(activeTags, (tags) => emit('change', tags))

onMounted(async () => {
  document.addEventListener('click', onDocClick)
  tbMatrix.value = await fetchTextbookMatrix()
  // 默认教材：高一 - 数学 - 人教A版，不存在时取第一组
  const gradeRow =
    tbMatrix.value.find((row) => row.grade === '高一' && row.subjects.some((s) => s.name === '数学')) ??
    tbMatrix.value[0]
  if (gradeRow) {
    sel.grade = gradeRow.grade
    sel.subject = gradeRow.subjects.find((s) => s.name === '数学')?.name ?? gradeRow.subjects[0].name
    sel.version =
      gradeRow.subjects.find((s) => s.name === sel.subject)?.versions.find((v) => v === '人教A版') ??
      gradeRow.subjects.find((s) => s.name === sel.subject)?.versions[0] ??
      ''
    void loadTree()
  }
})

onBeforeUnmount(() => {
  document.removeEventListener('click', onDocClick)
})
</script>

<template>
  <aside ref="rootEl" class="panel tree-panel">
    <div class="tp-head">知识点</div>

    <!-- 教材级联下拉（年级 → 学科（动态）→ 教材版本） -->
    <div class="tb-selector">
      <button class="tb-btn" :class="{ open: tbOpen }" type="button" @click.stop="toggleTb">
        <AppIcon name="book" :size="15" />
        <span class="tb-label">{{ tbLabel }}</span>
        <AppIcon name="chevron-down" :size="15" class="tb-caret" :class="{ up: tbOpen }" />
      </button>
      <!-- 年级 / 学科 / 教材版本：每个维度一行，选项横向平铺 -->
      <div v-if="tbOpen" class="tb-pop" @click.stop>
        <div class="tb-row">
          <span class="tb-row-label">年级</span>
          <div class="tb-opts">
            <button
              v-for="row in tbMatrix"
              :key="row.grade"
              class="tb-opt"
              :class="{ on: pick.grade === row.grade }"
              type="button"
              @click="pickGrade(row.grade)"
            >
              {{ row.grade }}
            </button>
            <span v-if="tbMatrix.length === 0" class="tb-empty">暂无年级</span>
          </div>
        </div>
        <div class="tb-row">
          <span class="tb-row-label">学科</span>
          <div class="tb-opts">
            <template v-if="tbGradeRow">
              <button
                v-for="subject in tbGradeRow.subjects"
                :key="subject.name"
                class="tb-opt"
                :class="{ on: pick.subject === subject.name }"
                type="button"
                @click="pickSubject(subject.name)"
              >
                {{ subject.name }}
              </button>
            </template>
            <span v-else class="tb-empty">请先选择年级</span>
          </div>
        </div>
        <div class="tb-row">
          <span class="tb-row-label">教材版本</span>
          <div class="tb-opts">
            <template v-if="tbSubjectRow">
              <button
                v-for="version in tbSubjectRow.versions"
                :key="version"
                class="tb-opt"
                :class="{ on: pick.version === version }"
                type="button"
                @click="pickVersion(version)"
              >
                {{ version }}
              </button>
            </template>
            <span v-else class="tb-empty">请先选择学科</span>
          </div>
        </div>
        <div class="tb-foot">
          <button class="tb-apply" type="button" :disabled="!pick.version" @click="applyTextbook">
            确定
          </button>
        </div>
      </div>
    </div>

    <!-- 知识点搜索定位 -->
    <div class="kp-search">
      <AppIcon name="search" :size="14" />
      <input v-model="kpQuery" placeholder="搜索知识点定位" />
      <button v-if="kpQuery" class="kp-clear" type="button" @click="kpQuery = ''">
        <AppIcon name="close" :size="12" />
      </button>
    </div>
    <p v-if="searchMode" class="kp-hint">命中 {{ hitIds.size }} 个知识点</p>

    <!-- 知识点树 -->
    <div class="kp-tree">
      <button
        class="kp-item root"
        :class="{ active: activeNode == null }"
        type="button"
        @click="activeNode = null"
      >
        <AppIcon name="grid" :size="15" />
        <span class="kp-name">全部知识点</span>
        <span class="kp-count">{{ rows.length }}</span>
      </button>
      <div
        v-for="row in treeRows"
        :key="row.node.id"
        class="kp-item"
        :class="{ active: activeNode?.id === row.node.id }"
        :style="{ paddingLeft: `${8 + row.depth * 15}px` }"
        @click="activeNode = row.node"
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
        <span class="kp-count">{{ countOf(row.node.id) }}</span>
      </div>
      <p v-if="treeRows.length === 0 && !searchMode" class="kp-empty">请先选择教材</p>
      <p v-if="searchMode && hitIds.size === 0" class="kp-empty">未找到匹配的知识点</p>
    </div>
  </aside>
</template>

<style scoped>
/* ===== 左侧知识点面板 ===== */
.tree-panel {
  width: 272px;
  flex-shrink: 0;
  height: 100%;
  padding: 12px;
  display: flex;
  flex-direction: column;
  min-height: 0;
}
.tp-head { font-size: 13px; font-weight: 700; color: var(--ink); padding: 2px 4px 10px; flex-shrink: 0; }

/* 教材级联下拉 */
.tb-selector { position: relative; flex-shrink: 0; }
.tb-btn {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 7px;
  border: 1.5px solid var(--border);
  border-radius: 10px;
  background: #fff;
  padding: 8px 10px;
  font-size: 13px;
  color: var(--ink-2);
  transition: border-color 0.15s;
}
.tb-btn:hover, .tb-btn.open { border-color: var(--brand); }
.tb-label { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-align: left; font-weight: 600; }
.tb-caret { color: var(--sub); transition: transform 0.18s; }
.tb-caret.up { transform: rotate(180deg); }
.tb-pop {
  position: absolute;
  top: calc(100% + 6px);
  left: 0;
  z-index: 20;
  width: 520px;
  max-width: calc(100vw - 330px);
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 12px;
  box-shadow: 0 12px 32px rgba(15, 60, 55, 0.14);
  padding: 10px 12px 8px;
  display: flex;
  flex-direction: column;
  gap: 7px;
}
/* 单个维度：标签 + 横向平铺的选项 */
.tb-row { display: flex; align-items: flex-start; gap: 10px; }
.tb-row-label {
  width: 58px;
  flex-shrink: 0;
  font-size: 11.5px;
  font-weight: 700;
  color: var(--sub);
  line-height: 26px;
}
.tb-opts {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  max-height: 118px;
  overflow-y: auto;
}
.tb-opt {
  border: 1.5px solid var(--border);
  border-radius: 8px;
  background: #fff;
  font-size: 12.5px;
  color: var(--ink-2);
  padding: 3px 11px;
  line-height: 18px;
  transition: all 0.12s;
}
.tb-opt:hover { border-color: var(--brand); color: var(--brand-deep); }
.tb-opt.on { background: var(--brand); border-color: var(--brand); color: #fff; font-weight: 600; }
.tb-empty { font-size: 12px; color: var(--sub); line-height: 26px; }
.tb-foot { display: flex; justify-content: flex-end; border-top: 1px dashed var(--border); padding-top: 8px; }
.tb-apply {
  border: none;
  border-radius: 8px;
  background: var(--brand);
  color: #fff;
  font-size: 12.5px;
  font-weight: 600;
  padding: 6px 20px;
}
.tb-apply:hover:not(:disabled) { background: var(--brand-deep); }
.tb-apply:disabled { opacity: 0.5; cursor: not-allowed; }

/* 知识点搜索 */
.kp-search {
  position: relative;
  display: flex;
  align-items: center;
  margin-top: 10px;
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
.kp-clear { display: flex; color: var(--sub); }
.kp-hint { font-size: 11.5px; color: var(--sub); padding: 6px 4px 0; flex-shrink: 0; }

/* 知识点树：占满面板剩余高度，仅树自身滚动 */
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
  display: flex;
  align-items: center;
  gap: 6px;
  border-radius: 8px;
  padding: 7px 8px;
  font-size: 13px;
  color: var(--ink);
  cursor: pointer;
  transition: background 0.12s;
  user-select: none;
}
.kp-item:hover { background: #f2f6f6; }
/* 仅选中项着色，其余文字保持黑色、无背景 */
.kp-item.active { background: var(--brand-soft); color: var(--brand-deep); font-weight: 600; }
.kp-item.root { color: var(--ink); font-weight: 600; }
.kp-item.root.active { color: var(--brand-deep); }
.kp-caret { display: flex; color: var(--sub); transition: transform 0.15s; }
.kp-caret.open { transform: rotate(90deg); }
.kp-dot { width: 4px; height: 4px; border-radius: 50%; background: var(--border); flex-shrink: 0; margin: 0 4px; }
.kp-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* 搜索命中：仅加粗，不加背景、不变色 */
.kp-name.hit { font-weight: 700; }
.kp-count { font-size: 11.5px; color: var(--sub); flex-shrink: 0; }
.kp-item.active .kp-count { color: var(--brand-deep); }
.kp-empty { font-size: 12.5px; color: var(--sub); text-align: center; padding: 20px 0; }
</style>
