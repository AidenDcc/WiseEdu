<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { AppIcon, showToast } from '@aiteach/shared'
import { fetchOrgLoginLogs, fetchOrgOperationLogs } from '@/api/org'

type TabKey = 'login' | 'operation'
const TABS: Array<{ key: TabKey; label: string }> = [
  { key: 'login', label: '登录日志' },
  { key: 'operation', label: '操作日志' },
]
const tab = ref<TabKey>('login')

const loginLogs = ref<Array<{ id: number; account: string; ip: string; device: string; ok: boolean; time: string }>>([])
const operationLogs = ref<Array<{ id: number; account: string; module: string; action: string; target: string; ok: boolean; time: string }>>([])

async function load() {
  ;[loginLogs.value, operationLogs.value] = await Promise.all([fetchOrgLoginLogs(), fetchOrgOperationLogs()])
}

function onExport() {
  showToast(`${tab.value === 'login' ? '登录' : '操作'}日志导出任务已创建（CSV），稍后下载`, 'success')
}

onMounted(load)
</script>

<template>
  <div class="page">
    <div class="page-head">
      <h2>日志管理</h2>
      <span class="f-hint">登录 / 操作全量留痕，保存 180 天</span>
      <button class="btn btn-ghost" style="margin-left: auto" @click="onExport">
        <AppIcon name="download" :size="15" /> 导出当前日志
      </button>
    </div>

    <div class="tab-bar">
      <button
        v-for="t in TABS"
        :key="t.key"
        class="tab-btn"
        :class="{ on: tab === t.key }"
        type="button"
        @click="tab = t.key"
      >
        {{ t.label }}（{{ t.key === 'login' ? loginLogs.length : operationLogs.length }}）
      </button>
    </div>

    <div class="panel">
      <!-- 登录日志 -->
      <table v-if="tab === 'login'" class="data-table">
        <thead>
          <tr>
            <th>账号</th>
            <th>IP</th>
            <th>设备 / 浏览器</th>
            <th>结果</th>
            <th>时间</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in loginLogs" :key="row.id">
            <td class="cell-strong">{{ row.account }}</td>
            <td><code class="ip-chip">{{ row.ip }}</code></td>
            <td>{{ row.device }}</td>
            <td>
              <span class="tag" :class="row.ok ? 'tag-green' : 'tag-red'">{{ row.ok ? '成功' : '失败' }}</span>
            </td>
            <td>{{ row.time }}</td>
          </tr>
        </tbody>
      </table>

      <!-- 操作日志 -->
      <table v-else class="data-table">
        <thead>
          <tr>
            <th>账号</th>
            <th>模块</th>
            <th>操作</th>
            <th>对象</th>
            <th>结果</th>
            <th>时间</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in operationLogs" :key="row.id">
            <td class="cell-strong">{{ row.account }}</td>
            <td><span class="tag tag-gray">{{ row.module }}</span></td>
            <td>{{ row.action }}</td>
            <td>{{ row.target }}</td>
            <td>
              <span class="tag" :class="row.ok ? 'tag-green' : 'tag-red'">{{ row.ok ? '成功' : '失败' }}</span>
            </td>
            <td>{{ row.time }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.tab-bar { display: flex; gap: 4px; margin-bottom: 14px; border-bottom: 1px solid var(--border); }
.tab-btn {
  border: none; background: transparent; padding: 9px 16px;
  font-size: 13.5px; color: var(--sub); border-bottom: 2.5px solid transparent;
  margin-bottom: -1px;
}
.tab-btn.on { color: var(--brand-deep); font-weight: 600; border-bottom-color: var(--brand); }

.ip-chip { font-family: 'SF Mono', Menlo, monospace; font-size: 12px; color: var(--ink-2); }
</style>
