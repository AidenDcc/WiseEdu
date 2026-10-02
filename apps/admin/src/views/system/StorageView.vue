<script setup lang="ts">
/**
 * 文件上传与存储策略（P-07-06）+ 数据备份与恢复（P-07-07）。
 *
 * 两个页签：
 * - 存储策略：按业务类型划分存储桶、上传上限、允许类型、容量用量；
 * - 备份恢复：自动 / 手动备份记录，支持立即备份与恢复演练。
 */
import { computed, onMounted, ref } from 'vue'
import { AppIcon, AppPageHeader, AppTabs, showToast, AppModal, appConfirm } from '@aiteach/shared'
import type { BackupRecord, StoragePolicy } from '@aiteach/shared'
import { createBackup, fetchBackups, fetchStoragePolicies, saveStoragePolicy } from '@/api/content'

const tab = ref<'storage' | 'backup'>('storage')
const policies = ref<StoragePolicy[]>([])
const backups = ref<BackupRecord[]>([])
const loading = ref(true)

async function load() {
  loading.value = true
  const [policyList, backupList] = await Promise.all([fetchStoragePolicies(), fetchBackups()])
  policies.value = policyList
  backups.value = backupList
  loading.value = false
}

const totalUsed = computed(() => Math.round(policies.value.reduce((sum, row) => sum + row.usedGb, 0)))
const totalQuota = computed(() => Math.round(policies.value.reduce((sum, row) => sum + row.quotaGb, 0)))

function usagePercent(row: StoragePolicy) {
  return Math.round((row.usedGb / Math.max(1, row.quotaGb)) * 100)
}
function usageColor(percent: number) {
  if (percent >= 85) return '#d94f43'
  if (percent >= 70) return '#d9822b'
  return '#2e9e5b'
}

/* ===== 存储策略编辑 ===== */
const editingPolicy = ref<null | { key: string; label: string; maxUploadMb: number; acceptTypesText: string }>(null)

function openPolicyEdit(row: StoragePolicy) {
  editingPolicy.value = { key: row.key, label: row.label, maxUploadMb: row.maxUploadMb, acceptTypesText: row.acceptTypes.join(', ') }
}

async function submitPolicy() {
  if (!editingPolicy.value) return
  try {
    await saveStoragePolicy(editingPolicy.value.key, {
      maxUploadMb: editingPolicy.value.maxUploadMb,
      acceptTypes: editingPolicy.value.acceptTypesText.split(',').map((row) => row.trim()).filter(Boolean),
    })
    showToast('已保存', 'success')
    editingPolicy.value = null
    load()
  } catch (error) {
    showToast(error instanceof Error ? error.message : '保存失败', 'error')
  }
}

async function togglePolicy(row: StoragePolicy) {
  await saveStoragePolicy(row.key, { enabled: !row.enabled })
  await load()
  showToast(row.enabled ? '已停用该存储策略' : '已启用', 'success')
}

/* ===== 备份 ===== */
const backupStatusMeta: Record<BackupRecord['status'], { text: string; tag: string }> = {
  done: { text: '已完成', tag: 'tag-green' },
  running: { text: '进行中', tag: 'tag-blue' },
  failed: { text: '失败', tag: 'tag-red' },
}

const creating = ref<null | { scope: string }>(null)

function openCreate() {
  creating.value = { scope: '全平台' }
}

async function submitBackup() {
  if (!creating.value) return
  try {
    await createBackup(creating.value.scope)
    showToast('备份任务已创建（进行中）', 'success')
    creating.value = null
    load()
  } catch (error) {
    showToast(error instanceof Error ? error.message : '创建失败', 'error')
  }
}

async function onRestore(row: BackupRecord) {
  if (row.status !== 'done') {
    showToast('该备份未完成，无法恢复', 'error')
    return
  }
  if (!(await appConfirm(`从「${row.name}」恢复数据？恢复为高敏操作，需二次审批（P-06-04）。`, { type: 'danger' }))) return
  showToast('恢复演练已提交二次审批', 'success')
}

onMounted(load)
</script>

