<script setup lang="ts">
/**
 * 系统参数配置（P-07-04）。
 *
 * 按分组维护平台运行参数；只读参数（合规红线类）不可编辑。
 */
import { computed, onMounted, ref } from 'vue'
import { AppIcon, AppPageHeader, showToast } from '@aiteach/shared'
import AppSwitch from '@/components/ui/AppSwitch.vue'
import type { SystemParam } from '@aiteach/shared'
import AppModal from '@/components/ui/AppModal.vue'
import { fetchSystemParams, saveSystemParam } from '@/api/content'

const params = ref<SystemParam[]>([])
const loading = ref(true)

async function load() {
  loading.value = true
  params.value = await fetchSystemParams()
  loading.value = false
}

const groups = computed(() => [...new Set(params.value.map((row) => row.group))])

const editing = ref<null | { key: string; label: string; value: string; desc: string }>(null)

function openEdit(row: SystemParam) {
  editing.value = { key: row.key, label: row.label, value: row.value, desc: row.desc }
}

async function submit() {
  if (!editing.value) return
  try {
    await saveSystemParam(editing.value.key, editing.value.value)
    showToast('参数已保存', 'success')
    editing.value = null
    load()
  } catch (error) {
    showToast(error instanceof Error ? error.message : '保存失败', 'error')
  }
}

async function onToggle(row: SystemParam) {
  try {
    await saveSystemParam(row.key, row.value === 'true' ? 'false' : 'true')
    await load()
    showToast('已更新', 'success')
  } catch (error) {
    showToast(error instanceof Error ? error.message : '操作失败', 'error')
  }
}

function isBoolean(row: SystemParam) {
  return row.value === 'true' || row.value === 'false'
}

onMounted(load)
</script>

<template>
  <div class="page">
    <AppPageHeader desc="平台运行参数配置；标注「只读」的合规红线参数（如学生照片留存天数）由系统强制，不可修改。" />

    <div v-for="group in groups" :key="group" class="panel">
      <h3 class="panel-title">{{ group }}</h3>
      <div class="data-table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>参数</th>
              <th>当前值</th>
              <th>说明</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="loading"><td colspan="4" class="empty-row">加载中…</td></tr>
            <template v-else>
              <tr v-for="row in params.filter((item) => item.group === group)" :key="row.key">
                <td class="cell-strong">
                  {{ row.label }}
                  <code class="code-chip">{{ row.key }}</code>
                </td>
                <td>
                  <AppSwitch v-if="isBoolean(row)" :model-value="row.value === 'true'" :disabled="!row.editable" @update:model-value="onToggle(row)" />
                  <span v-else class="param-value">{{ row.value }}</span>
                </td>
                <td class="param-desc">{{ row.desc }}</td>
                <td>
                  <div class="op-group">
                    <button class="mini-btn" :disabled="!row.editable" @click="openEdit(row)">{{ row.editable ? '编辑' : '只读' }}</button>
                  </div>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
    </div>

    <AppModal v-if="editing" :title="`编辑参数 · ${editing.label}`" :width="440" @close="editing = null">
      <div class="f-field">
        <label class="f-label">参数值</label>
        <input v-model="editing.value" class="f-input" />
      </div>
      <p class="param-hint">{{ editing.desc }}</p>
      <template #footer>
        <button class="btn btn-ghost" @click="editing = null">取消</button>
        <button class="btn btn-primary" @click="submit">保存</button>
      </template>
    </AppModal>
  </div>
</template>

<style scoped>
.panel-title { font-size: 14px; margin: 0 0 14px; }
.code-chip {
  display: inline-block; margin-left: 8px; font-family: 'SF Mono', Menlo, monospace;
  font-size: 11.5px; color: var(--brand-deep); background: var(--brand-soft);
  border-radius: 5px; padding: 1px 7px; font-weight: 400;
}
.param-value { font-variant-numeric: tabular-nums; }
.param-desc { font-size: 12.5px; color: var(--sub); }
.param-hint { font-size: 12.5px; color: var(--sub); margin: 10px 0 0; }
</style>
