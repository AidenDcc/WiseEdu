<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { AppFilterPanel, AppIcon, AppListToolbar, AppSearchInput, showToast, ApiError, AppModal, appConfirm } from '@aiteach/shared'
import type { DictItem, ExamTypeNode, ExamTypeNodeKind, FilterRowDef } from '@aiteach/shared'
import AppSwitch from '@/components/ui/AppSwitch.vue'
import { deleteExamTypeNode, fetchDict, fetchExamTypeNodes, saveExamTypeNode, toggleExamTypeNode } from '@/api/platform'

/** 层级上限：与 mock 侧 `MAX_EXAM_TYPE_DEPTH` 同口径（改一处要改两处） */
const MAX_DEPTH = 5

const KIND_TEXT: Record<ExamTypeNodeKind, string> = {
  category: '试卷分类',
  examType: '考试类型',
  competition: '杯赛',
}

const nodes = ref<ExamTypeNode[]>([])
const subjects = ref<DictItem[]>([])
const FILTERS = reactive<Record<string, string[]>>({ kind: [] })

/* AppFilterPanel 回传整份筛选值（覆盖式回写），逐 key 写回这份 reactive 对象本身。
   不能交给 `v-model`：它会替换掉整个对象，而替换引用不是一次响应式写入 —— 点了 chip
   既不亮选中态也不重新筛选。机构端 CollabView 里有同款说明。 */
function onFiltersChange(next: Record<string, string[]>) {
  FILTERS.kind = next.kind ?? []
}
const keyword = ref('')
const collapsedIds = ref<number[]>([])

/* 「试卷分类」根不入筛选项：它是分组容器，本身不是可筛选的业务类型 */
const FILTER_ROWS: FilterRowDef[] = [
  { key: 'kind', label: '类型', options: [KIND_TEXT.examType, KIND_TEXT.competition], multiple: true },
]

const enabledSubjects = computed(() => subjects.value.filter((item) => item.enabled))

/** 编辑历史节点时，其学科可能已停用 —— 并入选项，避免保存时被静默改写成首项 */
const formSubjects = computed(() =>
  enabledSubjects.value
    .map((item) => item.name)
    .concat(form.subjects.filter((name) => !enabledSubjects.value.some((item) => item.name === name))),
)

async function load() {
  ;[nodes.value, subjects.value] = await Promise.all([fetchExamTypeNodes(), fetchDict('subject')])
}

/**
 * 类型筛选：命中节点**连同其祖先**一起保留，否则被选中的子节点会因为父节点被滤掉而
 * 从展平结果里消失（`rows` 是从根往下走的）。分类根则靠「有后代命中」自然保住，
 * 选「杯赛」时会只剩「竞赛」这一支。
 */
const filtered = computed(() => {
  const kinds = FILTERS.kind
  if (!kinds.length) return nodes.value
  const childrenOf = (parentId: number | null) =>
    nodes.value.filter((node) => node.parentId === parentId)
  const keep = new Set<number>()
  /* 返回「子树里是否有命中」，父节点据此决定自己是否保留 */
  const walk = (parentId: number | null): boolean => {
    let hit = false
    for (const node of childrenOf(parentId)) {
      const childHit = walk(node.id)
      if (childHit || kinds.includes(KIND_TEXT[node.kind])) {
        keep.add(node.id)
        hit = true
      }
    }
    return hit
  }
  walk(null)
  return nodes.value.filter((node) => keep.has(node.id))
})

interface TreeRow {
  node: ExamTypeNode
  depth: number
  hasChildren: boolean
}

/** 展平为带缩进的行：祖先全部展开才可见；搜索时自动展开命中路径 */
const rows = computed<TreeRow[]>(() => {
  const childrenOf = (parentId: number | null) =>
    filtered.value.filter((node) => node.parentId === parentId)
  const kw = keyword.value.trim()
  const matchedIds = new Set<number>()
  if (kw) {
    filtered.value.forEach((node) => {
      if (node.name.includes(kw)) {
        matchedIds.add(node.id)
        let current: ExamTypeNode | undefined = node
        while (current?.parentId != null) {
          matchedIds.add(current.parentId)
          current = filtered.value.find((row) => row.id === current!.parentId)
        }
      }
    })
  }
  const result: TreeRow[] = []
  const walk = (parentId: number | null, depth: number, ancestorsCollapsed: boolean) => {
    for (const node of childrenOf(parentId)) {
      const children = childrenOf(node.id)
      const visible = !ancestorsCollapsed || (kw && matchedIds.has(node.id))
      const collapsed = collapsedIds.value.includes(node.id) && !(kw && matchedIds.has(node.id))
      if (visible) {
        result.push({ node, depth, hasChildren: children.length > 0 })
      }
      /* 搜索时强制展开命中路径；否则折叠态沿祖先向下传递 */
      walk(node.id, depth + 1, kw ? false : ancestorsCollapsed || collapsed)
    }
  }
  /* 首参是「祖先是否已折叠」。根节点没有祖先，故传 false —— 传 true 时
     `visible = !ancestorsCollapsed` 对每个根节点恒为 false，且该值只增不减，
     整棵树会永远渲染成「暂无节点」。 */
  walk(null, 0, false)
  return result
})

