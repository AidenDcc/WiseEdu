<script setup lang="ts">
/**
 * 教材知识点过滤面板（题库 BankView 与标准公式库 StandardView 共用）。
 *
 * 左侧：教材级联（年级 → 学科 → 版本）+ 知识点搜索 + 知识点树；
 * 选中节点时 emit 该子树的全部叶子 tag（null = 全部知识点），由父组件自行过滤列表；
 * 已应用的年级 / 学科随 `scopeChange` 一并抛出，供父组件替代单独的年级 / 学科筛选行。
 * 节点计数通过 `rows`（含 knowledge 标签的列表数据）计算。
 *
 * 年级 / 学科单向跟随顶部栏全局作用域（useScope）：顶部栏变了面板跟着变，
 * 面板内自己改则不回写——只换本面板的知识点树，不动顶部栏与题库筛选。
 */
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { ArrowRight } from '@element-plus/icons-vue'
import { AppFilterChips, AppIcon } from '@aiteach/shared'
import type { OrgKnowledgeNode, TextbookOption } from '@aiteach/shared'
import { fetchKnowledgeTree, fetchTextbookMatrix } from '@/api/org'
import { useScope } from '@/composables/useScope'

const props = defineProps<{ rows: Array<{ knowledge: string[] }> }>()
const emit = defineEmits<{
  /** 选中节点的子树叶子 tag（null = 全部知识点） */
  change: [tags: string[] | null]
  /** 已应用的年级 / 学科。题库管理用它替代「年级 / 学科」两个筛选行 —— 教材级联就是这两个维度 */
  scopeChange: [scope: { grade: string; subject: string }]
}>()

const rootEl = ref<HTMLElement | null>(null)

/** 顶部栏全局作用域：本面板的年级 / 学科始终与它一致 */
const { grade: scopeGrade, subject: scopeSubject, ensureScope } = useScope()

/** 教材矩阵查不到作用域时的兜底教材（与 useScope 的首次默认作用域一致） */
const DEFAULT_TEXTBOOK = { grade: '高一', subject: '数学', version: '人教A版' }

/* ===== 教材级联（年级 → 学科（动态）→ 教材版本） ===== */
const tbMatrix = ref<TextbookOption[]>([])
/** 已应用的教材选择 */
const sel = reactive({ grade: '', subject: '', version: '' })
/** 下拉面板内的级联选择进度 */
const pick = reactive({ grade: '', subject: '', version: '' })
const tbOpen = ref(false)

