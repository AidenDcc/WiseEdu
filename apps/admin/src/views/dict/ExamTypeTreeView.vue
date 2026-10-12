<script setup lang="ts">
/**
 * 考试类型树（与知识点树、教材目录树共用同一套树组件 `AppTreeView`）。
 *
 * 与知识点树的差别都通过配置表达：
 * - **一级节点 = 分组**（阶段考试 / 真题 / 模拟试卷…）：它们既是树上的分类，也是机构端组卷
 *   「试卷类型树」的一级分组。分组与其它节点一视同仁 —— 可改名、增删、拖拽、启停用；
 * - 行标签多出「考试 / 杯赛」「适配学段」「适配学科」（分组行不打类型标签：它是容器）；
 * - 顶部搜索条件有 类型 / 学段 / 学科 三行（原搜索框已并入树组件的左上角）。
 *
 * 新增 / 编辑弹窗与知识点树同构：上级路径（只读）+ 适配学段 / 适配学科（chip 多选）
 * + 类型（chip 单选）+ 节点名称 + 节点编码（只读，平台自动生成）。
 */
import { computed, onMounted, reactive, ref } from 'vue'
import { AppChipGroup, AppFilterPanel, AppModal, ApiError, appConfirm, showToast } from '@aiteach/shared'
import type { DictItem, ExamTypeNode, ExamTypeNodeKind, FilterRowDef } from '@aiteach/shared'
import { deleteExamTypeNode, fetchDict, fetchExamTypeNodes, moveExamTypeNode, saveExamTypeNode, toggleExamTypeNode } from '@/api/platform'
import AppTreeView from '@/components/tree/AppTreeView.vue'
import type { TreeTag } from '@/components/tree/tree-utils'
import { childrenOf, depthOf, pathText } from '@/components/tree/tree-utils'

/** 层级上限：与 mock 侧 `MAX_EXAM_TYPE_DEPTH` 同口径（改一处要改两处） */
const MAX_DEPTH = 5

/** 类型文案：同时也是「类型」筛选行的候选项 */
const KIND_TEXT: Record<ExamTypeNodeKind, string> = {
  examType: '考试',
  competition: '杯赛',
}
/** 学段展示顺序：字典里的学段是无序的，顺序只在这里定 */
const STAGE_ORDER = ['小学', '初中', '高中']
function stageRank(stage: string) {
  const index = STAGE_ORDER.indexOf(stage)
  return index < 0 ? STAGE_ORDER.length : index
}

const nodes = ref<ExamTypeNode[]>([])
const grades = ref<DictItem[]>([])
const subjects = ref<DictItem[]>([])
const FILTERS = reactive<Record<string, string[]>>({ kind: [], stage: [], subject: [] })

/* AppFilterPanel 回传整份筛选值（覆盖式回写），逐 key 写回这份 reactive 对象本身。
   不能交给 `v-model`：它会替换掉整个对象，而替换引用不是一次响应式写入 —— 点了 chip
   既不亮选中态也不重新筛选。机构端 CollabView 里有同款说明。 */
function onFiltersChange(next: Record<string, string[]>) {
  FILTERS.kind = next.kind ?? []
  FILTERS.stage = next.stage ?? []
  FILTERS.subject = next.subject ?? []
}

const enabledSubjects = computed(() => subjects.value.filter((item) => item.enabled))

/** 学段候选项：以年级字典的 `stage` 为准（学段就是这么配置出来的），再并上节点上的历史值 */
const stageOptions = computed(() => {
  const set = new Set<string>()
  grades.value.forEach((item) => { if (item.enabled && item.stage) set.add(item.stage) })
  nodes.value.forEach((node) => node.stages?.forEach((name) => set.add(name)))
  return [...set].sort((a, b) => stageRank(a) - stageRank(b) || a.localeCompare(b))
})

/**
 * 学科候选项：启用的学科字典项 + 节点上已被引用的历史值。
 * 后者不能丢 —— 学科被停用后，历史节点上的值必须还能展示、编辑时也不会被静默改写。
 */
const subjectOptions = computed(() => {
  const enabled = enabledSubjects.value.map((item) => item.name)
  const used = new Set<string>()
  nodes.value.forEach((node) => node.subjects?.forEach((name) => used.add(name)))
  return [...enabled, ...[...used].filter((name) => !enabled.includes(name))]
})

/* ===== 搜索条件：类型 / 学段 / 学科 ===== */
const FILTER_ROWS = computed<FilterRowDef[]>(() => [
  { key: 'kind', label: '类型', options: [KIND_TEXT.examType, KIND_TEXT.competition], multiple: true },
  { key: 'stage', label: '学段', options: stageOptions.value, multiple: true },
  { key: 'subject', label: '学科', options: subjectOptions.value, multiple: true },
])

