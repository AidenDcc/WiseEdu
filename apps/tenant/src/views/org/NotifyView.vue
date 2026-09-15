<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { AppIcon, showToast } from '@aiteach/shared'
import type { NotifyMatrixRow } from '@aiteach/shared'
import AppSwitch from '@/components/ui/AppSwitch.vue'
import { fetchNotifyMatrix, saveNotifyMatrix } from '@/api/org'

const rows = ref<NotifyMatrixRow[]>([])
const dirty = ref(false)
const saving = ref(false)

async function load() {
  rows.value = await fetchNotifyMatrix()
  dirty.value = false
}

function onChange(row: NotifyMatrixRow, channel: 'inApp' | 'sms' | 'email', value: boolean) {
  if (channel !== 'inApp' && value) {
    showToast('短信 / 邮件通道为付费增值能力，将消耗平台通知额度', 'info')
  }
  row[channel] = value
  dirty.value = true
}

async function onSave() {
  saving.value = true
  try {
    await saveNotifyMatrix()
    dirty.value = false
    showToast('通知配置已保存', 'success')
  } catch (error) {
    showToast(error instanceof Error ? error.message : '保存失败', 'error')
  } finally {
    saving.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="page">
    <div class="page-head">
      <h2>通知配置</h2>
      <span class="f-hint">站内通知免费；短信 / 邮件为付费增值通道，按量计费</span>
    </div>

    <div class="panel notify-panel">
      <table class="data-table">
        <thead>
          <tr>
            <th style="width: 200px">事件</th>
            <th>站内通知</th>
            <th>短信</th>
            <th>邮件</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="row.key">
            <td class="cell-strong">{{ row.label }}</td>
            <td><AppSwitch :model-value="row.inApp" @update:model-value="(v: boolean) => onChange(row, 'inApp', v)" /></td>
            <td>
              <div class="cell-switch">
                <AppSwitch :model-value="row.sms" @update:model-value="(v: boolean) => onChange(row, 'sms', v)" />
                <span class="pay-tag">付费</span>
              </div>
            </td>
            <td>
              <div class="cell-switch">
                <AppSwitch :model-value="row.email" @update:model-value="(v: boolean) => onChange(row, 'email', v)" />
                <span class="pay-tag">付费</span>
              </div>
            </td>
          </tr>
        </tbody>
      </table>

      <div class="notify-foot">
        <p class="f-hint">
          <AppIcon name="bell" :size="13" /> 审核待办建议至少保留站内通知，避免流程停滞
        </p>
        <button class="btn btn-primary" :disabled="!dirty || saving" @click="onSave">
          {{ saving ? '保存中…' : dirty ? '保存修改' : '无变更' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.notify-panel { padding: 16px 18px; }
.cell-switch { display: flex; align-items: center; gap: 8px; }
.pay-tag {
  font-size: 10.5px; color: var(--warn); background: var(--warn-soft);
  border-radius: 999px; padding: 1.5px 8px;
}
.notify-foot {
  display: flex; align-items: center; justify-content: space-between;
  border-top: 1px solid var(--border); margin-top: 14px; padding-top: 14px;
}
.notify-foot .f-hint { display: flex; align-items: center; gap: 5px; }
</style>
