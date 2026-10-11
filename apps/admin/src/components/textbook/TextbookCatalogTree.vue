<script setup lang="ts">
/**
 * 教材目录树（章节 / 小节，可多级）—— 只是通用树组件 `AppTreeView` 的**适配层**。
 *
 * 教材目录的数据是**嵌套**结构（`children`），而 `AppTreeView` 只认扁平 `parentId`
 * 数组；这里负责两种形态的互转，并把「目录只能拖拽排序、不要上移/下移按钮」等差异
 * 通过 props 表达出来。渲染、拖拽、折叠、搜索逻辑全部复用同一个组件。
 *
 * 受控组件：内部持有深拷贝，任何增删改都写回 `modelValue` 并向上 `update:modelValue`。
 * 只用于右侧抽屉（目录单独维护），不再内联进「新增 / 编辑版本」表单。
 */
import { computed, ref, watch } from 'vue'
import { AppModal, appConfirm, showToast } from '@aiteach/shared'
import type { TextbookCatalogNode } from '@aiteach/shared'
import AppTreeView from '@/components/tree/AppTreeView.vue'
import { childrenOf, pathText } from '@/components/tree/tree-utils'

/** 层级上限：与知识点树 / 考试类型树同口径（最多 5 级） */
const MAX_DEPTH = 5

/** 扁平节点（AppTreeView 认的形状）：`title` 统一成 `name`，顺序落到 `sort` 上 */
interface CatalogFlatNode {
  id: string
  parentId: string | null
  name: string
  enabled: boolean
  sort: number
}

const props = defineProps<{ modelValue: TextbookCatalogNode[] }>()
const emit = defineEmits<{ 'update:modelValue': [value: TextbookCatalogNode[]] }>()

/* ===== 嵌套 ↔ 扁平 ===== */
function flatten(list: TextbookCatalogNode[], parentId: string | null, out: CatalogFlatNode[] = []): CatalogFlatNode[] {
  list.forEach((node, index) => {
    out.push({ id: node.id, parentId, name: node.title, enabled: node.enabled !== false, sort: index + 1 })
    if (node.children?.length) flatten(node.children, node.id, out)
  })
  return out
}
function nest(flat: CatalogFlatNode[]): TextbookCatalogNode[] {
  const build = (parentId: string | null): TextbookCatalogNode[] =>
    childrenOf(flat, parentId).map((item) => {
      const children = build(item.id)
      return {
        id: item.id,
        title: item.name,
        enabled: item.enabled,
        ...(children.length ? { children } : {}),
      }
    })
  return build(null)
}

const flat = ref<CatalogFlatNode[]>(flatten(props.modelValue ?? [], null))

/* 外部数据变化（如切换另一个版本的目录）时同步进来；JSON 比对避免自己 emit 触发的回环 */
watch(
  () => props.modelValue,
  (next) => {
    if (JSON.stringify(next) !== JSON.stringify(nest(flat.value))) flat.value = flatten(next ?? [], null)
  },
  { deep: true },
)

function commit() {
  emit('update:modelValue', nest(flat.value))
}

/* ===== 移动 / 排序（拖拽） ===== */
function onMove(payload: { id: string; parentId: string | null; beforeId: string | null }) {
  const node = flat.value.find((item) => item.id === payload.id)
  if (!node) return
  node.parentId = payload.parentId
  const siblings = childrenOf(flat.value, payload.parentId).filter((item) => item.id !== node.id)
  const position = payload.beforeId ? siblings.findIndex((item) => item.id === payload.beforeId) : siblings.length
  siblings.splice(position < 0 ? siblings.length : position, 0, node)
  siblings.forEach((item, index) => { item.sort = index + 1 })
  commit()
}

