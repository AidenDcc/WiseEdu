<script setup lang="ts">
/**
 * 服务健康监控（P-06-06）。
 *
 * 各核心服务的可用率、平均响应、CPU / 内存占用一览；degraded / down 直接标红，
 * 并给出告警值班提示（P-06-07 的入口在此）。
 */
import { computed, onMounted, ref } from 'vue'
import { AppIcon, AppPageHeader, showToast } from '@aiteach/shared'
import type { ServiceHealthItem } from '@aiteach/shared'
import { fetchServiceHealth } from '@/api/content'

const services = ref<ServiceHealthItem[]>([])
const loading = ref(true)

async function load() {
  loading.value = true
  services.value = await fetchServiceHealth()
  loading.value = false
}

const abnormal = computed(() => services.value.filter((row) => row.status !== 'up'))

function statusMeta(status: ServiceHealthItem['status']) {
  if (status === 'up') return { text: '正常', tag: 'tag-green' }
  if (status === 'degraded') return { text: '降级', tag: 'tag-orange' }
  return { text: '不可用', tag: 'tag-red' }
}

function usageColor(value: number) {
  if (value >= 80) return '#d94f43'
  if (value >= 60) return '#d9822b'
  return '#2e9e5b'
}

onMounted(load)
</script>

<template>
  <div class="page">
    <AppPageHeader desc="核心服务健康监控：可用率、响应时延与资源占用；异常服务触发告警值班通知（P-06-07）。">
      <template #actions>
        <button class="btn btn-ghost" @click="showToast('已刷新服务健康数据', 'success')">
          <AppIcon name="refresh" :size="15" /> 刷新
        </button>
      </template>
    </AppPageHeader>

    <div v-if="abnormal.length" class="alert-bar">
      <AppIcon name="warning" :size="16" />
      <span>
        {{ abnormal.length }} 个服务异常：
        <b v-for="item in abnormal" :key="item.key">{{ item.name }}（{{ statusMeta(item.status).text }}）</b>
      </span>
    </div>

    <div class="service-grid">
      <div v-for="row in services" :key="row.key" class="service-card" :class="{ abnormal: row.status !== 'up' }">
        <div class="service-head">
          <div class="service-name">
            <AppIcon name="cpu" :size="15" /> {{ row.name }}
          </div>
          <span class="tag" :class="statusMeta(row.status).tag">{{ statusMeta(row.status).text }}</span>
        </div>
        <div class="service-metrics">
          <div class="metric">
            <span>24h 可用率</span>
            <b>{{ row.uptime }}%</b>
          </div>
          <div class="metric">
            <span>平均响应</span>
            <b :class="{ bad: row.latencyMs > 1000 }">{{ row.latencyMs ? `${row.latencyMs} ms` : '—' }}</b>
          </div>
        </div>
        <div class="resource-list">
          <div class="resource-row">
            <span class="resource-label">CPU</span>
            <div class="bar-track"><div class="bar" :style="{ width: `${row.cpu}%`, background: usageColor(row.cpu) }" /></div>
            <span class="resource-value">{{ row.cpu }}%</span>
          </div>
          <div class="resource-row">
            <span class="resource-label">内存</span>
            <div class="bar-track"><div class="bar" :style="{ width: `${row.memory}%`, background: usageColor(row.memory) }" /></div>
            <span class="resource-value">{{ row.memory }}%</span>
          </div>
        </div>
        <p v-if="row.lastAlertAt" class="alert-time"><AppIcon name="clock" :size="12" /> 最近告警：{{ row.lastAlertAt }}</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.alert-bar {
  display: flex; align-items: center; gap: 8px; margin-bottom: 16px; padding: 11px 14px;
  background: #fef2f2; border: 1px solid #fecaca; border-radius: 10px; font-size: 13px; color: #b91c1c;
}
.alert-bar b { margin-left: 6px; }
.service-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
.service-card { background: #fff; border: 1px solid var(--border); border-radius: 12px; padding: 16px 18px; }
.service-card.abnormal { border-color: #fecaca; background: #fffbfb; }
.service-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; }
.service-name { display: flex; align-items: center; gap: 8px; font-size: 14px; font-weight: 600; }
.service-metrics { display: flex; gap: 26px; margin-bottom: 14px; }
.metric { display: flex; flex-direction: column; gap: 3px; }
.metric span { font-size: 12px; color: var(--sub); }
.metric b { font-size: 17px; font-variant-numeric: tabular-nums; }
.metric b.bad { color: #d94f43; }
.resource-list { display: flex; flex-direction: column; gap: 8px; }
.resource-row { display: grid; grid-template-columns: 40px 1fr 38px; gap: 8px; align-items: center; }
.resource-label { font-size: 12px; color: var(--sub); }
.resource-value { font-size: 12px; text-align: right; font-variant-numeric: tabular-nums; }
.bar-track { position: relative; height: 8px; border-radius: 4px; background: #eef2f4; overflow: hidden; }
.bar { position: absolute; inset: 0 auto 0 0; border-radius: 4px; }
.alert-time { display: flex; align-items: center; gap: 5px; margin: 12px 0 0; font-size: 11.5px; color: #d9822b; }
</style>
