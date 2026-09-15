<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { AppIcon, RichTextViewer, showToast, ApiError, QUESTION_STATUS_TEXT, hasImage, toPlainText, truncateRich } from '@aiteach/shared'
import type { OrgKnowledgeNode, OrgQuestion, TextbookOption } from '@aiteach/shared'
import AppModal from '@/components/ui/AppModal.vue'
import AppDrawer from '@/components/ui/AppDrawer.vue'
import AppPagination from '@/components/ui/AppPagination.vue'
import {
  deleteQuestions,
  fetchKnowledgeTree,
  fetchQuestions,
  fetchTenantDict,
  fetchTextbookMatrix,
  variantOf,
} from '@/api/org'

const router = useRouter()

const LIBRARY_TEXT: Record<string, string> = { personal: '个人题库', org: '机构公共', wrong: '错题库' }
const STATUS_CLASS: Record<string, string> = {
  draft: 'tag-gray',
  checking: 'tag-blue',
  pending: 'tag-orange',
  approved: 'tag-green',
  rejected: 'tag-red',
}

/* ===== 数据 ===== */
const list = ref<OrgQuestion[]>([])
const loading = ref(false)

async function load() {
  loading.value = true
  try {
    list.value = await fetchQuestions()
  } finally {
    loading.value = false
  }
}

/* ================= 左侧：教材级联 + 知识点树 ================= */
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
  const root = document.querySelector('.tb-selector')
  if (tbOpen.value && root && !root.contains(event.target as Node)) tbOpen.value = false
}

/* ----- 知识点树 ----- */
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
  return list.value.filter((row) => row.knowledge.some((tag) => tags.includes(tag))).length
}

async function loadTree() {
  if (!sel.grade) return
  tree.value = await fetchKnowledgeTree(sel.grade, sel.subject, sel.version)
  expanded.value = new Set(tree.value.filter((node) => node.parentId == null).map((node) => node.id))
}

