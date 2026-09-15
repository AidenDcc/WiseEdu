<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { AppIcon, showToast } from '@aiteach/shared'
import type { ErrorLog, LoginLog, OperationLog } from '@aiteach/shared'
import AppModal from '@/components/ui/AppModal.vue'
import AppPagination from '@/components/ui/AppPagination.vue'
import { fetchErrorLogs, fetchLoginLogs, fetchOperationLogs } from '@/api/platform'

type TabKey = 'login' | 'operation' | 'error'
const TABS: Array<{ key: TabKey; label: string; hint: string }> = [
  { key: 'login', label: '登录日志', hint: '全平台账号登录流水，含失败尝试' },
  { key: 'operation', label: '操作日志', hint: '平台端管理动作流水，只读留存 180 天' },
  { key: 'error', label: '异常日志', hint: '系统级 ERROR / WARN 告警快照' },
]

const activeTab = ref<TabKey>('login')
const loginLogs = ref<LoginLog[]>([])
const operationLogs = ref<OperationLog[]>([])
const errorLogs = ref<ErrorLog[]>([])
const loading = ref(false)

const loginKeyword = ref('')
const opModule = ref('')

async function load() {
  loading.value = true
  try {
    ;[loginLogs.value, operationLogs.value, errorLogs.value] = await Promise.all([
      fetchLoginLogs(),
      fetchOperationLogs(),
      fetchErrorLogs(),
    ])
  } finally {
    loading.value = false
  }
}

const filteredLogin = computed(() => {
  const kw = loginKeyword.value.trim()
  return kw ? loginLogs.value.filter((row) => row.account.includes(kw) || row.ip.includes(kw)) : loginLogs.value
})
const filteredOps = computed(() =>
  opModule.value ? operationLogs.value.filter((row) => row.module === opModule.value) : operationLogs.value,
)
const opModules = computed(() => [...new Set(operationLogs.value.map((row) => row.module))])

/* ===== 分页（三个 Tab 共用 page 状态，切换时重置） ===== */
const page = ref(1)
const pageSize = 10

function switchTab(tab: TabKey) {
  activeTab.value = tab
  page.value = 1
}

function pageOf<T>(rows: T[]): T[] {
  return rows.slice((page.value - 1) * pageSize, page.value * pageSize)
}

const currentTotal = computed(() => {
  if (activeTab.value === 'login') return filteredLogin.value.length
  if (activeTab.value === 'operation') return filteredOps.value.length
  return errorLogs.value.length
})

function onExport() {
  const label = TABS.find((tab) => tab.key === activeTab.value)?.label ?? ''
  showToast(`已导出${label}（演示）`, 'success')
}

/* ===== 异常堆栈详情 ===== */
const stackOpen = ref<ErrorLog | null>(null)

onMounted(load)
</script>

