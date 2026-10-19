<script setup lang="ts">
/**
 * AI 工作台（T-10-01）：机构 AI 用量的核算台。
 *
 * 三件事按「先看总账 → 再看结构 → 最后对单条」的顺序排：
 * 1. 额度卡：还剩多少 token / 多少钱，本月用了多少 —— 这是管理员每周被问的第一句；
 * 2. 用量趋势 + 分布：按日 / 周 / 月切换看走势，按个人 / 按功能看是谁、在哪用掉的；
 * 3. 请求明细：每一次模型调用的 token 与金额，对账到具体一条。
 *
 * 任务执行轨迹不在这里 —— 它已独立为「AI 能力中心 → 任务中心」：任务中心是「正在跑 / 跑完
 * 的活」，用量是「花了多少钱」，两类问题、两种节奏，混在一页会互相挤占注意力。
 */
import { computed, onMounted, ref, watch } from 'vue'
import { AppIcon, AppPageHeader, AppPagination, AppSegmented, BarChart, showToast } from '@aiteach/shared'
import type { AiCapabilityCard, AiRequestLog, AiUsageGranularity, AiUsageReport } from '@aiteach/shared'
import { fetchAiCapabilities, fetchAiUsage } from '@/api/student'

const capabilities = ref<AiCapabilityCard[]>([])
const report = ref<AiUsageReport | null>(null)
const loading = ref(true)

/** 统计粒度：日 / 周 / 月 */
const granularity = ref<AiUsageGranularity>('day')
const GRANULARITY_OPTIONS = [
  { value: 'day', label: '按日' },
  { value: 'week', label: '按周' },
  { value: 'month', label: '按月' },
]

/** 分布口径：按个人 / 按功能 */
const groupMode = ref<'user' | 'scene'>('user')
const GROUP_OPTIONS = [
  { value: 'user', label: '按个人' },
  { value: 'scene', label: '按功能' },
]

/* 窗口跟着粒度走：看日趋势给 30 天，看周趋势给 12 周（84 天），月度固定最近 3 个月 */
const WINDOW_DAYS: Record<AiUsageGranularity, number> = { day: 30, week: 84, month: 90 }

const page = ref(1)
const PAGE_SIZE = 10

async function load() {
  loading.value = true
  try {
    const [cards, usage] = await Promise.all([
      fetchAiCapabilities(),
      fetchAiUsage({ granularity: granularity.value, days: WINDOW_DAYS[granularity.value] }),
    ])
    capabilities.value = cards
    report.value = usage
  } catch (error) {
    showToast(error instanceof Error ? error.message : '用量加载失败', 'error')
  } finally {
    loading.value = false
  }
}

watch(granularity, () => {
  page.value = 1
  load()
})

onMounted(load)

const quota = computed(() => report.value?.quota)
const totalTokens = computed(() => report.value?.summary.tokens ?? 0)
const groupRows = computed(() => (groupMode.value === 'user' ? report.value?.byUser ?? [] : report.value?.byScene ?? []))
const pagedLogs = computed(() => {
  const rows = report.value?.logs ?? []
  return rows.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE)
})

/** 额度使用率：token 与金额两套口径，卡片上取 token 那条画进度条 */
const tokenUsedPercent = computed(() => {
  const q = quota.value
  if (!q || !q.tokenQuota) return 0
  return Math.min(100, Math.round((q.tokenUsed / q.tokenQuota) * 1000) / 10)
})
const costUsedPercent = computed(() => {
  const q = quota.value
  if (!q || !q.costQuota) return 0
  return Math.min(100, Math.round((q.costUsed / q.costQuota) * 1000) / 10)
})

function percentTone(percent: number): string {
  return percent >= 90 ? 'danger' : percent >= 75 ? 'warn' : 'ok'
}

const chartLabels = computed(() => (report.value?.buckets ?? []).map((row) => row.label))
const chartValues = computed(() => (report.value?.buckets ?? []).map((row) => row.tokens))

/** 明细上限 200 条（窗口拉长时不该说「共 200 条」—— 那是截断，不是总数） */
const logCountText = computed(() => {
  const count = report.value?.logs.length ?? 0
  return count >= 200 ? '最近 200 条' : `共 ${count.toLocaleString('zh-CN')} 条`
})

const WINDOW_TEXT = computed(() => (granularity.value === 'day' ? '近 30 天' : granularity.value === 'week' ? '近 12 周' : '近 3 个月'))

function num(value: number): string {
  return value.toLocaleString('zh-CN')
}

function money(value: number): string {
  return `¥${value.toFixed(2)}`
}

function statusTag(status: AiRequestLog['status']): string {
  return status === 'success' ? 'tag-green' : 'tag-red'
}
</script>

