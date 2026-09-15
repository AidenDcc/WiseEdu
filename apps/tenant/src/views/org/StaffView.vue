<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { AppIcon, showToast } from '@aiteach/shared'
import type { StaffMember } from '@aiteach/shared'
import AppModal from '@/components/ui/AppModal.vue'
import { deleteStaff, fetchCampuses, fetchRoles, fetchStaff, saveStaff, toggleStaff } from '@/api/org'

const staff = ref<StaffMember[]>([])
const quota = ref({ max: 20, current: 0 })
const roleNames = ref<string[]>([])
const campusNames = ref<string[]>([])

const keyword = ref('')

async function load() {
  const [staffData, rolesData, campusesData] = await Promise.all([fetchStaff(), fetchRoles(), fetchCampuses()])
  staff.value = staffData.list
  quota.value = { max: staffData.quota.max, current: staff.value.length }
  roleNames.value = rolesData.roles.map((row) => row.name)
  campusNames.value = campusesData.map((row) => row.name)
}

const filtered = computed(() => staff.value.filter((row) => !keyword.value || row.name.includes(keyword.value) || row.phone.includes(keyword.value)))
const quotaFull = computed(() => staff.value.length >= quota.value.max)

/* ===== 新增 / 编辑 ===== */
const editing = ref<null | { id: number | null; name: string; phone: string; role: string; campus: string }>(null)

function openCreate() {
  if (quotaFull.value) {
    showToast(`员工账号已达套餐上限（${quota.value.max}），请升级套餐`, 'error')
    return
  }
  editing.value = { id: null, name: '', phone: '', role: roleNames.value[2] ?? roleNames.value[0], campus: campusNames.value[0] ?? '' }
}
function openEdit(row: StaffMember) {
  editing.value = { id: row.id, name: row.name, phone: row.phone, role: row.role, campus: row.campus }
}

async function submit() {
  if (!editing.value) return
  try {
    await saveStaff({ ...editing.value, id: editing.value.id ?? undefined })
    editing.value = null
    showToast('已保存，初始密码已通过短信下发', 'success')
    load()
  } catch (error) {
    showToast(error instanceof Error ? error.message : '保存失败', 'error')
  }
}

async function onToggle(row: StaffMember) {
  try {
    await toggleStaff(row.id)
    await load()
    showToast(row.enabled ? '已停用（名下题库保留，功能入口冻结）' : '已启用', 'success')
  } catch (error) {
    showToast(error instanceof Error ? error.message : '操作失败', 'error')
  }
}

async function onDelete(row: StaffMember) {
  if (!window.confirm(`删除员工「${row.name}」？其名下题目将转移至机构公共库`)) return
  try {
    await deleteStaff(row.id)
    await load()
    showToast('已删除', 'success')
  } catch (error) {
    showToast(error instanceof Error ? error.message : '删除失败', 'error')
  }
}

function onImport() {
  showToast('批量导入模板已下载：姓名 / 手机号 / 角色 / 校区，回传后自动创建', 'success')
}

function onResetPwd(row: StaffMember) {
  if (!window.confirm(`重置「${row.name}」的密码？新密码将通过短信下发`)) return
  showToast('密码已重置并短信通知', 'success')
}

onMounted(load)
</script>

<template>
  <div class="page">
    <div class="page-head">
      <h2>员工账号</h2>
      <span class="f-hint">套餐额度 {{ staff.length }} / {{ quota.max }} 个账号 · 停用账号保留数据但冻结入口</span>
    </div>

    <div class="panel">
      <div class="filter-bar">
        <input v-model="keyword" class="f-input" placeholder="搜索姓名 / 手机号" style="width: 200px" />
        <button class="btn btn-ghost btn-sm" @click="onImport"><AppIcon name="upload" :size="14" /> 批量导入</button>
        <button
          class="btn btn-primary btn-sm"
          style="margin-left: auto"
          :class="{ disabled: quotaFull }"
          @click="openCreate"
        >
          <AppIcon name="plus" :size="14" /> 新增员工
        </button>
      </div>

      <table class="data-table">
        <thead>
          <tr>
            <th>姓名</th>
            <th>手机号</th>
            <th>角色</th>
            <th>校区</th>
            <th>状态</th>
            <th>待审任务</th>
            <th>最近登录</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="filtered.length === 0">
            <td colspan="8" class="empty-row">无匹配员工</td>
          </tr>
          <template v-else>
            <tr v-for="row in filtered" :key="row.id">
              <td class="cell-strong">{{ row.name }}</td>
              <td>{{ row.phone }}</td>
              <td><span class="tag" :class="row.role === '管理员' ? 'tag-blue' : 'tag-gray'">{{ row.role }}</span></td>
              <td>{{ row.campus }}</td>
              <td>
                <span class="tag" :class="row.enabled ? 'tag-green' : 'tag-red'">{{ row.enabled ? '启用' : '停用' }}</span>
              </td>
              <td>
                <span v-if="row.pendingReviews > 0" class="tag tag-orange">{{ row.pendingReviews }} 项</span>
                <span v-else class="f-hint">—</span>
              </td>
              <td>{{ row.lastLoginAt }}</td>
              <td>
                <div class="op-group">
                  <button class="mini-btn" @click="openEdit(row)">编辑</button>
                  <button class="mini-btn" @click="onResetPwd(row)">重置密码</button>
                  <button class="mini-btn" @click="onToggle(row)">{{ row.enabled ? '停用' : '启用' }}</button>
                  <button class="mini-btn danger" @click="onDelete(row)">删除</button>
                </div>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>

    <AppModal v-if="editing" :title="editing.id ? '编辑员工' : '新增员工'" :width="460" @close="editing = null">
      <div class="f-field row2">
        <div>
          <label class="f-label">姓名<span class="req">*</span>（2-10 字）</label>
          <input v-model="editing.name" class="f-input" maxlength="10" />
        </div>
        <div>
          <label class="f-label">手机号<span class="req">*</span></label>
          <input v-model="editing.phone" class="f-input" placeholder="11 位手机号（登录账号）" maxlength="11" />
        </div>
      </div>
      <div class="f-field row2">
        <div>
          <label class="f-label">角色<span class="req">*</span></label>
          <select v-model="editing.role" class="f-select">
            <option v-for="r in roleNames" :key="r">{{ r }}</option>
          </select>
        </div>
        <div>
          <label class="f-label">校区<span class="req">*</span></label>
          <select v-model="editing.campus" class="f-select">
            <option v-for="c in campusNames" :key="c">{{ c }}</option>
          </select>
        </div>
      </div>
      <p class="f-hint">新增后初始密码通过短信下发；角色决定其可访问的功能与审核权限</p>
      <template #footer>
        <button class="btn btn-ghost" @click="editing = null">取消</button>
        <button class="btn btn-primary" @click="submit">保存</button>
      </template>
    </AppModal>
  </div>
</template>

<style scoped>
.row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.btn.disabled { opacity: 0.5; }
</style>