<template>
  <div class="panel">
    <div class="tab-row">
      <button
        v-for="tab in TABS"
        :key="tab.key"
        class="tab-btn"
        :class="{ active: activeTab === tab.key }"
        type="button"
        @click="switchTab(tab.key)"
      >
        {{ tab.label }}
      </button>
      <span class="filter-label" style="margin-left: 14px">
        {{ TABS.find((tab) => tab.key === activeTab)?.hint }}
      </span>
      <button class="btn btn-ghost btn-sm" style="margin-left: auto" @click="onExport">
        <AppIcon name="download" :size="14" /> 导出
      </button>
    </div>

    <!-- 登录日志 -->
    <div v-if="activeTab === 'login'" class="tab-body">
      <div class="filter-bar">
        <input v-model="loginKeyword" class="f-input" style="width: 220px" placeholder="账号 / IP 检索" />
        <button class="btn btn-ghost btn-sm" @click="page = 1">检索</button>
      </div>
      <div class="data-table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>时间</th>
              <th>账号</th>
              <th>IP</th>
              <th>设备</th>
              <th>结果</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="loading && loginLogs.length === 0">
              <td colspan="5" class="empty-row">加载中…</td>
            </tr>
            <tr v-else-if="pageOf(filteredLogin).length === 0">
              <td colspan="5" class="empty-row">无匹配记录</td>
            </tr>
            <template v-else>
              <tr v-for="row in pageOf(filteredLogin)" :key="row.id">
                <td class="time-cell">{{ row.time }}</td>
                <td class="cell-strong">{{ row.account }}</td>
                <td><code class="ip-chip">{{ row.ip }}</code></td>
                <td>{{ row.device }}</td>
                <td>
                  <span v-if="row.ok" class="tag tag-green">成功</span>
                  <span v-else class="tag tag-red">失败</span>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
    </div>

    <!-- 操作日志 -->
    <div v-else-if="activeTab === 'operation'" class="tab-body">
      <div class="filter-bar">
        <select v-model="opModule" class="f-select" style="width: 150px">
          <option value="">全部模块</option>
          <option v-for="module in opModules" :key="module" :value="module">{{ module }}</option>
        </select>
      </div>
      <div class="data-table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>时间</th>
              <th>操作账号</th>
              <th>模块</th>
              <th>动作</th>
              <th>对象</th>
              <th>结果</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="loading && operationLogs.length === 0">
              <td colspan="6" class="empty-row">加载中…</td>
            </tr>
            <tr v-else-if="pageOf(filteredOps).length === 0">
              <td colspan="6" class="empty-row">无匹配记录</td>
            </tr>
            <template v-else>
              <tr v-for="row in pageOf(filteredOps)" :key="row.id">
                <td class="time-cell">{{ row.time }}</td>
                <td class="cell-strong">{{ row.account }}</td>
                <td><span class="tag tag-gray">{{ row.module }}</span></td>
                <td>{{ row.action }}</td>
                <td>{{ row.target }}</td>
                <td>
                  <span v-if="row.ok" class="tag tag-green">成功</span>
                  <span v-else class="tag tag-red">失败</span>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
    </div>

    <!-- 异常日志 -->
    <div v-else class="tab-body">
      <div class="data-table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th style="width: 150px">时间</th>
              <th>级别</th>
              <th>堆栈摘要</th>
              <th style="width: 80px">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="loading && errorLogs.length === 0">
              <td colspan="4" class="empty-row">加载中…</td>
            </tr>
            <tr v-else-if="pageOf(errorLogs).length === 0">
              <td colspan="4" class="empty-row">暂无异常</td>
            </tr>
            <template v-else>
              <tr v-for="row in pageOf(errorLogs)" :key="row.id" :class="{ 'err-row': row.level === 'ERROR' }">
                <td class="time-cell">{{ row.time }}</td>
                <td>
                  <span class="tag" :class="row.level === 'ERROR' ? 'tag-red' : 'tag-orange'">{{ row.level }}</span>
                </td>
                <td class="stack-cell">{{ row.stack.split('\n')[0] }}</td>
                <td>
                  <button class="mini-btn" type="button" @click="stackOpen = row">堆栈</button>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
    </div>

    <AppPagination :total="currentTotal" v-model:page="page" :page-size="pageSize" />

    <!-- 堆栈详情 -->
    <AppModal v-if="stackOpen" :title="`异常堆栈 · ${stackOpen.level}`" :width="640" @close="stackOpen = null">
      <p class="stack-time">{{ stackOpen.time }}</p>
      <pre class="stack-block">{{ stackOpen.stack }}</pre>
    </AppModal>
  </div>
</template>

<style scoped>
.tab-row {
  display: flex;
  align-items: center;
  gap: 4px;
  border-bottom: 1px solid var(--border);
  padding: 0 16px;
}
.tab-btn {
  border: none;
  background: transparent;
  color: var(--sub);
  font-size: 13.5px;
  font-weight: 500;
  padding: 14px 16px;
  cursor: pointer;
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  transition: color 0.15s;
}
.tab-btn:hover { color: var(--ink); }
.tab-btn.active { color: var(--brand); font-weight: 600; border-bottom-color: var(--brand); }
.tab-body { padding: 14px 16px 0; }

.time-cell { font-size: 12.5px; color: var(--sub); white-space: nowrap; }
.ip-chip {
  font-family: 'SF Mono', Menlo, monospace;
  font-size: 12px;
  background: #f1f3f9;
  border-radius: 6px;
  padding: 2px 8px;
  color: #4b5568;
}
.stack-cell {
  font-family: 'SF Mono', Menlo, monospace;
  font-size: 12px;
  color: var(--ink-2);
  max-width: 520px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.err-row td { background: rgba(214, 69, 69, 0.04); }

.stack-time { font-size: 12px; color: var(--sub); margin-bottom: 10px; }
.stack-block {
  background: #0f1729;
  color: #dbe4f5;
  border-radius: 10px;
  padding: 14px 16px;
  font-size: 12px;
  line-height: 1.8;
  white-space: pre-wrap;
  word-break: break-all;
  margin: 0;
}
</style>