const tbLabel = computed(() =>
  sel.grade ? `${sel.grade} / ${sel.subject} / ${sel.version}` : '请选择教材',
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

/* 共享 chip 组件是 v-model 语义（回传整个数组），而这三个 pick 函数带**级联副作用**
   （换年级会清掉失效的学科 / 版本），所以这里不用 v-model，改用 :model-value + 自己的 handler：
   选中即调 pick，取消（回传空数组，单选组件里表示点已选项）保持原行为——本面板的三级选择
   必须始终有值，不允许被取消。 */
function onPickGrade(value: string[]) {
  if (value[0]) pickGrade(value[0])
}

function onPickSubject(value: string[]) {
  if (value[0]) pickSubject(value[0])
}

function onPickVersion(value: string[]) {
  if (value[0]) pickVersion(value[0])
}

/** 确认教材选择：回写「年级 / 学科 / 教材名称」并加载对应知识点树 */
function applyTextbook() {
  Object.assign(sel, { grade: pick.grade, subject: pick.subject, version: pick.version })
  tbOpen.value = false
  activeNode.value = null
  kpQuery.value = ''
  // 单向跟随：面板改年级 / 学科不反向写全局作用域（顶部栏、题库筛选项不受影响），
  // 只影响本面板的知识点树
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

/** 点选节点；再次点击同一节点取消选中，回到「全部知识点」（activeTags 变回 null） */
function selectNode(node: OrgKnowledgeNode) {
  activeNode.value = activeNode.value?.id === node.id ? null : node
}

/* 选中节点变化 → 通知父组件 */
watch(activeTags, (tags) => emit('change', tags))

/* 已应用的年级 / 学科变化 → 通知父组件。
   不用 immediate：onMounted 里的 locateByScope() 会写 sel，那一次同样会触发，
   提前 emit 只会抛出一对空字符串。 */
watch([() => sel.grade, () => sel.subject], () => {
  emit('scopeChange', { grade: sel.grade, subject: sel.subject })
})

/* ===== 顶部栏作用域 → 教材级联 ===== */
/** 在教材矩阵里定位一组「年级 / 学科」，教材版本沿用现值，失效则回退人教A版 / 首项 */
function locate(grade: string, subject: string): boolean {
  const gradeRow = tbMatrix.value.find((row) => row.grade === grade)
  const subjectRow = gradeRow?.subjects.find((row) => row.name === subject)
  if (!gradeRow || !subjectRow) return false
  sel.grade = gradeRow.grade
  sel.subject = subjectRow.name
  if (!subjectRow.versions.includes(sel.version)) {
    sel.version = subjectRow.versions.find((v) => v === DEFAULT_TEXTBOOK.version) ?? subjectRow.versions[0] ?? ''
  }
  return true
}

/** 取顶部栏作用域；作用域不在教材矩阵内（字典与教材未同步）时退回默认教材，避免面板空白 */
function locateByScope(): boolean {
  if (locate(scopeGrade.value, scopeSubject.value)) return true
  if (locate(DEFAULT_TEXTBOOK.grade, DEFAULT_TEXTBOOK.subject)) return true
  const first = tbMatrix.value[0]
  return first ? locate(first.grade, first.subjects[0]?.name ?? '') : false
}

/** 顶部栏切年级 / 学科 → 面板跟随并重载知识点树（切换作用域后旧选中节点已无意义） */
watch([scopeGrade, scopeSubject], () => {
  if (!locateByScope()) return
  activeNode.value = null
  kpQuery.value = ''
  void loadTree()
})

onMounted(async () => {
  document.addEventListener('click', onDocClick)
  // 先等作用域按字典归一，再拉教材矩阵 —— 面板默认值直接取顶部栏的选择，两边不再各说各话
  await ensureScope().catch(() => {})
  tbMatrix.value = await fetchTextbookMatrix()
  if (locateByScope()) void loadTree()
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
      <!-- 年级 / 学科 / 教材版本：每个维度一行，选项横向平铺（行渲染用共享的 AppFilterChips） -->
      <div v-if="tbOpen" class="tb-pop" @click.stop>
        <AppFilterChips
          v-if="tbMatrix.length"
          label="年级"
          :options="tbMatrix.map((row) => row.grade)"
          :model-value="pick.grade ? [pick.grade] : []"
          :multiple="false"
          @update:model-value="onPickGrade"
        />
        <div v-else class="tb-row">
          <span class="tb-row-label">年级</span>
          <div class="tb-opts"><span class="tb-empty">暂无年级</span></div>
        </div>

        <AppFilterChips
          v-if="tbGradeRow?.subjects.length"
          label="学科"
          :options="tbGradeRow.subjects.map((subject) => subject.name)"
          :model-value="pick.subject ? [pick.subject] : []"
          :multiple="false"
          @update:model-value="onPickSubject"
        />
        <div v-else class="tb-row">
          <span class="tb-row-label">学科</span>
          <div class="tb-opts"><span class="tb-empty">请先选择年级</span></div>
        </div>

        <AppFilterChips
          v-if="tbSubjectRow?.versions.length"
          label="教材版本"
          :options="tbSubjectRow.versions"
          :model-value="pick.version ? [pick.version] : []"
          :multiple="false"
          @update:model-value="onPickVersion"
        />
        <div v-else class="tb-row">
          <span class="tb-row-label">教材版本</span>
          <div class="tb-opts"><span class="tb-empty">请先选择学科</span></div>
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

    <!-- 知识点树（未选中任何节点 = 全部知识点，靠再次点击已选节点取消选中） -->
    <div class="kp-tree">
      <div
        v-for="row in treeRows"
        :key="row.node.id"
        class="kp-item"
        :class="{ active: activeNode?.id === row.node.id }"
        :style="{ paddingLeft: `${8 + row.depth * 15}px` }"
        @click="selectNode(row.node)"
      >
        <button
          v-if="row.hasChildren"
          class="kp-caret"
          :class="{ open: row.open }"
          type="button"
          @click.stop="toggleNode(row)"
        >
          <!-- 展开 / 收缩图标：Element Plus 的 ArrowRight，展开时旋转 90°（同 el-tree） -->
          <ArrowRight class="kp-caret-icon" />
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
/* 选项行的 chip 由共享 AppFilterChips 渲染（.chip-row / .chip-label / .chip-opts / .opt-chip）；
   下面这套 .tb-row / .tb-opts 只在「当前维度还无可选项」时兜底，保留原来的空态文案 */
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
/* 共享 chip 行沿用本面板原有的高度上限（版本多的学科不至于把下拉撑爆） */
.tb-pop :deep(.chip-opts) { max-height: 118px; overflow-y: auto; }
.tb-empty { font-size: 12px; color: var(--sub); line-height: 26px; }
/* 底部确定条：有 justify-content 就必须有 align-items，否则按钮与分隔线不垂直居中 */
.tb-foot {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  border-top: 1px dashed var(--border);
  padding-top: 8px;
}
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
/* 图标按钮：原先只有裸 display:flex，图标既不居中、点击区也只有图标本身大小；
   这里补居中、撑成 22×22 命中区，并清掉原生 button 的 UA 边框 / 灰底 */
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
/* 原生 button 带 UA 默认边框 / 灰底（Chrome 有边框、Safari 只给背景），这里清掉，
   只留图标本身 */
.kp-caret {
  display: flex;
  flex-shrink: 0;
  appearance: none;
  border: none;
  background: none;
  padding: 0;
  font-size: 13px;
  color: var(--sub);
}
/* @element-plus/icons-vue 的图标只有 svg 骨架、不带尺寸，这里补上 el-icon 的那套样式
   （1em 见方 + currentColor 填充）；旋转放在图标上，按钮本身不参与变换 */
.kp-caret-icon {
  width: 1em;
  height: 1em;
  fill: currentColor;
  transition: transform 0.2s ease;
}
.kp-caret.open .kp-caret-icon { transform: rotate(90deg); }
.kp-dot { width: 4px; height: 4px; border-radius: 50%; background: var(--border); flex-shrink: 0; margin: 0 4px; }
.kp-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
/* 搜索命中：仅加粗，不加背景、不变色 */
.kp-name.hit { font-weight: 700; }
.kp-count { font-size: 11.5px; color: var(--sub); flex-shrink: 0; }
.kp-item.active .kp-count { color: var(--brand-deep); }
.kp-empty { font-size: 12.5px; color: var(--sub); text-align: center; padding: 20px 0; }
</style>