/** 搜索命中：名称或标签包含关键字 */
const searchMode = computed(() => kpQuery.value.trim().length > 0)
const hitIds = computed(() => {
  if (!searchMode) return new Set<string>()
  const keyword = kpQuery.value.trim()
  return new Set(
    tree.value
      .filter((node) => node.name.includes(keyword) || (node.tag ?? '').includes(keyword))
      .map((node) => node.id),
  )
})
/** 搜索时仅保留命中节点及其祖先链 */
const visibleIds = computed(() => {
  if (!searchMode) return null
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

/* ================= 右上：可折叠筛选条件 ================= */
interface FilterRowDef {
  key: 'type' | 'difficulty' | 'grade' | 'term' | 'examType'
  label: string
  dict?: string
  options?: string[]
}

const FILTER_ROWS: FilterRowDef[] = [
  { key: 'type', label: '题型', dict: 'questionType' },
  { key: 'difficulty', label: '难度', dict: 'difficulty' },
  { key: 'grade', label: '年级', dict: 'grade' },
  { key: 'term', label: '学期', options: ['上学期', '下学期'] },
  { key: 'examType', label: '考试类型', dict: 'examType' },
]

const filterSel = reactive<Record<FilterRowDef['key'], string[]>>({
  type: [],
  difficulty: [],
  grade: [],
  term: [],
  examType: [],
})
const filterOptions = reactive<Record<string, string[]>>({})
const filterOpen = ref(true)
/** 折叠态每个已选条件值串的最大展示长度（超出省略） */
const COLLAPSE_MAX = 18

const activeFilterRows = computed(() =>
  FILTER_ROWS.filter((row) => filterSel[row.key].length > 0).map((row) => ({
    ...row,
    text: filterSel[row.key].join('、'),
    overflow: filterSel[row.key].join('、').length > COLLAPSE_MAX,
  })),
)

function toggleOption(key: FilterRowDef['key'], option: string) {
  const bucket = filterSel[key]
  const index = bucket.indexOf(option)
  if (index >= 0) bucket.splice(index, 1)
  else bucket.push(option)
}

function rowOptions(row: FilterRowDef): string[] {
  if (row.options) return row.options
  return filterOptions[row.dict ?? ''] ?? []
}

function clearFilters() {
  FILTER_ROWS.forEach((row) => (filterSel[row.key] = []))
}

async function loadDicts() {
  const dictTypes = [...new Set(FILTER_ROWS.map((row) => row.dict).filter((d): d is string => !!d))]
  await Promise.all(
    dictTypes.map(async (type) => {
      filterOptions[type] = (await fetchTenantDict(type)).map((item) => item.name)
    }),
  )
}

/* ================= 列表筛选 / 分页 ================= */
const keyword = ref('')
const viewMode = ref<'table' | 'detail'>('table')
const page = ref(1)

const FIELD_OF: Record<FilterRowDef['key'], (row: OrgQuestion) => string> = {
  type: (row) => row.type,
  difficulty: (row) => row.difficulty,
  grade: (row) => row.grade,
  term: (row) => row.term ?? '',
  examType: (row) => row.examType ?? '',
}

const filtered = computed(() => {
  const kw = keyword.value.trim()
  return list.value.filter((row) => {
    if (activeTags.value && !row.knowledge.some((tag) => activeTags.value!.includes(tag))) return false
    for (const def of FILTER_ROWS) {
      const selected = filterSel[def.key]
      if (selected.length > 0 && !selected.includes(FIELD_OF[def.key](row))) return false
    }
    if (kw && !toPlainText(row.stem).includes(kw) && !String(row.id).includes(kw)) return false
    return true
  })
})

const pageSize = computed(() => (viewMode.value === 'table' ? 10 : 4))
const paged = computed(() => filtered.value.slice((page.value - 1) * pageSize.value, page.value * pageSize.value))

watch([activeTags, () => JSON.stringify(filterSel), keyword, viewMode], () => {
  page.value = 1
})

/** 图形占位框：题干提到配图、且题内确实没有嵌入图片时才显示 */
function needsFigure(row: OrgQuestion): boolean {
  if (hasImage(row.stem)) return false
  const text = toPlainText(row.stem)
  return text.includes('如图') || text.includes('图）')
}

/** 选项答案字母（选择题高亮正确项） */
function answerLetters(row: OrgQuestion): string[] {
  return row.options.length > 0 ? [...new Set(row.answer.toUpperCase().replace(/[^A-F]/g, '').split(''))] : []
}

/* ===== 详细列表：解析展开 ===== */
const analysisOpen = ref<number[]>([])

function toggleAnalysis(id: number) {
  const index = analysisOpen.value.indexOf(id)
  if (index >= 0) analysisOpen.value.splice(index, 1)
  else analysisOpen.value.push(id)
}

/* ================= 组卷篮（加入组卷库） ================= */
const BASKET_KEY = 'aiteach.paper-basket'
const basket = ref<number[]>([])

function restoreBasket() {
  try {
    const raw = sessionStorage.getItem(BASKET_KEY)
    if (raw) basket.value = JSON.parse(raw) as number[]
  } catch {
    basket.value = []
  }
}

watch(
  basket,
  (ids) => {
    if (ids.length) sessionStorage.setItem(BASKET_KEY, JSON.stringify(ids))
    else sessionStorage.removeItem(BASKET_KEY)
  },
  { deep: true },
)

function addToBasket(row: OrgQuestion) {
  if (basket.value.includes(row.id)) return
  basket.value.push(row.id)
  showToast(`题目 #${row.id} 已加入组卷库`, 'success')
}

function clearBasket() {
  basket.value = []
  showToast('已清空组卷库', 'info')
}

function goCollab() {
  router.push({ path: '/paper/collab', query: { basket: '1' } })
}

/* ===== 操作：预览 / 编辑 / 变式 / 删除 ===== */
const preview = ref<OrgQuestion | null>(null)
const variantOpen = ref<OrgQuestion | null>(null)

function goEdit(id?: number) {
  router.push({ path: '/question/manual', query: id != null ? { id: String(id) } : {} })
}

async function onManualVariant() {
  if (!variantOpen.value) return
  const copy = await variantOf(variantOpen.value.id)
  showToast('已复制原题为变式草稿，永久建立关联', 'success')
  variantOpen.value = null
  goEdit(copy.id)
  void load()
}

function goAiVariant() {
  if (!variantOpen.value) return
  router.push({ path: '/question/ai', query: { variantOf: String(variantOpen.value.id) } })
  variantOpen.value = null
}

async function onDelete(row: OrgQuestion) {
  if (!window.confirm('确认删除该题？删除后进入回收站（30 天）。')) return
  try {
    await deleteQuestions([row.id])
    showToast('已删除（进入回收站）', 'success')
    load()
  } catch (error) {
    showToast(error instanceof ApiError ? error.message : '删除失败', 'error')
  }
}

/* ===== 挂载 ===== */
onMounted(async () => {
  document.addEventListener('click', onDocClick)
  restoreBasket()
  void load()
  void loadDicts()
  tbMatrix.value = await fetchTextbookMatrix()
  // 默认教材：高一 - 数学 - 人教A版（题库种子题范围），不存在时取第一组
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
  <div class="bank-layout">
    <!-- 左：教材 + 知识点树 -->
    <aside class="panel tree-panel">
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
          <span class="kp-count">{{ list.length }}</span>
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

    <!-- 右侧 -->
    <div class="right-col">
      <!-- 搜索条件（可折叠） -->
      <div class="panel filter-panel">
        <div class="fp-head" @click="filterOpen = !filterOpen">
          <span class="fp-title">
            搜索条件
            <span v-if="!filterOpen" class="fp-summary">
              <template v-if="activeFilterRows.length">
                <span v-for="row in activeFilterRows" :key="row.key" class="fp-chip">
                  <b>{{ row.label }}</b>
                  <span class="fp-values" :class="{ overflow: row.overflow }" :title="row.text">{{ row.text }}</span>
                </span>
              </template>
              <span v-else class="fp-none">暂无筛选条件</span>
            </span>
          </span>
          <span class="fp-toggle">
            <button v-if="activeFilterRows.length" class="mini-btn" type="button" @click.stop="clearFilters">清空</button>
            {{ filterOpen ? '收起' : '展开' }}
            <AppIcon name="chevron-down" :size="15" class="fp-caret" :class="{ up: filterOpen }" />
          </span>
        </div>
        <div v-if="filterOpen" class="fp-body">
          <div v-for="def in FILTER_ROWS" :key="def.key" class="cf-row">
            <span class="cf-label">{{ def.label }}</span>
            <div class="cf-opts">
              <button
                v-for="option in rowOptions(def)"
                :key="option"
                class="opt-chip"
                :class="{ on: filterSel[def.key].includes(option) }"
                type="button"
                @click="toggleOption(def.key, option)"
              >
                {{ option }}
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- 试题列表 -->
      <div class="panel table-panel">
        <div class="list-toolbar">
          <div class="search-box">
            <AppIcon name="search" :size="15" />
            <input v-model="keyword" class="f-input" placeholder="题干关键词 / 题目编号" />
          </div>
          <div class="mode-toggle">
            <button :class="{ on: viewMode === 'table' }" type="button" @click="viewMode = 'table'">
              <AppIcon name="grid" :size="14" /> 表格
            </button>
            <button :class="{ on: viewMode === 'detail' }" type="button" @click="viewMode = 'detail'">
              <AppIcon name="file" :size="14" /> 详细
            </button>
          </div>
          <button class="btn btn-primary btn-sm" @click="goEdit()">
            <AppIcon name="plus" :size="15" /> 手动录题
          </button>
        </div>

        <!-- 表格显示 -->
        <div v-if="viewMode === 'table'" class="data-table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th style="width: 46px">序号</th>
                <th style="width: 84px">题目编号</th>
                <th class="th-stem">题干</th>
                <th style="width: 76px">题型</th>
                <th style="width: 66px">难度</th>
                <th style="width: 150px">知识点</th>
                <th style="width: 76px">考试次数</th>
                <th style="width: 96px">更新时间</th>
                <th style="width: 250px">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="loading && list.length === 0">
                <td colspan="9" class="empty-row">加载中…</td>
              </tr>
              <tr v-else-if="paged.length === 0">
                <td colspan="9" class="empty-row">暂无符合条件的题目</td>
              </tr>
              <template v-else>
                <tr v-for="(row, i) in paged" :key="row.id">
                  <td>{{ (page - 1) * pageSize + i + 1 }}</td>
                  <td class="cell-strong">#{{ row.id }}</td>
                  <td class="stem-cell" @click="preview = row"><RichTextViewer :content="row.stem" tag="span" /></td>
                  <td>{{ row.type }}</td>
                  <td>{{ row.difficulty }}</td>
                  <td class="knowledge-cell" :title="row.knowledge.join('、')">{{ row.knowledge.join('、') }}</td>
                  <td>{{ row.useCount }} 次</td>
                  <td class="time-cell">{{ row.updatedAt.slice(5, 16) }}</td>
                  <td>
                    <div class="op-group">
                      <button class="mini-btn" type="button" @click="preview = row">预览</button>
                      <button class="mini-btn" type="button" @click="goEdit(row.id)">编辑</button>
                      <button class="mini-btn" type="button" @click="variantOpen = row">变式</button>
                      <button
                        class="mini-btn success"
                        :disabled="basket.includes(row.id)"
                        type="button"
                        @click="addToBasket(row)"
                      >
                        {{ basket.includes(row.id) ? '已在组卷库' : '加入组卷库' }}
                      </button>
                    </div>
                  </td>
                </tr>
              </template>
            </tbody>
          </table>
        </div>

        <!-- 详细列表：完整面板卡片 -->
        <div v-else class="detail-list">
          <p v-if="paged.length === 0" class="empty-row" style="padding: 30px 0; text-align: center">暂无符合条件的题目</p>
          <article v-for="row in paged" :key="row.id" class="q-card">
            <div class="qc-meta">
              <span class="qc-id">#{{ row.id }}</span>
              <span class="tag tag-blue">{{ row.type }}</span>
              <span class="tag" :class="row.difficulty === '困难' || row.difficulty === '较难' ? 'tag-red' : row.difficulty === '中等' ? 'tag-orange' : 'tag-green'">{{ row.difficulty }}</span>
              <span class="tag" :class="STATUS_CLASS[row.status]">{{ QUESTION_STATUS_TEXT[row.status] }}</span>
              <span class="qc-kp">{{ row.knowledge.join('、') }}</span>
              <span class="qc-right">考试 {{ row.useCount }} 次 · {{ row.updatedAt.slice(5, 16) }}</span>
            </div>
            <RichTextViewer class="qc-stem" :content="row.stem" @click="preview = row" />
            <!-- 配图（含图形描述的题展示图位；题内已嵌图的不再占位） -->
            <div v-if="needsFigure(row)" class="qc-figure">
              <AppIcon name="image" :size="26" />
              <span>题目配图（演示占位）</span>
            </div>
            <ul v-if="row.options.length > 0" class="qc-options">
              <li
                v-for="(opt, i) in row.options"
                :key="i"
                :class="{ right: answerLetters(row).includes('ABCDEF'[i]) }"
              >
                <span class="opt-letter">{{ 'ABCDEF'[i] }}</span>
                <RichTextViewer :content="opt" tag="span" />
              </li>
            </ul>
            <div v-if="analysisOpen.includes(row.id)" class="qc-answer">
              <p><b>答案：</b><span class="qc-answer-text">{{ row.answer || '—' }}</span></p>
              <p><b>解析：</b><RichTextViewer :content="row.analysis" tag="span" empty="—" /></p>
            </div>
            <div v-if="basket.includes(row.id) || row.status === 'rejected'" class="qc-flags">
              <span v-if="basket.includes(row.id)" class="tag tag-green">已加入组卷库</span>
              <span v-if="row.status === 'rejected'" class="qc-reject">驳回意见：{{ row.reviewOpinion }}</span>
            </div>
            <div class="qc-ops">
              <button class="btn btn-ghost btn-sm" type="button" @click="onDelete(row)">删除</button>
              <button class="mini-btn" type="button" @click="preview = row">预览</button>
              <button class="mini-btn" type="button" @click="toggleAnalysis(row.id)">
                {{ analysisOpen.includes(row.id) ? '收起解析' : '解析' }}
              </button>
              <button class="mini-btn" type="button" @click="goEdit(row.id)">编辑</button>
              <button class="mini-btn" type="button" @click="variantOpen = row">变式</button>
              <button
                class="mini-btn success"
                :disabled="basket.includes(row.id)"
                type="button"
                @click="addToBasket(row)"
              >
                {{ basket.includes(row.id) ? '已在组卷库' : '加入组卷库' }}
              </button>
            </div>
          </article>
        </div>

        <AppPagination :total="filtered.length" v-model:page="page" :page-size="pageSize" />
      </div>
    </div>

    <!-- 题目预览 -->
    <AppDrawer v-if="preview" :title="`题目 #${preview.id}`" subtitle="学生视角预览" @close="preview = null">
      <div class="detail-grid">
        <div class="detail-item"><div class="d-label">学科 / 年级</div><div class="d-value">{{ preview.subject }} · {{ preview.grade }}</div></div>
        <div class="detail-item"><div class="d-label">题型 / 难度</div><div class="d-value">{{ preview.type }} · {{ preview.difficulty }}</div></div>
        <div class="detail-item"><div class="d-label">知识点</div><div class="d-value">{{ preview.knowledge.join('、') }}</div></div>
        <div class="detail-item"><div class="d-label">来源 / 库</div><div class="d-value">{{ preview.source }} · {{ LIBRARY_TEXT[preview.library] }}</div></div>
        <div class="detail-item"><div class="d-label">学期 / 考试类型</div><div class="d-value">{{ preview.term ?? '—' }} · {{ preview.examType ?? '—' }}</div></div>
        <div class="detail-item"><div class="d-label">考试次数</div><div class="d-value">{{ preview.useCount }} 次</div></div>
      </div>
      <h4 class="section-title">题干</h4>
      <RichTextViewer class="q-text" :content="preview.stem" empty="—" />
      <template v-if="preview.options.length > 0">
        <h4 class="section-title">选项</h4>
        <ul class="option-list">
          <li v-for="(opt, i) in preview.options" :key="i" :class="{ right: answerLetters(preview).includes('ABCDEF'[i]) }">
            {{ 'ABCDEF'[i] }}. <RichTextViewer :content="opt" tag="span" />
          </li>
        </ul>
      </template>
      <h4 class="section-title">答案</h4>
      <p class="q-text answer">{{ preview.answer || '—' }}</p>
      <h4 class="section-title">解析</h4>
      <RichTextViewer class="q-text" :content="preview.analysis" empty="—" />
      <template v-if="preview.variantOf != null">
        <h4 class="section-title">变式关联</h4>
        <p class="q-text">本题为题目 #{{ preview.variantOf }} 的变式，原题-变式关联永久存档，可互跳。</p>
      </template>
      <template v-if="preview.reviewOpinion">
        <h4 class="section-title">审核意见</h4>
        <p class="q-text reject">{{ preview.reviewOpinion }}</p>
      </template>
    </AppDrawer>

    <!-- 变式入口 -->
    <AppModal v-if="variantOpen" :title="`变式 · 题目 #${variantOpen.id}`" @close="variantOpen = null">
      <p class="f-hint" style="margin-bottom: 12px">{{ truncateRich(variantOpen.stem, 60) }}…</p>
      <button class="variant-entry" type="button" @click="onManualVariant">
        <span class="ve-title">手动变式</span>
        <span class="ve-desc">复制原题全部内容进入录题页，人工修改后保存，系统永久建立原题-变式关联</span>
      </button>
      <button class="variant-entry" type="button" @click="goAiVariant">
        <span class="ve-title">AI 变式</span>
        <span class="ve-desc">选择变式策略批量生成（消耗 AI 额度），结果卡片可逐题采纳 / 丢弃</span>
      </button>
    </AppModal>

    <!-- 组卷篮浮动条 -->
    <div v-if="basket.length" class="basket-bar">
      <AppIcon name="file" :size="16" />
      <span>已选 <b>{{ basket.length }}</b> 题</span>
      <button class="btn btn-primary btn-sm" @click="goCollab">去组卷</button>
      <button class="btn btn-ghost btn-sm" @click="clearBasket">清空</button>
    </div>
  </div>
</template>

<style scoped>
/* 整体高度随屏幕高度动态撑满内容区（顶栏 62 + 内容区上下内边距 44），
   左右两栏各自内部滚动，滚动题目列表时左侧知识点面板保持不动 */
.bank-layout {
  --content-h: calc(100vh - 106px);
  display: flex;
  gap: 14px;
  align-items: stretch;
  height: var(--content-h);
  min-height: 460px;
}
.right-col {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 14px;
  height: 100%;
}

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

/* ===== 筛选面板 ===== */
.filter-panel { padding: 0; overflow: visible; flex-shrink: 0; }
.fp-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 12px 16px;
  cursor: pointer;
  min-height: 46px;
}
.fp-title { font-size: 13.5px; font-weight: 700; color: var(--ink); display: flex; align-items: center; gap: 10px; flex-wrap: wrap; min-width: 0; }
.fp-summary { display: flex; align-items: center; gap: 8px; flex-wrap: nowrap; overflow: hidden; font-weight: 400; }
.fp-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  background: var(--brand-soft);
  color: var(--brand-deep);
  border-radius: 7px;
  padding: 3px 9px;
  font-size: 12px;
  max-width: 200px;
  min-width: 0;
}
.fp-chip b { font-weight: 700; flex-shrink: 0; }
.fp-values { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.fp-none { font-size: 12.5px; color: var(--sub); font-weight: 400; }
.fp-toggle { display: flex; align-items: center; gap: 6px; font-size: 12.5px; color: var(--sub); flex-shrink: 0; }
.fp-caret { transition: transform 0.18s; }
.fp-caret.up { transform: rotate(180deg); }
.fp-body { border-top: 1px dashed var(--border); padding: 12px 16px 14px; display: flex; flex-direction: column; gap: 10px; }

.cf-row { display: flex; align-items: flex-start; gap: 12px; }
.cf-label { width: 58px; flex-shrink: 0; font-size: 12.5px; font-weight: 600; color: var(--sub); line-height: 26px; }
.cf-opts { display: flex; flex-wrap: wrap; gap: 7px; flex: 1; min-width: 0; }
.opt-chip {
  border: 1.5px solid var(--border);
  border-radius: 8px;
  background: #fff;
  font-size: 12.5px;
  color: var(--ink-2);
  padding: 3px 12px;
  transition: all 0.12s;
}
.opt-chip:hover { border-color: var(--brand); color: var(--brand-deep); }
.opt-chip.on { background: var(--brand); border-color: var(--brand); color: #fff; font-weight: 600; }

/* ===== 列表 =====
   面板撑满右栏剩余高度：工具栏、分页固定，仅题目列表区域滚动 */
.table-panel { min-width: 0; flex: 1; min-height: 0; display: flex; flex-direction: column; }
.list-toolbar { display: flex; align-items: center; gap: 10px; margin-bottom: 12px; flex-shrink: 0; }
.search-box { position: relative; width: 240px; }
.search-box .f-input { padding-left: 32px; height: 34px; width: 100%; }
.search-box > :first-child { position: absolute; left: 10px; top: 50%; transform: translateY(-50%); color: var(--sub); pointer-events: none; }
.mode-toggle { margin-left: auto; display: flex; border: 1.5px solid var(--border); border-radius: 9px; overflow: hidden; }
.mode-toggle button {
  display: flex;
  align-items: center;
  gap: 5px;
  border: none;
  background: #fff;
  font-size: 12.5px;
  color: var(--sub);
  padding: 7px 14px;
}
.mode-toggle button.on { background: var(--brand-soft); color: var(--brand-deep); font-weight: 700; }

/* 表格区独立滚动（表头全局样式已 sticky） */
.data-table-wrap { flex: 1; min-height: 0; overflow: auto; }
.table-panel .pagination { flex-shrink: 0; }

.th-stem { min-width: 220px; }
.stem-cell {
  max-width: 320px;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
  line-clamp: 3;
  overflow: hidden;
  line-height: 1.6;
  font-size: 13px;
  color: var(--ink-2);
  cursor: pointer;
  text-align: left;
  vertical-align: middle;
}
.stem-cell:hover { color: var(--brand-deep); }
.knowledge-cell { font-size: 12.5px; max-width: 150px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.time-cell { font-size: 12.5px; color: var(--sub); white-space: nowrap; }

/* ===== 详细列表卡片 ===== */
.detail-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-right: 2px;
}
.q-card { border: 1px solid var(--border); border-radius: 14px; background: #fff; padding: 14px 18px; }
.qc-meta { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 10px; }
.qc-id { font-size: 13px; font-weight: 700; color: var(--ink); }
.qc-kp { font-size: 12px; color: var(--sub); }
.qc-right { margin-left: auto; font-size: 12px; color: var(--sub); }
.qc-stem { font-size: 13.5px; color: var(--ink); line-height: 1.8; cursor: pointer; }
.qc-figure {
  margin-top: 10px;
  height: 110px;
  border: 1px dashed var(--border);
  border-radius: 10px;
  background: repeating-conic-gradient(#f4f7f7 0% 25%, #fff 0% 50%) 50% / 16px 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: var(--sub);
  font-size: 12.5px;
}
.qc-options { margin-top: 10px; display: flex; flex-direction: column; gap: 6px; }
.qc-options li {
  display: flex;
  align-items: baseline;
  gap: 8px;
  border: 1px solid var(--border);
  border-radius: 9px;
  padding: 8px 12px;
  font-size: 13px;
  color: var(--ink-2);
}
.qc-options li.right { border-color: var(--success); background: var(--success-soft, #ecfaf4); }
.opt-letter { font-weight: 700; color: var(--sub); }
.qc-options li.right .opt-letter { color: var(--success); }
.qc-answer {
  margin-top: 10px;
  border-left: 3px solid var(--brand);
  background: #f7fafa;
  border-radius: 0 10px 10px 0;
  padding: 10px 14px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 13px;
  color: var(--ink-2);
  line-height: 1.7;
}
.qc-answer b { color: var(--ink); }
.qc-answer-text { color: var(--success); font-weight: 600; }
.qc-flags { margin-top: 8px; display: flex; align-items: center; gap: 10px; }
.qc-reject { font-size: 12.5px; color: var(--danger); }
.qc-ops { display: flex; align-items: center; justify-content: flex-end; gap: 8px; margin-top: 12px; border-top: 1px dashed var(--border); padding-top: 10px; }

/* ===== 组卷篮浮动条 ===== */
.basket-bar {
  position: fixed;
  right: 28px;
  bottom: 28px;
  z-index: 40;
  display: flex;
  align-items: center;
  gap: 10px;
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 999px;
  box-shadow: 0 10px 30px rgba(15, 60, 55, 0.16);
  padding: 9px 12px 9px 18px;
  font-size: 13px;
  color: var(--ink-2);
}
.basket-bar b { color: var(--brand-deep); }

/* ===== 预览抽屉 ===== */
.q-text {
  font-size: 13.5px;
  color: var(--ink-2);
  line-height: 1.8;
  background: #f7fafa;
  border-radius: 10px;
  padding: 12px 14px;
}
.q-text.answer { color: var(--success); font-weight: 600; }
.q-text.reject { color: var(--danger); }
.option-list { display: flex; flex-direction: column; gap: 8px; }
.option-list li { background: #f7fafa; border-radius: 8px; padding: 9px 12px; font-size: 13.5px; color: var(--ink-2); }
.option-list li.right { background: var(--success-soft, #ecfaf4); color: var(--success); font-weight: 600; }

/* ===== 变式入口 ===== */
.variant-entry {
  display: flex;
  flex-direction: column;
  gap: 5px;
  width: 100%;
  text-align: left;
  border: 1.5px solid var(--border);
  border-radius: 12px;
  padding: 13px 16px;
  background: #fff;
  margin-bottom: 10px;
  transition: border-color 0.15s;
}
.variant-entry:hover { border-color: var(--brand); }
.ve-title { font-size: 14px; font-weight: 700; color: var(--ink); }
.ve-desc { font-size: 12.5px; color: var(--sub); line-height: 1.6; }
</style>