function expandAll() {
  collapsedIds.value = []
}

function collapseAll() {
  collapsedIds.value = nodes.value.map((node) => node.id)
}

function toggleCollapse(id: number) {
  const index = collapsedIds.value.indexOf(id)
  if (index >= 0) collapsedIds.value.splice(index, 1)
  else collapsedIds.value.push(id)
}

function depthOf(id: number): number {
  let depth = 1
  let current = nodes.value.find((node) => node.id === id)
  while (current?.parentId != null) {
    depth += 1
    current = nodes.value.find((node) => node.id === current!.parentId)
  }
  return depth
}

async function onToggle(node: ExamTypeNode) {
  try {
    const result = await toggleExamTypeNode(node.id)
    showToast(result.enabled ? '已启用该节点及其整棵子树' : '已停用该节点及其整棵子树', 'success')
    load()
  } catch (error) {
    showToast(error instanceof ApiError ? error.message : '操作失败', 'error')
  }
}

async function onDelete(node: ExamTypeNode) {
  if (!(await appConfirm(`确认删除「${node.name}」？存在子节点时将无法删除。`, { type: 'danger' }))) return
  try {
    await deleteExamTypeNode(node.id)
    showToast('已删除', 'success')
    load()
  } catch (error) {
    showToast(error instanceof ApiError ? error.message : '删除失败', 'error')
  }
}

/* ===== 新增 / 编辑 ===== */
const STAGES = ['小学', '初中', '高中']

const editing = ref<{ node: ExamTypeNode | null; parentId: number | null } | null>(null)
const form = reactive({
  name: '',
  /* 只分「考试类型 / 杯赛」两种可维护类型；分类根由系统固定 */
  kind: 'examType' as Exclude<ExamTypeNodeKind, 'category'>,
  stage: '',
  subjects: [] as string[],
})
const formError = ref('')
const saving = ref(false)

/** 名称之外的字段只有「考试类型」才有意义（杯赛不参与学段 / 学科收窄） */
const isExamType = computed(() => form.kind === 'examType')

function openCreate(parentId: number) {
  if (depthOf(parentId) >= MAX_DEPTH) {
    showToast(`考试类型树最多 ${MAX_DEPTH} 级，无法再添加子节点`, 'error')
    return
  }
  editing.value = { node: null, parentId }
  form.name = ''
  form.kind = 'examType'
  form.stage = ''
  form.subjects = []
  formError.value = ''
}

function openEdit(node: ExamTypeNode) {
  editing.value = { node, parentId: node.parentId }
  form.name = node.name
  form.kind = node.kind === 'competition' ? 'competition' : 'examType'
  form.stage = node.stage ?? ''
  form.subjects = [...(node.subjects ?? [])]
  formError.value = ''
}

