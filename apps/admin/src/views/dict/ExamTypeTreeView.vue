<script setup lang="ts">
/**
 * 考试类型树（与知识点树、教材目录树共用同一套树组件 `AppTreeView`）。
 *
 * 与知识点树的差别都通过配置表达：
 * - 分类根由系统固定 —— 不可编辑 / 删除 / 拖拽，但可以往里加子节点（`rowConfig`）；
 * - 不允许新增根节点、不允许拖到根层级（`rootLabel=""` / `allowRootLevel=false`）；
 * - 行标签多出「考试类型 / 杯赛」「仅X学段」「适配学科」；
 * - 顶部只有「类型」筛选（原搜索框已并入树组件的左上角）。
 */
import { computed, onMounted, reactive, ref } from 'vue'
import { AppFilterPanel, AppModal, ApiError, appConfirm, showToast } from '@aiteach/shared'
import type { DictItem, ExamTypeNode, ExamTypeNodeKind, FilterRowDef } from '@aiteach/shared'
import { deleteExamTypeNode, fetchDict, fetchExamTypeNodes, moveExamTypeNode, saveExamTypeNode, toggleExamTypeNode } from '@/api/platform'
import AppTreeView from '@/components/tree/AppTreeView.vue'
import type { TreeRowConfig, TreeTag } from '@/components/tree/tree-utils'
import { childrenOf, depthOf } from '@/components/tree/tree-utils'

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
 * 从展平结果里消失（树是从根往下走的）。分类根则靠「有后代命中」自然保住，
 * 选「杯赛」时会只剩「竞赛」这一支。
 */
const filtered = computed(() => {
  const kinds = FILTERS.kind
  if (!kinds.length) return nodes.value
  const kidsOf = (parentId: number | null) => nodes.value.filter((node) => node.parentId === parentId)
  const keep = new Set<number>()
  /* 返回「子树里是否有命中」，父节点据此决定自己是否保留 */
  const walk = (parentId: number | null): boolean => {
    let hit = false
    for (const node of kidsOf(parentId)) {
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

/* ===== 交给通用树组件的「考试类型」专属配置 ===== */
function rowTags(node: ExamTypeNode): TreeTag[] {
  const tags: TreeTag[] = [{ text: KIND_TEXT[node.kind], tone: node.kind === 'competition' ? 'orange' : 'gray' }]
  if (node.stage) tags.push({ text: `仅${node.stage}`, tone: 'gray' })
  if (node.subjects?.length) tags.push({ text: node.subjects.join('、'), tone: 'gray' })
  return tags
}
/** 分类根由系统固定：不可编辑 / 删除 / 拖拽（但可加子节点） */
function rowConfig(node: ExamTypeNode): TreeRowConfig {
  return node.kind === 'category' ? { editable: false, draggable: false } : {}
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
  if (depthOf(nodes.value, parentId) >= MAX_DEPTH) {
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
    <!-- 搜索条件：只有「类型」一项；搜索框已并入树组件左上角 -->
    <AppFilterPanel :rows="FILTER_ROWS" :model-value="FILTERS" @update:model-value="onFiltersChange" />

    <div class="panel tree-panel">
      <AppTreeView
        :nodes="filtered"
        :max-depth="MAX_DEPTH"
        search-placeholder="搜索名称，自动定位高亮"
        empty-text="暂无节点"
        root-label=""
        :allow-root-level="false"
        :show-move="true"
        :row-tags="rowTags"
        :row-config="rowConfig"
        @add-child="(node) => openCreate(node.id)"
        @edit="openEdit"
        @remove="onDelete"
        @toggle="onToggle"
        @move="onMove"
        @move-by="onMoveBy"
      />

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
/* 页面整体不滚动，滚动收进树面板（与知识点树一致） */
.page { height: calc(100vh - 62px - 44px); min-height: 520px; }
.tree-panel { display: flex; flex-direction: column; flex: 1; min-height: 0; }
/* 树组件（AppTreeView）的工具条留出与面板一致的内边距 */
.tree-panel :deep(.list-toolbar) { padding: 14px 14px 0; }
.subject-checks { display: flex; flex-wrap: wrap; gap: 6px 16px; }
.check-item { display: flex; align-items: center; gap: 6px; font-size: 13px; cursor: pointer; }
.form-err { font-size: 12px; color: var(--danger); margin: 4px 0; }
</style>
