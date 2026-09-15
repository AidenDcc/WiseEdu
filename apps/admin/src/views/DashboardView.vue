<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'
import {
  AppIcon,
  showToast,
  formatCount,
  TrendChart,
  type AdminOverview,
} from '@aiteach/shared'
import { fetchAdminOverview } from '@/api/dashboard'
import StatCard from '@/components/StatCard.vue'
import PanelCard from '@/components/PanelCard.vue'

const router = useRouter()

const overview = ref<AdminOverview | null>(null)
const loading = ref(true)

onMounted(async () => {
  try {
    overview.value = await fetchAdminOverview()
  } catch (error) {
    showToast((error as Error).message || '数据加载失败', 'error')
  } finally {
    loading.value = false
  }
})

function onPending(name: string) {
  showToast(`「${name}」功能正在开发中，敬请期待`, 'info')
}
</script>

<template>
  <div class="dashboard">
    <!-- 指标卡（FR-PT-001） -->
    <div v-if="overview" class="stats">
      <StatCard label="机构总数" :value="overview.totalTenants" icon="building" :delta="overview.tenantGrowth" />
      <StatCard label="试用中机构" :value="overview.trialTenants" icon="clock" tone="plain" />
      <StatCard label="30 天内到期预警" :value="overview.expiringSoon" icon="warning" tone="warn" hint="家" />
      <StatCard label="本月 AI 调用" :value="overview.aiCallsThisMonth" icon="cpu" :delta="overview.aiCallsGrowth" />
      <StatCard label="今日新增机构" :value="overview.newTenantsToday" icon="sparkles" tone="plain" />
    </div>

    <!-- 趋势图（FR-PT-002） -->
    <PanelCard
      v-if="overview"
      class="trend-panel"
      title="平台趋势"
      subtitle="近 30 天机构增长与 AI 调用量"
    >
      <template #extra>
        <div class="range-switch">
          <button class="active">30 天</button>
          <button @click="onPending('7 / 90 天切换')">7 天</button>
          <button @click="onPending('7 / 90 天切换')">90 天</button>
        </div>
      </template>
      <TrendChart
        :labels="overview.trend.days"
        :series="[
          { name: '机构累计', data: overview.trend.tenants, color: '#4f6ef7' },
          { name: 'AI 调用量', data: overview.trend.aiCalls, color: '#00b4a6' },
        ]"
      />
    </PanelCard>

    <!-- 待办与预警（FR-PT-003 / 004） -->
    <div v-if="overview" class="dual">
      <PanelCard title="入驻审核待办" :subtitle="`${overview.pendingApplies.length} 条待处理申请`">
        <template #extra>
          <button class="link-btn" @click="router.push('/tenant/apply')">
            全部 <AppIcon name="arrow-right" :size="13" />
          </button>
        </template>
        <table class="table">
          <thead>
            <tr>
              <th>机构名称</th>
              <th>类型 / 学段</th>
              <th>联系人</th>
              <th>提交时间</th>
              <th>等待时长</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="apply in overview.pendingApplies" :key="apply.applyNo">
              <td>
                <div class="org-cell">
                  <span class="org-name">{{ apply.orgName }}</span>
                  <span class="org-no">{{ apply.applyNo }}</span>
                </div>
              </td>
              <td class="muted">{{ apply.orgType }} · {{ apply.stages }}</td>
              <td>
                <div>{{ apply.contact }}</div>
                <div class="muted">{{ apply.phone }}</div>
              </td>
              <td class="muted">{{ apply.submittedAt }}</td>
              <td>
                <span class="tag" :class="apply.overtime ? 'tag-red' : 'tag-gray'">
                  {{ apply.overtime ? '超时' : '' }} {{ apply.waitingHours }}h
                </span>
              </td>
              <td>
                <button class="mini-btn" @click="router.push('/tenant/apply')">去处理</button>
              </td>
            </tr>
          </tbody>
        </table>
      </PanelCard>

      <PanelCard title="到期预警" subtitle="30 天内到期的机构">
        <template #extra>
          <button class="link-btn" @click="router.push('/tenant/list')">
            全部 <AppIcon name="arrow-right" :size="13" />
          </button>
        </template>
        <ul class="expire-list">
          <li v-for="tenant in overview.expiringTenants" :key="tenant.name">
            <div class="expire-info">
              <span class="org-name">{{ tenant.name }}</span>
              <span class="tag tag-blue">{{ tenant.packageName }}</span>
            </div>
            <div class="expire-right">
              <span class="muted">{{ tenant.expireTime }}</span>
              <span class="tag" :class="tenant.daysLeft <= 7 ? 'tag-red' : 'tag-orange'">
                剩 {{ tenant.daysLeft }} 天
              </span>
              <button class="mini-btn ghost" @click="router.push('/tenant/list')">查看</button>
            </div>
          </li>
        </ul>
      </PanelCard>
    </div>

    <!-- 加载态 -->
    <div v-if="loading" class="loading panel">
      <AppIcon name="clock" :size="20" class="spin" />
      正在加载平台数据…
    </div>
  </div>