/* ===== 启停用（整棵子树） ===== */
function onToggle(node: CatalogFlatNode) {
  const next = !node.enabled
  const stack = [node.id]
  while (stack.length) {
    const currentId = stack.pop()!
    const item = flat.value.find((row) => row.id === currentId)
    if (!item) continue
    item.enabled = next
    flat.value.filter((row) => row.parentId === currentId).forEach((child) => stack.push(child.id))
  }
  showToast(next ? '已启用该节点及其整棵子树' : '已停用该节点及其整棵子树', 'success')
  commit()
}

/* ===== 新增 / 编辑 / 删除 ===== */
const editing = ref<{ node: CatalogFlatNode | null; parentId: string | null } | null>(null)
const form = ref({ title: '' })
const formError = ref('')

/** 上级路径：新增子节点 / 编辑时展示挂在谁下面 */
const parentPath = computed(() => pathText(flat.value, editing.value?.parentId ?? null))

function openCreate(parentId: string | null) {
  editing.value = { node: null, parentId }
  form.value.title = ''
  formError.value = ''
}
function openEdit(node: CatalogFlatNode) {
  editing.value = { node, parentId: node.parentId }
  form.value.title = node.name
  formError.value = ''
}
function saveModal() {
  const title = form.value.title.trim()
  if (!title) { formError.value = '请输入章节名称'; return }
  if (!editing.value) return
  const siblings = childrenOf(flat.value, editing.value.parentId)
  const duplicated = siblings.some((item) => item.id !== editing.value!.node?.id && item.name === title)
  if (duplicated) { formError.value = '同级已存在同名章节'; return }
  if (editing.value.node) {
    editing.value.node.name = title
  } else {
    const parentId = editing.value.parentId
    const node: CatalogFlatNode = {
      id: `n-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      parentId,
      name: title,
      enabled: true,
      sort: siblings.length + 1,
    }
    flat.value.push(node)
  }
  commit()
  editing.value = null
}
async function onRemove(node: CatalogFlatNode) {
  if (flat.value.some((item) => item.parentId === node.id)) { showToast('请先删除或移走子节点', 'error'); return }
  if (!(await appConfirm(`确认删除「${node.name}」？`, { type: 'danger' }))) return
  flat.value = flat.value.filter((item) => item.id !== node.id)
  commit()
}
</script>

<template>
  <div class="catalog-tree">
    <AppTreeView
      :nodes="flat"
      :max-depth="MAX_DEPTH"
      search-placeholder="搜索章节名称，自动定位高亮"
      empty-text="暂无目录，可新增章节"
      root-label="新增章节"
      :show-move="false"
      @create-root="openCreate(null)"
      @add-child="(node) => openCreate(node.id)"
      @edit="openEdit"
      @remove="onRemove"
      @toggle="onToggle"
      @move="onMove"
    />

    <AppModal v-if="editing" :title="editing.node ? '编辑章节' : editing.parentId == null ? '新增章节' : '新增子章节'" @close="editing = null">
      <div class="f-field"><label class="f-label">上级路径</label><div class="parent-path">{{ parentPath || '顶级（无上级）' }}</div></div>
      <div class="f-field"><label class="f-label">章节名称<span class="req">*</span></label><input v-model="form.title" class="f-input" placeholder="最多 5 级，同级不可重名" @keyup.enter="saveModal" /></div>
      <p v-if="formError" class="form-err">{{ formError }}</p>
      <template #footer>
        <button class="btn btn-ghost btn-sm" type="button" @click="editing = null">取消</button>
        <button class="btn btn-primary btn-sm" type="button" @click="saveModal">保存</button>
      </template>
    </AppModal>
  </div>
</template>

<style scoped>
/* 撑满抽屉可用高度：工具条与树体一起把「保存目录」上方的空间占满 */
.catalog-tree { display: flex; flex-direction: column; flex: 1; min-height: 0; }
.parent-path { padding: 9px 10px; border-radius: 8px; background: #f7f9fd; color: var(--sub); font-size: 13px; }
.form-err { font-size: 12px; color: var(--danger); margin: 4px 0; }
.req { color: var(--danger); margin-left: 2px; }
</style>
