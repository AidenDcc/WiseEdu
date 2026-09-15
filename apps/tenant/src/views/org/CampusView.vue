<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { AppIcon, showToast } from '@aiteach/shared'
import type { Campus } from '@aiteach/shared'
import AppModal from '@/components/ui/AppModal.vue'
import { deleteCampus, fetchCampuses, saveCampus, toggleCampus } from '@/api/org'

const campuses = ref<Campus[]>([])

async function load() {
  campuses.value = await fetchCampuses()
}

const editing = ref<null | { id: number | null; name: string; code: string; address: string; manager: string }>(null)

function openCreate() {
  editing.value = { id: null, name: '', code: '', address: '', manager: '' }
}
function openEdit(row: Campus) {
  editing.value = { id: row.id, name: row.name, code: row.code, address: row.address ?? '', manager: row.manager ?? '' }
}

async function submit() {
  if (!editing.value) return
  if (!editing.value.code.trim() && editing.value.id == null) {
    showToast('校区编码必填（创建后不可改）', 'error')
    return
  }
  try {
    await saveCampus({
      id: editing.value.id ?? undefined,
      name: editing.value.name,
      code: editing.value.code,
      address: editing.value.address,
      manager: editing.value.manager,
    })
    editing.value = null
    showToast('已保存', 'success')
    load()
  } catch (error) {
    showToast(error instanceof Error ? error.message : '保存失败', 'error')
  }
}

async function onToggle(row: Campus) {
  await toggleCampus(row.id)
  await load()
  showToast(row.enabled ? '已停用（员工不可再分配至该校区）' : '已启用', 'success')
}

async function onDelete(row: Campus) {
  if (!window.confirm(`删除校区「${row.name}」？`)) return
  try {
    await deleteCampus(row.id)
    await load()
    showToast('已删除', 'success')
  } catch (error) {
    showToast(error instanceof Error ? error.message : '删除失败', 'error')
  }
}

onMounted(load)
</script>

<template>
  <div class="page">
    <div class="page-head">
      <h2>校区管理</h2>
      <span class="f-hint">多校区隔离数据；校区编码创建后不可修改</span>
      <button class="btn btn-primary" style="margin-left: auto" @click="openCreate">
        <AppIcon name="plus" :size="15" /> 新增校区
      </button>
    </div>

    <div class="panel">
      <table class="data-table">
        <thead>
          <tr>
            <th>校区名称</th>
            <th>编码</th>
            <th>地址</th>
            <th>负责人</th>
            <th>员工数</th>
            <th>状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="campuses.length === 0">
            <td colspan="7" class="empty-row">暂无校区</td>
          </tr>
          <template v-else>
            <tr v-for="row in campuses" :key="row.id">
              <td class="cell-strong">{{ row.name }}</td>
              <td><code class="code-chip">{{ row.code }}</code></td>
              <td>{{ row.address || '—' }}</td>
              <td>{{ row.manager || '—' }}</td>
              <td>{{ row.staffCount }}</td>
              <td>
                <span class="tag" :class="row.enabled ? 'tag-green' : 'tag-gray'">{{ row.enabled ? '启用' : '停用' }}</span>
              </td>
              <td>
                <div class="op-group">
                  <button class="mini-btn" @click="openEdit(row)">编辑</button>
                  <button class="mini-btn" @click="onToggle(row)">{{ row.enabled ? '停用' : '启用' }}</button>
                  <button class="mini-btn danger" @click="onDelete(row)">删除</button>
                </div>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
    </div>

    <AppModal v-if="editing" :title="editing.id ? '编辑校区' : '新增校区'" :width="460" @close="editing = null">
      <div class="f-field row2">
        <div>
          <label class="f-label">校区名称<span class="req">*</span></label>
          <input v-model="editing.name" class="f-input" placeholder="机构内唯一" />
        </div>
        <div>
          <label class="f-label">校区编码<span class="req">*</span></label>
          <input
            v-model="editing.code"
            class="f-input"
            placeholder="如 C03"
            :disabled="!!editing.id"
            maxlength="10"
          />
        </div>
      </div>
      <div class="f-field">
        <label class="f-label">地址</label>
        <input v-model="editing.address" class="f-input" placeholder="选填" />
      </div>
      <div class="f-field">
        <label class="f-label">负责人</label>
        <input v-model="editing.manager" class="f-input" placeholder="选填" />
      </div>
      <template #footer>
        <button class="btn btn-ghost" @click="editing = null">取消</button>
        <button class="btn btn-primary" @click="submit">保存</button>
      </template>
    </AppModal>
  </div>
</template>

<style scoped>
.row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.code-chip {
  font-family: 'SF Mono', Menlo, monospace;
  font-size: 12px; color: var(--brand-deep);
  background: var(--brand-soft); border-radius: 6px; padding: 2px 8px;
}
.f-input:disabled { background: #f2f5f5; color: var(--sub); }
</style>
