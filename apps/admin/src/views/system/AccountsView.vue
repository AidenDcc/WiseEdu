<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { AppIcon, AppPageHeader, showToast, ApiError, ADMIN_SUPER_ROLE_CODE, AppModal, appConfirm } from '@aiteach/shared'
import type { AdminAccount, AdminRole, AdminRoleRecord } from '@aiteach/shared'
import AppSwitch from '@/components/ui/AppSwitch.vue'
import { fetchAdminRoles, fetchAdmins, resetAdminPassword, saveAdmin, toggleAdmin } from '@/api/platform'

const list = ref<AdminAccount[]>([])
/** 角色候选来自「角色权限」维护的数据，账号归属的角色值是角色的 code */
const roles = ref<AdminRoleRecord[]>([])
const loading = ref(false)

const roleName = (code: AdminRole) => roles.value.find((role) => role.code === code)?.name ?? code
/** 可选角色：停用的不再分配给新账号，但已归属的不影响展示 */
const selectableRoles = computed(() => roles.value.filter((role) => role.enabled))

async function load() {
  loading.value = true
  try {
    ;[list.value, roles.value] = await Promise.all([fetchAdmins(), fetchAdminRoles()])
  } finally {
    loading.value = false
  }
}

async function onToggle(item: AdminAccount) {
  if (item.enabled && item.role === ADMIN_SUPER_ROLE_CODE && !(await appConfirm('停用后该账号将无法登录平台端，确认停用？', { type: 'warning' }))) {
    return
  }
  try {
    const result = await toggleAdmin(item.id)
    showToast(result.enabled ? '已启用' : '已停用', 'success')
    load()
  } catch (error) {
    showToast(error instanceof ApiError ? error.message : '操作失败', 'error')
  }
}

async function onResetPassword(item: AdminAccount) {
  if (!(await appConfirm(`确认重置「${item.name}」的密码？重置后初始密码将通过管理员渠道下发。`, { type: 'warning' }))) return
  try {
    await resetAdminPassword(item.id)
    showToast('密码已重置为初始密码，请通知账号首次登录后修改', 'success')
  } catch (error) {
    showToast(error instanceof ApiError ? error.message : '操作失败', 'error')
  }
}

/* ===== 新增（FR-PT-033） ===== */
const createOpen = ref(false)
const form = reactive({ account: '', name: '', role: 'ops' as AdminRole })
const formError = ref('')
const saving = ref(false)

function openCreate() {
  createOpen.value = true
  form.account = ''
  form.name = ''
  /* 默认选第一个非超级管理员的角色：超管账号已存在，新增大多是普通角色 */
  form.role = selectableRoles.value.find((role) => role.code !== ADMIN_SUPER_ROLE_CODE)?.code
    ?? selectableRoles.value[0]?.code
    ?? ''
  formError.value = ''
}

async function save() {
  if (!/^[a-zA-Z0-9_]{4,20}$/.test(form.account)) {
    formError.value = '账号须为 4-20 位字母 / 数字 / 下划线'
    return
  }
  if (!form.name.trim()) {
    formError.value = '姓名不能为空'
    return
  }
  saving.value = true
  try {
    await saveAdmin({ account: form.account, name: form.name.trim(), role: form.role })
    showToast('账号已创建，初始密码将通过管理员渠道下发', 'success')
    createOpen.value = false
    load()
  } catch (error) {
    formError.value = error instanceof ApiError ? error.message : '创建失败，请重试'
  } finally {
    saving.value = false
  }
}

onMounted(load)
</script>

<template>
  <div>
    <AppPageHeader desc="平台端管理员账号；最后一个超级管理员不可停用 / 删除（服务端强校验）">
      <template #actions>
        <button class="btn btn-primary btn-sm" @click="openCreate">
          <AppIcon name="plus" :size="15" /> 新增账号
        </button>
      </template>
    </AppPageHeader>

    <div class="panel">
      <div class="data-table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>账号</th>
              <th>姓名</th>
              <th>角色</th>
              <th>最近登录</th>
              <th>状态</th>
              <th style="width: 220px">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="loading && list.length === 0">
              <td colspan="6" class="empty-row">加载中…</td>
            </tr>
            <tr v-else-if="list.length === 0">
              <td colspan="6" class="empty-row">暂无账号</td>
            </tr>
            <template v-else>
              <tr v-for="item in list" :key="item.id">
                <td class="cell-strong"><code class="account-chip">{{ item.account }}</code></td>
                <td>{{ item.name }}</td>
                <td>
                  <span class="tag" :class="item.role === ADMIN_SUPER_ROLE_CODE ? 'tag-blue' : 'tag-gray'">
                    {{ roleName(item.role) }}
                  </span>
                </td>
                <td class="time-cell">{{ item.lastLoginAt }}</td>
                <td><AppSwitch :model-value="item.enabled" @update:model-value="onToggle(item)" /></td>
                <td>
                  <div class="op-group">
                    <button class="mini-btn" type="button" @click="onResetPassword(item)">重置密码</button>
                    <button
                      v-if="item.enabled"
                      class="mini-btn danger"
                      type="button"
                      @click="onToggle(item)"
                    >
                      停用
                    </button>
                    <button v-else class="mini-btn" type="button" @click="onToggle(item)">启用</button>
                  </div>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
    </div>

    <!-- 新增弹窗 -->
    <AppModal v-if="createOpen" title="新增管理员账号" @close="createOpen = false">
      <div class="f-field">
        <label class="f-label">登录账号<span class="req">*</span></label>
        <input v-model="form.account" class="f-input" placeholder="4-20 位字母 / 数字 / 下划线，创建后不可改" />
      </div>
      <div class="f-field">
        <label class="f-label">姓名<span class="req">*</span></label>
        <input v-model="form.name" class="f-input" placeholder="真实姓名" />
      </div>
      <div class="f-field">
        <label class="f-label">角色<span class="req">*</span></label>
        <select v-model="form.role" class="f-select">
          <option v-for="role in selectableRoles" :key="role.code" :value="role.code">{{ role.name }}</option>
        </select>
        <p class="f-hint">角色的可见菜单范围在「系统管理 → 角色权限」里维护。</p>
      </div>
      <p v-if="formError" class="form-err">{{ formError }}</p>
      <template #footer>
        <button class="btn btn-ghost btn-sm" @click="createOpen = false">取消</button>
        <button class="btn btn-primary btn-sm" :disabled="saving" @click="save">
          {{ saving ? '创建中…' : '创建' }}
        </button>
      </template>
    </AppModal>
  </div>
</template>

<style scoped>
.account-chip {
  font-family: 'SF Mono', Menlo, monospace;
  font-size: 12.5px;
  background: #f1f3f9;
  border-radius: 6px;
  padding: 3px 9px;
  color: var(--ink);
}
.time-cell { font-size: 12.5px; color: var(--sub); white-space: nowrap; }
.form-err { font-size: 12px; color: var(--danger); margin: 4px 0; }
</style>
