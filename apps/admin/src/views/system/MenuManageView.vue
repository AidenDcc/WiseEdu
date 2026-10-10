<script setup lang="ts">
/**
 * 菜单管理（管理端）。
 *
 * 这棵树是左侧边栏的**唯一事实源**：改名 / 停用 / 排序 / 删除后调 `useAdminMenus().reload()`
 * 即时反映到侧边栏与面包屑。与「机构菜单权限」（机构端功能可见性）是两回事，别混。
 *
 * 层级上限 2 级（顶级分组 + 子菜单）—— 侧边栏就只渲染这两层，放开第三层会出现「配了却看不到」
 * 的节点，故 UI 与 Mock（`MAX_ADMIN_MENU_DEPTH`）都卡住。路由仍是编译期静态注册的，
 * 这里新增的自定义路径会落到兜底路由，渲染为「开发中」占位页。
 */
import { computed, onMounted, reactive, ref } from 'vue'
import { AppIcon, AppListToolbar, AppPageHeader, AppModal, appConfirm, showToast, ApiError, MAX_ADMIN_MENU_DEPTH } from '@aiteach/shared'
import type { AdminMenuItem } from '@aiteach/shared'
import AppSwitch from '@/components/ui/AppSwitch.vue'
import { deleteAdminMenuItem, fetchAdminMenus, saveAdminMenuItem, toggleAdminMenuItem } from '@/api/platform'
import { useAdminMenus } from '@/composables/useAdminMenus'

/** 侧边栏用到的图标（AppIcon 的名字），给图标输入做个下拉，免得手打错 */
const ICON_OPTIONS = [
  'dashboard', 'building', 'book', 'cpu', 'chart', 'sliders',
  'users', 'file', 'paper', 'message', 'star', 'folder',
  'shield', 'table', 'bell', 'award', 'target', 'grid',
]

const items = ref<AdminMenuItem[]>([])
const collapsedIds = ref<number[]>([])
const { reload: reloadSidebarMenus } = useAdminMenus()

async function load() {
  items.value = await fetchAdminMenus()
}

/** 加载完与侧边栏对齐：菜单管理改完菜单，左栏也要跟着变 */
async function loadAndSync() {
  await load()
  await reloadSidebarMenus()
}

interface TreeRow {
  node: AdminMenuItem
  depth: number
  hasChildren: boolean
}

const rows = computed<TreeRow[]>(() => {
  const childrenOf = (parentId: number | null) =>
    items.value.filter((item) => item.parentId === parentId).sort((a, b) => a.sort - b.sort)
  const result: TreeRow[] = []
  const walk = (parentId: number | null, depth: number, hidden: boolean) => {
    for (const node of childrenOf(parentId)) {
      const children = childrenOf(node.id)
      if (!hidden) result.push({ node, depth, hasChildren: children.length > 0 })
      walk(node.id, depth + 1, hidden || collapsedIds.value.includes(node.id))
    }
  }
  walk(null, 0, false)
  return result
})

const topLevelOptions = computed(() => items.value.filter((item) => item.parentId === null))

function expandAll() {
  collapsedIds.value = []
}

function collapseAll() {
  collapsedIds.value = items.value.map((item) => item.id)
}

function toggleCollapse(id: number) {
  const index = collapsedIds.value.indexOf(id)
  if (index >= 0) collapsedIds.value.splice(index, 1)
  else collapsedIds.value.push(id)
}

async function onToggle(node: AdminMenuItem) {
  try {
    const result = await toggleAdminMenuItem(node.id)
    showToast(result.enabled ? '已启用该菜单及其子菜单' : '已停用该菜单及其子菜单', 'success')
    await loadAndSync()
  } catch (error) {
    showToast(error instanceof ApiError ? error.message : '操作失败', 'error')
  }
}

async function onDelete(node: AdminMenuItem) {
  if (!(await appConfirm(`确认删除菜单「${node.title}」？存在子菜单时将无法删除。`, { type: 'danger' }))) return
  try {
    await deleteAdminMenuItem(node.id)
    showToast('已删除，侧边栏同步更新', 'success')
    await loadAndSync()
  } catch (error) {
    showToast(error instanceof ApiError ? error.message : '删除失败', 'error')
  }
}

/* ===== 新增 / 编辑 ===== */
const editing = ref<{ node: AdminMenuItem | null; parentId: number | null } | null>(null)
const form = reactive({ title: '', path: '', icon: '', sort: 1, enabled: true })
const formError = ref('')
const saving = ref(false)

/** 编辑有子菜单的节点时不允许改上级：挂到别的分组下会变成第 3 级（侧边栏渲染不出来）。
    直接从 `items` 判子节点，不能用 `rows` —— 折叠起来的行不在 rows 里。 */
const parentLocked = computed(() => {
  const node = editing.value?.node
  return Boolean(node && items.value.some((item) => item.parentId === node.id))
})

function openCreate(parentId: number | null) {
  editing.value = { node: null, parentId }
  form.title = ''
  form.path = ''
  form.icon = ''
  form.sort = Math.max(0, ...items.value.filter((item) => item.parentId === parentId).map((item) => item.sort)) + 1
  form.enabled = true
  formError.value = ''
}

function openEdit(node: AdminMenuItem) {
  editing.value = { node, parentId: node.parentId }
  form.title = node.title
  form.path = node.path
  form.icon = node.icon ?? ''
  form.sort = node.sort
  form.enabled = node.enabled
  formError.value = ''
}