</template>

<style scoped>
.dashboard { display: flex; flex-direction: column; gap: 18px; }

.stats {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 16px;
}
@media (max-width: 1400px) {
  .stats { grid-template-columns: repeat(3, 1fr); }
}
@media (max-width: 900px) {
  .stats { grid-template-columns: repeat(2, 1fr); }
}

.range-switch {
  display: flex;
  background: #f1f3f9;
  border-radius: 9px;
  padding: 3px;
}
.range-switch button {
  border: none;
  background: transparent;
  border-radius: 7px;
  font-size: 12.5px;
  color: var(--ink-2);
  padding: 4px 12px;
}
.range-switch button.active {
  background: #fff;
  color: var(--brand);
  font-weight: 700;
  box-shadow: 0 1px 4px rgba(28, 36, 52, 0.1);
}

.dual {
  display: grid;
  grid-template-columns: 3fr 2fr;
  gap: 18px;
  align-items: start;
}
@media (max-width: 1100px) {
  .dual { grid-template-columns: 1fr; }
}

.table { width: 100%; border-collapse: collapse; font-size: 13px; }
.table th {
  text-align: left;
  font-size: 12px;
  color: var(--sub);
  font-weight: 500;
  padding: 8px 10px 8px 0;
  border-bottom: 1px solid var(--border);
  white-space: nowrap;
}
.table td {
  padding: 12px 10px 12px 0;
  border-bottom: 1px solid #f1f3f8;
  vertical-align: middle;
}
.table tr:last-child td { border-bottom: none; }
.org-cell { display: flex; flex-direction: column; }
.org-name { font-weight: 600; }
.org-no { font-size: 11.5px; color: var(--sub); font-family: 'SF Mono', monospace; }
.muted { color: var(--sub); font-size: 12.5px; }

.mini-btn {
  border: none;
  border-radius: 8px;
  background: var(--brand-grad);
  color: #fff;
  font-size: 12px;
  font-weight: 600;
  padding: 5px 12px;
}
.mini-btn.ghost {
  background: var(--brand-soft);
  color: var(--brand);
}

.link-btn {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  border: none;
  background: none;
  color: var(--sub);
  font-size: 12.5px;
}
.link-btn:hover { color: var(--brand); }

.expire-list li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 13px 2px;
  border-bottom: 1px solid #f1f3f8;
}
.expire-list li:last-child { border-bottom: none; }
.expire-info { display: flex; align-items: center; gap: 8px; }
.expire-right { display: flex; align-items: center; gap: 8px; }

.loading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 60px;
  color: var(--sub);
  font-size: 14px;
}
.spin { animation: spin 1s linear infinite; }
@keyframes spin { to { transform: rotate(360deg); } }
</style>
