<script setup lang="ts">
/**
 * AI 任务中心（T-10-02）：所有 AI 任务的执行轨迹。
 *
 * 从 AI 工作台独立出来的原因：工作台回答「花了多少钱」，任务中心回答「那些活干得怎么样」。
 * 两者一个按窗口聚合、一个按任务逐条看，节奏不同；混在一页时任务表把用量图表挤到首屏之外。
 *
 * 每行可下钻两层，正好覆盖老师对账时的两个疑问：
 * - **请求明细**：这个任务到底调了几次、每次吃多少 token（一次 AI 组卷往往来回十几次，
 *   只看一个汇总数字，出问题时无从对账）；
 * - **产出明细**：它生成了什么、能不能用、有没有卡在复核。
 */
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  AI_TASK_OUTPUT_STATUS_TEXT,
  AI_TASK_STATUS_TEXT,
  AppDrawer,
  AppFilterPanel,
  AppIcon,
  AppListToolbar,
  AppPageHeader,
  AppPagination,
  appConfirm,
  showToast,
} from '@aiteach/shared'
import type { AiCenterTask, AiRequestLog, AiTaskOutput, AiTaskQuery, FilterRowDef } from '@aiteach/shared'
import { cancelAiTask, fetchAiTasks, fetchTaskOutputs, fetchTaskRequests } from '@/api/student'

const router = useRouter()

const tasks = ref<AiCenterTask[]>([])
const loading = ref(true)
const keyword = ref('')
const filter = ref<Record<string, string[]>>({ scene: [], status: [], creator: [] })
const page = ref(1)
const PAGE_SIZE = 10

/** 候选值先全量取一次：筛完再去取候选会只剩当前命中的那几项，选不回去 */
const sceneOptions = ref<string[]>([])
const creatorOptions = ref<string[]>([])

const STATUS_OPTIONS = ['running', 'success', 'reviewing', 'failed']

const filterRows = computed<FilterRowDef[]>(() => [
  { key: 'scene', label: '场景', options: sceneOptions.value, multiple: false },
  {
    key: 'status',
    label: '状态',
    options: STATUS_OPTIONS,
    optionLabels: AI_TASK_STATUS_TEXT as Record<string, string>,
    multiple: false,
  },
  { key: 'creator', label: '发起人', options: creatorOptions.value, multiple: false },
])

function currentQuery(): AiTaskQuery {
  return {
    keyword: keyword.value.trim(),
    scene: filter.value.scene[0] ?? '',
    status: filter.value.status[0] ?? '',
    creator: filter.value.creator[0] ?? '',
  }
}

async function load() {
  loading.value = true
  try {
    tasks.value = await fetchAiTasks(currentQuery())
  } catch (error) {
    showToast(error instanceof Error ? error.message : '任务加载失败', 'error')
  } finally {
    loading.value = false
  }
}

async function bootstrap() {
  try {
    const all = await fetchAiTasks({})
    sceneOptions.value = [...new Set(all.map((row) => row.scene))]
    creatorOptions.value = [...new Set(all.map((row) => row.creator))]
    tasks.value = all
  } catch (error) {
    showToast(error instanceof Error ? error.message : '任务加载失败', 'error')
  } finally {
    loading.value = false
  }
}

onMounted(bootstrap)

/* 任一条件变化：回到第 1 页再查（停在旧页码会看到一张「明明有数据却空白」的表） */
function onFilterChange(next: Record<string, string[]>) {
  filter.value = next
  page.value = 1
  load()
}

function onKeywordChange(value: string) {
  keyword.value = value
  page.value = 1
  load()
}

const pagedTasks = computed(() => tasks.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE))

const stats = computed(() => ({
  total: tasks.value.length,
  running: tasks.value.filter((row) => row.status === 'running').length,
  reviewing: tasks.value.filter((row) => row.status === 'reviewing').length,
  tokens: tasks.value.reduce((sum, row) => sum + row.tokens, 0),
}))

function statusTag(status: AiCenterTask['status']): string {
  return status === 'success' ? 'tag-green' : status === 'running' ? 'tag-blue' : status === 'reviewing' ? 'tag-orange' : 'tag-red'
}

async function onCancel(row: AiCenterTask) {
  if (!(await appConfirm(`取消任务「${row.title}」？已消耗的 token 不退还。`, { type: 'warning' }))) return
  try {
    await cancelAiTask(row.id)
    showToast('已取消', 'success')
    load()
  } catch (error) {
    showToast(error instanceof Error ? error.message : '取消失败', 'error')
  }
}