async function save() {
  if (!form.name.trim()) {
    formError.value = '节点名称不能为空'
    return
  }
  saving.value = true
  try {
    await saveExamTypeNode({
      id: editing.value?.node?.id,
      parentId: editing.value?.parentId ?? null,
      name: form.name.trim(),
      kind: form.kind,
      /* 传空串 = 「不限学段」，与 `saveExamTypeNode` 的 `input.stage || undefined` 对应；
         杯赛不带这两个字段，显式传 undefined 让 store 清掉旧值（改类型时会用到） */
      stage: isExamType.value ? form.stage : undefined,
      subjects: isExamType.value && form.subjects.length ? [...form.subjects] : undefined,
    })
    showToast('已保存', 'success')
    editing.value = null
    load()
  } catch (error) {
    formError.value = error instanceof ApiError ? error.message : '保存失败，请重试'
  } finally {
    saving.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="page">
    <!-- 搜索条件：独立面板，与下方列表分开（对齐机构端列表页布局） -->
    <AppFilterPanel :rows="FILTER_ROWS" :model-value="FILTERS" @update:model-value="onFiltersChange">
      <template #extra>
        <AppSearchInput v-model="keyword" placeholder="搜索名称，自动定位高亮" :width="260" />
      </template>
    </AppFilterPanel>

    <div class="panel">
      <AppListToolbar :searchable="false">
        <template #left>
          <span class="panel-hint">
            考试类型与杯赛合并维护，按试卷分类归类，最多 {{ MAX_DEPTH }} 级；停用 / 启用会同步整棵子树。
          </span>
        </template>
        <template #right>
          <button class="btn btn-ghost btn-sm" @click="expandAll">展开全部</button>
          <button class="btn btn-ghost btn-sm" @click="collapseAll">收起全部</button>
        </template>
      </AppListToolbar>

      <div class="tree-body">
        <div v-if="rows.length === 0" class="tree-empty">暂无节点</div>
        <div
          v-for="row in rows"
          :key="row.node.id"
          class="tree-row"
          :class="{ disabled: !row.node.enabled, hit: keyword.trim() !== '' && row.node.name.includes(keyword.trim()) }"
          :style="{ paddingLeft: `${14 + row.depth * 26}px` }"
        >
          <button
            class="chev-btn"
            :class="{ invisible: !row.hasChildren }"
            type="button"
            @click="toggleCollapse(row.node.id)"
          >
            <AppIcon name="chevron-right" :size="14" />
          </button>
          <span class="node-name">{{ row.node.name }}</span>
          <span class="tag" :class="row.node.kind === 'competition' ? 'tag-orange' : 'tag-gray'">
            {{ KIND_TEXT[row.node.kind] }}
          </span>
          <span v-if="row.node.stage" class="tag tag-gray">仅{{ row.node.stage }}</span>
          <span v-if="row.node.subjects?.length" class="tag tag-gray">{{ row.node.subjects.join('、') }}</span>
          <span v-if="row.depth >= MAX_DEPTH - 1" class="tag tag-orange">第 {{ row.depth + 1 }} 级</span>
          <span v-if="!row.node.enabled" class="tag tag-red">已停用</span>

          <div class="row-ops">
            <AppSwitch
              :model-value="row.node.enabled"
              @update:model-value="onToggle(row.node)"
            />
            <button class="mini-btn" type="button" @click="openCreate(row.node.id)">加子节点</button>
            <!-- 分类根由系统固定：机构端是按这四个名字分组的，改名 / 删除会让子节点在机构端树上失联 -->
            <template v-if="row.node.kind !== 'category'">
              <button class="mini-btn" type="button" @click="openEdit(row.node)">编辑</button>
              <button class="mini-btn danger" type="button" @click="onDelete(row.node)">删除</button>
            </template>
          </div>
        </div>
      </div>

      <AppModal
        v-if="editing"
        :title="editing.node ? '编辑节点' : '新增子节点'"
        @close="editing = null"
      >
        <div class="f-field">
          <label class="f-label">类型<span class="req">*</span></label>
          <select v-model="form.kind" class="f-select">
            <option value="examType">{{ KIND_TEXT.examType }}</option>
            <option value="competition">{{ KIND_TEXT.competition }}</option>
          </select>
          <p class="f-hint">
            杯赛只进机构端的「杯赛」筛选维度，不会出现在组卷的试卷类型树里。
          </p>
        </div>
        <div class="f-field">
          <label class="f-label">节点名称<span class="req">*</span></label>
          <input v-model="form.name" class="f-input" placeholder="最多 5 级，同级不可重名" />
        </div>
        <div v-if="isExamType" class="f-field">
          <label class="f-label">适配学段（留空 = 全学段通用）</label>
          <select v-model="form.stage" class="f-select">
            <option value="">不限</option>
            <option v-for="stage in STAGES" :key="stage" :value="stage">{{ stage }}</option>
          </select>
          <p class="f-hint">限定后，只在机构端选到该学段（如六年级）时才出现在试卷类型树与筛选项里。</p>
        </div>
        <div v-if="isExamType" class="f-field">
          <label class="f-label">适配学科（不勾选 = 全学科通用）</label>
          <div class="subject-checks">
            <label v-for="subject in formSubjects" :key="subject" class="check-item">
              <input v-model="form.subjects" type="checkbox" :value="subject" />
              {{ subject }}
            </label>
          </div>
          <p class="f-hint">勾选后该项只在机构端选到这些学科时出现，如「数学竞赛」只勾数学。</p>
        </div>
        <p v-if="formError" class="form-err">{{ formError }}</p>
        <template #footer>
          <button class="btn btn-ghost btn-sm" @click="editing = null">取消</button>
          <button class="btn btn-primary btn-sm" :disabled="saving" @click="save">
            {{ saving ? '保存中…' : '保存' }}
          </button>
        </template>
      </AppModal>
    </div>
  </div>
</template>

<style scoped>
/* 筛选面板已提为列表面板的兄弟节点（自带边框圆角），工具条顶部留白由它自己给 */
.panel > :deep(.list-toolbar) { padding: 14px 14px 0; }
.panel-hint { font-size: 12.5px; color: var(--sub); }

.tree-body { padding: 8px 10px 12px; }
.tree-empty { text-align: center; color: var(--sub); font-size: 13px; padding: 40px 0; }
.tree-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 12px;
  border-radius: 10px;
  font-size: 13.5px;
  color: var(--ink);
  transition: background 0.15s;
}
.tree-row:hover { background: #f7f9fd; }
.tree-row.disabled .node-name { color: var(--sub); text-decoration: line-through; }
.tree-row.hit { background: var(--brand-soft); }
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
.subject-checks { display: flex; flex-wrap: wrap; gap: 6px 16px; }
.check-item { display: flex; align-items: center; gap: 6px; font-size: 13px; cursor: pointer; }
.form-err { font-size: 12px; color: var(--danger); margin: 4px 0; }
</style>
