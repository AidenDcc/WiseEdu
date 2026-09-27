<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { AppIcon, AppPageHeader, AppTabs, showToast } from '@aiteach/shared'
import type { TabDef } from '@aiteach/shared'
import { fetchOrgLoginLogs, fetchOrgOperationLogs } from '@/api/org'

type TabKey = 'login' | 'operation'
const tab = ref<TabKey>('login')

const loginLogs = ref<Array<{ id: number; account: string; ip: string; device: string; ok: boolean; time: string }>>([])
const operationLogs = ref<Array<{ id: number; account: string; module: string; action: string; target: string; ok: boolean; time: string }>>([])

/** 标签页（计数取自各自日志条数） */
const TABS = computed<TabDef[]>(() => [
  { key: 'login', label: '登录日志', count: loginLogs.value.length },
  { key: 'operation', label: '操作日志', count: operationLogs.value.length },
])

/** AppTabs 回传 string，这里收窄回 TabKey */
function switchTab(value: string) {
  tab.value = value as TabKey
}

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
    <AppPageHeader desc="登录 / 操作全量留痕，保存 180 天">
      <template #actions>
        <button class="btn btn-ghost" @click="onExport">
          <AppIcon name="download" :size="15" /> 导出当前日志
        </button>
      </template>
    </AppPageHeader>

    <AppTabs :tabs="TABS" :model-value="tab" @update:model-value="switchTab" />

    <div class="panel">
      <div class="data-table-wrap">
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
  </div>
</template>

<style scoped>
.ip-chip { font-family: 'SF Mono', Menlo, monospace; font-size: 12px; color: var(--ink-2); }
</style>
