<script setup lang="ts">
/**
 * 消息模板与渠道配置（P-07-05）。
 *
 * 平台各场景通知的消息模板：模板内容、投放渠道（站内 / 短信 / 邮件 / 电话）、启停。
 * 变量用 {变量名} 占位，渲染时替换。
 */
import { onMounted, ref } from 'vue'
import { AppIcon, AppPageHeader, showToast, AppModal } from '@aiteach/shared'
import type { MessageTemplate } from '@aiteach/shared'
import { fetchMessageTemplates, saveMessageTemplate, toggleMessageTemplate } from '@/api/content'

const templates = ref<MessageTemplate[]>([])
const loading = ref(true)

const CHANNELS = ['站内', '短信', '邮件', '电话']

async function load() {
  loading.value = true
  templates.value = await fetchMessageTemplates()
  loading.value = false
}

function channelTag(channel: string) {
  return channel === '短信' ? 'tag-blue' : channel === '邮件' ? 'tag-green' : channel === '电话' ? 'tag-orange' : 'tag-gray'
}

const editing = ref<null | { id: number | null; name: string; scene: string; channels: string[]; content: string }>(null)

function openCreate() {
  editing.value = { id: null, name: '', scene: '通用', channels: ['站内'], content: '' }
}
function openEdit(row: MessageTemplate) {
  editing.value = { id: row.id, name: row.name, scene: row.scene, channels: [...row.channels], content: row.content }
}

async function submit() {
  if (!editing.value) return
  if (!editing.value.name.trim()) {
    showToast('模板名称必填', 'error')
    return
  }
  if (!editing.value.channels.length) {
    showToast('至少选择一个渠道', 'error')
    return
  }
  try {
    await saveMessageTemplate({
      id: editing.value.id ?? undefined,
      name: editing.value.name,
      scene: editing.value.scene,
      channels: editing.value.channels,
      content: editing.value.content,
    })
    showToast('已保存', 'success')
    editing.value = null
    load()
  } catch (error) {
    showToast(error instanceof Error ? error.message : '保存失败', 'error')
  }
}

async function onToggle(row: MessageTemplate) {
  await toggleMessageTemplate(row.id)
  await load()
  showToast(row.enabled ? '已停用' : '已启用', 'success')
}

onMounted(load)
</script>

<template>
  <div class="page">
    <AppPageHeader desc="平台通知消息模板与投放渠道配置；模板支持 {变量} 占位，渲染时替换为实际值。">
      <template #actions>
        <button class="btn btn-primary" @click="openCreate"><AppIcon name="plus" :size="15" /> 新建模板</button>
      </template>
    </AppPageHeader>

    <div class="panel">
      <div class="data-table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>模板名称</th>
              <th>场景</th>
              <th>渠道</th>
              <th>模板内容</th>
              <th>状态</th>
              <th>更新时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="loading"><td colspan="7" class="empty-row">加载中…</td></tr>
            <tr v-else-if="templates.length === 0"><td colspan="7" class="empty-row">暂无模板</td></tr>
            <template v-else>
              <tr v-for="row in templates" :key="row.id">
                <td class="cell-strong">{{ row.name }}</td>
                <td>{{ row.scene }}</td>
                <td>
                  <div class="tag-row">
                    <span v-for="channel in row.channels" :key="channel" class="tag" :class="channelTag(channel)">{{ channel }}</span>
                  </div>
                </td>
                <td class="content-cell">{{ row.content }}</td>
                <td><span class="tag" :class="row.enabled ? 'tag-green' : 'tag-gray'">{{ row.enabled ? '启用' : '停用' }}</span></td>
                <td class="mono">{{ row.updatedAt }}</td>
                <td>
                  <div class="op-group">
                    <button class="mini-btn" @click="openEdit(row)">编辑</button>
                    <button class="mini-btn" @click="onToggle(row)">{{ row.enabled ? '停用' : '启用' }}</button>
                  </div>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
    </div>

    <AppModal v-if="editing" :title="editing.id ? '编辑消息模板' : '新建消息模板'" :width="520" @close="editing = null">
      <div class="f-field row2">
        <div>
          <label class="f-label">模板名称<span class="req">*</span></label>
          <input v-model="editing.name" class="f-input" placeholder="如 租户入驻审核结果" />
        </div>
        <div>
          <label class="f-label">场景</label>
          <select v-model="editing.scene" class="f-select">
            <option v-for="scene in ['通用', '租户管理', '内容运营', '系统监控']" :key="scene" :value="scene">{{ scene }}</option>
          </select>
        </div>
      </div>
      <div class="f-field">
        <label class="f-label">投放渠道<span class="req">*</span></label>
        <div class="channel-checks">
          <label v-for="channel in CHANNELS" :key="channel" class="check-item">
            <input v-model="editing.channels" type="checkbox" :value="channel" />
            {{ channel }}
          </label>
        </div>
      </div>
      <div class="f-field">
        <label class="f-label">模板内容<span class="req">*</span>（含 {变量}）</label>
        <textarea v-model="editing.content" class="f-textarea" rows="3" placeholder="【AI教学云】您的入驻申请已{result}…" />
      </div>
      <template #footer>
        <button class="btn btn-ghost" @click="editing = null">取消</button>
        <button class="btn btn-primary" @click="submit">保存</button>
      </template>
    </AppModal>
  </div>
</template>

<style scoped>
.mono { font-family: 'SF Mono', Menlo, monospace; font-size: 12px; }
.content-cell { max-width: 340px; font-size: 12.5px; color: var(--sub); }
.tag-row { display: flex; flex-wrap: wrap; gap: 4px; }
.row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.channel-checks { display: flex; flex-wrap: wrap; gap: 6px 16px; }
.check-item { display: flex; align-items: center; gap: 6px; font-size: 13px; cursor: pointer; }
</style>