async function load() {
  ;[nodes.value, grades.value, subjects.value] = await Promise.all([
    fetchExamTypeNodes(),
    fetchDict('grade'),
    fetchDict('subject'),
  ])
}

/**
 * 筛选：命中节点**连同其祖先**一起保留，否则被选中的子节点会因为父节点被滤掉而
 * 从展平结果里消失（树是从根往下走的）。分组则靠「有后代命中」自然保住。
 *
 * 学段 / 学科取**宽松口径**（与机构端 `useBaseData.scopedExamTypes` 一致）：
 * 「没配 = 全学段 / 全学科通用」，所以未标记的节点在任何学段 / 学科下都该被搜出来 ——
 * 严格口径（只留真的标了所选维度的节点）会让「期中考试」这种通用项在按学段筛选时凭空消失，
 * 维护时反而看不见它。多选维度均按「有交集即命中」判。
 */
const filtered = computed(() => {
  const kinds = FILTERS.kind
  const stages = FILTERS.stage
  const subjects = FILTERS.subject
  if (!kinds.length && !stages.length && !subjects.length) return nodes.value

  const hit = (node: ExamTypeNode) => {
    const kindOk = !kinds.length || kinds.includes(KIND_TEXT[node.kind])
    const stageOk = !stages.length || !node.stages?.length || node.stages.some((name) => stages.includes(name))
    const subjectOk = !subjects.length || !node.subjects?.length || node.subjects.some((name) => subjects.includes(name))
    return kindOk && stageOk && subjectOk
  }
  const kidsOf = (parentId: number | null) => nodes.value.filter((node) => node.parentId === parentId)
  const keep = new Set<number>()
  /* 返回「子树里是否有命中」，父节点据此决定自己是否保留 */
  const walk = (parentId: number | null): boolean => {
    let any = false
    for (const node of kidsOf(parentId)) {
      const childHit = walk(node.id)
      if (childHit || hit(node)) {
        keep.add(node.id)
        any = true
      }
    }
    return any
  }
  walk(null)
  return nodes.value.filter((node) => keep.has(node.id))
})

/* ===== 交给通用树组件的「考试类型」专属配置 ===== */
function rowTags(node: ExamTypeNode): TreeTag[] {
  /* 一级节点是分组（容器），不打类型标签 —— 「阶段考试」既不是考试也不是杯赛；
     学段 / 学科标签只跟在真正可选的类型后面。 */
  if (node.parentId === null) return []
  const tags: TreeTag[] = [{ text: KIND_TEXT[node.kind], tone: node.kind === 'competition' ? 'orange' : 'gray' }]
  if (node.stages?.length) tags.push({ text: node.stages.join('、'), tone: 'gray' })
  if (node.subjects?.length) tags.push({ text: node.subjects.join('、'), tone: 'gray' })
  return tags
}

