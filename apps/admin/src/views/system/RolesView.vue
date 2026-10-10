<script setup lang="ts">
/**
 * 角色权限（管理端）。
 *
 * 角色从原先写死的 超级管理员 / 运营专员 扩成可维护的数据：角色 CRUD + 按菜单勾选可见权限。
 * 账号归属（`AdminAccount.role`）存角色 `code`，所以角色的菜单权限就是该角色下账号能看到的
 * 左侧边栏范围（过滤逻辑见 `composables/useAdminMenus.ts`）。
 *
 * 内置超级管理员角色不可删除、不可停用，权限恒为全部且不可编辑 —— 演示只有一个管理端账号，
 * 放开就会把自己关在系统管理之外。
 */
import { computed, onMounted, reactive, ref } from 'vue'
import { AppIcon, AppListToolbar, AppPageHeader, AppModal, appConfirm, showToast, ApiError, ADMIN_SUPER_ROLE_CODE } from '@aiteach/shared'
import type { AdminMenuItem, AdminRoleRecord } from '@aiteach/shared'
import AppSwitch from '@/components/ui/AppSwitch.vue'
import { deleteAdminRole, fetchAdminMenus, fetchAdminRoles, saveAdminRole, toggleAdminRole } from '@/api/platform'

const roles = ref<AdminRoleRecord[]>([])
const menus = ref<AdminMenuItem[]>([])
const loading = ref(false)

/** 权限勾选树：顶级分组 + 其子菜单；顶级叶子（如平台工作台）自己就是一项 */
const menuGroups = computed(() =>
  menus.value
    .filter((item) => item.parentId === null)
    .sort((a, b) => a.sort - b.sort)
    .map((node) => ({
      node,
      children: menus.value.filter((item) => item.parentId === node.id).sort((a, b) => a.sort - b.sort),
    })),
)

async function load() {
  loading.value = true
  try {
    ;[roles.value, menus.value] = await Promise.all([fetchAdminRoles(), fetchAdminMenus()])
  } finally {
    loading.value = false
  }
}

async function onToggle(role: AdminRoleRecord) {
  try {
    const result = await toggleAdminRole(role.id)
    showToast(result.enabled ? '已启用' : '已停用，该角色下账号不再看到对应菜单', 'success')
    load()
  } catch (error) {
    showToast(error instanceof ApiError ? error.message : '操作失败', 'error')
  }
}

async function onDelete(role: AdminRoleRecord) {
  if (!(await appConfirm(`确认删除角色「${role.name}」？该角色下若仍有管理员将无法删除。`, { type: 'danger' }))) return
  try {
    await deleteAdminRole(role.id)
    showToast('已删除', 'success')
    load()
  } catch (error) {
    showToast(error instanceof ApiError ? error.message : '删除失败', 'error')
  }
}

/* ===== 新增 / 编辑 ===== */
const editing = ref<AdminRoleRecord | 'new' | null>(null)
const form = reactive({ code: '', name: '', desc: '', enabled: true, permissions: [] as string[] })
const formError = ref('')
const saving = ref(false)

/** 内置超级管理员：权限区整体置灰，不允许编辑 */
const isSuper = computed(() => editing.value instanceof Object && editing.value.code === ADMIN_SUPER_ROLE_CODE)

/** 该分组的子菜单路径（顶级叶子则为它自己） */
function groupLeafPaths(group: (typeof menuGroups.value)[number]): string[] {
  return group.children.length ? group.children.map((child) => child.path) : [group.node.path]
}

function isGroupChecked(group: (typeof menuGroups.value)[number]): boolean {
  const paths = groupLeafPaths(group)
  return paths.length > 0 && paths.every((path) => form.permissions.includes(path))
}

function onGroupToggle(group: (typeof menuGroups.value)[number]) {
  if (isSuper.value) return
  const paths = groupLeafPaths(group)
  if (isGroupChecked(group)) {
    form.permissions = form.permissions.filter((path) => !paths.includes(path))
  } else {
    form.permissions = [...new Set([...form.permissions, ...paths])]
  }
}

/** 全部可选叶子路径（含「平台工作台」这类顶级叶子） */
function allLeafPaths(): string[] {
  return menuGroups.value.flatMap((group) => groupLeafPaths(group))
}

function openCreate() {
  editing.value = 'new'
  form.code = ''
  form.name = ''
  form.desc = ''
  form.enabled = true
  /* 默认全选，由使用者按需取消 */
  form.permissions = allLeafPaths()
  formError.value = ''
}

function openEdit(role: AdminRoleRecord) {
  editing.value = role
  form.code = role.code
  form.name = role.name
  form.desc = role.desc
  form.enabled = role.enabled
  /* 超级管理员的 `['*']` 展开成全部叶子，勾选树才画得出「全选」的样子 */
  form.permissions = role.permissions.includes('*') ? allLeafPaths() : [...role.permissions]
  formError.value = ''
}

