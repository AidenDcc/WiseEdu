<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { AppIcon, showToast, ApiError } from '@aiteach/shared'
import type { DictItem, KnowledgeNode } from '@aiteach/shared'
import AppModal from '@/components/ui/AppModal.vue'
import { deleteKnowledgeNode, fetchDict, fetchKnowledge, saveKnowledgeNode, toggleKnowledgeNode } from '@/api/platform'

const MAX_DEPTH = 6

const nodes = ref<KnowledgeNode[]>([])
const subjects = ref<DictItem[]>([])
const subjectFilter = ref('')
const keyword = ref('')
const collapsedIds = ref<number[]>([])

/** 学科选项统一取自全局字典，避免新增学科后此处漏配 */
const enabledSubjects = computed(() => subjects.value.filter((item) => item.enabled))

/** 编辑历史节点时，其学科可能已停用 —— 并入选项，避免保存时被静默改写成首项 */
const formSubjects = computed(() => {
  const names = enabledSubjects.value.map((item) => item.name)
  return form.subject && !names.includes(form.subject) ? [...names, form.subject] : names
})

async function load() {
  ;[nodes.value, subjects.value] = await Promise.all([fetchKnowledge(), fetchDict('subject')])
}

const filtered = computed(() =>
  subjectFilter.value ? nodes.value.filter((node) => node.subject === subjectFilter.value) : nodes.value,
)

interface TreeRow {
  node: KnowledgeNode
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
        let current: KnowledgeNode | undefined = node
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

async function onToggle(node: KnowledgeNode) {
  try {
    const result = await toggleKnowledgeNode(node.id)
    showToast(result.enabled ? '已启用该节点及其整棵子树' : '已停用该节点及其整棵子树', 'success')
    load()
  } catch (error) {
    showToast(error instanceof ApiError ? error.message : '操作失败', 'error')
  }
}

async function onDelete(node: KnowledgeNode) {
  if (!window.confirm(`确认删除「${node.name}」？存在子节点时将无法删除。`)) return
  try {
    await deleteKnowledgeNode(node.id)
    showToast('已删除', 'success')
    load()
  } catch (error) {
    showToast(error instanceof ApiError ? error.message : '删除失败', 'error')
  }
}

/* ===== 新增 / 编辑 ===== */
const editing = ref<{ node: KnowledgeNode | null; parentId: number | null } | null>(null)
const form = reactive({ name: '', subject: '数学' })
const formError = ref('')
const saving = ref(false)

function openCreate(parentId: number | null) {
  if (parentId != null && depthOf(parentId) >= MAX_DEPTH) {
    showToast(`知识点树最多 ${MAX_DEPTH} 级，无法再添加子节点`, 'error')
    return
  }
  editing.value = { node: null, parentId }
  form.name = ''
  form.subject = subjectFilter.value || enabledSubjects.value[0]?.name || ''
  formError.value = ''
}

function openEdit(node: KnowledgeNode) {
  editing.value = { node, parentId: node.parentId }
  form.name = node.name
  form.subject = node.subject
  formError.value = ''
}

async function save() {
  if (!form.name.trim()) {
    formError.value = '节点名称不能为空'
    return
  }
  saving.value = true
  try {
    await saveKnowledgeNode({
      id: editing.value?.node?.id,
      parentId: editing.value?.parentId ?? null,
      name: form.name.trim(),
      subject: form.subject,
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
  <div class="panel">
    <div class="filter-bar">
      <select v-model="subjectFilter" class="f-select" style="width: 120px">
        <option value="">全部学科</option>
        <option v-for="subject in enabledSubjects" :key="subject.id" :value="subject.name">{{ subject.name }}</option>
      </select>
      <div class="search-box">
        <AppIcon name="search" :size="15" />
        <input v-model="keyword" class="f-input" placeholder="搜索节点名称，自动定位高亮" />
      </div>
      <button class="btn btn-ghost btn-sm" @click="expandAll">展开全部</button>
      <button class="btn btn-ghost btn-sm" @click="collapseAll">收起全部</button>
      <button class="btn btn-primary btn-sm" style="margin-left: auto" @click="openCreate(null)">
        <AppIcon name="plus" :size="15" /> 新增根节点
      </button>
    </div>

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
        <span class="tag tag-gray">{{ row.node.subject }}</span>
        <span v-if="row.depth >= MAX_DEPTH - 1" class="tag tag-orange">第 {{ row.depth + 1 }} 级</span>
        <span v-if="!row.node.enabled" class="tag tag-red">已停用</span>

        <div class="row-ops">
          <AppSwitch
            :model-value="row.node.enabled"
            @update:model-value="onToggle(row.node)"
          />
          <button class="mini-btn" type="button" @click="openCreate(row.node.id)">加子节点</button>
          <button class="mini-btn" type="button" @click="openEdit(row.node)">编辑</button>
          <button class="mini-btn danger" type="button" @click="onDelete(row.node)">删除</button>
        </div>
      </div>
    </div>

    <AppModal
      v-if="editing"
      :title="editing.node ? '编辑节点' : editing.parentId == null ? '新增根节点' : '新增子节点'"
      @close="editing = null"
    >
      <div class="f-field">
        <label class="f-label">所属学科<span class="req">*</span></label>
        <select v-model="form.subject" class="f-select">
          <option v-for="subject in formSubjects" :key="subject" :value="subject">{{ subject }}</option>
        </select>
      </div>
      <div class="f-field">
        <label class="f-label">节点名称<span class="req">*</span></label>
        <input v-model="form.name" class="f-input" placeholder="最多 6 级，同级不建议重名" />
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
</template>

<style scoped>
.search-box {
  position: relative;
  width: 260px;
}
.search-box .f-input { padding-left: 34px; height: 34px; }
.search-box > :first-child {
  position: absolute;
  left: 11px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--sub);
  pointer-events: none;
}
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
.form-err { font-size: 12px; color: var(--danger); margin: 4px 0; }
</style>
