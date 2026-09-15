<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { AppIcon, showToast, ApiError, ADMIN_ROLE_TEXT } from '@aiteach/shared'
import type { AdminAccount, AdminRole } from '@aiteach/shared'
import AppModal from '@/components/ui/AppModal.vue'
import AppSwitch from '@/components/ui/AppSwitch.vue'
import { fetchAdmins, resetAdminPassword, saveAdmin, toggleAdmin } from '@/api/platform'

const list = ref<AdminAccount[]>([])
const loading = ref(false)

async function load() {
  loading.value = true
  try {
    list.value = await fetchAdmins()
  } finally {
    loading.value = false
  }
}

async function onToggle(item: AdminAccount) {
  if (item.enabled && item.role === 'super' && !window.confirm('停用后该账号将无法登录平台端，确认停用？')) {
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
  if (!window.confirm(`确认重置「${item.name}」的密码？重置后初始密码将通过管理员渠道下发。`)) return
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
  form.role = 'ops'
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
  <div class="panel">
    <div class="filter-bar">
      <span class="filter-label">平台端管理员账号；最后一个超级管理员不可停用 / 删除（服务端强校验）</span>
      <button class="btn btn-primary btn-sm" style="margin-left: auto" @click="openCreate">
        <AppIcon name="plus" :size="15" /> 新增账号
      </button>
    </div>

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
                <span class="tag" :class="item.role === 'super' ? 'tag-blue' : 'tag-gray'">
                  {{ ADMIN_ROLE_TEXT[item.role] }}
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
          <option value="ops">{{ ADMIN_ROLE_TEXT.ops }}</option>
          <option value="super">{{ ADMIN_ROLE_TEXT.super }}</option>
        </select>
        <p class="f-hint">超级管理员：全部权限；运营管理员：除系统管理外的全部权限。</p>
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
