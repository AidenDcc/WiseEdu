<script setup lang="ts">
/**
 * AI 能力中心（T-10-01 / 02）：能力总入口 + 任务中心。
 *
 * 上半屏是能力卡片（AI 出题 / 组卷 / 讲义 / 课件 / 识题 / 阅卷 / 学情 / 助手），
 * 点卡片直达对应业务页；下半屏是任务中心 —— 所有 AI 任务的执行轨迹
 * （状态、耗时、token 消耗、产物数），token 计量对应机构 AI 用量计费。
 */
import { computed, onMounted, ref } from 'vue'
import { AI_TASK_STATUS_TEXT, AppIcon, AppPageHeader, appConfirm, showToast } from '@aiteach/shared'
import type { AiCapabilityCard, AiCenterTask } from '@aiteach/shared'
import { cancelAiTask, fetchAiCapabilities, fetchAiTasks } from '@/api/student'

const capabilities = ref<AiCapabilityCard[]>([])
const tasks = ref<AiCenterTask[]>([])
const sceneFilter = ref('')
const loading = ref(true)

async function load() {
  loading.value = true
  const [cards, taskList] = await Promise.all([fetchAiCapabilities(), fetchAiTasks(sceneFilter.value)])
  capabilities.value = cards
  tasks.value = taskList
  loading.value = false
}

const SCENES = ['出题', '组卷', '讲义', '课件', '识题', '阅卷', '学情', '问答']

const stats = computed(() => {
  const monthUses = capabilities.value.reduce((sum, row) => sum + row.monthUses, 0)
  const monthTokens = tasks.value.reduce((sum, row) => sum + row.tokens, 0)
  return {
    monthUses,
    monthTokens,
    running: tasks.value.filter((row) => row.status === 'running').length,
    reviewing: tasks.value.filter((row) => row.status === 'reviewing').length,
  }
})

function statusTag(status: AiCenterTask['status']) {
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

onMounted(load)
</script>

<template>
  <div class="page">
    <AppPageHeader desc="机构全部 AI 能力的总入口与任务中心；任务 token 消耗计入机构 AI 用量（见工作台 · AI 用量与余额）。" />

    <!-- 用量概览 -->
    <div class="stat-row">
      <div class="stat-card">
        <span class="stat-label">本月能力调用</span>
        <b class="stat-value">{{ stats.monthUses }}</b>
        <span class="stat-sub">次（8 项 AI 能力）</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">近期 token 消耗</span>
        <b class="stat-value">{{ stats.monthTokens.toLocaleString() }}</b>
        <span class="stat-sub">tokens（任务中心口径）</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">进行中任务</span>
        <b class="stat-value">{{ stats.running }}</b>
        <span class="stat-sub">个</span>
      </div>
      <div class="stat-card">
        <span class="stat-label">待复核产物</span>
        <b class="stat-value warn">{{ stats.reviewing }}</b>
        <span class="stat-sub">AI 内容须经教师复核后生效</span>
      </div>
    </div>

    <!-- 能力入口 -->
    <div class="panel">
      <h3 class="panel-title">AI 能力入口</h3>
      <div class="cap-grid">
        <router-link v-for="card in capabilities" :key="card.key" class="cap-card" :to="card.link">
          <div class="cap-icon"><AppIcon :name="card.icon" :size="20" /></div>
          <div class="cap-body">
            <div class="cap-title">{{ card.title }}<span class="cap-uses">本月 {{ card.monthUses }} 次</span></div>
            <p class="cap-desc">{{ card.desc }}</p>
          </div>
          <AppIcon name="close" class="cap-arrow" :size="14" />
        </router-link>
      </div>
    </div>

    <!-- 任务中心 -->
    <div class="panel">
      <div class="task-head">
        <h3 class="panel-title">AI 任务中心</h3>
        <select v-model="sceneFilter" class="f-select" @change="load">
          <option value="">全部场景</option>
          <option v-for="scene in SCENES" :key="scene" :value="scene">{{ scene }}</option>
        </select>
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
            <tr v-else-if="tasks.length === 0">
              <td colspan="9" class="empty-row">暂无任务</td>
            </tr>
            <template v-else>
              <tr v-for="row in tasks" :key="row.id">
                <td class="cell-strong">{{ row.title }}</td>
                <td><span class="tag tag-blue">{{ row.scene }}</span></td>
                <td>{{ row.creator }}</td>
                <td><span class="tag" :class="statusTag(row.status)">{{ AI_TASK_STATUS_TEXT[row.status] }}</span></td>
                <td>{{ row.elapsed }}s</td>
                <td class="mono">{{ row.tokens.toLocaleString() }}</td>
                <td>{{ row.outputCount ? `${row.outputCount} 项` : '—' }}</td>
                <td class="mono">{{ row.createdAt }}</td>
                <td>
                  <div class="op-group">
                    <button v-if="row.status === 'running'" class="mini-btn danger" @click="onCancel(row)">取消</button>
                    <span v-else class="muted">—</span>
                  </div>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
    </div>
  </div>
</template>

<style scoped>
.stat-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 14px; margin-bottom: 14px; }
.stat-card {
  background: #fff; border: 1px solid var(--border); border-radius: 12px; padding: 16px 18px;
  display: flex; flex-direction: column; gap: 4px;
}
.stat-label { font-size: 12.5px; color: var(--sub); }
.stat-value { font-size: 26px; font-weight: 700; color: var(--text); font-variant-numeric: tabular-nums; }
.stat-value.warn { color: #d9822b; }
.stat-sub { font-size: 12px; color: var(--sub); }
.panel-title { font-size: 14px; margin: 0 0 14px; }
.task-head { display: flex; align-items: center; justify-content: space-between; }
.cap-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
.cap-card {
  display: flex; align-items: center; gap: 14px; padding: 14px 16px;
  border: 1.5px solid var(--border); border-radius: 12px; text-decoration: none;
  color: inherit; transition: border-color 0.15s, box-shadow 0.15s;
}
.cap-card:hover { border-color: var(--brand); box-shadow: 0 2px 10px rgba(47, 108, 253, 0.08); }
.cap-icon {
  width: 44px; height: 44px; border-radius: 10px; background: var(--brand-soft); color: var(--brand-deep);
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
}
.cap-body { flex: 1; min-width: 0; }
.cap-title { font-size: 14px; font-weight: 600; display: flex; align-items: baseline; gap: 8px; }
.cap-uses { font-size: 11.5px; color: var(--sub); font-weight: 400; }
.cap-desc {
  margin: 4px 0 0; font-size: 12px; color: var(--sub); line-height: 1.6;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.cap-arrow { color: var(--sub); transform: rotate(-45deg); flex-shrink: 0; }
.mono { font-family: 'SF Mono', Menlo, monospace; font-size: 12px; }
.muted { color: var(--sub); font-size: 12px; }
</style>