/* ===== 请求明细 / 产出明细 ===== */

const detail = ref<null | { task: AiCenterTask; mode: 'requests' | 'outputs' }>(null)
const detailLoading = ref(false)
const requests = ref<AiRequestLog[]>([])
const outputs = ref<AiTaskOutput[]>([])

async function openDetail(task: AiCenterTask, mode: 'requests' | 'outputs') {
  detail.value = { task, mode }
  detailLoading.value = true
  requests.value = []
  outputs.value = []
  try {
    if (mode === 'requests') requests.value = await fetchTaskRequests(task.id)
    else outputs.value = await fetchTaskOutputs(task.id)
  } catch (error) {
    showToast(error instanceof Error ? error.message : '明细加载失败', 'error')
  } finally {
    detailLoading.value = false
  }
}

const requestSummary = computed(() => ({
  calls: requests.value.length,
  tokens: requests.value.reduce((sum, row) => sum + row.totalTokens, 0),
  cost: Math.round(requests.value.reduce((sum, row) => sum + row.cost, 0) * 100) / 100,
  failed: requests.value.filter((row) => row.status === 'failed').length,
}))

function num(value: number): string {
  return value.toLocaleString('zh-CN')
}

function money(value: number): string {
  return `¥${value.toFixed(2)}`
}

function outputTag(status: AiTaskOutput['status']): string {
  return status === 'ok' ? 'tag-green' : status === 'reviewing' ? 'tag-orange' : 'tag-red'
}
</script>

