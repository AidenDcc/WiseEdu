<script setup lang="ts">
/**
 * 知识点树（平台管理端字典）。
 *
 * 树体本身交给通用组件 `AppTreeView`（与考试类型树、教材目录树同一份实现）——
 * 搜索、展开 / 收起、新增根节点、拖拽、启停用、加子节点、上移 / 下移、编辑、删除
 * 都在组件内部完成，这里只保留「知识点」特有的部分：
 * - 学段页签 + 学科页签（学科随学段收窄），把树按「学段 + 学科」分棵；
 * - 新增 / 编辑弹窗（节点名称 + 自动生成的只读编码 + 只读的学段 / 学科）；
 * - 移动时的「父子学段 / 学科必须一致」校验（组件不知道这两个维度）。
 */
import { computed, onMounted, reactive, ref } from 'vue'
import { ApiError, AppModal, AppSegmented, AppTabs, appConfirm, showToast } from '@aiteach/shared'
import type { DictItem, KnowledgeNode } from '@aiteach/shared'
import { deleteKnowledgeNode, fetchDict, fetchKnowledge, moveKnowledgeNode, saveKnowledgeNode, toggleKnowledgeNode } from '@/api/platform'
import AppTreeView from '@/components/tree/AppTreeView.vue'
import { childrenOf, pathText } from '@/components/tree/tree-utils'

/** 层级上限：与 mock 侧 `MAX_KNOWLEDGE_DEPTH` 同口径（改一处要改两处） */
const MAX_DEPTH = 5
/** 学段展示顺序。学段取值本身来自年级字典（无序），页签顺序只在这里定：小学 → 初中 → 高中 */
const STAGE_ORDER = ['小学', '初中', '高中']

const nodes = ref<KnowledgeNode[]>([])
const grades = ref<DictItem[]>([])
const subjects = ref<DictItem[]>([])
const activeStage = ref('')
const activeSubject = ref('')
const moving = ref(false)
const editing = ref<{ node: KnowledgeNode | null; parentId: number | null } | null>(null)
const form = reactive({ name: '', code: '', stage: '', subject: '' })
const formError = ref('')
const saving = ref(false)

const enabledGrades = computed(() => grades.value.filter((item) => item.enabled))
const enabledSubjects = computed(() => subjects.value.filter((item) => item.enabled))

function stageRank(stage: string) {
  const index = STAGE_ORDER.indexOf(stage)
  return index < 0 ? STAGE_ORDER.length : index
}
/** 学段清单以年级字典的 `stage` 为准（年级挂靠学段，学段就是这么配置出来的），节点上的学段只作兜底 */
const stageTabs = computed(() => {
  const stages = new Set<string>()
  enabledGrades.value.forEach((item) => { if (item.stage) stages.add(item.stage) })
  nodes.value.forEach((node) => stages.add(node.stage))
  return [...stages].sort((a, b) => stageRank(a) - stageRank(b) || a.localeCompare(b))
})

/** 年级名 → 学段：学科「适配年级」要换算成学段才能判断它挂不挂得上当前学段 */
const gradeStage = computed(() => new Map(grades.value.map((item) => [item.name, item.stage])))
/**
 * 学科页签按当前学段收窄：适配年级留空 = 不限年级（小学到高中都有），
 * 否则只要有**任一**适配年级落在该学段就算命中 —— 于是小学学段下不会出现物理、化学。
 * 学段下一个学科都匹配不上时（自定义学段等）退回全量，免得树整个空掉。
 */
const subjectTabs = computed(() => {
  const stage = activeStage.value
  const scoped = enabledSubjects.value.filter(
    (item) => !item.grades?.length || item.grades.some((name) => gradeStage.value.get(name) === stage),
  )
  return scoped.length ? scoped : enabledSubjects.value
})

/** 当前页签（学段 + 学科）对应的那棵树 —— 交给 AppTreeView 渲染 */
const filtered = computed(() => nodes.value.filter((node) => node.stage === activeStage.value && node.subject === activeSubject.value))