<template>
  <div class="page">
    <AppPageHeader desc="机构 AI 用量总账：请求明细、token 消耗与剩余额度；可按日 / 周 / 月看走势，按个人或按功能看结构。" />

    <!-- 额度与消耗 -->
    <div class="quota-row">
      <div class="quota-card quota-main">
        <div class="q-head">
          <span class="q-label">Token 剩余额度</span>
          <span class="q-pill" :class="percentTone(tokenUsedPercent)">{{ tokenUsedPercent }}% 已用</span>
        </div>
        <b class="q-value">{{ num(quota?.tokenLeft ?? 0) }}</b>
        <div class="q-bar">
          <i :class="percentTone(tokenUsedPercent)" :style="{ width: `${tokenUsedPercent}%` }" />
        </div>
        <span class="q-sub">
          本月已用 {{ num(quota?.tokenUsed ?? 0) }} / 额度 {{ num(quota?.tokenQuota ?? 0) }} · {{ quota?.resetAt }} 重置
        </span>
      </div>

      <div class="quota-card">
        <span class="q-label">本月消耗</span>
        <b class="q-value">{{ money(quota?.costUsed ?? 0) }}</b>
        <span class="q-sub">额度 {{ money(quota?.costQuota ?? 0) }} · 剩余 {{ money(quota?.costLeft ?? 0) }}</span>
        <div class="q-bar small">
          <i :class="percentTone(costUsedPercent)" :style="{ width: `${costUsedPercent}%` }" />
        </div>
      </div>

      <div class="quota-card">
        <span class="q-label">{{ WINDOW_TEXT }}请求</span>
        <b class="q-value">{{ num(report?.summary.requests ?? 0) }}</b>
        <span class="q-sub">
          {{ num(totalTokens) }} tokens · 失败率 {{ report?.summary.failRate ?? 0 }}%
        </span>
      </div>

      <div class="quota-card">
        <span class="q-label">覆盖范围</span>
        <b class="q-value">{{ report?.byScene.length ?? 0 }} 项功能</b>
        <span class="q-sub">{{ report?.byUser.length ?? 0 }} 位使用人 · {{ WINDOW_TEXT }}</span>
      </div>
    </div>

    <!-- 快捷入口：一排 4 个 -->
    <div class="panel">
      <div class="panel-body">
        <h3 class="panel-title">快捷入口</h3>
        <div class="cap-grid">
          <router-link v-for="card in capabilities" :key="card.key" class="cap-card" :to="card.link">
            <div class="cap-top">
              <div class="cap-icon"><AppIcon :name="card.icon" :size="18" /></div>
              <span class="cap-uses">本月 {{ card.monthUses }} 次</span>
            </div>
            <div class="cap-title">{{ card.title }}</div>
            <p class="cap-desc">{{ card.desc }}</p>
          </router-link>
        </div>
      </div>
    </div>

    <!-- 用量趋势 -->
    <div class="panel">
      <div class="panel-head">
        <div>
          <h3 class="panel-title flush">用量趋势</h3>
          <p class="panel-hint">{{ WINDOW_TEXT }} token 消耗 · 共 {{ num(totalTokens) }} tokens</p>
        </div>
        <AppSegmented v-model="granularity" :options="GRANULARITY_OPTIONS" />
      </div>
      <div class="chart-wrap">
        <BarChart :labels="chartLabels" :values="chartValues" color="#00b4a6" unit=" tokens" :height="240" />
      </div>
    </div>

    <!-- 用量分布 -->
    <div class="panel">
      <div class="panel-head">
        <div>
          <h3 class="panel-title flush">用量分布</h3>
          <p class="panel-hint">按 token 占比排序，占比以当前窗口总量为分母</p>
        </div>
        <AppSegmented v-model="groupMode" :options="GROUP_OPTIONS" />
      </div>
      <div class="data-table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>{{ groupMode === 'user' ? '使用人' : '功能' }}</th>
              <th>请求数</th>
              <th>token 消耗</th>
              <th>费用</th>
              <th class="col-share">占比</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="!groupRows.length">
              <td colspan="5" class="empty-row">当前窗口没有调用记录</td>
            </tr>
            <template v-else>
              <tr v-for="row in groupRows" :key="row.key">
                <td class="cell-strong">{{ row.name }}</td>
                <td>{{ row.requests }}</td>
                <td class="mono">{{ num(row.tokens) }}</td>
                <td class="mono">{{ money(row.cost) }}</td>
                <td>
                  <div class="share-cell">
                    <div class="share-bar"><i :style="{ width: `${row.share}%` }" /></div>
                    <span class="share-num">{{ row.share }}%</span>
                  </div>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
    </div>

    <!-- 请求明细 -->
    <div class="panel">
      <div class="panel-head">
        <div>
          <h3 class="panel-title flush">请求明细</h3>
          <p class="panel-hint">每一次 AI 调用一行，按时间倒序；金额按输入 / 输出 token 分别计价</p>
        </div>
        <span class="panel-hint">{{ logCountText }}</span>
      </div>
      <div class="data-table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>时间</th>
              <th>功能</th>
              <th>使用人</th>
              <th>输入 / 输出 token</th>
              <th>合计</th>
              <th>费用</th>
              <th>耗时</th>
              <th>状态</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="loading">
              <td colspan="8" class="empty-row">加载中…</td>
            </tr>
            <tr v-else-if="!pagedLogs.length">
              <td colspan="8" class="empty-row">当前窗口没有调用记录</td>
            </tr>
            <template v-else>
              <tr v-for="row in pagedLogs" :key="row.id">
                <td class="mono">{{ row.createdAt }}</td>
                <td><span class="tag tag-blue">{{ row.scene }}</span></td>
                <td>{{ row.userName }}</td>
                <td class="mono">{{ num(row.promptTokens) }} / {{ num(row.completionTokens) }}</td>
                <td class="mono cell-strong">{{ num(row.totalTokens) }}</td>
                <td class="mono">{{ money(row.cost) }}</td>
                <td class="mono">{{ row.elapsed }}s</td>
                <td><span class="tag" :class="statusTag(row.status)">{{ row.status === 'success' ? '成功' : '失败' }}</span></td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
      <AppPagination v-model:page="page" :total="report?.logs.length ?? 0" :page-size="PAGE_SIZE" />
    </div>
  </div>