<template>
  <div class="page">
    <AppPageHeader desc="机构全部 AI 任务的执行轨迹：状态、耗时、token 消耗与产物；可下钻查看每次请求与每份产物。" />

    <AppFilterPanel :rows="filterRows" :model-value="filter" @update:model-value="onFilterChange" />

    <div class="panel">
      <div class="list-head">
        <AppListToolbar
          :model-value="keyword"
          placeholder="搜索任务名称 / 发起人"
          :search-width="240"
          @update:model-value="onKeywordChange"
        >
          <template #right>
            <span class="head-stat">进行中 <b>{{ stats.running }}</b></span>
            <span class="head-stat">待复核 <b class="warn">{{ stats.reviewing }}</b></span>
            <span class="head-stat">token 合计 <b>{{ num(stats.tokens) }}</b></span>
          </template>
        </AppListToolbar>
      </div>

      <div class="data-table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>任务</th>
              <th>场景</th>
              <th>发起人</th>
              <th>状态</th>
              <th>耗时</th>
              <th>token 消耗</th>
              <th>产物</th>
              <th>发起时间</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="loading">
              <td colspan="9" class="empty-row">加载中…</td>
            </tr>
            <tr v-else-if="!pagedTasks.length">
              <td colspan="9" class="empty-row">{{ tasks.length ? '没有符合条件的任务' : '暂无任务' }}</td>
            </tr>
            <template v-else>
              <tr v-for="row in pagedTasks" :key="row.id">
                <td class="cell-strong">{{ row.title }}</td>
                <td><span class="tag tag-blue">{{ row.scene }}</span></td>
                <td>{{ row.creator }}</td>
                <td><span class="tag" :class="statusTag(row.status)">{{ AI_TASK_STATUS_TEXT[row.status] }}</span></td>
                <td class="mono">{{ row.elapsed }}s</td>
                <td class="mono">{{ row.tokens.toLocaleString('zh-CN') }}</td>
                <td>{{ row.outputCount ? `${row.outputCount} 项` : '—' }}</td>
                <td class="mono">{{ row.createdAt }}</td>
                <td>
                  <div class="op-group">
                    <button class="mini-btn" @click="openDetail(row, 'requests')">请求明细</button>
                    <button class="mini-btn" :disabled="!row.outputCount" @click="openDetail(row, 'outputs')">产出明细</button>
                    <button v-if="row.status === 'running'" class="mini-btn danger" @click="onCancel(row)">取消</button>
                  </div>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>

      <AppPagination v-model:page="page" :total="tasks.length" :page-size="PAGE_SIZE" />
    </div>

    <!-- 请求明细：一次任务的每次模型调用 -->
    <AppDrawer
      v-if="detail && detail.mode === 'requests'"
      :title="`${detail.task.title} · 请求明细`"
      :subtitle="`${detail.task.scene} · ${detail.task.creator} · 发起于 ${detail.task.createdAt}`"
      :width="760"
      @close="detail = null"
    >
      <div class="detail-stats">
        <span>调用 <b>{{ requestSummary.calls }}</b> 次</span>
        <span>合计 <b>{{ num(requestSummary.tokens) }}</b> tokens</span>
        <span>费用 <b>{{ money(requestSummary.cost) }}</b></span>
        <span v-if="requestSummary.failed" class="danger">失败 <b>{{ requestSummary.failed }}</b> 次</span>
      </div>
      <table class="data-table">
        <thead>
          <tr>
            <th>时间</th>
            <th>输入 / 输出</th>
            <th>合计</th>
            <th>费用</th>
            <th>耗时</th>
            <th>状态</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="detailLoading">
            <td colspan="6" class="empty-row">加载中…</td>
          </tr>
          <tr v-else-if="!requests.length">
            <td colspan="6" class="empty-row">暂无请求记录</td>
          </tr>
          <template v-else>
            <tr v-for="row in requests" :key="row.id">
              <td class="mono">{{ row.createdAt }}</td>
              <td class="mono">{{ num(row.promptTokens) }} / {{ num(row.completionTokens) }}</td>
              <td class="mono cell-strong">{{ num(row.totalTokens) }}</td>
              <td class="mono">{{ money(row.cost) }}</td>
              <td class="mono">{{ row.elapsed }}s</td>
              <td><span class="tag" :class="row.status === 'success' ? 'tag-green' : 'tag-red'">{{ row.status === 'success' ? '成功' : '失败' }}</span></td>
            </tr>
          </template>
        </tbody>
      </table>
    </AppDrawer>

    <!-- 产出明细：这个任务到底产出了什么 -->
    <AppDrawer
      v-if="detail && detail.mode === 'outputs'"
      :title="`${detail.task.title} · 产出明细`"
      :subtitle="`共 ${detail.task.outputCount} 项产物 · token 消耗按产物均摊`"
      :width="720"
      @close="detail = null"
    >
      <table class="data-table">
        <thead>
          <tr>
            <th>产物</th>
            <th>类型</th>
            <th>状态</th>
            <th>token</th>
            <th>生成时间</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="detailLoading">
            <td colspan="6" class="empty-row">加载中…</td>
          </tr>
          <tr v-else-if="!outputs.length">
            <td colspan="6" class="empty-row">该任务没有产出（失败或进行中）</td>
          </tr>
          <template v-else>
            <tr v-for="row in outputs" :key="row.id">
              <td class="cell-strong">{{ row.title }}</td>
              <td><span class="tag tag-blue">{{ row.kind }}</span></td>
              <td><span class="tag" :class="outputTag(row.status)">{{ AI_TASK_OUTPUT_STATUS_TEXT[row.status] }}</span></td>
              <td class="mono">{{ num(row.tokens) }}</td>
              <td class="mono">{{ row.createdAt }}</td>
              <td>
                <button v-if="row.link" class="mini-btn" @click="router.push(row.link)">查看</button>
                <span v-else class="muted">—</span>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
      <p class="detail-hint">
        <AppIcon name="info" :size="14" />
        待复核的产物需先在「AI 内容复核」通过后才会发布给学生。
      </p>
    </AppDrawer>
  </div>
</template>

<style scoped>
/* 工具条嵌在面板顶部（与其它列表页同一写法：间距由 AppListToolbar 自带） */
.list-head { padding: 14px 18px 0; }
.head-stat { font-size: 12.5px; color: var(--sub); white-space: nowrap; }
.head-stat b { color: var(--ink); font-variant-numeric: tabular-nums; }
.head-stat b.warn { color: var(--warn); }

.detail-stats {
  display: flex; flex-wrap: wrap; gap: 18px;
  padding: 12px 14px; margin-bottom: 12px;
  background: var(--bg); border-radius: 10px;
  font-size: 12.5px; color: var(--sub);
}
.detail-stats b { font-size: 15px; color: var(--ink); }
.detail-stats .danger b { color: var(--danger); }
.detail-hint {
  display: flex; align-items: center; gap: 6px;
  margin-top: 14px; font-size: 12px; color: var(--sub);
}
.mono { font-family: 'SF Mono', Menlo, monospace; font-size: 12px; }
.muted { color: var(--sub); font-size: 12px; }
.data-table :deep(td),
.data-table :deep(th) { white-space: nowrap; }
</style>
