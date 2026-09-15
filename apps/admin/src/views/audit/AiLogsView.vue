<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { AppIcon, showToast } from '@aiteach/shared'
import type { AiCallLog } from '@aiteach/shared'
import AppPagination from '@/components/ui/AppPagination.vue'
import { fetchAiLogs } from '@/api/platform'
import type { AiLogStats } from '@/api/platform'

const SCENES = ['AI 出题', 'AI 变式', '拍照识题', '文档识别入库', '题目校验', '试卷分析']
const MODELS = ['GPT-5.1', 'Claude Opus 5', 'Qwen-VL Max', 'PaddleOCR']

const filters = reactive({ org: '', scene: '', model: '', result: '' })
const list = ref<AiCallLog[]>([])
const stats = ref<AiLogStats>({ total: 0, successRate: 0, totalTokens: 0, totalCost: 0 })
const loading = ref(false)

const page = ref(1)
const pageSize = 12

async function load() {
  loading.value = true
  try {
    const data = await fetchAiLogs({
      org: filters.org.trim() || undefined,
      scene: filters.scene || undefined,
      model: filters.model || undefined,
      result: filters.result || undefined,
    })
    list.value = data.list
    stats.value = data.stats
    page.value = 1
  } finally {
    loading.value = false
  }
}

const paged = computed(() => list.value.slice((page.value - 1) * pageSize, page.value * pageSize))
const failedCount = computed(() => list.value.filter((row) => !row.ok).length)

function totalTokens(row: AiCallLog) {
  return row.inputTokens + row.outputTokens
}

function rowCost(row: AiCallLog) {
  // 演示口径：0.004 元 / 千 tokens
  return (totalTokens(row) / 1000) * 0.004
}

function onExport() {
  showToast(`已导出 ${list.value.length} 条 AI 调用日志（演示）`, 'success')
}

onMounted(load)
</script>

<template>
  <div>
    <!-- 统计条（FR-PT-028） -->
    <div class="stat-strip">
      <div class="stat-card">
        <span class="stat-num">{{ stats.total.toLocaleString('zh-CN') }}</span>
        <span class="stat-label">筛选结果调用总量</span>
      </div>
      <div class="stat-card">
        <span class="stat-num ok">{{ stats.successRate.toFixed(1) }}%</span>
        <span class="stat-label">成功率</span>
      </div>
      <div class="stat-card">
        <span class="stat-num">{{ (stats.totalTokens / 10000).toFixed(1) }} 万</span>
        <span class="stat-label">总 tokens</span>
      </div>
      <div class="stat-card">
        <span class="stat-num">¥{{ stats.totalCost.toFixed(1) }}</span>
        <span class="stat-label">总费用</span>
      </div>
      <div class="stat-card">
        <span class="stat-num" :class="{ bad: failedCount > 0 }">{{ failedCount }}</span>
        <span class="stat-label">失败（点行展开）</span>
      </div>
    </div>

    <div class="panel">
      <div class="filter-bar">
        <input v-model="filters.org" class="f-input" style="width: 150px" placeholder="机构（脱敏名）" />
        <select v-model="filters.scene" class="f-select" style="width: 130px">
          <option value="">全部场景</option>
          <option v-for="scene in SCENES" :key="scene" :value="scene">{{ scene }}</option>
        </select>
        <select v-model="filters.model" class="f-select" style="width: 150px">
          <option value="">全部模型</option>
          <option v-for="model in MODELS" :key="model" :value="model">{{ model }}</option>
        </select>
        <select v-model="filters.result" class="f-select" style="width: 110px">
          <option value="">全部结果</option>
          <option value="ok">成功</option>
          <option value="fail">失败</option>
        </select>
        <button class="btn btn-primary btn-sm" @click="load">查询</button>
        <button class="btn btn-ghost btn-sm" style="margin-left: auto" @click="onExport">
          <AppIcon name="download" :size="14" /> 导出
        </button>
      </div>

      <div class="data-table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th style="width: 150px">时间</th>
              <th>机构</th>
              <th>用户</th>
              <th>场景</th>
              <th>模型</th>
              <th>tokens（入/出）</th>
              <th>耗时</th>
              <th>费用</th>
              <th>结果</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="loading && list.length === 0">
              <td colspan="9" class="empty-row">加载中…</td>
            </tr>
            <tr v-else-if="paged.length === 0">
              <td colspan="9" class="empty-row">无匹配日志</td>
            </tr>
            <template v-else>
              <template v-for="row in paged" :key="row.id">
                <tr :class="{ 'fail-row': !row.ok }">
                  <td class="time-cell">{{ row.time }}</td>
                  <td>{{ row.orgMasked }}</td>
                  <td>{{ row.user }}</td>
                  <td><span class="tag tag-blue">{{ row.scene }}</span></td>
                  <td>{{ row.model }}</td>
                  <td>{{ row.inputTokens }} / {{ row.outputTokens }}</td>
                  <td>{{ (row.costMs / 1000).toFixed(2) }}s</td>
                  <td>¥{{ rowCost(row).toFixed(4) }}</td>
                  <td>
                    <span v-if="row.ok" class="tag tag-green">成功</span>
                    <span v-else class="tag tag-red">失败</span>
                  </td>
                </tr>
                <tr v-if="!row.ok" class="fail-detail">
                  <td colspan="9">
                    <AppIcon name="warning" :size="13" />
                    错误信息：{{ row.error }}
                  </td>
                </tr>
              </template>
            </template>
          </tbody>
        </table>
      </div>

      <AppPagination :total="list.length" v-model:page="page" :page-size="pageSize" />
    </div>
  </div>
</template>

<style scoped>
.stat-strip {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 14px;
  margin-bottom: 14px;
}
.stat-card {
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 14px;
  padding: 16px 18px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.stat-num { font-size: 22px; font-weight: 700; color: var(--ink); font-variant-numeric: tabular-nums; }
.stat-num.ok { color: var(--success); }
.stat-num.bad { color: var(--danger); }
.stat-label { font-size: 12px; color: var(--sub); }

.time-cell { font-size: 12.5px; color: var(--sub); white-space: nowrap; }
.fail-row td { background: rgba(214, 69, 69, 0.05); }
.fail-detail td {
  background: rgba(214, 69, 69, 0.04);
  color: var(--danger);
  font-size: 12.5px;
  padding: 6px 14px 10px;
  border-top: none;
  display: flex;
  align-items: center;
  gap: 6px;
}
</style>