async function save() {
  if (!form.title.trim()) {
    formError.value = '菜单名称不能为空'
    return
  }
  if (!form.path.trim()) {
    formError.value = '菜单路径不能为空'
    return
  }
  if (!form.path.trim().startsWith('/')) {
    formError.value = '菜单路径须以 / 开头'
    return
  }
  saving.value = true
  try {
    await saveAdminMenuItem({
      id: editing.value?.node?.id,
      parentId: editing.value?.parentId ?? null,
      title: form.title.trim(),
      path: form.path.trim(),
      icon: form.icon.trim() || undefined,
      sort: form.sort,
      enabled: form.enabled,
    })
    showToast('已保存，侧边栏同步更新', 'success')
    editing.value = null
    await loadAndSync()
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
    <AppPageHeader desc="管理端左侧边栏菜单：改名 / 停用 / 排序 / 删除即时生效；新增的路径若未开发，进入后是「开发中」占位页。">
      <template #actions>
        <button class="btn btn-ghost btn-sm" @click="expandAll">展开全部</button>
        <button class="btn btn-ghost btn-sm" @click="collapseAll">收起全部</button>
        <button class="btn btn-primary btn-sm" @click="openCreate(null)">
          <AppIcon name="plus" :size="15" /> 新增顶级菜单
        </button>
      </template>
    </AppPageHeader>

    <div class="panel">
      <AppListToolbar :searchable="false">
        <template #left>
          <span class="panel-hint">
            最多 {{ MAX_ADMIN_MENU_DEPTH }} 级（顶级分组 + 子菜单）；停用 / 启用会同步整棵子树。
          </span>
        </template>
      </AppListToolbar>

      <div class="tree-body">
        <div v-if="rows.length === 0" class="tree-empty">暂无菜单</div>
        <div
          v-for="row in rows"
          :key="row.node.id"
          class="tree-row"
          :class="{ disabled: !row.node.enabled }"
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
          <AppIcon :name="row.node.icon ?? (row.hasChildren ? 'folder' : 'file')" :size="16" />
          <span class="node-name">{{ row.node.title }}</span>
          <code class="path-chip">{{ row.node.path }}</code>
          <span v-if="row.hasChildren" class="tag tag-gray">分组 · {{ items.filter((item) => item.parentId === row.node.id).length }} 项</span>
          <span v-if="!row.node.enabled" class="tag tag-red">已停用</span>
          <span class="sort-hint">排序 {{ row.node.sort }}</span>

          <div class="row-ops">
            <AppSwitch :model-value="row.node.enabled" @update:model-value="onToggle(row.node)" />
            <button
              v-if="row.depth + 1 < MAX_ADMIN_MENU_DEPTH"
              class="mini-btn"
              type="button"
              @click="openCreate(row.node.id)"
            >
              加子菜单
            </button>
            <button class="mini-btn" type="button" @click="openEdit(row.node)">编辑</button>
            <button class="mini-btn danger" type="button" @click="onDelete(row.node)">删除</button>
          </div>
        </div>
      </div>

      <AppModal
        v-if="editing"
        :title="editing.node ? '编辑菜单' : '新增菜单'"
        @close="editing = null"
      >
        <div class="f-field">
          <label class="f-label">上级菜单</label>
          <select v-model="editing.parentId" class="f-select" :disabled="parentLocked">
            <option :value="null">顶级（分组或直接入口）</option>
            <option v-for="item in topLevelOptions" :key="item.id" :value="item.id">{{ item.title }}</option>
          </select>
          <p class="f-hint">
            选「顶级」为一级菜单；选某个分组则挂在它下面（二级）。菜单最多 {{ MAX_ADMIN_MENU_DEPTH }} 级。
          </p>
        </div>
        <div class="f-field">
          <label class="f-label">菜单名称<span class="req">*</span></label>
          <input v-model="form.title" class="f-input" placeholder="同级不可重名，如 角色权限" />
        </div>
        <div class="f-field">
          <label class="f-label">菜单路径<span class="req">*</span></label>
          <input v-model="form.path" class="f-input" placeholder="以 / 开头且全局唯一，如 /system/roles" />
        </div>
        <div class="f-field">
          <label class="f-label">图标</label>
          <select v-model="form.icon" class="f-select">
            <option value="">（不设图标）</option>
            <option v-for="icon in ICON_OPTIONS" :key="icon" :value="icon">{{ icon }}</option>
          </select>
          <p class="f-hint">分组与顶级入口显示图标，子菜单不显示。</p>
        </div>
        <div class="f-field">
          <label class="f-label">排序<span class="req">*</span></label>
          <input v-model.number="form.sort" class="f-input" type="number" min="1" step="1" />
          <p class="f-hint">同级内按序号从小到大展示，越小越靠前。</p>
        </div>
        <label class="f-check">
          <input v-model="form.enabled" type="checkbox" />
          启用（停用后左侧边栏不再显示）
        </label>
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
.node-name { font-weight: 500; white-space: nowrap; }
.path-chip {
  font-family: 'SF Mono', Menlo, monospace;
  font-size: 12px;
  background: #f1f3f9;
  border-radius: 6px;
  padding: 2px 8px;
  color: #4b5568;
}
.sort-hint { font-size: 12px; color: var(--sub); }
.row-ops {
  margin-left: auto;
  display: none;
  align-items: center;
  gap: 2px;
}
.tree-row:hover .row-ops { display: inline-flex; }
.f-check { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--ink-2); margin: 4px 0; cursor: pointer; }
.f-check input { accent-color: var(--brand); width: 15px; height: 15px; }
.form-err { font-size: 12px; color: var(--danger); margin: 4px 0; }
</style>