async function load() {
  ;[nodes.value, grades.value, subjects.value] = await Promise.all([fetchKnowledge(), fetchDict('grade'), fetchDict('subject')])
  if (!stageTabs.value.includes(activeStage.value)) activeStage.value = stageTabs.value[0] ?? nodes.value[0]?.stage ?? ''
  if (!subjectTabs.value.some((item) => item.name === activeSubject.value)) activeSubject.value = subjectTabs.value[0]?.name ?? ''
}
function switchStage(stage: string) { activeStage.value = stage; activeSubject.value = subjectTabs.value[0]?.name ?? '' }
function switchSubject(subject: string) { activeSubject.value = subject }

/* ===== 移动（拖拽 / 上下移都汇到这里） ===== */
async function applyMove(node: KnowledgeNode, parentId: number | null, beforeId: number | null) {
  if (moving.value) return
  moving.value = true
  try {
    await moveKnowledgeNode({ id: node.id, parentId, beforeId })
    await load()
  } catch (error) {
    showToast(error instanceof ApiError ? error.message : '移动失败', 'error')
  } finally {
    moving.value = false
  }
}
async function onMove(payload: { id: number; parentId: number | null; beforeId: number | null }) {
  const source = nodes.value.find((node) => node.id === payload.id)
  if (!source) return
  if (payload.parentId != null) {
    const parent = nodes.value.find((node) => node.id === payload.parentId)
    if (parent && (parent.stage !== source.stage || parent.subject !== source.subject)) {
      showToast('父子节点的学段与学科必须一致', 'error')
      return
    }
  }
  await applyMove(source, payload.parentId, payload.beforeId)
}
async function onMoveBy(payload: { node: KnowledgeNode; direction: -1 | 1 }) {
  const { node, direction } = payload
  const list = childrenOf(filtered.value, node.parentId)
  const index = list.findIndex((item) => item.id === node.id)
  const neighbor = list[index + direction]
  if (!neighbor) return
  const beforeId = direction < 0 ? neighbor.id : (list[index + direction + 1]?.id ?? null)
  await applyMove(node, node.parentId, beforeId)
}

async function onToggle(node: KnowledgeNode) {
  try {
    const result = await toggleKnowledgeNode(node.id)
    showToast(result.enabled ? '已启用该节点及其整棵子树' : '已停用该节点及其整棵子树', 'success')
    await load()
  } catch (error) {
    showToast(error instanceof ApiError ? error.message : '操作失败', 'error')
  }
}
async function onDelete(node: KnowledgeNode) {
  if (!(await appConfirm(`确认删除「${node.name}」？存在子节点时将无法删除。`, { type: 'danger' }))) return
  try {
    await deleteKnowledgeNode(node.id)
    showToast('已删除', 'success')
    await load()
  } catch (error) {
    showToast(error instanceof ApiError ? error.message : '删除失败', 'error')
  }
}

/** 上级路径：编辑态与新增子节点都要能一眼看出挂在谁下面；根节点显示「顶级节点」而不是整行隐藏 */
const parentPath = computed(() => pathText(nodes.value, editing.value?.parentId ?? null))