const moving = ref(false)
async function onMove(payload: { id: number; parentId: number | null; beforeId: number | null }) {
  if (moving.value) return
  moving.value = true
  try {
    await moveExamTypeNode(payload)
    await load()
  } catch (error) {
    showToast(error instanceof ApiError ? error.message : '移动失败', 'error')
  } finally {
    moving.value = false
  }
}
async function onMoveBy(payload: { node: ExamTypeNode; direction: -1 | 1 }) {
  const { node, direction } = payload
  const list = childrenOf(filtered.value, node.parentId)
  const index = list.findIndex((item) => item.id === node.id)
  const neighbor = list[index + direction]
  if (!neighbor) return
  const beforeId = direction < 0 ? neighbor.id : (list[index + direction + 1]?.id ?? null)
  await onMove({ id: node.id, parentId: node.parentId, beforeId })
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
const editing = ref<{ node: ExamTypeNode | null; parentId: number | null } | null>(null)
const form = reactive({
  name: '',
  code: '',
  /* 只有「考试 / 杯赛」两种类型：考试进机构端的考试类型维度，杯赛进杯赛维度 */
  kind: 'examType' as ExamTypeNodeKind,
  stages: [] as string[],
  subjects: [] as string[],
})
const formError = ref('')
const saving = ref(false)

/** 类型用 chip 单选：选项文案是「考试 / 杯赛」，落库值仍是 examType / competition */
const KIND_CHIPS = [KIND_TEXT.examType, KIND_TEXT.competition]
const kindChips = computed<string[]>({
  get: () => [KIND_TEXT[form.kind]],
  set: (value) => { form.kind = value[0] === KIND_TEXT.competition ? 'competition' : 'examType' },
})

/** 上级路径：编辑态与新增都一眼看出挂在谁下面；一级节点显示「无上级」而不是整行隐藏 */
const parentPath = computed(() => pathText(nodes.value, editing.value?.parentId ?? null))

function openCreate(parentId: number | null) {
  if (parentId != null && depthOf(nodes.value, parentId) >= MAX_DEPTH) {
    showToast(`考试类型树最多 ${MAX_DEPTH} 级，无法再添加子节点`, 'error')
    return
  }
  editing.value = { node: null, parentId }
  form.name = ''
  form.code = ''
  form.kind = 'examType'
  form.stages = []
  form.subjects = []
  formError.value = ''
}

function openEdit(node: ExamTypeNode) {
  editing.value = { node, parentId: node.parentId }
  form.name = node.name
  form.code = node.code
  form.kind = node.kind === 'competition' ? 'competition' : 'examType'
  form.stages = [...(node.stages ?? [])]
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
      /* 适配学段 / 学科对「考试」与「杯赛」都成立，空数组 = 不限；编码由平台维护，不上送。
         学段按「小学 → 初中 → 高中」归一到固定顺序，免得存成点击顺序（高中、初中）看着别扭 */
      stages: [...form.stages].sort((a, b) => stageRank(a) - stageRank(b) || a.localeCompare(b)),
      subjects: [...form.subjects],
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
    <!-- 搜索条件：类型 / 学段 / 学科；搜索框已并入树组件左上角 -->
    <AppFilterPanel :rows="FILTER_ROWS" :model-value="FILTERS" @update:model-value="onFiltersChange" />

    <div class="panel tree-panel">
      <AppTreeView
        :nodes="filtered"
        :max-depth="MAX_DEPTH"
        search-placeholder="搜索名称，自动定位高亮"
        empty-text="暂无节点，可新增根节点"
        root-label="新增根节点"
        :show-move="true"
        :row-tags="rowTags"
        @create-root="openCreate(null)"
        @add-child="(node) => openCreate(node.id)"
        @edit="openEdit"
        @remove="onDelete"
        @toggle="onToggle"
        @move="onMove"
        @move-by="onMoveBy"
      />

      <AppModal
        v-if="editing"
        :title="editing.node ? '编辑节点' : editing.parentId == null ? '新增根节点' : '新增子节点'"
        @close="editing = null"
      >
        <div class="f-field">
          <label class="f-label">上级路径</label>
          <div class="parent-path">{{ parentPath || '顶级节点（无上级）' }}</div>
        </div>
        <div class="f-field">
          <label class="f-label">适配学段<span class="muted">（多选，不选 = 全学段通用）</span></label>
          <AppChipGroup v-model="form.stages" :options="stageOptions" />
        </div>
        <div class="f-field">
          <label class="f-label">适配学科<span class="muted">（多选，不选 = 全学科通用）</span></label>
          <AppChipGroup v-model="form.subjects" :options="subjectOptions" />
        </div>
        <div class="f-field">
          <label class="f-label">类型<span class="req">*</span></label>
          <AppChipGroup v-model="kindChips" :options="KIND_CHIPS" :multiple="false" :clearable="false" />
          <p class="f-hint">杯赛只进机构端的「杯赛」筛选维度，不会出现在组卷的试卷类型树里。</p>
        </div>
        <div class="f-field">
          <label class="f-label">节点名称<span class="req">*</span></label>
          <input v-model="form.name" class="f-input" placeholder="最多 5 级，同级不可重名" />
        </div>
        <div class="f-field">
          <label class="f-label">节点编码</label>
          <input class="f-input" :value="form.code" disabled placeholder="保存后由系统自动生成" />
          <p class="f-hint">编码由平台自动生成、全局唯一，不支持手动修改。</p>
        </div>
        <p v-if="formError" class="form-err">{{ formError }}</p>
        <template #footer>
          <button class="btn btn-ghost btn-sm" type="button" @click="editing = null">取消</button>
          <button class="btn btn-primary btn-sm" type="button" :disabled="saving" @click="save">
            {{ saving ? '保存中…' : '保存' }}
          </button>
        </template>
      </AppModal>
    </div>
  </div>
</template>

<style scoped>
/* 页面整体不滚动，滚动收进树面板（与知识点树一致） */
.page { height: calc(100vh - 62px - 44px); min-height: 520px; }
.tree-panel { display: flex; flex-direction: column; flex: 1; min-height: 0; }
/* 树组件（AppTreeView）的工具条留出与面板一致的内边距 */
.tree-panel :deep(.list-toolbar) { padding: 14px 14px 0; }
.parent-path { padding: 9px 10px; border-radius: 8px; background: #f7f9fd; color: var(--sub); font-size: 13px; }
.f-label .muted { color: var(--sub); font-weight: 400; margin-left: 4px; }
.form-err { font-size: 12px; color: var(--danger); margin: 4px 0; }
</style>
