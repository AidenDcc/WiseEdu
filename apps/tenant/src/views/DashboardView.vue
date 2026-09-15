<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import {
  AppIcon,
  showToast,
  formatCount,
  formatQuota,
  TrendChart,
  type TenantOverview,
} from '@aiteach/shared'
import { fetchTenantOverview } from '@/api/dashboard'
import StatCard from '@/components/StatCard.vue'
import PanelCard from '@/components/PanelCard.vue'

const overview = ref<TenantOverview | null>(null)
const loading = ref(true)
const todoTab = ref('全部')

const TODO_TABS = ['全部', '题目终审', '试卷审核', '文档识别', '协同消息']

const todos = computed(() => {
  if (!overview.value) return []
  return todoTab.value === '全部'
    ? overview.value.todos
    : overview.value.todos.filter((todo) => todo.type === todoTab.value)
})

const aiPercent = computed(() => {
  if (!overview.value) return 0
  const { aiUsed, aiQuota } = overview.value.stats
  return Math.min(Math.round((aiUsed / aiQuota) * 100), 100)
})

const quotaTone = computed(() =>
  aiPercent.value >= 100 ? 'full' : aiPercent.value >= 80 ? 'warn' : 'ok',
)

onMounted(async () => {
  try {
    overview.value = await fetchTenantOverview()
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
    <!-- 指标卡 + AI 用量（FR-WS-001） -->
    <div v-if="overview" class="stats">
      <StatCard label="题目总数" :value="overview.stats.questionCount" icon="edit" />
      <StatCard label="试卷总数" :value="overview.stats.paperCount" icon="file" tone="plain" />
      <StatCard label="教辅数" :value="overview.stats.materialCount" icon="book" tone="plain" />
      <StatCard label="文件数" :value="overview.stats.fileCount" icon="folder" tone="plain" />

      <!-- AI 用量卡：进度条 + 预警色（≥80% 橙 / 100% 红） -->
      <div class="stat-card panel quota-card" :class="`quota-${quotaTone}`">
        <div class="stat-icon"><AppIcon name="cpu" :size="20" /></div>
        <div class="stat-main">
          <div class="stat-label">AI 用量（本月）</div>
          <div class="stat-value quota-value">
            {{ formatQuota(overview.stats.aiUsed, overview.stats.aiQuota) }}
          </div>
          <div class="quota-bar">
            <i :style="{ width: `${aiPercent}%` }" />
          </div>
          <div class="quota-hint">
            已用 {{ aiPercent }}%
            <template v-if="quotaTone === 'warn'">· 额度即将用尽</template>
            <template v-if="quotaTone === 'full'">· 额度已用完</template>
          </div>
        </div>
      </div>
    </div>

    <!-- 快捷操作（FR-WS-002） -->
    <div v-if="overview" class="quick-actions panel">
      <button
        v-for="action in overview.quickActions"
        :key="action.key"
        class="quick-btn"
        @click="onPending(action.label)"
      >
        <span class="quick-icon"><AppIcon :name="action.icon" :size="22" /></span>
        <span class="quick-label">{{ action.label }}</span>
      </button>
    </div>

    <div v-if="overview" class="dual">
      <!-- 分类待办中心（FR-WS-003） -->
      <PanelCard title="待办中心" subtitle="审核待办仅推送给审核员与机管">
        <template #extra>
          <button class="link-btn" @click="onPending('待办中心')">
            全部 <AppIcon name="arrow-right" :size="13" />
          </button>
        </template>
        <div class="todo-tabs">
          <button
            v-for="tab in TODO_TABS"
            :key="tab"
            :class="{ active: todoTab === tab }"
            @click="todoTab = tab"
          >
            {{ tab }}
          </button>
        </div>
        <ul class="todo-list">
          <li v-for="todo in todos" :key="todo.title">
            <span class="tag" :class="todo.type === '协同消息' ? 'tag-blue' : 'tag-green'">
              {{ todo.type }}
            </span>
            <div class="todo-main">
              <div class="todo-title">{{ todo.title }}</div>
              <div class="todo-meta">
                {{ todo.submitter }} 提交于 {{ todo.submittedAt }}
                <em v-if="todo.overtime" class="overtime">已等待 {{ todo.waitingHours }}h · 超时</em>
              </div>
            </div>
            <button class="mini-btn" @click="onPending(todo.type)">去处理</button>
          </li>
          <li v-if="todos.length === 0" class="empty">暂无待办，一切就绪 ✨</li>
        </ul>
      </PanelCard>

      <!-- 业务趋势（FR-WS-004） -->
      <PanelCard title="业务趋势" subtitle="近 30 天新增题目与试卷">
        <TrendChart
          :labels="overview.trend.days"
          :series="[
            { name: '新增题目', data: overview.trend.newQuestions, color: '#00b4a6' },
            { name: '新增试卷', data: overview.trend.newPapers, color: '#f59e0b' },
          ]"
        />
      </PanelCard>
    </div>

    <!-- 加载态 -->
    <div v-if="loading" class="loading panel">
      <AppIcon name="clock" :size="20" class="spin" />
      正在加载机构数据…
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

/* ---- AI 用量卡 ---- */
.stat-card {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  padding: 20px;
  transition: transform 0.2s, box-shadow 0.2s;
}
.stat-card:hover { transform: translateY(-3px); box-shadow: var(--shadow-lg); }
.stat-icon {
  width: 44px; height: 44px;
  border-radius: 12px;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
  background: var(--brand-soft);
  color: var(--brand-deep);
}
.stat-main { flex: 1; min-width: 0; }
.stat-label { font-size: 13px; color: var(--ink-2); }
.stat-value { font-size: 22px; font-weight: 700; margin-top: 4px; font-variant-numeric: tabular-nums; }
.quota-ok .quota-value { color: var(--ink); }
.quota-warn .quota-value { color: var(--warn); }
.quota-full .quota-value { color: var(--danger); }
.quota-bar {
  height: 7px;
  border-radius: 4px;
  background: #eef1f7;
  margin-top: 9px;
  overflow: hidden;
}
.quota-bar i { display: block; height: 100%; border-radius: 4px; background: var(--brand-grad); transition: width 0.6s ease; }
.quota-warn .quota-bar i { background: linear-gradient(90deg, #f0a13a, #e6930d); }
.quota-full .quota-bar i { background: linear-gradient(90deg, #e05656, #d64545); }
.quota-hint { font-size: 12px; color: var(--sub); margin-top: 6px; }
.quota-warn .quota-hint { color: var(--warn); }
.quota-full .quota-hint { color: var(--danger); }

/* ---- 快捷操作 ---- */
.quick-actions {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 14px;
  padding: 18px 20px;
}
@media (max-width: 1100px) {
  .quick-actions { grid-template-columns: repeat(3, 1fr); }
}
.quick-btn {
  border: 1px solid var(--border);
  border-radius: 13px;
  background: #fbfcfe;
  padding: 16px 10px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  transition: border-color 0.2s, background 0.2s, transform 0.2s, box-shadow 0.2s;
}
.quick-btn:hover {
  border-color: var(--brand);
  background: var(--brand-soft);
  transform: translateY(-2px);
  box-shadow: 0 8px 18px rgba(0, 180, 166, 0.16);
}
.quick-icon {
  width: 46px; height: 46px;
  border-radius: 13px;
  background: var(--brand-grad);
  color: #fff;
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 6px 14px rgba(0, 180, 166, 0.3);
}
.quick-label { font-size: 14px; font-weight: 600; color: var(--ink); }

.dual {
  display: grid;
  grid-template-columns: 3fr 2fr;
  gap: 18px;
  align-items: start;
}
@media (max-width: 1100px) {
  .dual { grid-template-columns: 1fr; }
}

/* ---- 待办 ---- */
.todo-tabs {
  display: flex;
  gap: 6px;
  border-bottom: 1px solid var(--border);
  margin-bottom: 6px;
  overflow-x: auto;
}
.todo-tabs button {
  border: none;
  background: none;
  font-size: 13.5px;
  color: var(--ink-2);
  padding: 7px 13px;
  border-radius: 9px 9px 0 0;
  position: relative;
  white-space: nowrap;
}
.todo-tabs button.active { color: var(--brand-deep); font-weight: 700; }
.todo-tabs button.active::after {
  content: '';
  position: absolute;
  left: 13px; right: 13px; bottom: -1px;
  height: 3px;
  border-radius: 3px 3px 0 0;
  background: var(--brand-grad);
}
.todo-list li {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 2px;
  border-bottom: 1px solid #f1f3f8;
}
.todo-list li:last-child { border-bottom: none; }
.todo-list li.empty {
  justify-content: center;
  color: var(--sub);
  padding: 34px 0;
  font-size: 13.5px;
}
.todo-main { flex: 1; min-width: 0; }
.todo-title {
  font-size: 13.5px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.todo-meta { font-size: 12px; color: var(--sub); margin-top: 3px; }
.todo-meta .overtime {
  font-style: normal;
  color: var(--danger);
  font-weight: 600;
  margin-left: 6px;
}
.mini-btn {
  border: none;
  border-radius: 8px;
  background: var(--brand-grad);
  color: #fff;
  font-size: 12px;
  font-weight: 600;
  padding: 5px 12px;
  flex-shrink: 0;
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
.link-btn:hover { color: var(--brand-deep); }

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