function openCreate(parentId: number | null) {
  editing.value = { node: null, parentId }
  form.name = ''
  /* 编码由平台自动生成，新增时不预置 */
  form.code = ''
  /* 学段 / 学科跟随当前页签（挂子节点时以父节点为准，两者必然一致）—— 弹窗里只读展示 */
  form.stage = parentId == null ? activeStage.value : (nodes.value.find((node) => node.id === parentId)?.stage ?? activeStage.value)
  form.subject = parentId == null ? activeSubject.value : (nodes.value.find((node) => node.id === parentId)?.subject ?? activeSubject.value)
  formError.value = ''
}
function openEdit(node: KnowledgeNode) {
  editing.value = { node, parentId: node.parentId }
  form.name = node.name
  form.code = node.code
  form.stage = node.stage
  form.subject = node.subject
  formError.value = ''
}
async function save() {
  if (!form.name.trim()) {
    formError.value = '请填写节点名称'
    return
  }
  saving.value = true
  try {
    /* 编码由平台自动生成 / 维护，这里不再上送 */
    const saved = await saveKnowledgeNode({
      id: editing.value?.node?.id,
      parentId: editing.value?.parentId ?? null,
      name: form.name.trim(),
      stage: form.stage,
      subject: form.subject,
    })
    showToast('已保存', 'success')
    editing.value = null
    await load()
    /* 回到刚保存节点所在的那棵树，否则新增在别处时会被「当前页签」挡住看不见 */
    activeStage.value = saved.stage
    activeSubject.value = saved.subject
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
    <!-- 学段：单独一块面板，学科随它收窄 -->
    <div class="panel stage-panel">
      <span class="stage-label">学段</span>
      <AppSegmented
        :options="stageTabs.map((stage) => ({ value: stage, label: stage }))"
        :model-value="activeStage"
        @update:model-value="switchStage"
      />
      <span class="stage-hint">学科按学段收窄，节点按「学段 + 学科」分树维护，最多 {{ MAX_DEPTH }} 级</span>
    </div>

    <div class="panel tree-panel">
      <!-- 学科页签：与下方搜索框同处一块面板，紧贴搜索框上方 -->
      <div class="subject-head">
        <AppTabs :tabs="subjectTabs.map((item) => ({ key: item.name, label: item.name }))" :model-value="activeSubject" @update:model-value="switchSubject" />
      </div>

      <AppTreeView
        :nodes="filtered"
        :max-depth="MAX_DEPTH"
        search-placeholder="搜索节点名称，自动定位高亮"
        empty-text="暂无节点，可新增根节点"
        :show-move="true"
        @create-root="openCreate(null)"
        @add-child="(node) => openCreate(node.id)"
        @edit="openEdit"
        @remove="onDelete"
        @toggle="onToggle"
        @move="onMove"
        @move-by="onMoveBy"
      />

      <AppModal v-if="editing" :title="editing.node ? '编辑节点' : editing.parentId == null ? '新增根节点' : '新增子节点'" @close="editing = null">
        <div class="f-field"><label class="f-label">上级路径</label><div class="parent-path">{{ parentPath || '顶级节点（无上级）' }}</div></div>
        <div class="f-field">
          <label class="f-label">所属学段 / 学科</label>
          <div class="scope-fixed"><span class="tag tag-gray">{{ form.stage }}</span><span class="tag tag-gray">{{ form.subject }}</span></div>
          <p class="f-hint">跟随当前页签带入，不可修改。</p>
        </div>
        <div class="f-field"><label class="f-label">节点名称<span class="req">*</span></label><input v-model="form.name" class="f-input" placeholder="最多 5 级，同级不可重名" /></div>
        <div class="f-field">
          <label class="f-label">知识点编码</label>
          <input class="f-input" :value="form.code" disabled placeholder="保存后由系统自动生成" />
          <p class="f-hint">编码由平台自动生成、全局唯一，不支持手动修改。</p>
        </div>
        <p v-if="formError" class="form-err">{{ formError }}</p>
        <template #footer><button class="btn btn-ghost btn-sm" @click="editing = null">取消</button><button class="btn btn-primary btn-sm" :disabled="saving" @click="save">{{ saving ? '保存中…' : '保存' }}</button></template>
      </AppModal>
    </div>
  </div>
</template>

<style scoped>
/* 页面不再整体滚动，滚动收进知识点树面板：小屏时靠 min-height 兜底，
   超出的部分交回外层 .content，页签（学段 / 学科）始终留在视口内。 */
.page { height: calc(100vh - 62px - 44px); min-height: 520px; }
.stage-panel { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; flex-shrink: 0; padding: 12px 16px; }
.stage-label { font-size: 12.5px; color: var(--sub); flex-shrink: 0; }
.stage-hint { font-size: 12.5px; color: var(--sub); margin-left: auto; }
.tree-panel { display: flex; flex-direction: column; flex: 1; min-height: 0; }
.subject-head { padding: 14px 14px 0; flex-shrink: 0; }
.subject-head :deep(.tab-bar) { margin-bottom: 0; }
/* 树组件（AppTreeView）的工具条留出与面板一致的内边距 */
.tree-panel :deep(.list-toolbar) { padding: 12px 14px 0; }
.parent-path { padding: 9px 10px; border-radius: 8px; background: #f7f9fd; color: var(--sub); font-size: 13px; }
.scope-fixed { display: flex; align-items: center; gap: 8px; }
.form-err { font-size: 12px; color: var(--danger); margin: 4px 0; }
</style>