<template>
  <div class="page">
    <AppPageHeader desc="文件上传与存储策略、数据备份与恢复；恢复为敏感操作，需经二次审批。">
      <template #actions>
        <button v-if="tab === 'backup'" class="btn btn-primary" @click="openCreate">
          <AppIcon name="download" :size="15" /> 立即备份
        </button>
      </template>
    </AppPageHeader>

    <div class="toolbar">
      <AppTabs
        v-model="tab"
        :tabs="[
          { key: 'storage', label: '存储策略', count: policies.length },
          { key: 'backup', label: '备份与恢复', count: backups.length },
        ]"
      />
    </div>

    <!-- 存储策略 -->
    <template v-if="tab === 'storage'">
      <div class="stat-row">
        <div class="stat-card"><span>总已用</span><b>{{ totalUsed.toLocaleString() }} GB</b></div>
        <div class="stat-card"><span>总配额</span><b>{{ totalQuota.toLocaleString() }} GB</b></div>
        <div class="stat-card"><span>整体使用率</span><b>{{ Math.round((totalUsed / Math.max(1, totalQuota)) * 100) }}%</b></div>
      </div>
      <div class="panel">
        <div class="data-table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>策略 / 业务类型</th>
                <th>存储服务</th>
                <th>Bucket</th>
                <th>上传上限</th>
                <th>允许类型</th>
                <th>用量</th>
                <th>状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="loading"><td colspan="8" class="empty-row">加载中…</td></tr>
              <template v-else>
                <tr v-for="row in policies" :key="row.key">
                  <td class="cell-strong">{{ row.label }}</td>
                  <td>{{ row.provider }}</td>
                  <td class="mono">{{ row.bucket }}</td>
                  <td>{{ row.maxUploadMb ? `${row.maxUploadMb} MB` : '—' }}</td>
                  <td class="ellipsis">{{ row.acceptTypes.length ? row.acceptTypes.join(' / ') : '—' }}</td>
                  <td class="usage-cell">
                    <div class="bar-track"><div class="bar" :style="{ width: `${usagePercent(row)}%`, background: usageColor(usagePercent(row)) }" /></div>
                    <span>{{ row.usedGb }} / {{ row.quotaGb }} GB</span>
                  </td>
                  <td><span class="tag" :class="row.enabled ? 'tag-green' : 'tag-gray'">{{ row.enabled ? '启用' : '停用' }}</span></td>
                  <td>
                    <div class="op-group">
                      <button class="mini-btn" @click="openPolicyEdit(row)">编辑</button>
                      <button class="mini-btn" @click="togglePolicy(row)">{{ row.enabled ? '停用' : '启用' }}</button>
                    </div>
                  </td>
                </tr>
              </template>
            </tbody>
          </table>
        </div>
      </div>
    </template>

    <!-- 备份恢复 -->
    <template v-else>
      <div class="panel">
        <div class="data-table-wrap">
          <table class="data-table">
            <thead>
              <tr>
                <th>备份名称</th>
                <th>类型</th>
                <th>范围</th>
                <th>大小</th>
                <th>状态</th>
                <th>开始 / 完成</th>
                <th>恢复次数</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="loading"><td colspan="8" class="empty-row">加载中…</td></tr>
              <tr v-else-if="backups.length === 0"><td colspan="8" class="empty-row">暂无备份</td></tr>
              <template v-else>
                <tr v-for="row in backups" :key="row.id">
                  <td class="cell-strong">{{ row.name }}</td>
                  <td><span class="tag" :class="row.kind === 'auto' ? 'tag-blue' : 'tag-orange'">{{ row.kind === 'auto' ? '自动' : '手动' }}</span></td>
                  <td>{{ row.scope }}</td>
                  <td>{{ row.sizeGb ? `${row.sizeGb} GB` : '—' }}</td>
                  <td><span class="tag" :class="backupStatusMeta[row.status].tag">{{ backupStatusMeta[row.status].text }}</span></td>
                  <td class="mono">{{ row.startedAt }}<br />{{ row.finishedAt ?? '—' }}</td>
                  <td>{{ row.restoreTimes }}</td>
                  <td>
                    <div class="op-group">
                      <button class="mini-btn" :disabled="row.status !== 'done'" @click="onRestore(row)">恢复</button>
                    </div>
                  </td>
                </tr>
              </template>
            </tbody>
          </table>
        </div>
      </div>
    </template>

    <AppModal v-if="editingPolicy" :title="`编辑存储策略 · ${editingPolicy.label}`" :width="460" @close="editingPolicy = null">
      <div class="f-field">
        <label class="f-label">上传大小上限（MB）</label>
        <input v-model.number="editingPolicy.maxUploadMb" class="f-input" type="number" min="0" />
      </div>
      <div class="f-field">
        <label class="f-label">允许的文件类型（逗号分隔）</label>
        <input v-model="editingPolicy.acceptTypesText" class="f-input" placeholder="png, jpg, webp" />
      </div>
      <template #footer>
        <button class="btn btn-ghost" @click="editingPolicy = null">取消</button>
        <button class="btn btn-primary" @click="submitPolicy">保存</button>
      </template>
    </AppModal>

    <AppModal v-if="creating" title="立即备份" :width="420" @close="creating = null">
      <div class="f-field">
        <label class="f-label">备份范围<span class="req">*</span></label>
        <select v-model="creating.scope" class="f-select">
          <option value="全平台">全平台</option>
          <option value="题库服务">题库服务</option>
          <option value="消息中心">消息中心</option>
          <option value="机构数据">机构数据</option>
        </select>
      </div>
      <p class="modal-hint">手动备份将立即执行；恢复操作需二次审批。</p>
      <template #footer>
        <button class="btn btn-ghost" @click="creating = null">取消</button>
        <button class="btn btn-primary" @click="submitBackup">开始备份</button>
      </template>
    </AppModal>
  </div>
</template>

<style scoped>
.toolbar { margin-bottom: 14px; }
.stat-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; margin-bottom: 14px; }
.stat-card {
  background: #fff; border: 1px solid var(--border); border-radius: 12px; padding: 14px 18px;
  display: flex; flex-direction: column; gap: 4px;
}
.stat-card span { font-size: 12.5px; color: var(--sub); }
.stat-card b { font-size: 22px; font-variant-numeric: tabular-nums; }
.mono { font-family: 'SF Mono', Menlo, monospace; font-size: 12px; }
.ellipsis { max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.usage-cell { display: flex; flex-direction: column; gap: 5px; min-width: 130px; }
.usage-cell span { font-size: 11.5px; color: var(--sub); font-variant-numeric: tabular-nums; }
.bar-track { position: relative; height: 8px; border-radius: 4px; background: #eef2f4; overflow: hidden; }
.bar { position: absolute; inset: 0 auto 0 0; border-radius: 4px; }
.modal-hint { font-size: 12.5px; color: var(--sub); margin: 10px 0 0; }
</style>