</template>

<style scoped>
/* ===== 额度卡片 ===== */
.quota-row { display: grid; grid-template-columns: 1.6fr 1fr 1fr 1fr; gap: 14px; }
.quota-card {
  background: var(--card); border: 1px solid var(--border); border-radius: var(--radius);
  box-shadow: var(--shadow); padding: 16px 18px;
  display: flex; flex-direction: column; gap: 6px; min-width: 0;
}
.q-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.q-label { font-size: 12.5px; color: var(--sub); }
.q-pill {
  font-size: 11.5px; font-weight: 700; padding: 2px 8px; border-radius: 999px;
  background: var(--success-soft); color: var(--success);
}
.q-pill.warn { background: var(--warn-soft); color: var(--warn); }
.q-pill.danger { background: var(--danger-soft); color: var(--danger); }
.q-value {
  font-size: 26px; font-weight: 700; color: var(--ink);
  font-variant-numeric: tabular-nums; line-height: 1.2;
}
.q-sub { font-size: 11.5px; color: var(--sub); line-height: 1.6; }
.q-bar { height: 6px; border-radius: 999px; background: #eef1f7; overflow: hidden; }
.q-bar.small { height: 4px; margin-top: 2px; }
.q-bar i { display: block; height: 100%; border-radius: 999px; background: var(--brand); transition: width 0.3s; }
.q-bar i.warn { background: var(--warn); }
.q-bar i.danger { background: var(--danger); }

/* ===== 面板通用 ===== */
/* panel 本身不留内边距（表格要贴边），所以内容区自己给一圈 ——
   数值与全局筛选栏一致（14px / 18px），换页时不跳 */
.panel-body { padding: 14px 18px 18px; }
.panel-head {
  display: flex; align-items: flex-start; justify-content: space-between; gap: 12px;
  padding: 14px 18px 12px;
}
.panel-title { font-size: 14px; font-weight: 700; color: var(--ink); margin: 0 0 12px; }
.panel-title.flush { margin: 0; }
.panel-hint { margin: 4px 0 0; font-size: 12px; color: var(--sub); }

/* ===== 快捷入口：一排 4 个 ===== */
.cap-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
.cap-card {
  display: flex; flex-direction: column; gap: 8px;
  padding: 14px; border: 1.5px solid var(--border); border-radius: 12px;
  text-decoration: none; color: inherit; min-width: 0;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.cap-card:hover { border-color: var(--brand); box-shadow: 0 2px 10px rgba(0, 180, 166, 0.1); }
.cap-top { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.cap-icon {
  width: 36px; height: 36px; border-radius: 10px; background: var(--brand-soft); color: var(--brand-deep);
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
}
.cap-uses { font-size: 11px; color: var(--sub); white-space: nowrap; }
.cap-title { font-size: 13.5px; font-weight: 700; color: var(--ink); }
.cap-desc {
  margin: 0; font-size: 11.5px; color: var(--sub); line-height: 1.6;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}

/* ===== 图表 ===== */
.chart-wrap { padding: 0 8px 10px; }

/* ===== 分布与明细 ===== */
.col-share { width: 200px; }
.share-cell { display: flex; align-items: center; gap: 8px; }
.share-bar { width: 120px; height: 6px; border-radius: 999px; background: #eef1f7; overflow: hidden; }
.share-bar i { display: block; height: 100%; border-radius: 999px; background: var(--brand); }
.share-num { font-size: 12px; color: var(--sub); font-variant-numeric: tabular-nums; }
.mono { font-family: 'SF Mono', Menlo, monospace; font-size: 12px; }
.data-table :deep(td),
.data-table :deep(th) { white-space: nowrap; }
</style>