async function save() {
  if (!form.name.trim()) {
    formError.value = '角色名称不能为空'
    return
  }
  if (editing.value === 'new' && !/^[a-z][a-z0-9_]{1,19}$/.test(form.code.trim())) {
    formError.value = '角色编码须为 2-20 位小写字母 / 数字 / 下划线，且以字母开头'
    return
  }
  if (editing.value === 'new' && form.permissions.length === 0) {
    formError.value = '请至少勾选一项菜单权限'
    return
  }
  saving.value = true
  try {
    await saveAdminRole({
      id: editing.value instanceof Object ? editing.value.id : undefined,
      code: form.code.trim(),
      name: form.name.trim(),
      desc: form.desc.trim(),
      enabled: form.enabled,
      permissions: [...form.permissions],
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
    <AppPageHeader desc="管理端角色与其可见菜单范围；账号在「管理员账号」里归属角色。内置超级管理员不可删除 / 停用，权限恒为全部。">
      <template #actions>
        <button class="btn btn-primary btn-sm" @click="openCreate">
          <AppIcon name="plus" :size="15" /> 新增角色
        </button>
      </template>
    </AppPageHeader>

    <div class="panel">
      <AppListToolbar :searchable="false">
        <template #left>
          <span class="panel-hint">角色权限决定该角色下账号左侧边栏可见的菜单范围，改动即时生效。</span>
        </template>
      </AppListToolbar>

      <div class="data-table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>角色名称</th>
              <th>角色编码</th>
              <th>说明</th>
              <th>可见菜单</th>
              <th>成员数</th>
              <th>状态</th>
              <th style="width: 200px">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="loading && roles.length === 0">
              <td colspan="7" class="empty-row">加载中…</td>
            </tr>
            <tr v-else-if="roles.length === 0">
              <td colspan="7" class="empty-row">暂无角色</td>
            </tr>
            <template v-else>
              <tr v-for="role in roles" :key="role.id">
                <td class="cell-strong">
                  {{ role.name }}
                  <span v-if="role.builtin" class="tag tag-gray builtin-tag">内置</span>
                </td>
                <td><code class="code-chip">{{ role.code }}</code></td>
                <td class="desc-cell">{{ role.desc }}</td>
                <td>{{ role.permissions.includes('*') ? '全部菜单' : `${role.permissions.length} 项` }}</td>
                <td>{{ role.memberCount }}</td>
                <td>
                  <AppSwitch
                    :model-value="role.enabled"
                    :disabled="role.code === ADMIN_SUPER_ROLE_CODE"
                    @update:model-value="onToggle(role)"
                  />
                </td>
                <td>
                  <div class="op-group">
                    <button class="mini-btn" type="button" @click="openEdit(role)">编辑</button>
                    <button
                      class="mini-btn danger"
                      type="button"
                      :disabled="role.builtin"
                      :title="role.builtin ? '内置角色不可删除' : undefined"
                      @click="onDelete(role)"
                    >
                      删除
                    </button>
                  </div>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
    </div>

    <AppModal
      v-if="editing"
      :title="editing === 'new' ? '新增角色' : `编辑角色 · ${form.name}`"
      :width="560"
      @close="editing = null"
    >
      <div class="f-field">
        <label class="f-label">角色名称<span class="req">*</span></label>
        <input v-model="form.name" class="f-input" placeholder="如 内容运营" />
      </div>
      <div class="f-field">
        <label class="f-label">角色编码<span class="req">*</span></label>
        <input v-model="form.code" class="f-input" :disabled="editing !== 'new'" placeholder="2-20 位小写字母 / 数字 / 下划线，创建后不可改" />
      </div>
      <div class="f-field">
        <label class="f-label">说明</label>
        <input v-model="form.desc" class="f-input" placeholder="一句话说明该角色的职责范围" />
      </div>
      <div class="f-field">
        <label class="f-label">菜单权限<span class="req">*</span></label>
        <p v-if="isSuper" class="f-hint">超级管理员始终拥有全部权限，不可修改。</p>
        <div class="perm-tree" :class="{ locked: isSuper }">
          <div v-for="group in menuGroups" :key="group.node.id" class="perm-group">
            <label class="perm-head">
              <input
                type="checkbox"
                :checked="isGroupChecked(group)"
                :disabled="isSuper"
                @change="onGroupToggle(group)"
              />
              <span class="perm-title">{{ group.node.title }}</span>
            </label>
            <div v-if="group.children.length" class="perm-children">
              <label v-for="child in group.children" :key="child.id" class="check-item">
                <input v-model="form.permissions" type="checkbox" :value="child.path" :disabled="isSuper" />
                {{ child.title }}
              </label>
            </div>
          </div>
        </div>
      </div>
      <label class="f-check">
        <input v-model="form.enabled" type="checkbox" :disabled="isSuper" />
        启用
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
</template>

<style scoped>
.panel > :deep(.list-toolbar) { padding: 14px 14px 0; }
.panel-hint { font-size: 12.5px; color: var(--sub); }
.builtin-tag { margin-left: 6px; }
.code-chip {
  font-family: 'SF Mono', Menlo, monospace;
  font-size: 12px;
  background: #f1f3f9;
  border-radius: 6px;
  padding: 2px 8px;
  color: #4b5568;
}
.desc-cell { font-size: 12.5px; color: var(--sub); max-width: 320px; }

.perm-tree {
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 10px 12px;
  max-height: 300px;
  overflow-y: auto;
  background: #fbfcfe;
}
.perm-tree.locked { opacity: 0.65; }
.perm-group + .perm-group { margin-top: 10px; padding-top: 10px; border-top: 1px dashed #eef1f7; }
.perm-head { display: flex; align-items: center; gap: 8px; font-size: 13.5px; font-weight: 600; color: var(--ink); cursor: pointer; }
.perm-head input { accent-color: var(--brand); width: 15px; height: 15px; }
.perm-children { display: flex; flex-wrap: wrap; gap: 6px 16px; padding: 8px 0 0 24px; }
.check-item { display: flex; align-items: center; gap: 6px; font-size: 13px; color: var(--ink-2); cursor: pointer; }
.check-item input { accent-color: var(--brand); width: 15px; height: 15px; }
.f-check { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--ink-2); margin: 4px 0; cursor: pointer; }
.f-check input { accent-color: var(--brand); width: 15px; height: 15px; }
.form-err { font-size: 12px; color: var(--danger); margin: 4px 0; }
</style>
